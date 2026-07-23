// server/auth/routes.test.js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createFsDataStore } from '../storage/dataStore.js';
import { createProviders } from './providers.js';
import { createAuthRouter } from './routes.js';
import { SESSION_COOKIE } from './sessions.js';

const BASE = 'http://localhost:5173';
const env = { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec' };

let dir;
let dataStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-routes-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function buildApp(fetchImpl) {
  const app = express();
  app.use(express.json());
  app.use(createAuthRouter({
    dataStore,
    providers: createProviders(env),
    baseUrl: BASE,
    fetchImpl,
    secureCookies: false,
  }));
  return app;
}

// Google成功パスのモック: token交換→userinfoの2連続fetch
function googleFetchMock() {
  return vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: '111', name: '太郎', picture: null }) });
}

function cookieHeader(res, name) {
  const raw = (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${name}=`));
  return raw ? raw.split(';')[0] : null;
}

async function login(app, fetchImpl) {
  const start = await request(app).get('/auth/google/start');
  const oauthCookie = cookieHeader(start, 'gmdesk_oauth');
  const state = new URL(start.headers.location).searchParams.get('state');
  const cb = await request(app)
    .get(`/auth/google/callback?code=c1&state=${state}`)
    .set('Cookie', oauthCookie);
  return { cb, sessionCookie: cookieHeader(cb, SESSION_COOKIE) };
}

describe('auth routes', () => {
  it('start redirects to the provider and sets the oauth cookie', async () => {
    const res = await request(buildApp()).get('/auth/google/start');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://accounts.google.com/');
    expect(cookieHeader(res, 'gmdesk_oauth')).toBeTruthy();
  });

  it('start returns 404 for an unconfigured provider', async () => {
    expect((await request(buildApp()).get('/auth/discord/start')).status).toBe(404);
  });

  it('callback creates a user, sets a session cookie and redirects home', async () => {
    const app = buildApp(googleFetchMock());
    const { cb, sessionCookie } = await login(app);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/');
    expect(sessionCookie).toBeTruthy();
    const me = await request(app).get('/api/me').set('Cookie', sessionCookie);
    expect(me.body.user.displayName).toBe('太郎');
  });

  it('callback with a state mismatch redirects to /?auth_error=1 without a session', async () => {
    const app = buildApp(googleFetchMock());
    const start = await request(app).get('/auth/google/start');
    const res = await request(app)
      .get('/auth/google/callback?code=c1&state=WRONG')
      .set('Cookie', cookieHeader(start, 'gmdesk_oauth'));
    expect(res.headers.location).toBe('/?auth_error=1');
    expect(cookieHeader(res, SESSION_COOKIE)).toBeNull();
  });

  it('callback redirects to /?auth_error=1 when the token exchange fails', async () => {
    const app = buildApp(vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'no' }));
    const { cb } = await login(app);
    expect(cb.headers.location).toBe('/?auth_error=1');
  });

  it('GET /api/me returns { user: null } when logged out', async () => {
    const res = await request(buildApp()).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it('GET /api/auth/providers lists configured providers only', async () => {
    const res = await request(buildApp()).get('/api/auth/providers');
    expect(res.body).toEqual({ providers: ['google'] });
  });

  it('logout destroys the session', async () => {
    const app = buildApp(googleFetchMock());
    const { sessionCookie } = await login(app);
    await request(app).post('/auth/logout').set('Cookie', sessionCookie);
    const me = await request(app).get('/api/me').set('Cookie', sessionCookie);
    expect(me.body.user).toBeNull();
  });

  it('PATCH /api/me updates displayName and clears avatarUrl', async () => {
    const app = buildApp(googleFetchMock());
    const { sessionCookie } = await login(app);
    const res = await request(app)
      .patch('/api/me')
      .set('Cookie', sessionCookie)
      .send({ displayName: '  新しい名前  ', avatarUrl: null });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('新しい名前');
    expect(res.body.user.avatarUrl).toBeNull();
  });

  it('PATCH /api/me validates input', async () => {
    const app = buildApp(googleFetchMock());
    const { sessionCookie } = await login(app);
    expect((await request(app).patch('/api/me').send({ displayName: 'x' })).status).toBe(401);
    expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ displayName: '' })).status).toBe(400);
    expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ displayName: 'あ'.repeat(51) })).status).toBe(400);
    expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ avatarUrl: 'https://x' })).status).toBe(400);
  });

  it('PATCH /api/me updates bio with trim and allows empty', async () => {
    const app = buildApp(googleFetchMock());
    const { sessionCookie } = await login(app);
    const res = await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ bio: '  自己紹介です  ' });
    expect(res.status).toBe(200);
    expect(res.body.user.bio).toBe('自己紹介です');
    const cleared = await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ bio: '' });
    expect(cleared.body.user.bio).toBe('');
  });

  it('PATCH /api/me validates bio', async () => {
    const app = buildApp(googleFetchMock());
    const { sessionCookie } = await login(app);
    expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ bio: 123 })).status).toBe(400);
    expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ bio: 'あ'.repeat(501) })).status).toBe(400);
    expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ bio: 'あ'.repeat(500) })).status).toBe(200);
  });
});
