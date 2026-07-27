/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../server/index.js';
import { createTestUserSession } from '../../server/auth/testHelpers.js';
import { putCharacter, getCharacter } from './characterLibraryClient.js';
import { putWorld, putRegion, listRegions, deleteWorld } from './worldLibraryClient.js';

let dataDir;
let app;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fx5-integration-'));
  app = createApp({
    apiKey: 'test-key',
    dataDir,
    env: { GEMINI_TEXT_MODEL: 'text-model-test' },
  });
  // ルーター配線に認証(requireAuth)が挟まったため、シムからの全リクエストに
  // ログイン済みセッションのCookieを付与する(実クライアントはブラウザが
  // 自動的にCookieを送るが、このシムは手動でヘッダーを組み立てているため)。
  const { cookie } = await createTestUserSession(app.locals.dataStore);
  // 実クライアントは相対URLでglobal fetchを呼ぶ。supertestで実appへ往復させるシムに差し替える。
  vi.stubGlobal('fetch', async (url, options = {}) => {
    const method = (options.method || 'GET').toLowerCase();
    let req = request(app)[method](url).set('Cookie', cookie);
    if (options.headers) req = req.set(options.headers);
    if (options.body != null) req = req.send(options.body); // JSON文字列。Content-Typeは.setで設定済み
    const res = await req;
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body,
      text: async () => (typeof res.text === 'string' ? res.text : JSON.stringify(res.body)),
    };
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('client ↔ server integration', () => {
  it('round-trips a character through putCharacter/getCharacter', async () => {
    await putCharacter('w1', 'pc', 'alice', { raw: 'PC本文', revealed: undefined });
    const got = await getCharacter('w1', 'pc', 'alice');
    expect(got).toMatchObject({ raw: 'PC本文' });
  });

  it('deletes region content on the server when a world is deleted (FX3 cascade)', async () => {
    await putWorld('w1', { title: 'W', raw: '世界本文' });
    await putRegion('w1', 'north', { title: '北方地方', raw: '北の本文' });
    expect(await listRegions('w1')).toContainEqual({ id: 'north', title: '北方地方' });
    await deleteWorld('w1'); // 204。ボディをparseしないこともここで暗黙に検証
    expect(await listRegions('w1')).toEqual([]);
  });

  it('propagates a 400 from the server param guard when the client sends a slash-bearing id (FX3 guard e2e)', async () => {
    // client側でencodeURIComponent('a/b')='a%2Fb' → サーバーで'/'へデコード → idParamGuardが拒否
    await expect(
      putCharacter('w1', 'pc', 'a/b', { raw: 'x', revealed: undefined })
    ).rejects.toThrow('API error 400');
  });
});
