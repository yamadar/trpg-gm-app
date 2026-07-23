// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createWorldsRouter } from './worlds.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { publishWorld, getPublicWorld } from '../storage/shareLibrary.js';

let dir;
let app;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'worlds-route-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createWorldsRouter({ dataStore, textStore }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('worlds routes', () => {
  it('returns 404 for a missing world', async () => {
    const res = await request(app).get('/api/worlds/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a world', async () => {
    await request(app).put('/api/worlds/w1').send({ title: 'Waterdeep', raw: '# 世界観' });
    const res = await request(app).get('/api/worlds/w1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'w1', title: 'Waterdeep', raw: '# 世界観' });
  });

  it('lists saved worlds', async () => {
    await request(app).put('/api/worlds/w1').send({ title: 'A', raw: 'a' });
    await request(app).put('/api/worlds/w2').send({ title: 'B', raw: 'b' });
    const res = await request(app).get('/api/worlds');
    expect(res.status).toBe(200);
    expect(res.body.map((w) => w.id).sort()).toEqual(['w1', 'w2']);
  });

  it('deletes a world', async () => {
    await request(app).put('/api/worlds/w1').send({ title: 'A', raw: 'a' });
    const del = await request(app).delete('/api/worlds/w1');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/worlds/w1');
    expect(get.status).toBe(404);
  });

  it('returns 400 when raw is missing on PUT', async () => {
    const res = await request(app).put('/api/worlds/w1').send({ title: 'T' });
    expect(res.status).toBe(400);
  });

  it('rejects a traversal id with 400', async () => {
    const res = await request(app).get('/api/worlds/..%2F..%2Fescape');
    expect(res.status).toBe(400);
  });

  it('unpublishes a public world when it is deleted (cascade)', async () => {
    await request(app).put('/api/worlds/w1').send({ title: 'A', raw: 'a' });
    const owner = { id: 'usr_test', displayName: 'テストユーザー' };
    const { meta } = await publishWorld(dataStore, textStore, 'usr_test', 'w1', owner);
    expect(await getPublicWorld(dataStore, textStore, meta.publicId)).not.toBeNull();

    await request(app).delete('/api/worlds/w1');

    expect(await getPublicWorld(dataStore, textStore, meta.publicId)).toBeNull();
  });
});
