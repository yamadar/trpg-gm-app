// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createRulesetsRouter } from './rulesets.js';
import { createFsDataStore } from '../storage/dataStore.js';

let dir;
let app;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rulesets-route-test-'));
  const dataStore = createFsDataStore(dir);
  app = express();
  app.use(express.json());
  app.use('/api', createRulesetsRouter({ dataStore }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('rulesets routes', () => {
  it('returns 404 for a missing ruleset', async () => {
    const res = await request(app).get('/api/rulesets/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a ruleset', async () => {
    await request(app)
      .put('/api/rulesets/homebrew')
      .send({ label: '自作ルール', desc: '独自ルール', hint: 'ヒント', growthUnit: 'CP' });
    const res = await request(app).get('/api/rulesets/homebrew');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'homebrew',
      label: '自作ルール',
      desc: '独自ルール',
      hint: 'ヒント',
      growthUnit: 'CP',
    });
  });

  it('lists saved rulesets', async () => {
    await request(app).put('/api/rulesets/a').send({ label: 'A', desc: 'a', hint: '' });
    await request(app).put('/api/rulesets/b').send({ label: 'B', desc: 'b', hint: '' });
    const res = await request(app).get('/api/rulesets');
    expect(res.body.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('deletes a ruleset', async () => {
    await request(app).put('/api/rulesets/a').send({ label: 'A', desc: 'a', hint: '' });
    const del = await request(app).delete('/api/rulesets/a');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/rulesets/a');
    expect(get.status).toBe(404);
  });
});
