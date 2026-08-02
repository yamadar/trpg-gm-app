// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createApp, resolveSecureCookies, resolveStaticDir } from './index.js';
import { createTestUserSession } from './auth/testHelpers.js';

let dir;
let app;
let fetchImpl;

const TEST_ENV = { GEMINI_TEXT_MODEL: 'text-model-test' };
const testEnv = (overrides = {}) => ({ ...TEST_ENV, ...overrides });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-test-'));
  fetchImpl = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }),
  });
  app = createApp({ apiKey: 'test-key', dataDir: dir, fetchImpl, env: testEnv() });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createApp', () => {
  it('mounts fixed text operations and proxies via the injected fetchImpl', async () => {
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    const res = await request(app)
      .post('/api/text-operations/summarize-world')
      .set('Cookie', cookie)
      .set('X-GMDesk-CSRF', '1')
      .send({ input: { raw: '世界' } });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/text-model-test:generateContent',
      expect.anything(),
    );
  });

  it('uses separate text model and image key settings', async () => {
    app = createApp({
      apiKey: 'text-key',
      dataDir: dir,
      fetchImpl,
      env: {
        GEMINI_TEXT_MODEL: 'gemini-custom-text',
        GEMINI_IMAGE_API_KEY: 'image-key',
        GEMINI_IMAGE_MODEL: 'image-model-test',
      },
    });
    const { cookie } = await createTestUserSession(app.locals.dataStore);

    expect((await request(app).get('/api/config')).body).toEqual({ imageGen: true });
    await request(app)
      .post('/api/text-operations/summarize-world')
      .set('Cookie', cookie)
      .set('X-GMDesk-CSRF', '1')
      .send({ input: { raw: '世界' } });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-custom-text:generateContent',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goog-api-key': 'text-key' }),
      }),
    );
  });

  it('requires a text model when the text API key is configured', () => {
    expect(() => createApp({ apiKey: 'text-key', dataDir: dir, env: {} }))
      .toThrow(/GEMINI_TEXT_MODEL/);
  });

  it('requires an image model when the image API key is configured', () => {
    expect(() => createApp({
      apiKey: undefined,
      dataDir: dir,
      env: { GEMINI_IMAGE_API_KEY: 'image-key' },
    })).toThrow(/GEMINI_IMAGE_MODEL/);
  });

  it('mounts the sessions route', async () => {
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    const res = await request(app).get('/api/sessions').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('mounts the worlds route', async () => {
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    const res = await request(app).get('/api/worlds').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('mounts the rulesets route', async () => {
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    const res = await request(app).get('/api/rulesets').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('mounts the world content routes', async () => {
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    const res = await request(app).get('/api/worlds/w1/regions').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('404s on unknown routes', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });

  it('sets browser security headers without exposing Express', async () => {
    const res = await request(app).get('/api/config');
    expect(res.headers).not.toHaveProperty('x-powered-by');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toContain('camera=()');
  });

  it('returns and logs only redacted metadata for unexpected server errors', async () => {
    const secret = 'token=SUPER_SECRET_VALUE';
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    app.locals.dataStore.list = vi.fn().mockRejectedValue(new Error(secret));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app)
      .get(`/api/sessions?code=${encodeURIComponent(secret)}`)
      .set('Cookie', cookie);
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: 'internal server error',
      code: 'INTERNAL_SERVER_ERROR',
    });
    expect(res.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(res.body)).not.toContain(secret);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(secret);
    expect(errorSpy).toHaveBeenCalledWith(
      'request failed',
      expect.objectContaining({ requestId: res.body.requestId, path: '/api/sessions' }),
    );
    errorSpy.mockRestore();
  });

  it('preserves a thrown error status via the global handler', async () => {
    // 既知の400経路(不正なsession body)を通し、500ではなく400が返ることを確認
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    const res = await request(app)
      .put('/api/sessions/s1')
      .set('Cookie', cookie)
      .set('X-GMDesk-CSRF', '1')
      .set('Content-Type', 'application/json')
      .send('"x"');
    expect(res.status).toBe(400);
  });

  it('rejects /api requests without a session', async () => {
    expect((await request(app).get('/api/sessions')).status).toBe(401);
    expect(
      (await request(app)
        .post('/api/text-operations/summarize-world')
        .send({ input: { raw: '世界' } })).status,
    ).toBe(401);
  });

  it('serves /api/me as null and providers list without auth', async () => {
    expect((await request(app).get('/api/me')).body).toEqual({ user: null });
    expect((await request(app).get('/api/auth/providers')).status).toBe(200);
  });

  it('keeps data separated between two users end to end', async () => {
    const a = await createTestUserSession(app.locals.dataStore);
    const b = await createTestUserSession(app.locals.dataStore);
    await request(app)
      .put('/api/sessions/s1')
      .set('Cookie', a.cookie)
      .set('X-GMDesk-CSRF', '1')
      .send({ title: 'Aの卓' });
    expect((await request(app).get('/api/sessions/s1').set('Cookie', b.cookie)).status).toBe(404);
    expect((await request(app).get('/api/sessions/s1').set('Cookie', a.cookie)).status).toBe(200);
  });

  it('enforces the daily message limit via env', async () => {
    app = createApp({ apiKey: 'test-key', dataDir: dir, fetchImpl, env: testEnv({ LIMIT_MESSAGES_PER_DAY: '1' }) });
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    const send = () => request(app)
      .post('/api/text-operations/summarize-world')
      .set('Cookie', cookie)
      .set('X-GMDesk-CSRF', '1')
      .send({ input: { raw: '世界' } });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  it('LIMIT_MESSAGES_PER_DAY=0 denies all messages', async () => {
    app = createApp({ apiKey: 'test-key', dataDir: dir, fetchImpl, env: testEnv({ LIMIT_MESSAGES_PER_DAY: '0' }) });
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    expect((await request(app)
      .post('/api/text-operations/summarize-world')
      .set('Cookie', cookie)
      .set('X-GMDesk-CSRF', '1')
      .send({ input: { raw: '世界' } })).status).toBe(429);
  });

  it('LIMIT_MESSAGES_PER_DAY="" (blank) falls back to the default limit instead of denying all', async () => {
    app = createApp({ apiKey: 'test-key', dataDir: dir, fetchImpl, env: testEnv({ LIMIT_MESSAGES_PER_DAY: '' }) });
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    expect((await request(app)
      .post('/api/text-operations/summarize-world')
      .set('Cookie', cookie)
      .set('X-GMDesk-CSRF', '1')
      .send({ input: { raw: '世界' } })).status).toBe(200);
  });

  it('rejects cross-origin mutations', async () => {
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    const res = await request(app)
      .put('/api/sessions/s1')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .send({ title: 'x' });
    expect(res.status).toBe(403);
  });

  it('rejects authenticated no-Origin mutations without the CSRF header', async () => {
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    const rejected = await request(app)
      .put('/api/sessions/s1')
      .set('Cookie', cookie)
      .send({ title: 'x' });
    expect(rejected.status).toBe(403);
    const accepted = await request(app)
      .put('/api/sessions/s1')
      .set('Cookie', cookie)
      .set('X-GMDesk-CSRF', '1')
      .send({ title: 'x' });
    expect(accepted.status).toBe(200);
  });

  it('serves the public gallery without auth', async () => {
    expect((await request(app).get('/api/public/worlds')).status).toBe(200);
  });

  it('requires auth for publish and import', async () => {
    expect((await request(app).post('/api/publish/worlds/w1')).status).toBe(401);
    expect((await request(app).post('/api/import/worlds/pub_x')).status).toBe(401);
  });

  it('end to end: A publishes, anonymous reads, B imports a copy', async () => {
    const a = await createTestUserSession(app.locals.dataStore);
    const b = await createTestUserSession(app.locals.dataStore);
    await request(app)
      .put('/api/worlds/w1')
      .set('Cookie', a.cookie)
      .set('X-GMDesk-CSRF', '1')
      .send({ title: 'Aの世界', raw: '# 本文' });
    const pub = await request(app)
      .post('/api/publish/worlds/w1')
      .set('Cookie', a.cookie)
      .set('X-GMDesk-CSRF', '1');
    const { publicId } = pub.body;
    // 未認証で読める
    expect((await request(app).get(`/api/public/worlds/${publicId}`)).body.title).toBe('Aの世界');
    // Bがインポート → Bのライブラリに入る
    const imported = await request(app)
      .post(`/api/import/worlds/${publicId}`)
      .set('Cookie', b.cookie)
      .set('X-GMDesk-CSRF', '1');
    expect(imported.status).toBe(201);
    const bWorld = await request(app).get(`/api/worlds/${imported.body.id}`).set('Cookie', b.cookie);
    expect(bWorld.body.raw).toBe('# 本文');
    // Aのデータは不変・Bのインポート後にAが解除してもBのコピーは残る
    await request(app)
      .delete('/api/publish/worlds/w1')
      .set('Cookie', a.cookie)
      .set('X-GMDesk-CSRF', '1');
    expect((await request(app).get(`/api/public/worlds/${publicId}`)).status).toBe(404);
    expect((await request(app).get(`/api/worlds/${imported.body.id}`).set('Cookie', b.cookie)).status).toBe(200);
  });

  it('deleting a private item unpublishes it (cascade)', async () => {
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    await request(app)
      .put('/api/worlds/w1')
      .set('Cookie', cookie)
      .set('X-GMDesk-CSRF', '1')
      .send({ title: '世界', raw: '# 本文' });
    const pub = await request(app)
      .post('/api/publish/worlds/w1')
      .set('Cookie', cookie)
      .set('X-GMDesk-CSRF', '1');
    const { publicId } = pub.body;
    expect((await request(app).get(`/api/public/worlds/${publicId}`)).status).toBe(200);
    await request(app)
      .delete('/api/worlds/w1')
      .set('Cookie', cookie)
      .set('X-GMDesk-CSRF', '1');
    expect((await request(app).get(`/api/public/worlds/${publicId}`)).status).toBe(404);
  });

  it('serves public user profile without auth', async () => {
    const { user } = await createTestUserSession(app.locals.dataStore);
    expect((await request(app).get(`/api/users/${user.id}`)).status).toBe(200);
  });

  it('?ownerId= scopes the public gallery so other users\' public items are not mixed in', async () => {
    const a = await createTestUserSession(app.locals.dataStore);
    const b = await createTestUserSession(app.locals.dataStore);
    await request(app)
      .put('/api/worlds/w1')
      .set('Cookie', a.cookie)
      .set('X-GMDesk-CSRF', '1')
      .send({ title: 'Aの世界', raw: '# A' });
    await request(app)
      .put('/api/worlds/w1')
      .set('Cookie', b.cookie)
      .set('X-GMDesk-CSRF', '1')
      .send({ title: 'Bの世界', raw: '# B' });
    await request(app)
      .post('/api/publish/worlds/w1')
      .set('Cookie', a.cookie)
      .set('X-GMDesk-CSRF', '1');
    await request(app)
      .post('/api/publish/worlds/w1')
      .set('Cookie', b.cookie)
      .set('X-GMDesk-CSRF', '1');

    const res = await request(app).get('/api/public/worlds').query({ ownerId: a.user.id });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].ownerId).toBe(a.user.id);
    expect(res.body.items[0].title).toBe('Aの世界');
  });
});

describe('resolveSecureCookies', () => {
  const HTTPS = 'https://gmdesk.example.com';
  const HTTP = 'http://localhost:5173';

  it('honors an explicit true value', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' true ']) {
      expect(resolveSecureCookies(v, HTTP)).toBe(true);
    }
  });

  it('honors an explicit false value even on https', () => {
    for (const v of ['0', 'false', 'FALSE', 'no', 'off']) {
      expect(resolveSecureCookies(v, HTTPS)).toBe(false);
    }
  });

  // 未設定時の既定はBASE_URLのスキーム由来。NODE_ENVは一切参照しない。
  it('defaults to true for an https BASE_URL', () => {
    expect(resolveSecureCookies(undefined, HTTPS)).toBe(true);
    expect(resolveSecureCookies('', HTTPS)).toBe(true);
  });

  it('defaults to false for an http BASE_URL', () => {
    expect(resolveSecureCookies(undefined, HTTP)).toBe(false);
  });

  // タイプミスで黙ってSecureが外れると本番で気付けないため、起動を止める。
  it('throws on an unparseable value instead of silently falling back', () => {
    expect(() => resolveSecureCookies('ture', HTTPS)).toThrow(/SECURE_COOKIES/);
    expect(() => resolveSecureCookies('production', HTTPS)).toThrow(/SECURE_COOKIES/);
  });
});

