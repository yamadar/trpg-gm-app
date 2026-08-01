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

const MULTI_PACK = {
  ...PACKS[0],
  id: 'campaign-pack',
  scenarios: [
    { id: 'episode-one', title: '第一話', raw: '## シナリオ概要\n第一話\n## GM専用情報\n秘密1' },
    { id: 'episode-two', title: '第二話', raw: '## シナリオ概要\n第二話\n## GM専用情報\n秘密2' },
  ],
  scenario: undefined,
};

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
      // pack.jsonが宣言したscenario.idをそのままマニフェストに残す。無いと
      // 取り込み側がslugify(title)頼りになり、日本語タイトルは'untitled'に潰れる
      scenarioId: 'test-scenario',
      scenarioCount: 1,
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

  it('publishes every scenario in a campaign pack and keeps the first as the entry scenario', async () => {
    const manifest = await seedStarters(dataStore, textStore, { packs: [MULTI_PACK] });
    const [entry] = manifest.packs;

    expect(entry).toMatchObject({
      scenarioTitle: '第一話',
      scenarioId: 'episode-one',
      scenarioCount: 2,
    });
    expect(entry.scenarios.map((scenario) => ({ id: scenario.id, title: scenario.title }))).toEqual([
      { id: 'episode-one', title: '第一話' },
      { id: 'episode-two', title: '第二話' },
    ]);
    expect(entry.scenarioPublicId).toBe(entry.scenarios[0].publicId);

    const second = await getPublicItem(dataStore, textStore, 'scenarios', entry.scenarios[1].publicId);
    expect(second).toMatchObject({ title: '第二話', raw: expect.stringContaining('第二話') });
  });
});

// 起動のたびに全パックを書き直しており、その待ち時間がそのまま起動時間になっていた。
// 内容が変わっていなければ書き込みを飛ばす。飛ばしすぎ(内容が変わったのに反映されない)は
// 直接ユーザーに見えるので、両方向を固定する。
describe('seedStarters change detection', () => {
  // dataStore.set を数えて「書き込みを本当に飛ばしたか」を見る。所要時間で測ると
  // マシン負荷で揺れるうえ、飛ばせていなくても速ければ通ってしまう。
  function countingStore(inner) {
    const counts = { set: 0, get: 0 };
    return {
      store: {
        ...inner,
        get: (k) => { counts.get += 1; return inner.get(k); },
        set: (k, v) => { counts.set += 1; return inner.set(k, v); },
      },
      counts,
    };
  }

  it('skips every write when the content is unchanged', async () => {
    await seedStarters(dataStore, textStore, { packs: PACKS });

    const { store, counts } = countingStore(dataStore);
    const manifest = await seedStarters(store, textStore, { packs: PACKS });

    expect(counts.set).toBe(0);
    expect(manifest.packs).toHaveLength(1);
    expect(manifest.contentHash).toEqual(expect.any(String));
  });

  it('reseeds when any pack content changes', async () => {
    const first = await seedStarters(dataStore, textStore, { packs: PACKS });

    const edited = [{ ...PACKS[0], worldRaw: '# 別の本文' }];
    const { store, counts } = countingStore(dataStore);
    const second = await seedStarters(store, textStore, { packs: edited });

    expect(counts.set).toBeGreaterThan(0);
    expect(second.contentHash).not.toBe(first.contentHash);
    const pub = await getPublicWorld(dataStore, textStore, second.packs[0].worldPublicId);
    expect(pub.raw).toBe('# 別の本文');
  });

  it('reseeds when the stored data is gone even though the hash matches', async () => {
    await seedStarters(dataStore, textStore, { packs: PACKS });
    // ディスクを作り直した直後を模す。マニフェストだけ残り実体が無い状態で飛ばすと、
    // スターター一覧が壊れたまま復旧しなくなる。
    await dataStore.delete(worldMetaKey(OFFICIAL_USER_ID, 'test-pack'));

    const { store, counts } = countingStore(dataStore);
    await seedStarters(store, textStore, { packs: PACKS });

    expect(counts.set).toBeGreaterThan(0);
    expect(await dataStore.get(worldMetaKey(OFFICIAL_USER_ID, 'test-pack'))).not.toBeNull();
  });

  it('reseeds unconditionally when force is set', async () => {
    await seedStarters(dataStore, textStore, { packs: PACKS });

    const { store, counts } = countingStore(dataStore);
    await seedStarters(store, textStore, { packs: PACKS, force: true });

    expect(counts.set).toBeGreaterThan(0);
  });
});
