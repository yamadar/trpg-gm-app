// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsTextStore } from './textStore.js';
import { saveWorld } from './worldLibrary.js';
import { saveRegion, saveCategory, saveWorldSource, deleteRegion } from './worldContentLibrary.js';
import { saveCharacter } from './characterLibrary.js';
import { saveScenario } from './scenarioLibrary.js';
import {
  publicMetaKey,
  publicWorldDocPath,
  publicRegionDocPath,
  publicCategoryDocPath,
  publicCharacterDocPath,
  publicScenarioDocPath,
  publicNovelDocPath,
  publishWorldMapKey,
  publishCharacterMapKey,
  publishScenarioMapKey,
  publishNovelMapKey,
  sessionKey,
  sessionNovelDocPath,
} from './paths.js';
import {
  publishWorld,
  publishCharacter,
  publishScenario,
  publishNovel,
  unpublishWorld,
  unpublishCharacter,
  unpublishScenario,
  unpublishNovel,
  unpublishWorldCascade,
  listPublic,
  getPublicWorld,
  getPublicItem,
  getPublishedWorlds,
  getPublishedCharacters,
  getPublishedScenarios,
  getPublishedNovels,
} from './shareLibrary.js';

const OWNER = { id: 'usr_1', displayName: '太郎' };

let dir;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'share-library-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function seedWorld(userId, worldId = 'w1') {
  await saveWorld(dataStore, textStore, userId, { id: worldId, title: 'テスト世界', raw: '# 本文' });
  await saveRegion(textStore, userId, worldId, 'north', '北の地方');
  await saveCategory(textStore, userId, worldId, 'magic', '魔法体系');
  await saveWorldSource(textStore, userId, worldId, '長大な原文(非公開)');
  return worldId;
}

