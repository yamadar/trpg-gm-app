// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createEndingsRouter } from './endings.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { sessionKey } from '../storage/paths.js';

let dir;
let dataStore;
let app;

const STATS = { total: 3, successes: 2, successRate: 2 / 3, byDegree: { fumble: 0, fail: 1, success: 2, critical: 0 }, degrees: ['fumble', 'fail', 'success', 'critical'], resources: {} };

function okFetch(payload = { ending_title: '灰は星を数えない', summary: '総括の文。' }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(payload) }] },
        finishReason: 'STOP',
      }],
    }),
  });
}

function buildApp(opts = {}) {
  const apiKey = 'apiKey' in opts ? opts.apiKey : 'test-key';
  const { fetchImpl = okFetch(), usage, userId = 'usr_test', model = 'gemini-text' } = opts;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = userId;
    next();
  });
  app.use('/api', createEndingsRouter({ dataStore, apiKey, model, fetchImpl, usage }));
}

async function putSession(id, overrides = {}) {
  await dataStore.set(sessionKey('usr_test', id), {
    id,
    title: '星降りの夜に',
    endedAt: 500,
    worldId: 'w1',
    campaignId: 'cp1',
    rulesetId: 'coc7e',
    ruleset: { id: 'coc7e', formula: 'coc7e' },
    moods: ['ホラー'],
    state: { history_summary: 'まとめ' },
    log: [{ role: 'gm', text: '最後の場面' }],
    ...overrides,
  });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'endings-route-test-'));
  dataStore = createFsDataStore(dir);
  buildApp();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('endings routes', () => {
  it('returns 500 when no API key is configured', async () => {
    buildApp({ apiKey: undefined });
    await putSession('s1');
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.status).toBe(500);
  });

  it('returns 404 for a missing session', async () => {
    const res = await request(app).post('/api/sessions/missing/ending').send({ stats: STATS });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a session that has not ended', async () => {
    await putSession('s1', { endedAt: undefined });
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.status).toBe(400);
  });

  it('returns 400 when stats is missing or not an object', async () => {
    await putSession('s1');
    expect((await request(app).post('/api/sessions/s1/ending').send({})).status).toBe(400);
    expect((await request(app).post('/api/sessions/s1/ending').send({ stats: 'x' })).status).toBe(400);
  });

  it('records the ending with the session fields and the supplied stats', async () => {
    await putSession('s1');
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sessionId: 's1',
      sessionTitle: '星降りの夜に',
      endingTitle: '灰は星を数えない',
      summary: '総括の文。',
      endedAt: 500,
      worldId: 'w1',
      campaignId: 'cp1',
      rulesetId: 'coc7e',
      formula: 'coc7e',
      moods: ['ホラー'],
      stats: STATS,
    });
    expect(typeof res.body.recordedAt).toBe('number');
  });

  it('records a null formula for a legacy session with no ruleset snapshot', async () => {
    await putSession('s1', { ruleset: undefined });
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.body.formula).toBeNull();
  });

  it('returns 502 and saves nothing when naming fails', async () => {
    buildApp({ fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }) });
    await putSession('s1');
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.status).toBe(502);
    expect(await request(app).get('/api/endings').then((r) => r.body)).toEqual([]);
  });

  it('returns 429 when the daily limit is exhausted, without calling the model', async () => {
    const fetchImpl = okFetch();
    buildApp({ fetchImpl, usage: { consume: async () => ({ ok: false, resetAt: 456 }) } });
    await putSession('s1');
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.status).toBe(429);
    expect(res.body.resetAt).toBe(456);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns 502 instead of a generic 500 when usage.consume rejects (matches messages.js error handling)', async () => {
    const usage = { consume: vi.fn().mockRejectedValue(new Error('disk full')) };
    buildApp({ usage });
    await putSession('s1');
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'usage check failed: disk full' });
  });

  it('consumes the messages usage kind', async () => {
    const consume = vi.fn().mockResolvedValue({ ok: true });
    buildApp({ usage: { consume } });
    await putSession('s1');
    await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(consume).toHaveBeenCalledWith('usr_test', 'messages');
  });

  it('lists endings newest first', async () => {
    await putSession('a', { endedAt: 100 });
    await putSession('b', { endedAt: 300 });
    await request(app).post('/api/sessions/a/ending').send({ stats: STATS });
    await request(app).post('/api/sessions/b/ending').send({ stats: STATS });
    const res = await request(app).get('/api/endings');
    expect(res.status).toBe(200);
    expect(res.body.map((e) => e.sessionId)).toEqual(['b', 'a']);
  });

  it('renames an ending', async () => {
    await putSession('s1');
    await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    const res = await request(app).patch('/api/endings/s1').send({ endingTitle: '  新しい題  ' });
    expect(res.status).toBe(200);
    expect(res.body.endingTitle).toBe('新しい題');
    expect(res.body.summary).toBe('総括の文。'); // 他のフィールドは保たれる
  });

  it('rejects a blank rename and a missing ending', async () => {
    await putSession('s1');
    await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect((await request(app).patch('/api/endings/s1').send({ endingTitle: '   ' })).status).toBe(400);
    expect((await request(app).patch('/api/endings/nope').send({ endingTitle: 'x' })).status).toBe(404);
  });

  it('deletes an ending', async () => {
    await putSession('s1');
    await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect((await request(app).delete('/api/endings/s1')).status).toBe(204);
    expect((await request(app).get('/api/endings')).body).toEqual([]);
  });

  it('does not expose the endings of another user', async () => {
    await putSession('s1');
    await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    buildApp({ userId: 'usr_other' });
    expect((await request(app).get('/api/endings')).body).toEqual([]);
    expect((await request(app).patch('/api/endings/s1').send({ endingTitle: 'x' })).status).toBe(404);
  });
});
