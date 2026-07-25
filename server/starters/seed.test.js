// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedStarters, OFFICIAL_USER_ID } from './seed.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { starterManifestKey, worldMetaKey, characterMetaKey } from '../storage/paths.js';
import { getPublicWorld, getPublicItem } from '../storage/shareLibrary.js';
import { userProfileKey } from '../auth/users.js';

const PACKS = [
  {
    id: 'test-pack',
    title: 'テストの世界',
    tagline: '一行紹介',
    source: null,
    moods: ['ホラー'],
    recommendedRuleset: 'coc7e',
    worldRaw: '# 世界本文',
    scenario: { id: 'test-scenario', title: 'テストシナリオ', raw: '## シナリオ概要\n本文\n## GM専用情報\n秘密' },
    pc: [
      { name: 'pc-one', raw: 'PC名: 一人目\ngoal: A\nbonds: B' },
      { name: 'pc-two', raw: 'PC名: 二人目\ngoal: C\nbonds: D' },
    ],
    npc: [
      { name: 'npc-one', raw: 'NPC名: 甲' },
      { name: 'npc-two', raw: 'NPC名: 乙' },
    ],
  },
];

let dir;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starters-seed-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('seedStarters', () => {
  it('creates the official user without a login identity', async () => {
    await seedStarters(dataStore, textStore, { packs: PACKS });
    const profile = await dataStore.get(userProfileKey(OFFICIAL_USER_ID));
    expect(profile).toMatchObject({ id: OFFICIAL_USER_ID, displayName: '公式サンプル' });
    expect(await dataStore.list('auth/identities/google')).toEqual([]);
  });

  it('stores the pack in the official library using the pack id as the world id', async () => {
    await seedStarters(dataStore, textStore, { packs: PACKS });
    expect(await dataStore.get(worldMetaKey(OFFICIAL_USER_ID, 'test-pack'))).toMatchObject({ title: 'テストの世界', moods: ['ホラー'] });
    expect(await dataStore.get(characterMetaKey(OFFICIAL_USER_ID, 'test-pack', 'npc', 'npc-one'))).toMatchObject({ revealed: false });
  });

  it('writes a manifest with a publicId for every document', async () => {
    const manifest = await seedStarters(dataStore, textStore, { packs: PACKS });
    expect(manifest).toEqual(await dataStore.get(starterManifestKey()));
    expect(manifest.seededAt).toBeGreaterThan(0);
    const [entry] = manifest.packs;
    expect(entry).toMatchObject({
      packId: 'test-pack',
      title: 'テストの世界',
      tagline: '一行紹介',
      source: null,
      moods: ['ホラー'],
      recommendedRuleset: 'coc7e',
      scenarioTitle: 'テストシナリオ',
    });
    expect(entry.worldPublicId).toMatch(/^pub_/);
    expect(entry.scenarioPublicId).toMatch(/^pub_/);
    expect(entry.pcPublicIds).toHaveLength(2);
    expect(entry.npcPublicIds).toHaveLength(2);
  });

  it('publishes documents that can be read back through the public accessors', async () => {
    const manifest = await seedStarters(dataStore, textStore, { packs: PACKS });
    const [entry] = manifest.packs;
    expect(await getPublicWorld(dataStore, textStore, entry.worldPublicId)).toMatchObject({ title: 'テストの世界', raw: '# 世界本文' });
    expect(await getPublicItem(dataStore, textStore, 'scenarios', entry.scenarioPublicId)).toMatchObject({
      title: 'テストシナリオ',
      recommendedRuleset: 'coc7e',
    });
    expect(await getPublicItem(dataStore, textStore, 'characters', entry.pcPublicIds[0])).toMatchObject({ kind: 'pc', name: 'pc-one' });
  });

  // 再シードでpublicIdが変わると、ギャラリーのリンクとマニフェストが割れる
  it('keeps the same publicIds when run twice', async () => {
    const first = await seedStarters(dataStore, textStore, { packs: PACKS });
    const second = await seedStarters(dataStore, textStore, { packs: PACKS });
    expect(second.packs[0].worldPublicId).toBe(first.packs[0].worldPublicId);
    expect(second.packs[0].scenarioPublicId).toBe(first.packs[0].scenarioPublicId);
    expect(second.packs[0].pcPublicIds).toEqual(first.packs[0].pcPublicIds);
  });

  it('updates the published text when the source content changes', async () => {
    const first = await seedStarters(dataStore, textStore, { packs: PACKS });
    const edited = [{ ...PACKS[0], worldRaw: '# 書き直した本文' }];
    await seedStarters(dataStore, textStore, { packs: edited });
    const pub = await getPublicWorld(dataStore, textStore, first.packs[0].worldPublicId);
    expect(pub.raw).toBe('# 書き直した本文');
  });
});