describe('publishWorld', () => {
  it('snapshots world.md, regions and categories but not source.md', async () => {
    await seedWorld('usr_1');
    const { ok, meta } = await publishWorld(dataStore, textStore, 'usr_1', 'w1', OWNER);
    expect(ok).toBe(true);
    expect(meta.publicId).toMatch(/^pub_[0-9a-f]{12}$/);
    expect(meta).toMatchObject({
      title: 'テスト世界',
      ownerId: 'usr_1',
      ownerName: '太郎',
      regions: ['north'],
      categories: ['magic'],
    });
    expect(typeof meta.publishedAt).toBe('number');
    expect(typeof meta.updatedAt).toBe('number');
    expect(await textStore.read(publicWorldDocPath(meta.publicId))).toBe('# 本文');
    expect(await textStore.read(publicRegionDocPath(meta.publicId, 'north'))).toBe('北の地方');
    expect(await textStore.read(publicCategoryDocPath(meta.publicId, 'magic'))).toBe('魔法体系');
    const files = await textStore.list(`public/worlds/${meta.publicId}`);
    expect(files).not.toContain(expect.stringContaining('source'));
    expect(await dataStore.get(publishWorldMapKey('usr_1', 'w1'))).toEqual({ publicId: meta.publicId });
    expect(await dataStore.get(publicMetaKey('worlds', meta.publicId))).toEqual(meta);
  });

  it('returns not_found for a missing world', async () => {
    expect(await publishWorld(dataStore, textStore, 'usr_1', 'nope', OWNER)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('carries moods into the public meta', async () => {
    await saveWorld(dataStore, textStore, 'usr_1', { id: 'w1', title: 'テスト世界', raw: '# 本文', moods: ['ホラー', '冒険'] });
    const { meta } = await publishWorld(dataStore, textStore, 'usr_1', 'w1', OWNER);
    expect(meta.moods).toEqual(['ホラー', '冒険']);
  });

  it('defaults moods to [] when the world has none', async () => {
    await seedWorld('usr_1');
    const { meta } = await publishWorld(dataStore, textStore, 'usr_1', 'w1', OWNER);
    expect(meta.moods).toEqual([]);
  });

  it('republish keeps publicId and publishedAt, bumps updatedAt, and drops removed regions', async () => {
    await seedWorld('usr_1');
    const nowSpy = vi.spyOn(Date, 'now');

    nowSpy.mockReturnValueOnce(1000);
    const first = await publishWorld(dataStore, textStore, 'usr_1', 'w1', OWNER);
    expect(first.meta.publishedAt).toBe(1000);
    expect(first.meta.updatedAt).toBe(1000);

    await deleteRegion(textStore, 'usr_1', 'w1', 'north');
    await saveWorld(dataStore, textStore, 'usr_1', { id: 'w1', title: 'テスト世界2', raw: '# 新本文' });

    nowSpy.mockReturnValueOnce(2000);
    const second = await publishWorld(dataStore, textStore, 'usr_1', 'w1', OWNER);
    nowSpy.mockRestore();

    expect(second.ok).toBe(true);
    expect(second.meta.publicId).toBe(first.meta.publicId);
    expect(second.meta.publishedAt).toBe(1000);
    expect(second.meta.updatedAt).toBe(2000);
    expect(second.meta.regions).toEqual([]);
    expect(second.meta.title).toBe('テスト世界2');
    expect(await textStore.read(publicWorldDocPath(second.meta.publicId))).toBe('# 新本文');
    expect(await textStore.read(publicRegionDocPath(second.meta.publicId, 'north'))).toBeNull();
    // mapping still points at the same publicId (no duplicate publication created)
    expect(await dataStore.get(publishWorldMapKey('usr_1', 'w1'))).toEqual({ publicId: first.meta.publicId });
  });
});

describe('publishCharacter', () => {
  it('snapshots character content with type fields', async () => {
    await seedWorld('usr_1');
    await saveCharacter(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      kind: 'pc',
      name: 'alice',
      raw: '# アリスのシート',
    });
    const { ok, meta } = await publishCharacter(dataStore, textStore, 'usr_1', 'w1', 'pc', 'alice', OWNER);
    expect(ok).toBe(true);
    expect(meta).toMatchObject({ kind: 'pc', name: 'alice', title: 'alice', ownerId: 'usr_1', ownerName: '太郎' });
    expect(meta.publicId).toMatch(/^pub_[0-9a-f]{12}$/);
    expect(await textStore.read(publicCharacterDocPath(meta.publicId))).toBe('# アリスのシート');
    expect(await dataStore.get(publishCharacterMapKey('usr_1', 'w1', 'pc', 'alice'))).toEqual({
      publicId: meta.publicId,
    });
  });

  it('returns not_found for a missing character', async () => {
    await seedWorld('usr_1');
    expect(await publishCharacter(dataStore, textStore, 'usr_1', 'w1', 'pc', 'nope', OWNER)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('carries worldId and worldTitle (from the owner\'s world meta)', async () => {
    await seedWorld('usr_1');
    await saveCharacter(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      kind: 'pc',
      name: 'alice',
      raw: '# アリスのシート',
    });
    const { meta } = await publishCharacter(dataStore, textStore, 'usr_1', 'w1', 'pc', 'alice', OWNER);
    expect(meta.worldId).toBe('w1');
    expect(meta.worldTitle).toBe('テスト世界');
  });

  it('worldTitle falls back to null when the world meta is missing', async () => {
    await saveCharacter(dataStore, textStore, 'usr_1', {
      worldId: 'ghost-world',
      kind: 'pc',
      name: 'alice',
      raw: '# アリスのシート',
    });
    const { meta } = await publishCharacter(dataStore, textStore, 'usr_1', 'ghost-world', 'pc', 'alice', OWNER);
    expect(meta.worldId).toBe('ghost-world');
    expect(meta.worldTitle).toBeNull();
  });
});

describe('publishScenario', () => {
  it('snapshots scenario content including recommendedRuleset', async () => {
    await seedWorld('usr_1');
    await saveScenario(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      id: 'sc1',
      title: '失踪事件',
      raw: '## シナリオ概要',
      recommendedRuleset: 'coc',
    });
    const { ok, meta } = await publishScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1', OWNER);
    expect(ok).toBe(true);
    expect(meta).toMatchObject({ title: '失踪事件', recommendedRuleset: 'coc' });
    expect(await textStore.read(publicScenarioDocPath(meta.publicId))).toBe('## シナリオ概要');
    expect(await dataStore.get(publishScenarioMapKey('usr_1', 'w1', 'sc1'))).toEqual({ publicId: meta.publicId });
  });

  it('returns not_found for a missing scenario', async () => {
    await seedWorld('usr_1');
    expect(await publishScenario(dataStore, textStore, 'usr_1', 'w1', 'nope', OWNER)).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('carries moods, worldId and worldTitle (from the owner\'s world meta)', async () => {
    await seedWorld('usr_1');
    await saveScenario(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      id: 'sc1',
      title: '失踪事件',
      raw: '## シナリオ概要',
      moods: ['ミステリー', 'シリアス'],
    });
    const { meta } = await publishScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1', OWNER);
    expect(meta.moods).toEqual(['ミステリー', 'シリアス']);
    expect(meta.worldId).toBe('w1');
    expect(meta.worldTitle).toBe('テスト世界');
  });

  it('worldTitle falls back to null when the world meta is missing', async () => {
    await saveScenario(dataStore, textStore, 'usr_1', {
      worldId: 'ghost-world',
      id: 'sc1',
      title: '失踪事件',
      raw: '## シナリオ概要',
    });
    const { meta } = await publishScenario(dataStore, textStore, 'usr_1', 'ghost-world', 'sc1', OWNER);
    expect(meta.moods).toEqual([]);
    expect(meta.worldId).toBe('ghost-world');
    expect(meta.worldTitle).toBeNull();
  });
});

describe('publishNovel', () => {
  it('requires the session and the novel to exist', async () => {
    expect(await publishNovel(dataStore, textStore, 'usr_1', 'sess1', OWNER)).toEqual({
      ok: false,
      reason: 'not_found',
    });

    await dataStore.set(sessionKey('usr_1', 'sess1'), { id: 'sess1', title: 'とある冒険' });
    expect(await publishNovel(dataStore, textStore, 'usr_1', 'sess1', OWNER)).toEqual({
      ok: false,
      reason: 'novel_not_generated',
    });

    await textStore.write(sessionNovelDocPath('usr_1', 'sess1'), '小説本文');
    const { ok, meta } = await publishNovel(dataStore, textStore, 'usr_1', 'sess1', OWNER);
    expect(ok).toBe(true);
    expect(meta.title).toBe('とある冒険');
    expect(await textStore.read(publicNovelDocPath(meta.publicId))).toBe('小説本文');
    expect(await dataStore.get(publishNovelMapKey('usr_1', 'sess1'))).toEqual({ publicId: meta.publicId });
  });

  it('falls back to a default title when the session has none', async () => {
    await dataStore.set(sessionKey('usr_1', 'sess2'), { id: 'sess2' });
    await textStore.write(sessionNovelDocPath('usr_1', 'sess2'), '本文2');
    const { meta } = await publishNovel(dataStore, textStore, 'usr_1', 'sess2', OWNER);
    expect(meta.title).toBe('セッション');
  });
});

describe('unpublish*', () => {
  it('unpublishWorld removes snapshot, meta and mapping and is idempotent', async () => {
    await seedWorld('usr_1');
    const { meta } = await publishWorld(dataStore, textStore, 'usr_1', 'w1', OWNER);

    await unpublishWorld(dataStore, textStore, 'usr_1', 'w1');

    expect(await dataStore.get(publicMetaKey('worlds', meta.publicId))).toBeNull();
    expect(await textStore.read(publicWorldDocPath(meta.publicId))).toBeNull();
    expect(await textStore.read(publicRegionDocPath(meta.publicId, 'north'))).toBeNull();
    expect(await dataStore.get(publishWorldMapKey('usr_1', 'w1'))).toBeNull();

    await expect(unpublishWorld(dataStore, textStore, 'usr_1', 'w1')).resolves.not.toThrow();
  });

  it('unpublishCharacter removes snapshot, meta and mapping and is idempotent', async () => {
    await seedWorld('usr_1');
    await saveCharacter(dataStore, textStore, 'usr_1', { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    const { meta } = await publishCharacter(dataStore, textStore, 'usr_1', 'w1', 'pc', 'alice', OWNER);

    await unpublishCharacter(dataStore, textStore, 'usr_1', 'w1', 'pc', 'alice');

    expect(await dataStore.get(publicMetaKey('characters', meta.publicId))).toBeNull();
    expect(await textStore.read(publicCharacterDocPath(meta.publicId))).toBeNull();
    expect(await dataStore.get(publishCharacterMapKey('usr_1', 'w1', 'pc', 'alice'))).toBeNull();

    await expect(
      unpublishCharacter(dataStore, textStore, 'usr_1', 'w1', 'pc', 'alice')
    ).resolves.not.toThrow();
  });

  it('unpublishScenario removes snapshot, meta and mapping and is idempotent', async () => {
    await seedWorld('usr_1');
    await saveScenario(dataStore, textStore, 'usr_1', { worldId: 'w1', id: 'sc1', title: 't', raw: 'r' });
    const { meta } = await publishScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1', OWNER);

    await unpublishScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1');

    expect(await dataStore.get(publicMetaKey('scenarios', meta.publicId))).toBeNull();
    expect(await textStore.read(publicScenarioDocPath(meta.publicId))).toBeNull();
    expect(await dataStore.get(publishScenarioMapKey('usr_1', 'w1', 'sc1'))).toBeNull();

    await expect(unpublishScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1')).resolves.not.toThrow();
  });

  it('unpublishNovel removes snapshot, meta and mapping and is idempotent', async () => {
    await dataStore.set(sessionKey('usr_1', 'sess1'), { id: 'sess1', title: 'とある冒険' });
    await textStore.write(sessionNovelDocPath('usr_1', 'sess1'), '小説本文');
    const { meta } = await publishNovel(dataStore, textStore, 'usr_1', 'sess1', OWNER);

    await unpublishNovel(dataStore, textStore, 'usr_1', 'sess1');

    expect(await dataStore.get(publicMetaKey('novels', meta.publicId))).toBeNull();
    expect(await textStore.read(publicNovelDocPath(meta.publicId))).toBeNull();
    expect(await dataStore.get(publishNovelMapKey('usr_1', 'sess1'))).toBeNull();

    await expect(unpublishNovel(dataStore, textStore, 'usr_1', 'sess1')).resolves.not.toThrow();
  });

  it('unpublishing something that was never published does not throw', async () => {
    await expect(unpublishWorld(dataStore, textStore, 'usr_1', 'never-published')).resolves.not.toThrow();
    await expect(
      unpublishCharacter(dataStore, textStore, 'usr_1', 'w1', 'pc', 'nobody')
    ).resolves.not.toThrow();
  });
});

describe('unpublishWorldCascade', () => {
  it('unpublishes child characters and scenarios along with the world', async () => {
    await seedWorld('usr_1');
    await saveCharacter(dataStore, textStore, 'usr_1', { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    await saveCharacter(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      kind: 'npc',
      name: 'bob',
      raw: 'b',
      revealed: true,
    });
    await saveScenario(dataStore, textStore, 'usr_1', { worldId: 'w1', id: 'sc1', title: 't', raw: 'r' });

    const worldPub = await publishWorld(dataStore, textStore, 'usr_1', 'w1', OWNER);
    const pcPub = await publishCharacter(dataStore, textStore, 'usr_1', 'w1', 'pc', 'alice', OWNER);
    const npcPub = await publishCharacter(dataStore, textStore, 'usr_1', 'w1', 'npc', 'bob', OWNER);
    const scenarioPub = await publishScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1', OWNER);

    await unpublishWorldCascade(dataStore, textStore, 'usr_1', 'w1');

    expect(await dataStore.get(publicMetaKey('worlds', worldPub.meta.publicId))).toBeNull();
    expect(await dataStore.get(publicMetaKey('characters', pcPub.meta.publicId))).toBeNull();
    expect(await dataStore.get(publicMetaKey('characters', npcPub.meta.publicId))).toBeNull();
    expect(await dataStore.get(publicMetaKey('scenarios', scenarioPub.meta.publicId))).toBeNull();

    expect(await textStore.read(publicWorldDocPath(worldPub.meta.publicId))).toBeNull();
    expect(await textStore.read(publicCharacterDocPath(pcPub.meta.publicId))).toBeNull();
    expect(await textStore.read(publicCharacterDocPath(npcPub.meta.publicId))).toBeNull();
    expect(await textStore.read(publicScenarioDocPath(scenarioPub.meta.publicId))).toBeNull();

    expect(await dataStore.get(publishWorldMapKey('usr_1', 'w1'))).toBeNull();
    expect(await dataStore.get(publishCharacterMapKey('usr_1', 'w1', 'pc', 'alice'))).toBeNull();
    expect(await dataStore.get(publishCharacterMapKey('usr_1', 'w1', 'npc', 'bob'))).toBeNull();
    expect(await dataStore.get(publishScenarioMapKey('usr_1', 'w1', 'sc1'))).toBeNull();
  });

  it('is a no-op when nothing under the world was published', async () => {
    await seedWorld('usr_1');
    await expect(unpublishWorldCascade(dataStore, textStore, 'usr_1', 'w1')).resolves.not.toThrow();
  });
});

describe('listPublic', () => {
  it('returns metas sorted by publishedAt desc', async () => {
    await seedWorld('usr_1', 'w1');
    const first = await publishWorld(dataStore, textStore, 'usr_1', 'w1', OWNER);

    // real wall-clock gap so publishedAt differs without stubbing Date.now
    await new Promise((resolve) => setTimeout(resolve, 5));

    await seedWorld('usr_2', 'w2');
    const second = await publishWorld(dataStore, textStore, 'usr_2', 'w2', { id: 'usr_2', displayName: '花子' });

    const metas = await listPublic(dataStore, 'worlds');
    expect(metas.map((m) => m.publicId)).toEqual([second.meta.publicId, first.meta.publicId]);
    expect(metas[0].publishedAt).toBeGreaterThanOrEqual(metas[1].publishedAt);
  });

  it('returns an empty array when nothing is published', async () => {
    expect(await listPublic(dataStore, 'worlds')).toEqual([]);
  });
});

describe('getPublicWorld', () => {
  it('returns meta with region and category bodies', async () => {
    await seedWorld('usr_1');
    const { meta } = await publishWorld(dataStore, textStore, 'usr_1', 'w1', OWNER);

    const result = await getPublicWorld(dataStore, textStore, meta.publicId);

    expect(result).toMatchObject({
      publicId: meta.publicId,
      title: 'テスト世界',
      raw: '# 本文',
      regions: [{ name: 'north', raw: '北の地方' }],
      categories: [{ name: 'magic', raw: '魔法体系' }],
    });
  });

  it('returns null for an unknown publicId', async () => {
    expect(await getPublicWorld(dataStore, textStore, 'pub_nope')).toBeNull();
  });
});

describe('getPublicItem', () => {
  it('reads the per-type doc for characters, scenarios and novels', async () => {
    await seedWorld('usr_1');

    await saveCharacter(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      kind: 'pc',
      name: 'alice',
      raw: '# アリスのシート',
    });
    const charPub = await publishCharacter(dataStore, textStore, 'usr_1', 'w1', 'pc', 'alice', OWNER);
    expect(await getPublicItem(dataStore, textStore, 'characters', charPub.meta.publicId)).toMatchObject({
      publicId: charPub.meta.publicId,
      kind: 'pc',
      name: 'alice',
      raw: '# アリスのシート',
    });

    await saveScenario(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      id: 'sc1',
      title: '失踪事件',
      raw: '## シナリオ概要',
    });
    const scenarioPub = await publishScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1', OWNER);
    expect(await getPublicItem(dataStore, textStore, 'scenarios', scenarioPub.meta.publicId)).toMatchObject({
      publicId: scenarioPub.meta.publicId,
      title: '失踪事件',
      raw: '## シナリオ概要',
    });

    await dataStore.set(sessionKey('usr_1', 'sess1'), { id: 'sess1', title: 'とある冒険' });
    await textStore.write(sessionNovelDocPath('usr_1', 'sess1'), '小説本文');
    const novelPub = await publishNovel(dataStore, textStore, 'usr_1', 'sess1', OWNER);
    expect(await getPublicItem(dataStore, textStore, 'novels', novelPub.meta.publicId)).toMatchObject({
      publicId: novelPub.meta.publicId,
      title: 'とある冒険',
      raw: '小説本文',
    });
  });

  it('returns null for an unknown publicId', async () => {
    expect(await getPublicItem(dataStore, textStore, 'characters', 'pub_nope')).toBeNull();
  });
});

describe('getPublished* maps', () => {
  it('getPublishedWorlds maps local worldId to publicId, only for published worlds', async () => {
    await seedWorld('usr_1', 'w1');
    await seedWorld('usr_1', 'w2');
    const { meta } = await publishWorld(dataStore, textStore, 'usr_1', 'w1', OWNER);

    expect(await getPublishedWorlds(dataStore, 'usr_1')).toEqual({ w1: meta.publicId });
  });

  it('getPublishedCharacters maps name to publicId, scoped by kind', async () => {
    await seedWorld('usr_1');
    await saveCharacter(dataStore, textStore, 'usr_1', { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    await saveCharacter(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      kind: 'npc',
      name: 'bob',
      raw: 'b',
      revealed: true,
    });
    const pcPub = await publishCharacter(dataStore, textStore, 'usr_1', 'w1', 'pc', 'alice', OWNER);
    const npcPub = await publishCharacter(dataStore, textStore, 'usr_1', 'w1', 'npc', 'bob', OWNER);

    expect(await getPublishedCharacters(dataStore, 'usr_1', 'w1', 'pc')).toEqual({ alice: pcPub.meta.publicId });
    expect(await getPublishedCharacters(dataStore, 'usr_1', 'w1', 'npc')).toEqual({ bob: npcPub.meta.publicId });
  });

  it('getPublishedScenarios maps scenarioId to publicId', async () => {
    await seedWorld('usr_1');
    await saveScenario(dataStore, textStore, 'usr_1', { worldId: 'w1', id: 'sc1', title: 't', raw: 'r' });
    const { meta } = await publishScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1', OWNER);

    expect(await getPublishedScenarios(dataStore, 'usr_1', 'w1')).toEqual({ sc1: meta.publicId });
  });

  it('getPublishedNovels maps sessionId to publicId', async () => {
    await dataStore.set(sessionKey('usr_1', 'sess1'), { id: 'sess1', title: 'とある冒険' });
    await textStore.write(sessionNovelDocPath('usr_1', 'sess1'), '小説本文');
    const { meta } = await publishNovel(dataStore, textStore, 'usr_1', 'sess1', OWNER);

    expect(await getPublishedNovels(dataStore, 'usr_1')).toEqual({ sess1: meta.publicId });
  });

  it('returns empty objects when nothing is published', async () => {
    expect(await getPublishedWorlds(dataStore, 'usr_1')).toEqual({});
    expect(await getPublishedCharacters(dataStore, 'usr_1', 'w1', 'pc')).toEqual({});
    expect(await getPublishedScenarios(dataStore, 'usr_1', 'w1')).toEqual({});
    expect(await getPublishedNovels(dataStore, 'usr_1')).toEqual({});
  });
});
