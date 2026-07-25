// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsTextStore } from './textStore.js';
import { saveWorld } from './worldLibrary.js';
import { saveRegion, saveCategory } from './worldContentLibrary.js';
import { saveCharacter, getCharacter } from './characterLibrary.js';
import { saveScenario, getScenario } from './scenarioLibrary.js';
import { worldMetaKey, characterMetaKey, scenarioMetaKey } from './paths.js';
import { publishWorld, publishCharacter, publishScenario, unpublishWorld } from './shareLibrary.js';
import { getWorld } from './worldLibrary.js';
import { importWorld, importCharacter, importScenario } from './importLibrary.js';

const OWNER = { id: 'usr_a', displayName: '太郎' };

let dir;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'import-library-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function seedWorld(userId, worldId = 'w1', title = 'テスト世界') {
  await saveWorld(dataStore, textStore, userId, { id: worldId, title, raw: '# 本文' });
  await saveRegion(textStore, userId, worldId, 'north', '北の地方');
  await saveCategory(textStore, userId, worldId, 'magic', '魔法体系');
  return worldId;
}

describe('importWorld', () => {
  it('copies world.md, regions and categories under a new id, leaving the source and public snapshot untouched', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    const { meta: pubMeta } = await publishWorld(dataStore, textStore, 'usr_a', 'w1', OWNER);

    const result = await importWorld(dataStore, textStore, 'usr_b', pubMeta.publicId);

    expect(result.ok).toBe(true);
    // 日本語タイトルはslugifyで非ascii文字が除去され 'untitled' になる
    expect(result.meta.id).toBe('untitled');
    expect(result.meta.title).toBe('テスト世界');

    const imported = await getWorld(dataStore, textStore, 'usr_b', 'untitled');
    expect(imported).toMatchObject({ id: 'untitled', title: 'テスト世界', raw: '# 本文' });
    expect(await textStore.read('users/usr_b/worlds/untitled/regions/north.md')).toBe('北の地方');
    expect(await textStore.read('users/usr_b/worlds/untitled/categories/magic.md')).toBe('魔法体系');

    // usr_a側の元データは無傷
    const source = await getWorld(dataStore, textStore, 'usr_a', 'w1');
    expect(source).toMatchObject({ id: 'w1', title: 'テスト世界', raw: '# 本文' });
    expect(await textStore.read('users/usr_a/worlds/w1/regions/north.md')).toBe('北の地方');

    // public側のスナップショットも無傷
    expect(await textStore.read(`public/worlds/${pubMeta.publicId}/world.md`)).toBe('# 本文');
    expect(await textStore.read(`public/worlds/${pubMeta.publicId}/regions/north.md`)).toBe('北の地方');
  });

  it('suffixes the id on collision', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    const { meta: pubMeta } = await publishWorld(dataStore, textStore, 'usr_a', 'w1', OWNER);

    // usr_bには先に同idの世界がある
    await saveWorld(dataStore, textStore, 'usr_b', { id: 'untitled', title: '既存の世界', raw: '既存' });

    const first = await importWorld(dataStore, textStore, 'usr_b', pubMeta.publicId);
    expect(first.ok).toBe(true);
    expect(first.meta.id).toBe('untitled-2');

    const second = await importWorld(dataStore, textStore, 'usr_b', pubMeta.publicId);
    expect(second.ok).toBe(true);
    expect(second.meta.id).toBe('untitled-3');

    // 元の既存世界は上書きされていない
    expect(await getWorld(dataStore, textStore, 'usr_b', 'untitled')).toMatchObject({ raw: '既存' });
  });

  it('returns not_found for unknown publicId', async () => {
    expect(await importWorld(dataStore, textStore, 'usr_b', 'pub_nope')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('carries the moods tags over from the public snapshot into the imported copy', async () => {
    await saveWorld(dataStore, textStore, 'usr_a', {
      id: 'w1',
      title: 'テスト世界',
      raw: '# 本文',
      moods: ['ホラー', '冒険'],
    });
    const { meta: pubMeta } = await publishWorld(dataStore, textStore, 'usr_a', 'w1', OWNER);

    const result = await importWorld(dataStore, textStore, 'usr_b', pubMeta.publicId);

    expect(result.ok).toBe(true);
    expect(result.meta.moods).toEqual(['ホラー', '冒険']);
    const imported = await getWorld(dataStore, textStore, 'usr_b', result.meta.id);
    expect(imported.moods).toEqual(['ホラー', '冒険']);
  });

  describe('importWorld preferredId', () => {
    it('uses preferredId as the base id when given', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: '百鬼夜行 — 平安京', raw: '# 本文' });
      const { meta: pub } = await publishWorld(dataStore, textStore, OWNER.id, 'w1', OWNER);

      const res = await importWorld(dataStore, textStore, 'usr_b', pub.publicId, { preferredId: 'hyakki-yagyo' });

      expect(res.ok).toBe(true);
      expect(res.meta.id).toBe('hyakki-yagyo');
      expect(res.meta.title).toBe('百鬼夜行 — 平安京');
    });

    it('suffixes preferredId on collision', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: '百鬼夜行 — 平安京', raw: '# 本文' });
      const { meta: pub } = await publishWorld(dataStore, textStore, OWNER.id, 'w1', OWNER);

      await importWorld(dataStore, textStore, 'usr_b', pub.publicId, { preferredId: 'hyakki-yagyo' });
      const second = await importWorld(dataStore, textStore, 'usr_b', pub.publicId, { preferredId: 'hyakki-yagyo' });

      expect(second.meta.id).toBe('hyakki-yagyo-2');
    });

    it('falls back to slugify(title) when preferredId is absent or empty', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'Ruins Of Alden', raw: '# 本文' });
      const { meta: pub } = await publishWorld(dataStore, textStore, OWNER.id, 'w1', OWNER);

      const noArg = await importWorld(dataStore, textStore, 'usr_b', pub.publicId);
      expect(noArg.meta.id).toBe('ruinsofalden');

      const empty = await importWorld(dataStore, textStore, 'usr_c', pub.publicId, { preferredId: '' });
      expect(empty.meta.id).toBe('ruinsofalden');
    });
  });
});

