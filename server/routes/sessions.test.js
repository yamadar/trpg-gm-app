// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createSessionsRouter } from './sessions.js';
import { createNovelJobRunner } from '../novelJobs.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { createFsImageStore } from '../storage/imageStore.js';
import { sessionImagePath, sessionNovelJobKey } from '../storage/paths.js';

let dir;
let dataStore;
let textStore;
let imageStore;
let app;
let runner;

function buildApp(opts = {}) {
  // Use `'apiKey' in opts` rather than a destructured default so that an
  // explicit `{ apiKey: undefined }` (used to simulate "no API key
  // configured") is not silently overwritten by the default value — a
  // destructured default (`{ apiKey = 'test-key' }`) triggers on any
  // `undefined` value, explicit or not.
  const apiKey = 'apiKey' in opts ? opts.apiKey : 'test-key';
  const { fetchImpl, usage, bootId = 'boot-test', now } = opts;
  runner = createNovelJobRunner({ dataStore, textStore, apiKey, fetchImpl, bootId, now });
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createSessionsRouter({ dataStore, textStore, imageStore, apiKey, novelJobs: runner, usage }));
}

// 非同期ジョブの完了を待つ。完了済みならpendingから消えているのでそのまま抜ける。
async function waitForJob(sessionId) {
  await runner.pending.get(`usr_test/${sessionId}`);
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-route-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
  imageStore = createFsImageStore(dir);
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
      expect(body.messages[0].content[0].text).toContain('波止場を調べる');
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
    expect(postRes.status).toBe(202);
    expect(postRes.body).toEqual({ status: 'running' });
    await waitForJob('s1');

    const getRes = await request(app).get('/api/sessions/s1/novel');
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({ text: '小説化された本文。', stale: false });
  });

  it('挿絵付きセッションのnovelizeはマーカー入りnovel.mdとメタimageIdsを保存する', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '小説本文\n〈挿絵1〉\n続き' }], stop_reason: 'end_turn' }),
    });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({
      title: 'T',
      state: { turn_count: 1 },
      log: [{ role: 'gm', text: '森', image: { imageId: 'img_a' } }],
    });
    const res = await request(app).post('/api/sessions/s1/novelize').send({});
    expect(res.status).toBe(202);
    await waitForJob('s1');
    // upstreamへ渡したトランスクリプトにマーカーが含まれ、systemに保持指示がある
    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sentBody.messages[0].content[0].text).toContain('〈挿絵1〉');
    expect(sentBody.system).toContain('挿絵挿入位置');
    // novel.mdはマーカー入り、メタにimageIds
    const saved = await textStore.read('users/usr_test/sessions/s1/novel.md');
    expect(saved).toContain('〈挿絵1〉');
    const meta = await dataStore.get('users/usr_test/sessions/s1/novel');
    expect(meta.imageIds).toEqual(['img_a']);
  });

  it('挿絵なしセッションのnovelizeはシステムプロンプトにマーカー指示を含めない', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '本文' }], stop_reason: 'end_turn' }),
    });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s2').send({ title: 'T', state: {}, log: [{ role: 'gm', text: 'x' }] });
    await request(app).post('/api/sessions/s2/novelize').send({});
    await waitForJob('s2');
    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sentBody.system).not.toContain('挿絵挿入位置');
  });

  it('GET /novel はマーカーを除去したプレーン本文を返す', async () => {
    await request(app).put('/api/sessions/s3').send({ title: 'T', state: {}, log: [] });
    await textStore.write('users/usr_test/sessions/s3/novel.md', '前\n〈挿絵1〉\n後');
    const res = await request(app).get('/api/sessions/s3/novel');
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('前\n後');
  });

  it('GET /novel/illustrated は挿絵入りMarkdownを返す', async () => {
    await request(app).put('/api/sessions/s4').send({ title: 'T', state: {}, log: [] });
    await textStore.write('users/usr_test/sessions/s4/novel.md', '前\n〈挿絵1〉\n後');
    await dataStore.set('users/usr_test/sessions/s4/novel', { turnCount: 0, updatedAt: 1, imageIds: ['img_a'] });
    await imageStore.write(sessionImagePath('usr_test', 's4', 'img_a'), Buffer.from([1, 2]));
    const res = await request(app).get('/api/sessions/s4/novel/illustrated');
    expect(res.status).toBe(200);
    expect(res.body.markdown).toContain('![挿絵1](data:image/png;base64,');
    expect(res.body.markdown).not.toContain('〈挿絵1〉');
  });

  it('GET /novel/illustrated は小説未生成なら404', async () => {
    await request(app).put('/api/sessions/s5').send({ title: 'T', state: {}, log: [] });
    const res = await request(app).get('/api/sessions/s5/novel/illustrated');
    expect(res.status).toBe(404);
  });

  it('marks the novel stale after the session advances past the novelized turn', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '小説' }], stop_reason: 'end_turn' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 3 } });
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');
    // セッションが進行(turn_count 3 → 5)
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 5 } });
    const res = await request(app).get('/api/sessions/s1/novel');
    expect(res.body.stale).toBe(true);
  });

  it('continues a truncated (max_tokens) novelization and saves the joined text', async () => {
    let call = 0;
    const fetchImpl = async () => {
      call += 1;
      return {
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: call === 1 ? '前半' : '後半' }],
          stop_reason: call === 1 ? 'max_tokens' : 'end_turn',
        }),
      };
    };
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(202);
    await waitForJob('s1');
    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.status).toBe('done');
    expect(jobs.body.s1.truncated).toBe(false);
    const get = await request(app).get('/api/sessions/s1/novel');
    expect(get.body.text).toBe('前半後半');
  });

  it('reports truncated in /novel-jobs when the novelization hit the continuation limit', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '途中' }], stop_reason: 'max_tokens' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');
    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.status).toBe('done');
    expect(jobs.body.s1.truncated).toBe(true);
    // 未完でも本文は残る。
    expect((await request(app).get('/api/sessions/s1/novel')).body.text).toContain('途中');
  });

  it('reports elapsedMs for a running job in /novel-jobs', async () => {
    // 実際の生成は一瞬で終わるためrunningを観測できない。ジョブレコードを直接置く。
    buildApp({ now: () => 5000 });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    await dataStore.set(sessionNovelJobKey('usr_test', 's1'), {
      status: 'running',
      startedAt: 1000,
      updatedAt: 1000,
      error: null,
      bootId: 'boot-test',
    });

    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.status).toBe('running');
    expect(jobs.body.s1.elapsedMs).toBe(4000);
  });

  it('reports a null elapsedMs for a finished job in /novel-jobs', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '小説' }], stop_reason: 'end_turn' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');

    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.status).toBe('done');
    expect(jobs.body.s1.elapsedMs).toBeNull();
  });

  it('records an error for an empty novelization without saving', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [], stop_reason: 'end_turn' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(202);
    await waitForJob('s1');
    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.status).toBe('error');
  });

  it('returns 404 from GET novel when nothing has been generated yet', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    const res = await request(app).get('/api/sessions/s1/novel');
    expect(res.status).toBe(404);
  });

  it('records an error when the upstream call fails', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(202);
    await waitForJob('s1');
    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.status).toBe('error');
    expect(jobs.body.s1.error).toContain('boom');
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
    expect(res.status).toBe(202);
    await waitForJob('s1');
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('returns 400 when the session body is not an object', async () => {
    const res = await request(app).put('/api/sessions/s1').set('Content-Type', 'application/json').send('"a string"');
    expect(res.status).toBe(400);
  });

  it('does not see sessions or novel-jobs of another user', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '本文' }], stop_reason: 'end_turn' }),
    });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: {} }); // usr_test として保存
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');
    expect((await request(app).get('/api/novel-jobs')).body.s1.status).toBe('done'); // usr_test自身には見える

    // 別ユーザーでappを作り直す(/novel-jobsも叩けるようnovelJobsも渡す)
    const otherRunner = createNovelJobRunner({ dataStore, textStore, apiKey: 'test-key' });
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.userId = 'usr_other'; next(); });
    app.use('/api', createSessionsRouter({ dataStore, textStore, imageStore, apiKey: 'test-key', novelJobs: otherRunner }));
    expect((await request(app).get('/api/sessions/s1')).status).toBe(404);
    expect((await request(app).get('/api/sessions')).body).toEqual([]);
    expect((await request(app).get('/api/novel-jobs')).body).toEqual({}); // usr_testの完了ジョブが漏れない
  });

  it('returns an empty map from /novel-jobs when there are no sessions', async () => {
    const res = await request(app).get('/api/novel-jobs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('reports idle for a session that has never been novelized', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [], state: {} });
    const res = await request(app).get('/api/novel-jobs');
    expect(res.body.s1).toEqual({ status: 'idle', error: null, elapsedMs: null, hasNovel: false, stale: false, truncated: false });
  });

  it('reports running while the job is in flight and done afterwards', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn().mockImplementation(async () => {
      await gate;
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '本文' }], stop_reason: 'end_turn' }) };
    });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 1 } });

    await request(app).post('/api/sessions/s1/novelize');
    const during = await request(app).get('/api/novel-jobs');
    expect(during.body.s1.status).toBe('running');

    release();
    await waitForJob('s1');
    const after = await request(app).get('/api/novel-jobs');
    expect(after.body.s1).toMatchObject({ status: 'done', hasNovel: true, stale: false });
  });

  it('reports stale in /novel-jobs after the session advances', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '小説' }], stop_reason: 'end_turn' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 3 } });
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 5 } });

    const res = await request(app).get('/api/novel-jobs');
    expect(res.body.s1.stale).toBe(true);
  });

  it('reports a job left running by a previous process as an error', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [], state: {} });
    await dataStore.set('users/usr_test/sessions/s1/novelJob', {
      status: 'running',
      startedAt: 1,
      updatedAt: 1,
      error: null,
      bootId: 'other-boot',
    });
    const res = await request(app).get('/api/novel-jobs');
    expect(res.body.s1.status).toBe('error');
    expect(res.body.s1.error).toContain('再起動');
  });

  it('does not consume usage or start a second run while a job is already running', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn().mockImplementation(async () => {
      await gate;
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '本文' }], stop_reason: 'end_turn' }) };
    });
    const consume = vi.fn().mockResolvedValue({ ok: true });
    buildApp({ fetchImpl, usage: { consume } });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: {} });

    await request(app).post('/api/sessions/s1/novelize');
    const second = await request(app).post('/api/sessions/s1/novelize');
    expect(second.status).toBe(202);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    release();
    await waitForJob('s1');
  });

  it('starts a new run after a previous job finished', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '本文' }], stop_reason: 'end_turn' }),
    });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: {} });

    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
