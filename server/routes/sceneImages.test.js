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
import { sessionKey, sessionImagePath } from '../storage/paths.js';

let dir, dataStore, imageStore, app;
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');

function analysisResponse(payload = { present_names: [], new_appearances: [] }) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(payload) }] },
        finishReason: 'STOP',
      }],
    }),
  };
}
function geminiResponse() {
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: PNG_B64, mimeType: 'image/png' } }] } }] }) };
}
function routedFetch() {
  return vi.fn(async (url) => (String(url).includes('gemini-text') ? analysisResponse() : geminiResponse()));
}
function analysisWithNew(name, description) {
  return analysisResponse({
    present_names: [name],
    new_appearances: [{ name, description }],
  });
}

function buildApp(opts = {}) {
  // 明示的な `{ geminiImageApiKey: undefined }`(キー未設定の再現)が分割代入デフォルトで
  // 上書きされないよう `in` 判定で拾う(sessions.test.js の apiKey と同じ理由)。
  const geminiImageApiKey = 'geminiImageApiKey' in opts ? opts.geminiImageApiKey : 'gem';
  const {
    geminiTextApiKey = 'text-key',
    geminiTextModel = 'gemini-text',
    geminiImageModel = 'gemini-image',
    fetchImpl = routedFetch(),
    usage,
  } = opts;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createSceneImagesRouter({
    dataStore,
    imageStore,
    geminiTextApiKey,
    geminiTextModel,
    geminiImageApiKey,
    geminiImageModel,
    fetchImpl,
    usage,
  }));
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
    buildApp({ geminiImageApiKey: undefined });
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
    const fetchImpl = vi.fn(async (url) => (String(url).includes('gemini-text') ? { ok: false, json: async () => ({}) } : geminiResponse()));
    buildApp({ fetchImpl });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.imageId).toMatch(/^img_/);
  });
  it('returns 502 when image generation fails', async () => {
    const fetchImpl = vi.fn(async (url) => (String(url).includes('gemini-text') ? analysisResponse() : { ok: false, status: 500, text: async () => 'err' }));
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

describe('portrait generation and reference images', () => {
  it('新キャラがいるとポートレート+シーンの2回Geminiを呼び、newAppearancesにimageIdが付く', async () => {
    const fetchImpl = vi.fn(async (url) =>
      String(url).includes('gemini-text') ? analysisWithNew('村長', '白髪の老人') : geminiResponse()
    );
    const consume = vi.fn().mockResolvedValue({ ok: true });
    buildApp({ fetchImpl, usage: { consume } });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    const geminiCalls = fetchImpl.mock.calls.filter(([u]) => !String(u).includes('gemini-text'));
    expect(geminiCalls).toHaveLength(2); // ポートレート + シーン
    expect(res.body.newAppearances[0].imageId).toMatch(/^img_/);
    // ポートレートのプロンプトはbust shot
    const portraitBody = JSON.parse(geminiCalls[0][1].body);
    expect(portraitBody.contents[0].parts.at(-1).text).toContain('bust shot');
    // usage: シーン1 + ポートレート1 = 2回
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it('その場にいない(言及だけの)人物はポートレートもシーンプロンプトにも含めない', async () => {
    const fetchImpl = vi.fn(async (url) =>
      String(url).includes('gemini-text')
        ? analysisResponse({
            present_names: ['ゲオルク'],
            new_appearances: [
              { name: 'ゲオルク', description: '白髪の老人、厚手の外套' },
              { name: 'ハンス', description: 'ゲオルクの息子。言及されるのみ' },
            ],
          })
        : geminiResponse()
    );
    buildApp({ fetchImpl });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.newAppearances.map((a) => a.name)).toEqual(['ゲオルク']);
    const geminiCalls = fetchImpl.mock.calls.filter(([u]) => !String(u).includes('gemini-text'));
    expect(geminiCalls).toHaveLength(2); // ゲオルクのポートレート + シーン(ハンスの分は生成しない)
    const scenePrompt = JSON.parse(geminiCalls.at(-1)[1].body).contents[0].parts.at(-1).text;
    expect(scenePrompt).toContain('ゲオルク');
    expect(scenePrompt).not.toContain('ハンス');
  });

  it('既知キャラがimageIdを持つ場合、シーン生成に参照inlineDataを渡す', async () => {
    await dataStore.set(sessionKey('usr_test', 's1'), {
      id: 's1',
      moods: [],
      pc: { raw: '' },
      appearances: { カイ: { name: 'カイ', description: '赤髪', imageId: 'img_port1' } },
      log: [{ role: 'gm', text: 'カイが進む' }],
    });
    await imageStore.write(sessionImagePath('usr_test', 's1', 'img_port1'), Buffer.from([9, 9]));
    const fetchImpl = vi.fn(async (url) =>
      String(url).includes('gemini-text')
        ? analysisResponse({ present_names: ['カイ'], new_appearances: [] })
        : geminiResponse()
    );
    buildApp({ fetchImpl });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    const sceneCall = fetchImpl.mock.calls.filter(([u]) => !String(u).includes('gemini-text')).at(-1);
    const body = JSON.parse(sceneCall[1].body);
    expect(body.contents[0].parts[0].inlineData.data).toBe(Buffer.from([9, 9]).toString('base64'));
    expect(body.contents[0].parts.at(-1).text).toContain('厳密に維持');
  });

  it('ポートレート生成が失敗してもシーンは200で、imageIdなしのnewAppearancesを返す', async () => {
    let geminiCount = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('gemini-text')) return analysisWithNew('村長', '白髪の老人');
      geminiCount += 1;
      if (geminiCount === 1) return { ok: false, status: 500, text: async () => 'err' };
      return geminiResponse();
    });
    buildApp({ fetchImpl });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.newAppearances[0].imageId).toBeUndefined();
  });

  it('ポートレート分の上限超過はスキップし、シーン生成は成功する', async () => {
    const consume = vi
      .fn()
      .mockResolvedValueOnce({ ok: true }) // シーン分
      .mockResolvedValue({ ok: false, resetAt: 1 }); // ポートレート分
    const fetchImpl = vi.fn(async (url) =>
      String(url).includes('gemini-text') ? analysisWithNew('村長', '白髪の老人') : geminiResponse()
    );
    buildApp({ fetchImpl, usage: { consume } });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.newAppearances[0].imageId).toBeUndefined();
    expect(fetchImpl.mock.calls.filter(([u]) => !String(u).includes('gemini-text'))).toHaveLength(1);
  });
});