describe('importCharacter', () => {
  it('copies into the target world with a name collision suffix, resetting npc revealed to false', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    await saveCharacter(dataStore, textStore, 'usr_a', {
      worldId: 'w1',
      kind: 'npc',
      name: 'bob',
      raw: '# ボブの秘密',
      revealed: true,
    });
    const { meta: pubMeta } = await publishCharacter(dataStore, textStore, 'usr_a', 'w1', 'npc', 'bob', OWNER);

    await saveWorld(dataStore, textStore, 'usr_b', { id: 'target', title: '受け入れ先', raw: 'r' });
    // 衝突を発生させるため同名のnpcを先に作っておく
    await saveCharacter(dataStore, textStore, 'usr_b', {
      worldId: 'target',
      kind: 'npc',
      name: 'bob',
      raw: '既存のボブ',
      revealed: true,
    });

    const result = await importCharacter(dataStore, textStore, 'usr_b', pubMeta.publicId, 'target');

    expect(result.ok).toBe(true);
    expect(result.meta.name).toBe('bob-2');
    expect(result.meta.kind).toBe('npc');
    expect(result.meta.worldId).toBe('target');
    expect(result.meta.revealed).toBe(false);
    expect(result.meta.raw).toBe('# ボブの秘密');

    const imported = await getCharacter(dataStore, textStore, 'usr_b', 'target', 'npc', 'bob-2');
    expect(imported).toMatchObject({ raw: '# ボブの秘密', revealed: false });

    // 既存のnpcは上書きされていない
    const existing = await getCharacter(dataStore, textStore, 'usr_b', 'target', 'npc', 'bob');
    expect(existing).toMatchObject({ raw: '既存のボブ', revealed: true });

    // usr_a側の元データは無傷(revealed: trueのまま)
    const source = await getCharacter(dataStore, textStore, 'usr_a', 'w1', 'npc', 'bob');
    expect(source).toMatchObject({ raw: '# ボブの秘密', revealed: true });
  });

  it('returns target_not_found when the destination world does not exist', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    await saveCharacter(dataStore, textStore, 'usr_a', { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    const { meta: pubMeta } = await publishCharacter(dataStore, textStore, 'usr_a', 'w1', 'pc', 'alice', OWNER);

    expect(await importCharacter(dataStore, textStore, 'usr_b', pubMeta.publicId, 'nope')).toEqual({
      ok: false,
      reason: 'target_not_found',
    });
  });

  it('returns not_found for unknown publicId', async () => {
    await saveWorld(dataStore, textStore, 'usr_b', { id: 'target', title: '受け入れ先', raw: 'r' });
    expect(await importCharacter(dataStore, textStore, 'usr_b', 'pub_nope', 'target')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });
});

describe('importScenario', () => {
  it('copies with recommendedRuleset preserved', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    await saveScenario(dataStore, textStore, 'usr_a', {
      worldId: 'w1',
      id: 'sc1',
      title: '失踪事件',
      raw: '## シナリオ概要',
      recommendedRuleset: 'coc',
    });
    const { meta: pubMeta } = await publishScenario(dataStore, textStore, 'usr_a', 'w1', 'sc1', OWNER);

    await saveWorld(dataStore, textStore, 'usr_b', { id: 'target', title: '受け入れ先', raw: 'r' });

    const result = await importScenario(dataStore, textStore, 'usr_b', pubMeta.publicId, 'target');

    expect(result.ok).toBe(true);
    expect(result.meta).toMatchObject({
      worldId: 'target',
      title: '失踪事件',
      recommendedRuleset: 'coc',
      raw: '## シナリオ概要',
    });

    const imported = await getScenario(dataStore, textStore, 'usr_b', 'target', result.meta.id);
    expect(imported).toMatchObject({ title: '失踪事件', recommendedRuleset: 'coc', raw: '## シナリオ概要' });

    // usr_a側の元データは無傷
    const source = await getScenario(dataStore, textStore, 'usr_a', 'w1', 'sc1');
    expect(source).toMatchObject({ title: '失踪事件', recommendedRuleset: 'coc' });
  });

  it('suffixes the id on collision', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    await saveScenario(dataStore, textStore, 'usr_a', {
      worldId: 'w1',
      id: 'sc1',
      title: '失踪事件',
      raw: '## シナリオ概要',
    });
    const { meta: pubMeta } = await publishScenario(dataStore, textStore, 'usr_a', 'w1', 'sc1', OWNER);

    await saveWorld(dataStore, textStore, 'usr_b', { id: 'target', title: '受け入れ先', raw: 'r' });
    // slugify('失踪事件') -> 'untitled' (非ascii除去) と衝突させる
    await saveScenario(dataStore, textStore, 'usr_b', {
      worldId: 'target',
      id: 'untitled',
      title: '既存シナリオ',
      raw: '既存',
    });

    const result = await importScenario(dataStore, textStore, 'usr_b', pubMeta.publicId, 'target');
    expect(result.ok).toBe(true);
    expect(result.meta.id).toBe('untitled-2');
  });

  it('returns target_not_found when the destination world does not exist', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    await saveScenario(dataStore, textStore, 'usr_a', { worldId: 'w1', id: 'sc1', title: 't', raw: 'r' });
    const { meta: pubMeta } = await publishScenario(dataStore, textStore, 'usr_a', 'w1', 'sc1', OWNER);

    expect(await importScenario(dataStore, textStore, 'usr_b', pubMeta.publicId, 'nope')).toEqual({
      ok: false,
      reason: 'target_not_found',
    });
  });

  it('returns not_found for unknown publicId', async () => {
    await saveWorld(dataStore, textStore, 'usr_b', { id: 'target', title: '受け入れ先', raw: 'r' });
    expect(await importScenario(dataStore, textStore, 'usr_b', 'pub_nope', 'target')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('carries the moods tags over from the public snapshot into the imported copy', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    await saveScenario(dataStore, textStore, 'usr_a', {
      worldId: 'w1',
      id: 'sc1',
      title: '失踪事件',
      raw: '## シナリオ概要',
      moods: ['ミステリー', '日常'],
    });
    const { meta: pubMeta } = await publishScenario(dataStore, textStore, 'usr_a', 'w1', 'sc1', OWNER);

    await saveWorld(dataStore, textStore, 'usr_b', { id: 'target', title: '受け入れ先', raw: 'r' });

    const result = await importScenario(dataStore, textStore, 'usr_b', pubMeta.publicId, 'target');

    expect(result.ok).toBe(true);
    expect(result.meta.moods).toEqual(['ミステリー', '日常']);
    const imported = await getScenario(dataStore, textStore, 'usr_b', 'target', result.meta.id);
    expect(imported.moods).toEqual(['ミステリー', '日常']);
  });
});

  describe('importScenario preferredId', () => {
    it('uses preferredId as the base id when given', async () => {
      await seedWorld('usr_a', 'w1', 'テスト世界');
      await saveScenario(dataStore, textStore, 'usr_a', {
        worldId: 'w1',
        id: 'sc1',
        title: '朱雀大路の百鬼夜行',
        raw: '## シナリオ概要',
      });
      const { meta: pub } = await publishScenario(dataStore, textStore, 'usr_a', 'w1', 'sc1', OWNER);
      await saveWorld(dataStore, textStore, 'usr_b', { id: 'target', title: '受け入れ先', raw: 'r' });

      const result = await importScenario(dataStore, textStore, 'usr_b', pub.publicId, 'target', {
        preferredId: 'hyakki-on-suzaku-oji',
      });

      expect(result.ok).toBe(true);
      expect(result.meta.id).toBe('hyakki-on-suzaku-oji');
      expect(result.meta.title).toBe('朱雀大路の百鬼夜行');
    });

    it('suffixes preferredId on collision', async () => {
      await seedWorld('usr_a', 'w1', 'テスト世界');
      await saveScenario(dataStore, textStore, 'usr_a', {
        worldId: 'w1',
        id: 'sc1',
        title: '朱雀大路の百鬼夜行',
        raw: '## シナリオ概要',
      });
      const { meta: pub } = await publishScenario(dataStore, textStore, 'usr_a', 'w1', 'sc1', OWNER);
      await saveWorld(dataStore, textStore, 'usr_b', { id: 'target', title: '受け入れ先', raw: 'r' });

      await importScenario(dataStore, textStore, 'usr_b', pub.publicId, 'target', { preferredId: 'hyakki-on-suzaku-oji' });
      const second = await importScenario(dataStore, textStore, 'usr_b', pub.publicId, 'target', {
        preferredId: 'hyakki-on-suzaku-oji',
      });

      expect(second.meta.id).toBe('hyakki-on-suzaku-oji-2');
    });

    it('falls back to slugify(title) when preferredId is absent or empty', async () => {
      await seedWorld('usr_a', 'w1', 'テスト世界');
      await saveScenario(dataStore, textStore, 'usr_a', {
        worldId: 'w1',
        id: 'sc1',
        title: 'Stolen Well',
        raw: '## シナリオ概要',
      });
      const { meta: pub } = await publishScenario(dataStore, textStore, 'usr_a', 'w1', 'sc1', OWNER);
      await saveWorld(dataStore, textStore, 'usr_b', { id: 'target-b', title: '受け入れ先b', raw: 'r' });
      await saveWorld(dataStore, textStore, 'usr_b', { id: 'target-c', title: '受け入れ先c', raw: 'r' });

      const noArg = await importScenario(dataStore, textStore, 'usr_b', pub.publicId, 'target-b');
      expect(noArg.meta.id).toBe('stolenwell');

      const empty = await importScenario(dataStore, textStore, 'usr_b', pub.publicId, 'target-c', { preferredId: '' });
      expect(empty.meta.id).toBe('stolenwell');
    });
  });