describe('resolveStaticDir', () => {
  it('returns null when unset, leaving the client to Vite in development', () => {
    expect(resolveStaticDir(undefined)).toBeNull();
    expect(resolveStaticDir('')).toBeNull();
    expect(resolveStaticDir('   ')).toBeNull();
  });

  it('resolves a relative path against the repository root', () => {
    const serverDir = path.dirname(fileURLToPath(import.meta.url));
    expect(resolveStaticDir('dist')).toBe(path.join(serverDir, '..', 'dist'));
  });

  it('passes an absolute path through unchanged', () => {
    expect(resolveStaticDir('/srv/gmdesk/dist')).toBe('/srv/gmdesk/dist');
  });
});

describe('static serving', () => {
  const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';
  let staticDir;

  function buildApp({ withStatic = true } = {}) {
    return createApp({
      apiKey: 'test-key',
      env: testEnv({ BASE_URL: 'http://localhost:5173' }),
      dataDir: path.join(dir, 'data'),
      staticDir: withStatic ? staticDir : null,
    });
  }

  beforeEach(async () => {
    staticDir = path.join(dir, 'dist');
    await fs.mkdir(path.join(staticDir, 'assets'), { recursive: true });
    await fs.writeFile(path.join(staticDir, 'index.html'), INDEX_HTML);
    await fs.writeFile(path.join(staticDir, 'assets', 'app.js'), 'export default 1;\n');
  });

  it('serves index.html at the root', async () => {
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('id="root"');
  });

  it('serves built assets', async () => {
    const res = await request(buildApp()).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('export default 1;');
  });

  it('falls back to index.html for unknown client routes', async () => {
    const res = await request(buildApp()).get('/library');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('does not shadow public API routes', async () => {
    const res = await request(buildApp()).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imageGen: false });
  });

  // 認証必須APIの401がSPAのHTMLに化けると、クライアントがログイン切れを
  // 検知できなくなる。/api・/auth 配下はフォールバック対象外。
  it('keeps authenticated API routes returning JSON 401, not HTML', async () => {
    const res = await request(buildApp()).get('/api/sessions');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  // Expressの既定404ページ自体がtext/htmlなので、SPAシェルが返っていないことは
  // ステータスと本文で判定する。
  it('does not fall back for unknown /auth paths', async () => {
    const res = await request(buildApp()).get('/auth/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('id="root"');
  });

  it('does not fall back for non-GET requests to unknown paths', async () => {
    const res = await request(buildApp()).post('/library');
    expect(res.status).toBe(404);
  });

  it('serves nothing when no staticDir is configured', async () => {
    const res = await request(buildApp({ withStatic: false })).get('/');
    expect(res.status).toBe(404);
  });
});
