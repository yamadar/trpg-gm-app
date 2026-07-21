// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createSessionsRouter } from './sessions.js';
import { createFsDataStore } from '../storage/dataStore.js';

let dir;
let app;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-route-test-'));
  const dataStore = createFsDataStore(dir);
  app = express();
  app.use(express.json());
  app.use('/api', createSessionsRouter({ dataStore }));
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

  it('returns 501 for the novelize placeholder', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A' });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(501);
  });
});
