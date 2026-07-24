// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createSceneImagesRouter } from './sceneImages.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsImageStore } from '../storage/imageStore.js';
import { sessionKey } from '../storage/paths.js';

let dir, dataStore, imageStore, app;
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');

function analysisResponse() {
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ present_names: [], new_appearances: [] }) }] }) };
}
function geminiResponse() {
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: PNG_B64, mimeType: 'image/png' } }] } }] }) };
}
function routedFetch() {
  return vi.fn(async (url) => (String(url).includes('anthropic') ? analysisResponse() : geminiResponse()));
}

function buildApp(opts = {}) {
  // 明示的な `{ geminiApiKey: undefined }`(キー未設定の再現)が分割代入デフォルトで
  // 上書きされないよう `in` 判定で拾う(sessions.test.js の apiKey と同じ理由)。
  const geminiApiKey = 'geminiApiKey' in opts ? opts.geminiApiKey : 'gem';
  const { anthropicApiKey = 'anth', geminiModel = 'gemini-2.5-flash-image', fetchImpl = routedFetch(), usage } = opts;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createSceneImagesRouter({ dataStore, imageStore, anthropicApiKey, geminiApiKey, geminiModel, fetchImpl, usage }));
}

async function seedSession() {
  await dataStore.set(sessionKey('usr_test', 's1'), {
    id: 's1',
    moods: ['ホラー'],
    pc: { raw: 'PC名: カイ' },
    log: [{ role: 'gm', text: '廃坑の入口' }],
  });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-images-test-'));
  dataStore = createFsDataStore(dir);
  imageStore = createFsImageStore(dir);
  buildApp();
  await seedSession();
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('POST /sessions/:id/images', () => {
  it('generates an image and returns an imageId', async () => {
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.imageId).toMatch(/^img_/);
  });
  it('returns 501 when the gemini key is not configured', async () => {
    buildApp({ geminiApiKey: undefined });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(501);
  });
  it('returns 404 for a missing session', async () => {
    const res = await request(app).post('/api/sessions/missing/images').send({ logIndex: 0 });
    expect(res.status).toBe(404);
  });
  it('returns 400 when logIndex does not reference a gm entry', async () => {
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 5 });
    expect(res.status).toBe(400);
  });
  it('returns 429 when the daily image limit is reached', async () => {
    buildApp({ usage: { consume: async () => ({ ok: false, resetAt: 9 }) } });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(429);
  });
  it('still returns an image when scene analysis fails', async () => {
    const fetchImpl = vi.fn(async (url) => (String(url).includes('anthropic') ? { ok: false, json: async () => ({}) } : geminiResponse()));
    buildApp({ fetchImpl });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.imageId).toMatch(/^img_/);
  });
  it('returns 502 when image generation fails', async () => {
    const fetchImpl = vi.fn(async (url) => (String(url).includes('anthropic') ? analysisResponse() : { ok: false, status: 500, text: async () => 'err' }));
    buildApp({ fetchImpl });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(502);
  });
});

describe('GET /sessions/:id/images/:imageId', () => {
  it('serves the stored PNG bytes', async () => {
    const gen = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    const res = await request(app).get(`/api/sessions/s1/images/${gen.body.imageId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });
  it('returns 404 for a missing image', async () => {
    const res = await request(app).get('/api/sessions/s1/images/img_missing');
    expect(res.status).toBe(404);
  });
  it('returns 400 for a malformed imageId', async () => {
    const res = await request(app).get('/api/sessions/s1/images/badid');
    expect(res.status).toBe(400);
  });
});
