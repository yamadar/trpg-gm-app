// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createCampaignsRouter } from './campaigns.js';
import { createFsDataStore } from '../storage/dataStore.js';

let dir, dataStore, app;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'campaign-route-test-'));
  dataStore = createFsDataStore(dir);
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createCampaignsRouter({ dataStore }));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const body = { title: '影の連鎖', carriedPc: { raw: 'PC名: カイ', xp: 8 }, chapters: [{ sessionId: 's1', title: '第一章', endedAt: 1 }] };

describe('campaigns routes', () => {
  it('upserts and retrieves a campaign', async () => {
    const put = await request(app).put('/api/worlds/w1/campaigns/cp1').send(body);
    expect(put.status).toBe(200);
    expect(put.body.id).toBe('cp1');
    const get = await request(app).get('/api/worlds/w1/campaigns/cp1');
    expect(get.status).toBe(200);
    expect(get.body.carriedPc).toEqual({ raw: 'PC名: カイ', xp: 8 });
  });
  it('lists campaigns for a world', async () => {
    await request(app).put('/api/worlds/w1/campaigns/cp1').send(body);
    await request(app).put('/api/worlds/w1/campaigns/cp2').send({ ...body, title: 'B' });
    const res = await request(app).get('/api/worlds/w1/campaigns');
    expect(res.body.map((c) => c.id).sort()).toEqual(['cp1', 'cp2']);
  });
  it('returns 404 for a missing campaign', async () => {
    const res = await request(app).get('/api/worlds/w1/campaigns/nope');
    expect(res.status).toBe(404);
  });
  it('returns 400 when title or carriedPc is invalid', async () => {
    expect((await request(app).put('/api/worlds/w1/campaigns/cp1').send({ carriedPc: { raw: 'x', xp: 0 } })).status).toBe(400);
    expect((await request(app).put('/api/worlds/w1/campaigns/cp1').send({ title: 'A', carriedPc: { raw: 'x' } })).status).toBe(400);
  });
});
