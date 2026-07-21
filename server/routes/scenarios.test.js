// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createScenariosRouter } from './scenarios.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';

let dir;
let app;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scenarios-route-test-'));
  const dataStore = createFsDataStore(dir);
  const textStore = createFsTextStore(dir);
  app = express();
  app.use(express.json());
  app.use('/api', createScenariosRouter({ dataStore, textStore }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('scenarios routes', () => {
  it('returns 404 for a missing scenario', async () => {
    const res = await request(app).get('/api/worlds/w1/scenarios/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a scenario', async () => {
    await request(app).put('/api/worlds/w1/scenarios/sc1').send({ title: '失踪事件', raw: '## シナリオ概要' });
    const res = await request(app).get('/api/worlds/w1/scenarios/sc1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'sc1', worldId: 'w1', title: '失踪事件', raw: '## シナリオ概要' });
  });

  it('lists scenarios scoped to a world', async () => {
    await request(app).put('/api/worlds/w1/scenarios/sc1').send({ title: 'A', raw: 'a' });
    await request(app).put('/api/worlds/w1/scenarios/sc2').send({ title: 'B', raw: 'b' });
    const res = await request(app).get('/api/worlds/w1/scenarios');
    expect(res.body.map((s) => s.id).sort()).toEqual(['sc1', 'sc2']);
  });

  it('deletes a scenario', async () => {
    await request(app).put('/api/worlds/w1/scenarios/sc1').send({ title: 'A', raw: 'a' });
    const del = await request(app).delete('/api/worlds/w1/scenarios/sc1');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/worlds/w1/scenarios/sc1');
    expect(get.status).toBe(404);
  });
});
