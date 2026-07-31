// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createScenariosRouter } from './scenarios.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { publishScenario, getPublicItem } from '../storage/shareLibrary.js';

let dir;
let app;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scenarios-route-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
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

  it('analyses on PUT, preserves raw byte-for-byte, and saves the director guide', async () => {
    const directorGuide = {
      schemaVersion: 1,
      player_goal: '失踪者を見つける',
      ending_signals: ['失踪者の結末を描写した'],
    };
    const scenarioAnalyzer = vi.fn().mockResolvedValue(directorGuide);
    const analysedApp = express();
    analysedApp.use(express.json());
    analysedApp.use((req, res, next) => {
      req.userId = 'usr_test';
      next();
    });
    analysedApp.use('/api', createScenariosRouter({ dataStore, textStore, scenarioAnalyzer }));
    const raw = '  自由記述\n末尾改行も保持\n';

    const put = await request(analysedApp)
      .put('/api/worlds/w1/scenarios/sc1')
      .send({ title: '失踪事件', raw });
    expect(put.status).toBe(200);
    expect(scenarioAnalyzer).toHaveBeenCalledWith({ title: '失踪事件', raw });
    expect(put.body.raw).toBe(raw);
    expect(put.body.directorGuide).toEqual(directorGuide);

    const get = await request(analysedApp).get('/api/worlds/w1/scenarios/sc1');
    expect(get.body.raw).toBe(raw);
    expect(get.body.directorGuide).toEqual(directorGuide);
  });

  it('does not replace source text when analysis fails', async () => {
    await request(app)
      .put('/api/worlds/w1/scenarios/sc1')
      .send({ title: '既存', raw: '既存原文' });
    const analysedApp = express();
    analysedApp.use(express.json());
    analysedApp.use((req, res, next) => {
      req.userId = 'usr_test';
      next();
    });
    analysedApp.use(
      '/api',
      createScenariosRouter({
        dataStore,
        textStore,
        scenarioAnalyzer: vi.fn().mockRejectedValue(new Error('overloaded')),
      }),
    );

    const put = await request(analysedApp)
      .put('/api/worlds/w1/scenarios/sc1')
      .send({ title: '更新', raw: '未解析の新原文' });
    expect(put.status).toBe(502);

    const get = await request(app).get('/api/worlds/w1/scenarios/sc1');
    expect(get.body.title).toBe('既存');
    expect(get.body.raw).toBe('既存原文');
  });

  it('charges message usage before scenario analysis', async () => {
    const usage = { consume: vi.fn().mockResolvedValue({ ok: false, resetAt: 123 }) };
    const scenarioAnalyzer = vi.fn();
    const analysedApp = express();
    analysedApp.use(express.json());
    analysedApp.use((req, res, next) => {
      req.userId = 'usr_test';
      next();
    });
    analysedApp.use('/api', createScenariosRouter({
      dataStore,
      textStore,
      scenarioAnalyzer,
      usage,
    }));

    const put = await request(analysedApp)
      .put('/api/worlds/w1/scenarios/sc1')
      .send({ title: '題', raw: '原文' });
    expect(put.status).toBe(429);
    expect(usage.consume).toHaveBeenCalledWith('usr_test', 'messages');
    expect(scenarioAnalyzer).not.toHaveBeenCalled();
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

  it('saves and retrieves a scenario with a recommended ruleset', async () => {
    await request(app)
      .put('/api/worlds/w1/scenarios/sc1')
      .send({ title: 'A', raw: 'a', recommendedRuleset: 'coc7e' });
    const res = await request(app).get('/api/worlds/w1/scenarios/sc1');
    expect(res.body.recommendedRuleset).toBe('coc7e');
  });

  it('saves Campaign generation provenance on a generated scenario', async () => {
    const put = await request(app)
      .put('/api/worlds/w1/scenarios/sc1')
      .send({
        title: '灰の密使',
        raw: '# 本文',
        sourceCampaignId: 'cp1',
        sourceCampaignRevision: 3,
        generatedFromPitchId: 'pitch_1',
      });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      sourceCampaignId: 'cp1',
      sourceCampaignRevision: 3,
      generatedFromPitchId: 'pitch_1',
    });
  });

  it('rejects unknown moods on PUT with 400 and accepts valid ones', async () => {
    const bad = await request(app)
      .put('/api/worlds/w1/scenarios/sc1')
      .send({ title: 'T', raw: '#', moods: ['horror'] });
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'moods must be an array of known mood labels' });

    const good = await request(app)
      .put('/api/worlds/w1/scenarios/sc1')
      .send({ title: 'T', raw: '#', moods: ['ミステリー'] });
    expect(good.status).toBe(200);
    expect(good.body.moods).toEqual(['ミステリー']);

    const omitted = await request(app)
      .put('/api/worlds/w1/scenarios/sc2')
      .send({ title: 'T', raw: '#' });
    expect(omitted.status).toBe(200);
    expect(omitted.body.moods).toEqual([]);
  });

  it('unpublishes a public scenario when it is deleted (cascade)', async () => {
    await request(app).put('/api/worlds/w1/scenarios/sc1').send({ title: '失踪事件', raw: '## 概要' });
    const owner = { id: 'usr_test', displayName: 'テストユーザー' };
    const { meta } = await publishScenario(dataStore, textStore, 'usr_test', 'w1', 'sc1', owner);
    expect(await getPublicItem(dataStore, textStore, 'scenarios', meta.publicId)).not.toBeNull();

    await request(app).delete('/api/worlds/w1/scenarios/sc1');

    expect(await getPublicItem(dataStore, textStore, 'scenarios', meta.publicId)).toBeNull();
  });
});