describe('import is a snapshot', () => {
  it('keeps the imported copy after the source is unpublished', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    const { meta: pubMeta } = await publishWorld(dataStore, textStore, 'usr_a', 'w1', OWNER);

    const result = await importWorld(dataStore, textStore, 'usr_b', pubMeta.publicId);
    expect(result.ok).toBe(true);

    await unpublishWorld(dataStore, textStore, 'usr_a', 'w1');

    // 公開が解除されても、既にインポート済みのusr_b側コピーは残る
    const imported = await getWorld(dataStore, textStore, 'usr_b', result.meta.id);
    expect(imported).toMatchObject({ id: result.meta.id, title: 'テスト世界', raw: '# 本文' });
    expect(await textStore.read(`users/usr_b/worlds/${result.meta.id}/regions/north.md`)).toBe('北の地方');

    // usr_a側の元世界自体は(unpublishでは削除されないので)無傷のまま
    expect(await getWorld(dataStore, textStore, 'usr_a', 'w1')).toMatchObject({ raw: '# 本文' });
  });
});

describe('worldMetaKey / characterMetaKey / scenarioMetaKey exist-check keys', () => {
  it('importWorld collision check is scoped per-user (importer id collisions do not leak across users)', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    const { meta: pubMeta } = await publishWorld(dataStore, textStore, 'usr_a', 'w1', OWNER);

    // usr_c has no prior 'untitled' world, so import should land at the base id
    expect(await dataStore.get(worldMetaKey('usr_c', 'untitled'))).toBeNull();
    const result = await importWorld(dataStore, textStore, 'usr_c', pubMeta.publicId);
    expect(result.meta.id).toBe('untitled');
  });

  it('importCharacter collision check uses characterMetaKey scoped to the target world', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    await saveCharacter(dataStore, textStore, 'usr_a', { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    const { meta: pubMeta } = await publishCharacter(dataStore, textStore, 'usr_a', 'w1', 'pc', 'alice', OWNER);
    await saveWorld(dataStore, textStore, 'usr_b', { id: 'target', title: '受け入れ先', raw: 'r' });

    expect(await dataStore.get(characterMetaKey('usr_b', 'target', 'pc', 'alice'))).toBeNull();
    const result = await importCharacter(dataStore, textStore, 'usr_b', pubMeta.publicId, 'target');
    expect(result.meta.name).toBe('alice');
    expect(await dataStore.get(characterMetaKey('usr_b', 'target', 'pc', 'alice'))).not.toBeNull();
  });

  it('importScenario collision check uses scenarioMetaKey scoped to the target world', async () => {
    await seedWorld('usr_a', 'w1', 'テスト世界');
    await saveScenario(dataStore, textStore, 'usr_a', { worldId: 'w1', id: 'sc1', title: 'abc', raw: 'r' });
    const { meta: pubMeta } = await publishScenario(dataStore, textStore, 'usr_a', 'w1', 'sc1', OWNER);
    await saveWorld(dataStore, textStore, 'usr_b', { id: 'target', title: '受け入れ先', raw: 'r' });

    expect(await dataStore.get(scenarioMetaKey('usr_b', 'target', 'abc'))).toBeNull();
    const result = await importScenario(dataStore, textStore, 'usr_b', pubMeta.publicId, 'target');
    expect(result.meta.id).toBe('abc');
    expect(await dataStore.get(scenarioMetaKey('usr_b', 'target', 'abc'))).not.toBeNull();
  });
});
