// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createSessionsRouter } from './sessions.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';

let dir;
let dataStore;
let textStore;
let app;

function buildApp(opts = {}) {
  // Use `'apiKey' in opts` rather than a destructured default so that an
  // explicit `{ apiKey: undefined }` (used to simulate "no API key
  // configured") is not silently overwritten by the default value — a
  // destructured default (`{ apiKey = 'test-key' }`) triggers on any
  // `undefined` value, explicit or not.
  const apiKey = 'apiKey' in opts ? opts.apiKey : 'test-key';
  const { fetchImpl, usage } = opts;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createSessionsRouter({ dataStore, textStore, apiKey, fetchImpl, usage }));
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-route-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
  buildApp();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('sessions routes', () => {
  it('returns 404 for a missing session', async () => {
    const res = await request(app).get('/api/sessions/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a session', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'My Session' });
    const res = await request(app).get('/api/sessions/s1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 's1', title: 'My Session' });
  });

  it('lists saved sessions', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A' });
    await request(app).put('/api/sessions/s2').send({ title: 'B' });
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('returns 404 from novelize when the session does not exist', async () => {
    const res = await request(app).post('/api/sessions/missing/novelize');
    expect(res.status).toBe(404);
  });

  it('returns 500 from novelize when no API key is configured', async () => {
    buildApp({ apiKey: undefined });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(500);
  });

  it('generates and stores a novelization from the session log, retrievable via GET', async () => {
    const fetchImpl = async (url, options) => {
      const body = JSON.parse(options.body);
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(body.messages[0].content).toContain('波止場を調べる');
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: '小説化された本文。' }], stop_reason: 'end_turn' }),
      };
    };
    buildApp({ fetchImpl });

    await request(app)
      .put('/api/sessions/s1')
      .send({
        title: 'A',
        log: [
          { role: 'player', text: '波止場を調べる' },
          { role: 'gm', text: '波止場には誰もいなかった。' },
        ],
      });

    const postRes = await request(app).post('/api/sessions/s1/novelize');
    expect(postRes.status).toBe(200);
    expect(postRes.body).toEqual({ ok: true });

    const getRes = await request(app).get('/api/sessions/s1/novel');
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({ text: '小説化された本文。', stale: false });
  });

  it('marks the novel stale after the session advances past the novelized turn', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '小説' }], stop_reason: 'end_turn' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 3 } });
    await request(app).post('/api/sessions/s1/novelize');
    // セッションが進行(turn_count 3 → 5)
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 5 } });
    const res = await request(app).get('/api/sessions/s1/novel');
    expect(res.body.stale).toBe(true);
  });

  it('rejects a truncated (max_tokens) novelization without saving', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '途中' }], stop_reason: 'max_tokens' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(502);
    const get = await request(app).get('/api/sessions/s1/novel');
    expect(get.status).toBe(404); // 保存されていない
  });

  it('rejects an empty novelization without saving', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [], stop_reason: 'end_turn' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(502);
  });

  it('returns 404 from GET novel when nothing has been generated yet', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    const res = await request(app).get('/api/sessions/s1/novel');
    expect(res.status).toBe(404);
  });

  it('returns 502 from novelize when the upstream call fails', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(502);
  });

  it('returns 429 from novelize when the daily limit is exhausted', async () => {
    buildApp({ usage: { consume: async () => ({ ok: false, resetAt: 456 }) } });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(429);
    expect(res.body.resetAt).toBe(456);
  });

  it('consumes usage with the novelize kind and proceeds when allowed', async () => {
    const consume = vi.fn().mockResolvedValue({ ok: true });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '小説' }], stop_reason: 'end_turn' }),
    });
    buildApp({ usage: { consume }, fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(consume).toHaveBeenCalledWith('usr_test', 'novelize');
    expect(fetchImpl).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('returns 400 when the session body is not an object', async () => {
    const res = await request(app).put('/api/sessions/s1').set('Content-Type', 'application/json').send('"a string"');
    expect(res.status).toBe(400);
  });

  it('does not see sessions of another user', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A' }); // usr_test として保存
    // 別ユーザーでappを作り直す
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.userId = 'usr_other'; next(); });
    app.use('/api', createSessionsRouter({ dataStore, textStore, apiKey: 'test-key' }));
    expect((await request(app).get('/api/sessions/s1')).status).toBe(404);
    expect((await request(app).get('/api/sessions')).body).toEqual([]);
  });
});
