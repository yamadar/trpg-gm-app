// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createWorldContentRouter } from './worldContent.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';

let dir;
let app;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'world-content-route-test-'));
  const dataStore = createFsDataStore(dir);
  const textStore = createFsTextStore(dir);
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createWorldContentRouter({ dataStore, textStore }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('world content routes: source', () => {
  it('returns 404 for a missing source', async () => {
    const res = await request(app).get('/api/worlds/w1/source');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves the source', async () => {
    await request(app).put('/api/worlds/w1/source').send({ raw: '原文テキスト' });
    const res = await request(app).get('/api/worlds/w1/source');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ raw: '原文テキスト' });
  });
});

describe('world content routes: regions', () => {
  it('returns 404 for a missing region', async () => {
    const res = await request(app).get('/api/worlds/w1/regions/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a region', async () => {
    await request(app)
      .put('/api/worlds/w1/regions/waterdeep')
      .send({ title: 'ウォーターディープ', raw: '地域の詳細' });
    const res = await request(app).get('/api/worlds/w1/regions/waterdeep');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'waterdeep', title: 'ウォーターディープ', raw: '地域の詳細' });
  });

  it('lists regions for a world', async () => {
    await request(app).put('/api/worlds/w1/regions/waterdeep').send({ title: 'ウォーターディープ', raw: 'a' });
    await request(app).put('/api/worlds/w1/regions/baldurs-gate').send({ title: 'バルダーズ・ゲート', raw: 'b' });
    const res = await request(app).get('/api/worlds/w1/regions');
    expect(res.body.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'baldurs-gate', title: 'バルダーズ・ゲート' },
      { id: 'waterdeep', title: 'ウォーターディープ' },
    ]);
  });

  it('deletes a region', async () => {
    await request(app).put('/api/worlds/w1/regions/waterdeep').send({ raw: 'a' });
    const del = await request(app).delete('/api/worlds/w1/regions/waterdeep');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/worlds/w1/regions/waterdeep');
    expect(get.status).toBe(404);
  });
});

describe('world content routes: categories', () => {
  it('returns 404 for a missing category', async () => {
    const res = await request(app).get('/api/worlds/w1/categories/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a category', async () => {
    await request(app)
      .put('/api/worlds/w1/categories/magic-system')
      .send({ title: '魔法体系', raw: 'カテゴリの詳細' });
    const res = await request(app).get('/api/worlds/w1/categories/magic-system');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'magic-system', title: '魔法体系', raw: 'カテゴリの詳細' });
  });

  it('lists categories for a world', async () => {
    await request(app).put('/api/worlds/w1/categories/magic-system').send({ title: '魔法体系', raw: 'a' });
    await request(app).put('/api/worlds/w1/categories/history').send({ title: '世界史', raw: 'b' });
    const res = await request(app).get('/api/worlds/w1/categories');
    expect(res.body.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'history', title: '世界史' },
      { id: 'magic-system', title: '魔法体系' },
    ]);
  });

  it('deletes a category', async () => {
    await request(app).put('/api/worlds/w1/categories/magic-system').send({ raw: 'a' });
    const del = await request(app).delete('/api/worlds/w1/categories/magic-system');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/worlds/w1/categories/magic-system');
    expect(get.status).toBe(404);
  });
});
