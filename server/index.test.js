// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';
import { createTestUserSession } from './auth/testHelpers.js';

let dir;
let app;
let fetchImpl;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-test-'));
  fetchImpl = vi.fn().mockResolvedValue({ status: 200, text: async () => '{}' });
  app = createApp({ apiKey: 'test-key', dataDir: dir, fetchImpl });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createApp', () => {
  it('mounts the messages route and proxies via the injected fetchImpl', async () => {
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    const res = await request(app).post('/api/messages').set('Cookie', cookie).send({ messages: [] });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.anything());
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

  it('preserves a thrown error status via the global handler', async () => {
    // 既知の400経路(不正なsession body)を通し、500ではなく400が返ることを確認
    const res = await request(app).put('/api/sessions/s1').set('Content-Type', 'application/json').send('"x"');
    expect(res.status).toBe(400);
  });

  it('rejects /api requests without a session', async () => {
    expect((await request(app).get('/api/sessions')).status).toBe(401);
    expect((await request(app).post('/api/messages').send({ messages: [] })).status).toBe(401);
  });

  it('serves /api/me as null and providers list without auth', async () => {
    expect((await request(app).get('/api/me')).body).toEqual({ user: null });
    expect((await request(app).get('/api/auth/providers')).status).toBe(200);
  });

  it('keeps data separated between two users end to end', async () => {
    const a = await createTestUserSession(app.locals.dataStore);
    const b = await createTestUserSession(app.locals.dataStore);
    await request(app).put('/api/sessions/s1').set('Cookie', a.cookie).send({ title: 'Aの卓' });
    expect((await request(app).get('/api/sessions/s1').set('Cookie', b.cookie)).status).toBe(404);
    expect((await request(app).get('/api/sessions/s1').set('Cookie', a.cookie)).status).toBe(200);
  });

  it('enforces the daily message limit via env', async () => {
    app = createApp({ apiKey: 'test-key', dataDir: dir, fetchImpl, env: { LIMIT_MESSAGES_PER_DAY: '1' } });
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    expect((await request(app).post('/api/messages').set('Cookie', cookie).send({ messages: [] })).status).toBe(200);
    expect((await request(app).post('/api/messages').set('Cookie', cookie).send({ messages: [] })).status).toBe(429);
  });

  it('LIMIT_MESSAGES_PER_DAY=0 denies all messages', async () => {
    app = createApp({ apiKey: 'test-key', dataDir: dir, fetchImpl, env: { LIMIT_MESSAGES_PER_DAY: '0' } });
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    expect((await request(app).post('/api/messages').set('Cookie', cookie).send({ messages: [] })).status).toBe(429);
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
    await request(app).put('/api/worlds/w1').set('Cookie', a.cookie).send({ title: 'Aの世界', raw: '# 本文' });
    const pub = await request(app).post('/api/publish/worlds/w1').set('Cookie', a.cookie);
    const { publicId } = pub.body;
    // 未認証で読める
    expect((await request(app).get(`/api/public/worlds/${publicId}`)).body.title).toBe('Aの世界');
    // Bがインポート → Bのライブラリに入る
    const imported = await request(app).post(`/api/import/worlds/${publicId}`).set('Cookie', b.cookie);
    expect(imported.status).toBe(201);
    const bWorld = await request(app).get(`/api/worlds/${imported.body.id}`).set('Cookie', b.cookie);
    expect(bWorld.body.raw).toBe('# 本文');
    // Aのデータは不変・Bのインポート後にAが解除してもBのコピーは残る
    await request(app).delete('/api/publish/worlds/w1').set('Cookie', a.cookie);
    expect((await request(app).get(`/api/public/worlds/${publicId}`)).status).toBe(404);
    expect((await request(app).get(`/api/worlds/${imported.body.id}`).set('Cookie', b.cookie)).status).toBe(200);
  });

  it('deleting a private item unpublishes it (cascade)', async () => {
    const { cookie } = await createTestUserSession(app.locals.dataStore);
    await request(app).put('/api/worlds/w1').set('Cookie', cookie).send({ title: '世界', raw: '# 本文' });
    const pub = await request(app).post('/api/publish/worlds/w1').set('Cookie', cookie);
    const { publicId } = pub.body;
    expect((await request(app).get(`/api/public/worlds/${publicId}`)).status).toBe(200);
    await request(app).delete('/api/worlds/w1').set('Cookie', cookie);
    expect((await request(app).get(`/api/public/worlds/${publicId}`)).status).toBe(404);
  });

  it('serves public user profile without auth', async () => {
    const { user } = await createTestUserSession(app.locals.dataStore);
    expect((await request(app).get(`/api/users/${user.id}`)).status).toBe(200);
    expect((await request(app).get(`/api/users/${user.id}/public`)).status).toBe(200);
  });
});
