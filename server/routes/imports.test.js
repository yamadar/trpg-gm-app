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
import { saveWorld, getWorld } from '../storage/worldLibrary.js';
import { saveCharacter, getCharacter } from '../storage/characterLibrary.js';
import { saveScenario, getScenario } from '../storage/scenarioLibrary.js';
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
    // overrides でマニフェストの各フィールドを差し替えられるようにし、
    // 「Worldは解決できるがScenarioは解決できない」のような部分失敗を作れるようにする
    async function seedOnePack(overrides = {}) {
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
          ...overrides,
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

    // manifestのscenarioIdをimportScenarioへpreferredIdとして渡す
    // (worldがpackIdを使うのと同じ理由。無いと日本語タイトルはslugifyで'untitled'に潰れる)
    it('uses the manifest scenarioId as the scenario id instead of slugify(title)', async () => {
      await seedOnePack({ scenarioId: 'hyakki-on-suzaku-oji' });
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.status).toBe(201);
      expect(res.body.scenario.id).toBe('hyakki-on-suzaku-oji');
    });

    // 既存デプロイのマニフェストはscenarioIdを持たない可能性がある。新フィールドが
    // 欠けていてもクラッシュせず、従来どおりslugify(title)にフォールバックする
    it('falls back to slugify(title) for the scenario id when the manifest predates scenarioId', async () => {
      await seedOnePack();
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.status).toBe(201);
      expect(res.body.scenario.id).toBe('untitled');
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

    // ストアにトランザクションが無いので、途中で失敗しても既に書いた分は残る。
    // それでも二重送信や「部分成功なのに201」が起きないことをここで固定する。
    it('500s when the pack world is missing, before anything is written', async () => {
      await seedOnePack({ worldPublicId: 'pub_missing' });
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.status).toBe(500);
      // 二重送信(ERR_HTTP_HEADERS_SENT)が起きればsupertestはこのawaitで
      // 例外を投げるので、ここまで到達して単一のエラー本文が返る = 一回だけ応答した証拠
      expect(res.body).toEqual({ error: 'starter world is missing; re-run the seed' });
    });

    it('500s when the pack scenario is missing, after the world was already created', async () => {
      await seedOnePack({ scenarioPublicId: 'pub_missing' });
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.status).toBe(500);
      // 成功形のキーが一切無いことを見る。ステータスだけでなく本文の形でも
      // 「部分成功を201として返してしまう」regressionを検出できるようにする
      expect(res.body).not.toHaveProperty('world');
      expect(res.body).not.toHaveProperty('scenario');
      expect(res.body).not.toHaveProperty('pcs');
      expect(res.body).not.toHaveProperty('npcs');

      // World自体は先に保存済みなので、インポート先ライブラリに残っている
      const world = await getWorld(dataStore, textStore, 'usr_test', 'hyakki-yagyo');
      expect(world).not.toBeNull();
    });

    it('500s when a pack PC is missing, after the world and scenario were already created', async () => {
      await seedOnePack({ pcPublicIds: ['pub_missing'] });
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.status).toBe(500);

      const world = await getWorld(dataStore, textStore, 'usr_test', 'hyakki-yagyo');
      expect(world).not.toBeNull();
      // シナリオタイトル「シナリオ」はslugifyで非ASCIIが落ちてuntitledになる(worldと同様)
      const scenario = await getScenario(dataStore, textStore, 'usr_test', 'hyakki-yagyo', 'untitled');
      expect(scenario).not.toBeNull();
    });

    it('500s when a pack NPC is missing, after the world, scenario and PCs were already created', async () => {
      await seedOnePack({ npcPublicIds: ['pub_missing'] });
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.status).toBe(500);

      const world = await getWorld(dataStore, textStore, 'usr_test', 'hyakki-yagyo');
      expect(world).not.toBeNull();
      const pc = await getCharacter(dataStore, textStore, 'usr_test', 'hyakki-yagyo', 'pc', 'pc-one');
      expect(pc).not.toBeNull();
    });
  });
});
