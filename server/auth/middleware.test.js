// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createFsDataStore } from '../storage/dataStore.js';
import { createAuthSession, SESSION_COOKIE, SESSION_TTL_MS } from './sessions.js';
import {
  CSRF_HEADER,
  parseCookies,
  createRequireAuth,
  createOriginCheck,
} from './middleware.js';

let dir;
let dataStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-mw-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('parseCookies', () => {
  it('parses a cookie header', () => {
    expect(parseCookies('a=1; b=hello%20world')).toEqual({ a: '1', b: 'hello world' });
  });
  it('returns an empty object for undefined', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe('createRequireAuth', () => {
  function buildApp() {
    const app = express();
    app.use(createRequireAuth({ dataStore }));
    app.get('/whoami', (req, res) => res.json({ userId: req.userId }));
    return app;
  }

  it('rejects a request without a session cookie', async () => {
    const res = await request(buildApp()).get('/whoami');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('login required');
  });

  it('rejects an unknown token', async () => {
    const res = await request(buildApp()).get('/whoami').set('Cookie', `${SESSION_COOKIE}=bogus`);
    expect(res.status).toBe(401);
  });

  it('sets req.userId for a valid session', async () => {
    const token = await createAuthSession(dataStore, 'usr_1');
    const res = await request(buildApp()).get('/whoami').set('Cookie', `${SESSION_COOKIE}=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('usr_1');
  });

  it('re-issues the session cookie with a fresh Max-Age when the session slides', async () => {
    // createdAt in the past so that just over half the TTL has already elapsed,
    // triggering getAuthSession's sliding-renewal branch.
    const past = Date.now() - (SESSION_TTL_MS / 2 + 1000);
    const token = await createAuthSession(dataStore, 'usr_1', past);
    const res = await request(buildApp()).get('/whoami').set('Cookie', `${SESSION_COOKIE}=${token}`);
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] || [];
    const sessionCookie = setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/Max-Age=/i);
  });

  it('does not re-set the cookie for a fresh (non-renewed) session', async () => {
    const token = await createAuthSession(dataStore, 'usr_1');
    const res = await request(buildApp()).get('/whoami').set('Cookie', `${SESSION_COOKIE}=${token}`);
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] || [];
    expect(setCookie.find((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBeUndefined();
  });
});

describe('createOriginCheck', () => {
  function buildApp() {
    const app = express();
    app.use(createOriginCheck({ baseUrl: 'http://localhost:5173' }));
    app.post('/x', (req, res) => res.json({ ok: true }));
    app.get('/x', (req, res) => res.json({ ok: true }));
    return app;
  }

  it('allows matching-origin and unauthenticated no-origin mutations', async () => {
    expect((await request(buildApp()).post('/x').set('Origin', 'http://localhost:5173')).status).toBe(200);
    expect((await request(buildApp()).post('/x')).status).toBe(200);
  });

  it('requires the custom CSRF header for authenticated mutations even without Origin', async () => {
    const cookie = `${SESSION_COOKIE}=session-token`;
    expect((await request(buildApp()).post('/x').set('Cookie', cookie)).status).toBe(403);
    expect(
      (await request(buildApp()).post('/x').set('Cookie', cookie).set(CSRF_HEADER, '1')).status,
    ).toBe(200);
  });

  it('rejects cross-site Fetch Metadata even when the custom header is present', async () => {
    const res = await request(buildApp())
      .post('/x')
      .set('Cookie', `${SESSION_COOKIE}=session-token`)
      .set(CSRF_HEADER, '1')
      .set('Sec-Fetch-Site', 'cross-site');
    expect(res.status).toBe(403);
  });

  it('rejects a cross-origin mutation', async () => {
    const res = await request(buildApp()).post('/x').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('does not restrict GET', async () => {
    expect((await request(buildApp()).get('/x').set('Origin', 'https://evil.example')).status).toBe(200);
  });
});
