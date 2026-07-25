// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createImportsRouter } from './imports.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { saveWorld } from '../storage/worldLibrary.js';
import { saveCharacter } from '../storage/characterLibrary.js';
import { saveScenario } from '../storage/scenarioLibrary.js';
import { publishWorld, publishCharacter, publishScenario } from '../storage/shareLibrary.js';

const OWNER = { id: 'usr_a', displayName: '太郎' };

let dir;
let dataStore;
let textStore;
let app;

function buildApp() {
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createImportsRouter({ dataStore, textStore }));
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'imports-route-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
  buildApp();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('imports routes', () => {
  describe('worlds', () => {
    it('imports a published world and returns 201 with the created meta', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'テスト世界', raw: '# 本文' });
      const { meta: pubMeta } = await publishWorld(dataStore, textStore, OWNER.id, 'w1', OWNER);

      const res = await request(app).post(`/api/import/worlds/${pubMeta.publicId}`);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: 'untitled', title: 'テスト世界', raw: '# 本文' });
    });

    it('suffixes the id on repeated import (collision)', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'テスト世界', raw: '# 本文' });
      const { meta: pubMeta } = await publishWorld(dataStore, textStore, OWNER.id, 'w1', OWNER);

      const first = await request(app).post(`/api/import/worlds/${pubMeta.publicId}`);
      expect(first.status).toBe(201);
      expect(first.body.id).toBe('untitled');

      const second = await request(app).post(`/api/import/worlds/${pubMeta.publicId}`);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe('untitled-2');
    });

    it('404s for an unknown publicId', async () => {
      const res = await request(app).post('/api/import/worlds/pub_nope');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('rejects a path-traversal publicId with 400', async () => {
      const res = await request(app).post('/api/import/worlds/..%2F..%2Fescape');
      expect(res.status).toBe(400);
    });
  });

  describe('characters', () => {
    it('imports a published character into the target world and returns 201 with the created meta', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'テスト世界', raw: 'r' });
      await saveCharacter(dataStore, textStore, OWNER.id, { worldId: 'w1', kind: 'pc', name: 'alice', raw: '# アリス' });
      const { meta: pubMeta } = await publishCharacter(dataStore, textStore, OWNER.id, 'w1', 'pc', 'alice', OWNER);

      await saveWorld(dataStore, textStore, 'usr_test', { id: 'target', title: '受け入れ先', raw: 'r' });

      const res = await request(app)
        .post(`/api/import/characters/${pubMeta.publicId}`)
        .send({ targetWorldId: 'target' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ worldId: 'target', kind: 'pc', name: 'alice', raw: '# アリス' });
    });

    it('400s when targetWorldId is missing', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'テスト世界', raw: 'r' });
      await saveCharacter(dataStore, textStore, OWNER.id, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'r' });
      const { meta: pubMeta } = await publishCharacter(dataStore, textStore, OWNER.id, 'w1', 'pc', 'alice', OWNER);

      const res = await request(app).post(`/api/import/characters/${pubMeta.publicId}`).send({});
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'targetWorldId is required' });
    });

    it('400s when targetWorldId is invalid (path traversal)', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'テスト世界', raw: 'r' });
      await saveCharacter(dataStore, textStore, OWNER.id, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'r' });
      const { meta: pubMeta } = await publishCharacter(dataStore, textStore, OWNER.id, 'w1', 'pc', 'alice', OWNER);

      const res = await request(app)
        .post(`/api/import/characters/${pubMeta.publicId}`)
        .send({ targetWorldId: '../escape' });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'targetWorldId is required' });
    });

    it('400s when targetWorldId is not a string', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'テスト世界', raw: 'r' });
      await saveCharacter(dataStore, textStore, OWNER.id, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'r' });
      const { meta: pubMeta } = await publishCharacter(dataStore, textStore, OWNER.id, 'w1', 'pc', 'alice', OWNER);

      const res = await request(app)
        .post(`/api/import/characters/${pubMeta.publicId}`)
        .send({ targetWorldId: 123 });
      expect(res.status).toBe(400);
    });

    it('404s for an unknown publicId', async () => {
      await saveWorld(dataStore, textStore, 'usr_test', { id: 'target', title: '受け入れ先', raw: 'r' });
      const res = await request(app)
        .post('/api/import/characters/pub_nope')
        .send({ targetWorldId: 'target' });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('404s when the target world does not exist', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'テスト世界', raw: 'r' });
      await saveCharacter(dataStore, textStore, OWNER.id, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'r' });
      const { meta: pubMeta } = await publishCharacter(dataStore, textStore, OWNER.id, 'w1', 'pc', 'alice', OWNER);

      const res = await request(app)
        .post(`/api/import/characters/${pubMeta.publicId}`)
        .send({ targetWorldId: 'nope' });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'target world not found' });
    });

    it('rejects a path-traversal publicId with 400', async () => {
      const res = await request(app)
        .post('/api/import/characters/..%2F..%2Fescape')
        .send({ targetWorldId: 'target' });
      expect(res.status).toBe(400);
    });
  });

  describe('scenarios', () => {
    it('imports a published scenario into the target world and returns 201 with the created meta', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'テスト世界', raw: 'r' });
      await saveScenario(dataStore, textStore, OWNER.id, {
        worldId: 'w1',
        id: 'sc1',
        title: '失踪事件',
        raw: '## シナリオ概要',
        recommendedRuleset: 'coc',
      });
      const { meta: pubMeta } = await publishScenario(dataStore, textStore, OWNER.id, 'w1', 'sc1', OWNER);

      await saveWorld(dataStore, textStore, 'usr_test', { id: 'target', title: '受け入れ先', raw: 'r' });

      const res = await request(app)
        .post(`/api/import/scenarios/${pubMeta.publicId}`)
        .send({ targetWorldId: 'target' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        worldId: 'target',
        title: '失踪事件',
        recommendedRuleset: 'coc',
        raw: '## シナリオ概要',
      });
    });

    it('400s when targetWorldId is missing', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'テスト世界', raw: 'r' });
      await saveScenario(dataStore, textStore, OWNER.id, { worldId: 'w1', id: 'sc1', title: 't', raw: 'r' });
      const { meta: pubMeta } = await publishScenario(dataStore, textStore, OWNER.id, 'w1', 'sc1', OWNER);

      const res = await request(app).post(`/api/import/scenarios/${pubMeta.publicId}`).send({});
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'targetWorldId is required' });
    });

    it('404s for an unknown publicId', async () => {
      await saveWorld(dataStore, textStore, 'usr_test', { id: 'target', title: '受け入れ先', raw: 'r' });
      const res = await request(app)
        .post('/api/import/scenarios/pub_nope')
        .send({ targetWorldId: 'target' });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('404s when the target world does not exist', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'テスト世界', raw: 'r' });
      await saveScenario(dataStore, textStore, OWNER.id, { worldId: 'w1', id: 'sc1', title: 't', raw: 'r' });
      const { meta: pubMeta } = await publishScenario(dataStore, textStore, OWNER.id, 'w1', 'sc1', OWNER);

      const res = await request(app)
        .post(`/api/import/scenarios/${pubMeta.publicId}`)
        .send({ targetWorldId: 'nope' });
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'target world not found' });
    });

    it('rejects a path-traversal publicId with 400', async () => {
      const res = await request(app)
        .post('/api/import/scenarios/..%2F..%2Fescape')
        .send({ targetWorldId: 'target' });
      expect(res.status).toBe(400);
    });
  });

  describe('starter packs', () => {
    async function seedOnePack() {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'src-world', title: '百鬼夜行 — 平安京', raw: '# 世界', moods: ['ホラー'] });
      await saveScenario(dataStore, textStore, OWNER.id, {
        worldId: 'src-world', id: 'sc', title: 'シナリオ', raw: '# 本文', recommendedRuleset: 'coc7e', moods: ['ホラー'],
      });
      await saveCharacter(dataStore, textStore, OWNER.id, { worldId: 'src-world', kind: 'pc', name: 'pc-one', raw: 'PC1' });
      await saveCharacter(dataStore, textStore, OWNER.id, { worldId: 'src-world', kind: 'npc', name: 'npc-one', raw: 'NPC1', revealed: false });

      const world = await publishWorld(dataStore, textStore, OWNER.id, 'src-world', OWNER);
      const scenario = await publishScenario(dataStore, textStore, OWNER.id, 'src-world', 'sc', OWNER);
      const pc = await publishCharacter(dataStore, textStore, OWNER.id, 'src-world', 'pc', 'pc-one', OWNER);
      const npc = await publishCharacter(dataStore, textStore, OWNER.id, 'src-world', 'npc', 'npc-one', OWNER);

      await dataStore.set('public/starters', {
        packs: [{
          packId: 'hyakki-yagyo',
          title: '百鬼夜行 — 平安京',
          recommendedRuleset: 'coc7e',
          worldPublicId: world.meta.publicId,
          scenarioPublicId: scenario.meta.publicId,
          pcPublicIds: [pc.meta.publicId],
          npcPublicIds: [npc.meta.publicId],
        }],
        seededAt: 1,
      });
    }

    it('imports the whole pack in one call', async () => {
      await seedOnePack();
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.status).toBe(201);
      expect(res.body.world).toMatchObject({ id: 'hyakki-yagyo', title: '百鬼夜行 — 平安京', moods: ['ホラー'] });
      expect(res.body.scenario).toMatchObject({ worldId: 'hyakki-yagyo', title: 'シナリオ', recommendedRuleset: 'coc7e' });
      expect(res.body.pcs).toHaveLength(1);
      expect(res.body.npcs).toHaveLength(1);
      expect(res.body.pcs[0]).toMatchObject({ kind: 'pc', name: 'pc-one', worldId: 'hyakki-yagyo' });
      // NPCの秘匿情報はインポート先で未開示に戻る
      expect(res.body.npcs[0]).toMatchObject({ kind: 'npc', revealed: false });
    });

    // slugify は非ASCIIを全除去するので、preferredId 無しだと 'untitled' になる
    it('uses the packId as the world id instead of slugify(title)', async () => {
      await seedOnePack();
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.body.world.id).toBe('hyakki-yagyo');
    });

    it('suffixes the world id when the same pack is imported twice', async () => {
      await seedOnePack();
      await request(app).post('/api/starters/hyakki-yagyo/import');
      const second = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(second.status).toBe(201);
      expect(second.body.world.id).toBe('hyakki-yagyo-2');
      expect(second.body.scenario.worldId).toBe('hyakki-yagyo-2');
    });

    it('404s for an unknown pack id', async () => {
      await seedOnePack();
      const res = await request(app).post('/api/starters/nope/import');
      expect(res.status).toBe(404);
    });

    it('404s when nothing has been seeded', async () => {
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.status).toBe(404);
    });
  });
});
