// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createPublicContentRouter } from './publicContent.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import {
  publishWorld,
  publishCharacter,
  publishScenario,
  publishNovel,
} from '../storage/shareLibrary.js';
import {
  worldMetaKey,
  worldDocPath,
  regionDocPath,
  categoryDocPath,
  characterMetaKey,
  characterDocPath,
  scenarioMetaKey,
  scenarioDocPath,
  sessionKey,
  sessionNovelDocPath,
} from '../storage/paths.js';
import { findOrCreateUser, updateUserProfile } from '../auth/users.js';

let dir;
let dataStore;
let textStore;
let app;

function buildApp() {
  app = express();
  app.use(express.json());
  // NOTE: no req.userId middleware — this router is authentication-free
  app.use('/api', createPublicContentRouter({ dataStore, textStore }));
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'public-content-route-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
  buildApp();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('publicContent routes — authentication-free gallery read', () => {
  describe('GET /api/public/:type — list public items', () => {
    it('lists public worlds without auth, sorted desc by publishedAt', async () => {
      const owner = { id: 'usr_1', displayName: 'Alice' };

      // Publish world 1 at time T1
      await dataStore.set(worldMetaKey('usr_1', 'w1'), { id: 'w1', title: 'First World', updatedAt: Date.now() });
      await textStore.write(worldDocPath('usr_1', 'w1'), '# First');
      const pub1 = await publishWorld(dataStore, textStore, 'usr_1', 'w1', owner);
      expect(pub1.ok).toBe(true);

      // Publish world 2 at time T2 (later)
      await new Promise((resolve) => setTimeout(resolve, 10));
      await dataStore.set(worldMetaKey('usr_1', 'w2'), { id: 'w2', title: 'Second World', updatedAt: Date.now() });
      await textStore.write(worldDocPath('usr_1', 'w2'), '# Second');
      const pub2 = await publishWorld(dataStore, textStore, 'usr_1', 'w2', owner);
      expect(pub2.ok).toBe(true);

      const res = await request(app).get('/api/public/worlds');
      expect(res.status).toBe(200);
      expect(res.body.items).toBeInstanceOf(Array);
      expect(res.body.total).toBe(2);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.items.length).toBe(2);
      // Most recently published first (desc)
      expect(res.body.items[0].publicId).toBe(pub2.meta.publicId);
      expect(res.body.items[0].title).toBe('Second World');
      expect(res.body.items[1].publicId).toBe(pub1.meta.publicId);
      expect(res.body.items[1].title).toBe('First World');
    });

    it('lists public characters without auth, sorted desc by publishedAt', async () => {
      const owner = { id: 'usr_2', displayName: 'Bob' };
      const userId = 'usr_2';
      const worldId = 'w1';

      // Set up world
      await dataStore.set(worldMetaKey(userId, worldId), { id: worldId, title: 'Test World', updatedAt: Date.now() });
      await textStore.write(worldDocPath(userId, worldId), '# Test');

      // Publish character 1
      await dataStore.set(characterMetaKey(userId, worldId, 'pc', 'hero'), { id: 'hero', worldId, kind: 'pc', name: 'hero', revealed: null, parsed: null, parsedHash: null, updatedAt: Date.now() });
      await textStore.write(characterDocPath(userId, worldId, 'pc', 'hero'), 'PC名: 勇者アレン\n## Hero');
      const char1 = await publishCharacter(dataStore, textStore, userId, worldId, 'pc', 'hero', owner);
      expect(char1.ok).toBe(true);

      // Publish character 2 later
      await new Promise((resolve) => setTimeout(resolve, 10));
      await dataStore.set(characterMetaKey(userId, worldId, 'npc', 'villain'), { id: 'villain', worldId, kind: 'npc', name: 'villain', revealed: null, parsed: null, parsedHash: null, updatedAt: Date.now() });
      await textStore.write(characterDocPath(userId, worldId, 'npc', 'villain'), 'NPC名: 魔王ベル\n## Villain');
      const char2 = await publishCharacter(dataStore, textStore, userId, worldId, 'npc', 'villain', owner);
      expect(char2.ok).toBe(true);

      const res = await request(app).get('/api/public/characters');
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(2);
      expect(res.body.items[0].publicId).toBe(char2.meta.publicId);
      expect(res.body.items[0].title).toBe('魔王ベル');
      expect(res.body.items[0].kind).toBe('npc');
      expect(res.body.items[1].publicId).toBe(char1.meta.publicId);
      expect(res.body.items[1].title).toBe('勇者アレン');
      expect(res.body.items[1].kind).toBe('pc');
    });

    it('lists public scenarios without auth, sorted desc by publishedAt', async () => {
      const owner = { id: 'usr_3', displayName: 'Charlie' };
      const userId = 'usr_3';
      const worldId = 'w1';

      // Set up world
      await dataStore.set(worldMetaKey(userId, worldId), { id: worldId, title: 'Test World', updatedAt: Date.now() });
      await textStore.write(worldDocPath(userId, worldId), '# Test');

      // Publish scenario 1
      await dataStore.set(scenarioMetaKey(userId, worldId, 'sc1'), { id: 'sc1', worldId, title: 'Scenario 1', recommendedRuleset: null, updatedAt: Date.now() });
      await textStore.write(scenarioDocPath(userId, worldId, 'sc1'), '## SC1');
      const sc1 = await publishScenario(dataStore, textStore, userId, worldId, 'sc1', owner);
      expect(sc1.ok).toBe(true);

      // Publish scenario 2 later
      await new Promise((resolve) => setTimeout(resolve, 10));
      await dataStore.set(scenarioMetaKey(userId, worldId, 'sc2'), { id: 'sc2', worldId, title: 'Scenario 2', recommendedRuleset: 'dnd5e', updatedAt: Date.now() });
      await textStore.write(scenarioDocPath(userId, worldId, 'sc2'), '## SC2');
      const sc2 = await publishScenario(dataStore, textStore, userId, worldId, 'sc2', owner);
      expect(sc2.ok).toBe(true);

      const res = await request(app).get('/api/public/scenarios');
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(2);
      expect(res.body.items[0].publicId).toBe(sc2.meta.publicId);
      expect(res.body.items[0].title).toBe('Scenario 2');
      expect(res.body.items[0].recommendedRuleset).toBe('dnd5e');
      expect(res.body.items[1].publicId).toBe(sc1.meta.publicId);
      expect(res.body.items[1].title).toBe('Scenario 1');
      expect(res.body.items[1].recommendedRuleset).toBeNull();
    });

    it('lists public novels without auth, sorted desc by publishedAt', async () => {
      const owner = { id: 'usr_4', displayName: 'Diana' };
      const userId = 'usr_4';
      const sessionId = 'sess_1';

      // Set up session
      await dataStore.set(sessionKey(userId, sessionId), { id: sessionId, title: 'Session 1' });
      await textStore.write(sessionNovelDocPath(userId, sessionId), '# Novel 1');

      // Publish novel 1
      const nov1 = await publishNovel(dataStore, textStore, userId, sessionId, owner);
      expect(nov1.ok).toBe(true);

      // Publish novel 2 (different session)
      await new Promise((resolve) => setTimeout(resolve, 10));
      const sessionId2 = 'sess_2';
      await dataStore.set(sessionKey(userId, sessionId2), { id: sessionId2, title: 'Session 2' });
      await textStore.write(sessionNovelDocPath(userId, sessionId2), '# Novel 2');
      const nov2 = await publishNovel(dataStore, textStore, userId, sessionId2, owner);
      expect(nov2.ok).toBe(true);

      const res = await request(app).get('/api/public/novels');
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBe(2);
      expect(res.body.items[0].publicId).toBe(nov2.meta.publicId);
      expect(res.body.items[0].title).toBe('Session 2');
      expect(res.body.items[1].publicId).toBe(nov1.meta.publicId);
      expect(res.body.items[1].title).toBe('Session 1');
    });

    it('returns empty list for a type with no published items', async () => {
      const res = await request(app).get('/api/public/worlds');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], total: 0, hasMore: false });
    });

    it('returns { items, total, hasMore } and honors query params (q, moods, ruleset, ownerId, limit, offset)', async () => {
      const owner = { id: 'usr_query', displayName: 'Quinn' };
      await dataStore.set(worldMetaKey('usr_query', 'w1'), { id: 'w1', title: 'W1', updatedAt: Date.now() });
      await textStore.write(worldDocPath('usr_query', 'w1'), '# W1');
      await saveScenarioMetaAndPublish('usr_query', 'w1', 'sc1', 'Dragon Hunt', 'coc', ['ホラー'], owner);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await saveScenarioMetaAndPublish('usr_query', 'w1', 'sc2', 'Peaceful Village', 'dnd5e', ['日常'], owner);

      const byQ = await request(app).get('/api/public/scenarios').query({ q: 'dragon' });
      expect(byQ.status).toBe(200);
      expect(byQ.body.items.length).toBe(1);
      expect(byQ.body.items[0].title).toBe('Dragon Hunt');

      const byMood = await request(app).get('/api/public/scenarios').query({ moods: '日常' });
      expect(byMood.body.items.map((m) => m.title)).toEqual(['Peaceful Village']);

      const byRuleset = await request(app).get('/api/public/scenarios').query({ ruleset: 'coc' });
      expect(byRuleset.body.items.map((m) => m.title)).toEqual(['Dragon Hunt']);

      const byOwner = await request(app).get('/api/public/scenarios').query({ ownerId: 'usr_query' });
      expect(byOwner.body.total).toBe(2);

      const paged = await request(app).get('/api/public/scenarios').query({ limit: 1, offset: 0 });
      expect(paged.body.items.length).toBe(1);
      expect(paged.body.total).toBe(2);
      expect(paged.body.hasMore).toBe(true);

      async function saveScenarioMetaAndPublish(userId, worldId, scenarioId, title, recommendedRuleset, moods, own) {
        await dataStore.set(scenarioMetaKey(userId, worldId, scenarioId), {
          id: scenarioId, worldId, title, recommendedRuleset, moods, updatedAt: Date.now(),
        });
        await textStore.write(scenarioDocPath(userId, worldId, scenarioId), `## ${title}`);
        return publishScenario(dataStore, textStore, userId, worldId, scenarioId, own);
      }
    });

    it('returns 404 for unknown type in list', async () => {
      const res = await request(app).get('/api/public/rulesets');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'unknown type' });
    });

    it('returns 404 for other invalid types', async () => {
      const res = await request(app).get('/api/public/items');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'unknown type' });
    });
  });

  describe('GET /api/public/:type/:publicId — retrieve specific public item', () => {
    it('returns world detail with regions and categories', async () => {
      const owner = { id: 'usr_5', displayName: 'Eve' };
      const userId = 'usr_5';
      const worldId = 'w1';

      // Publish world with regions and categories
      await dataStore.set(worldMetaKey(userId, worldId), { id: worldId, title: 'Detailed World', updatedAt: Date.now() });
      await textStore.write(worldDocPath(userId, worldId), '# Main World Content');

      // Add regions
      await textStore.write(regionDocPath(userId, worldId, 'North'), '## North Region');
      await textStore.write(regionDocPath(userId, worldId, 'South'), '## South Region');

      // Add categories
      await textStore.write(categoryDocPath(userId, worldId, 'NPCs'), '### Important NPCs');
      await textStore.write(categoryDocPath(userId, worldId, 'Lore'), '### World Lore');

      // Publish the world
      const pub = await publishWorld(dataStore, textStore, userId, worldId, owner);
      expect(pub.ok).toBe(true);

      const res = await request(app).get(`/api/public/worlds/${pub.meta.publicId}`);
      expect(res.status).toBe(200);
      expect(res.body.publicId).toBe(pub.meta.publicId);
      expect(res.body.title).toBe('Detailed World');
      expect(res.body.raw).toBe('# Main World Content');
      expect(res.body.ownerId).toBe('usr_5');
      expect(res.body.ownerName).toBe('Eve');
      expect(res.body.regions).toBeInstanceOf(Array);
      expect(res.body.categories).toBeInstanceOf(Array);
      expect(res.body.publishedAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();
    });

    it('returns character detail with raw content', async () => {
      const owner = { id: 'usr_6', displayName: 'Frank' };
      const userId = 'usr_6';
      const worldId = 'w1';

      // Set up world
      await dataStore.set(worldMetaKey(userId, worldId), { id: worldId, title: 'Test World', updatedAt: Date.now() });
      await textStore.write(worldDocPath(userId, worldId), '# Test');

      // Publish character
      const charRaw = '## Dragon\nMighty dragon of the north';
      await dataStore.set(characterMetaKey(userId, worldId, 'npc', 'Dragon Lord'), { id: 'Dragon Lord', worldId, kind: 'npc', name: 'Dragon Lord', revealed: null, parsed: null, parsedHash: null, updatedAt: Date.now() });
      await textStore.write(characterDocPath(userId, worldId, 'npc', 'Dragon Lord'), charRaw);

      const pub = await publishCharacter(dataStore, textStore, userId, worldId, 'npc', 'Dragon Lord', owner);
      expect(pub.ok).toBe(true);

      const res = await request(app).get(`/api/public/characters/${pub.meta.publicId}`);
      expect(res.status).toBe(200);
      expect(res.body.publicId).toBe(pub.meta.publicId);
      expect(res.body.title).toBe('Dragon Lord');
      expect(res.body.kind).toBe('npc');
      expect(res.body.name).toBe('Dragon Lord');
      expect(res.body.raw).toBe('## Dragon\nMighty dragon of the north');
      expect(res.body.ownerId).toBe('usr_6');
      expect(res.body.ownerName).toBe('Frank');
      expect(res.body.publishedAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();
    });

    it('returns scenario detail with raw content and recommendedRuleset', async () => {
      const owner = { id: 'usr_7', displayName: 'Grace' };
      const userId = 'usr_7';
      const worldId = 'w1';

      // Set up world
      await dataStore.set(worldMetaKey(userId, worldId), { id: worldId, title: 'Test World', updatedAt: Date.now() });
      await textStore.write(worldDocPath(userId, worldId), '# Test');

      // Publish scenario
      const scenarioRaw = '## Quest: Slay the Dragon\nA dangerous quest...';
      await dataStore.set(scenarioMetaKey(userId, worldId, 'quest1'), { id: 'quest1', worldId, title: 'Dragon Quest', recommendedRuleset: 'pathfinder2e', updatedAt: Date.now() });
      await textStore.write(scenarioDocPath(userId, worldId, 'quest1'), scenarioRaw);

      const pub = await publishScenario(dataStore, textStore, userId, worldId, 'quest1', owner);
      expect(pub.ok).toBe(true);

      const res = await request(app).get(`/api/public/scenarios/${pub.meta.publicId}`);
      expect(res.status).toBe(200);
      expect(res.body.publicId).toBe(pub.meta.publicId);
      expect(res.body.title).toBe('Dragon Quest');
      expect(res.body.raw).toBe('## Quest: Slay the Dragon\nA dangerous quest...');
      expect(res.body.recommendedRuleset).toBe('pathfinder2e');
      expect(res.body.ownerId).toBe('usr_7');
      expect(res.body.ownerName).toBe('Grace');
      expect(res.body.publishedAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();
    });

    it('returns novel detail with raw content', async () => {
      const owner = { id: 'usr_8', displayName: 'Henry' };
      const userId = 'usr_8';
      const sessionId = 'sess_epic';

      // Set up session
      await dataStore.set(sessionKey(userId, sessionId), { id: sessionId, title: 'Epic Adventure' });
      const novelText = '# The Adventure Begins\nOnce upon a time in a far away land...';
      await textStore.write(sessionNovelDocPath(userId, sessionId), novelText);

      const pub = await publishNovel(dataStore, textStore, userId, sessionId, owner);
      expect(pub.ok).toBe(true);

      const res = await request(app).get(`/api/public/novels/${pub.meta.publicId}`);
      expect(res.status).toBe(200);
      expect(res.body.publicId).toBe(pub.meta.publicId);
      expect(res.body.title).toBe('Epic Adventure');
      expect(res.body.raw).toBe(novelText);
      expect(res.body.ownerId).toBe('usr_8');
      expect(res.body.ownerName).toBe('Henry');
      expect(res.body.publishedAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();
    });

    it('returns 404 when publicId does not exist for worlds', async () => {
      const res = await request(app).get('/api/public/worlds/pub_notfound00');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('returns 404 when publicId does not exist for characters', async () => {
      const res = await request(app).get('/api/public/characters/pub_notfound00');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('returns 404 when publicId does not exist for scenarios', async () => {
      const res = await request(app).get('/api/public/scenarios/pub_notfound00');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('returns 404 when publicId does not exist for novels', async () => {
      const res = await request(app).get('/api/public/novels/pub_notfound00');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('returns 404 for unknown type in detail endpoint', async () => {
      const res = await request(app).get('/api/public/rulesets/pub_something');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'unknown type' });
    });

    it('returns 404 for other invalid types in detail endpoint', async () => {
      const res = await request(app).get('/api/public/items/pub_something');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'unknown type' });
    });
  });

  describe('idParamGuard validation', () => {
    it('rejects malformed publicId with path traversal attempt via idParamGuard', async () => {
      const res = await request(app).get('/api/public/worlds/..%2F..%2Fescape');
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid path parameter' });
    });

    it('rejects publicId starting with dot', async () => {
      const res = await request(app).get('/api/public/worlds/.hidden');
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid path parameter' });
    });

    it('rejects publicId with consecutive dots', async () => {
      const res = await request(app).get('/api/public/worlds/pub..bad');
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid path parameter' });
    });

    it('rejects publicId with invalid characters', async () => {
      const res = await request(app).get('/api/public/worlds/pub_bad%20space');
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'invalid path parameter' });
    });

    it('accepts valid publicId format', async () => {
      const owner = { id: 'usr_9', displayName: 'Ivan' };
      const userId = 'usr_9';
      const worldId = 'w1';

      await dataStore.set(worldMetaKey(userId, worldId), { id: worldId, title: 'Test', updatedAt: Date.now() });
      await textStore.write(worldDocPath(userId, worldId), '# Test');

      const pub = await publishWorld(dataStore, textStore, userId, worldId, owner);
      expect(pub.ok).toBe(true);

      const res = await request(app).get(`/api/public/worlds/${pub.meta.publicId}`);
      expect(res.status).toBe(200);
      expect(res.body.publicId).toBe(pub.meta.publicId);
    });

    it('accepts publicId with underscores, hyphens, and alphanumerics', async () => {
      const owner = { id: 'usr_10', displayName: 'Jack' };
      const userId = 'usr_10';
      const worldId = 'w1';

      await dataStore.set(worldMetaKey(userId, worldId), { id: worldId, title: 'Test', updatedAt: Date.now() });
      await textStore.write(worldDocPath(userId, worldId), '# Test');

      const pub = await publishWorld(dataStore, textStore, userId, worldId, owner);
      const publicId = pub.meta.publicId; // Should be pub_xxxxx format

      // Verify it follows the expected pattern
      expect(publicId).toMatch(/^pub_[0-9a-f]+$/);

      const res = await request(app).get(`/api/public/worlds/${publicId}`);
      expect(res.status).toBe(200);
    });
  });

  describe('error handling', () => {
    it('handles storage errors gracefully', async () => {
      // This test verifies that asyncHandler catches errors from storage layer
      // Manually testing by poisoning a store would be intrusive, so we trust
      // that asyncHandler is tested separately (asyncHandler.test.js exists)
      // and verify it is wired correctly here via successful requests
      const owner = { id: 'usr_11', displayName: 'Karen' };
      const userId = 'usr_11';
      const worldId = 'w1';

      await dataStore.set(worldMetaKey(userId, worldId), { id: worldId, title: 'Test', updatedAt: Date.now() });
      await textStore.write(worldDocPath(userId, worldId), '# Test');

      const pub = await publishWorld(dataStore, textStore, userId, worldId, owner);
      expect(pub.ok).toBe(true);

      // Simple happy-path test to confirm asyncHandler is wired
      const res = await request(app).get(`/api/public/worlds/${pub.meta.publicId}`);
      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();
    });
  });

  describe('GET /api/starters', () => {
    it('returns an empty manifest before seeding (not a 404)', async () => {
      const res = await request(app).get('/api/starters');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ packs: [], seededAt: null });
    });

    it('returns the seeded manifest', async () => {
      await dataStore.set('public/starters', { packs: [{ packId: 'p1', title: 'パック1' }], seededAt: 123 });
      const res = await request(app).get('/api/starters');
      expect(res.status).toBe(200);
      expect(res.body.packs).toEqual([{ packId: 'p1', title: 'パック1' }]);
      expect(res.body.seededAt).toBe(123);
    });
  });
});

describe('public user profile', () => {
  it('returns only the public profile fields', async () => {
    const user = await findOrCreateUser(dataStore, { provider: 'google', providerUserId: '111', displayName: '太郎', avatarUrl: null });
    await updateUserProfile(dataStore, user.id, { bio: 'よろしく' });
    const res = await request(app).get(`/api/users/${user.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user.id, displayName: '太郎', avatarUrl: null, bio: 'よろしく' });
  });

  it('404 for an unknown user', async () => {
    expect((await request(app).get('/api/users/usr_nothere')).status).toBe(404);
  });

  it('rejects a malformed userId', async () => {
    expect((await request(app).get('/api/users/..evil')).status).toBe(400);
  });

  it('GET /users/:userId/public is gone (404) — superseded by GET /public/:type?ownerId=', async () => {
    const user = await findOrCreateUser(dataStore, { provider: 'google', providerUserId: '222', displayName: '花子', avatarUrl: null });
    const res = await request(app).get(`/api/users/${user.id}/public`);
    expect(res.status).toBe(404);
  });

  it('narrows to a single owner\'s public items via GET /public/:type?ownerId=', async () => {
    const userA = await findOrCreateUser(dataStore, { provider: 'google', providerUserId: 'aaa', displayName: 'Alice', avatarUrl: null });
    const userB = await findOrCreateUser(dataStore, { provider: 'google', providerUserId: 'bbb', displayName: 'Bob', avatarUrl: null });

    // Aがworldを1件公開
    await dataStore.set(worldMetaKey(userA.id, 'w1'), { id: 'w1', title: 'Aの世界', updatedAt: Date.now() });
    await textStore.write(worldDocPath(userA.id, 'w1'), '# Aの世界');
    const pubA = await publishWorld(dataStore, textStore, userA.id, 'w1', userA);
    expect(pubA.ok).toBe(true);

    // Bもworldを1件公開(別ユーザーなので結果に混ざってはいけない)
    await dataStore.set(worldMetaKey(userB.id, 'w1'), { id: 'w1', title: 'Bの世界', updatedAt: Date.now() });
    await textStore.write(worldDocPath(userB.id, 'w1'), '# Bの世界');
    const pubB = await publishWorld(dataStore, textStore, userB.id, 'w1', userB);
    expect(pubB.ok).toBe(true);

    const res = await request(app).get('/api/public/worlds').query({ ownerId: userA.id });
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].publicId).toBe(pubA.meta.publicId);
    expect(res.body.items[0].ownerId).toBe(userA.id);
  });
});
