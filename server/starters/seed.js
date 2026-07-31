import { loadStarterPacks } from './loadPacks.js';
import { saveWorld } from '../storage/worldLibrary.js';
import { saveScenario } from '../storage/scenarioLibrary.js';
import { saveCharacter } from '../storage/characterLibrary.js';
import { publishWorld, publishScenario, publishCharacter } from '../storage/shareLibrary.js';
import { starterManifestKey } from '../storage/paths.js';
import { userProfileKey } from '../auth/users.js';

export const OFFICIAL_USER_ID = 'usr_official';
export const OFFICIAL_DISPLAY_NAME = '公式サンプル';

// auth/identities/* を作らないので、このアカウントには誰もログインできない。
// 公開ギャラリーの作者リンク(GET /api/users/:userId)からは通常どおり参照できる。
async function ensureOfficialUser(dataStore) {
  const existing = await dataStore.get(userProfileKey(OFFICIAL_USER_ID));
  if (existing) return existing;
  const now = Date.now();
  const user = {
    id: OFFICIAL_USER_ID,
    displayName: OFFICIAL_DISPLAY_NAME,
    avatarUrl: null,
    bio: 'はじめて遊ぶ人向けの世界観・シナリオ・キャラクターを配布しているアカウント。',
    createdAt: now,
    updatedAt: now,
  };
  await dataStore.set(userProfileKey(OFFICIAL_USER_ID), user);
  return user;
}

function publicIdOf(result, what) {
  if (!result.ok) throw new Error(`starter seed failed to publish ${what}: ${result.reason}`);
  return result.meta.publicId;
}

async function seedPack(dataStore, textStore, owner, pack, imageStore) {
  await saveWorld(dataStore, textStore, OFFICIAL_USER_ID, {
    id: pack.id,
    title: pack.title,
    raw: pack.worldRaw,
    moods: pack.moods,
  });
  await saveScenario(dataStore, textStore, OFFICIAL_USER_ID, {
    worldId: pack.id,
    id: pack.scenario.id,
    title: pack.scenario.title,
    raw: pack.scenario.raw,
    recommendedRuleset: pack.recommendedRuleset,
    moods: pack.moods,
  });
  for (const kind of ['pc', 'npc']) {
    for (const c of pack[kind]) {
      await saveCharacter(dataStore, textStore, OFFICIAL_USER_ID, {
        worldId: pack.id,
        kind,
        name: c.name,
        raw: c.raw,
        revealed: false,
      });
    }
  }

  const worldPublicId = publicIdOf(
    await publishWorld(dataStore, textStore, OFFICIAL_USER_ID, pack.id, owner, imageStore),
    `world ${pack.id}`,
  );
  const scenarioPublicId = publicIdOf(
    await publishScenario(dataStore, textStore, OFFICIAL_USER_ID, pack.id, pack.scenario.id, owner, imageStore),
    `scenario ${pack.scenario.id}`
  );
  const characterIds = {};
  for (const kind of ['pc', 'npc']) {
    characterIds[kind] = [];
    for (const c of pack[kind]) {
      characterIds[kind].push(
        publicIdOf(
          await publishCharacter(dataStore, textStore, OFFICIAL_USER_ID, pack.id, kind, c.name, owner, imageStore),
          `${kind} ${c.name}`,
        )
      );
    }
  }

  return {
    packId: pack.id,
    title: pack.title,
    tagline: pack.tagline,
    source: pack.source,
    moods: pack.moods,
    recommendedRuleset: pack.recommendedRuleset,
    scenarioTitle: pack.scenario.title,
    // インポート時にimportScenarioへpreferredIdとして渡す。無いとslugify(title)頼りになり
    // 日本語タイトルは'untitled'に潰れる(importWorldがpack.idを使うのと同じ理由)
    scenarioId: pack.scenario.id,
    worldPublicId,
    scenarioPublicId,
    pcPublicIds: characterIds.pc,
    npcPublicIds: characterIds.npc,
  };
}

export async function seedStarters(dataStore, textStore, { packs, imageStore } = {}) {
  const loaded = packs ?? (await loadStarterPacks());
  const owner = await ensureOfficialUser(dataStore);
  const entries = [];
  for (const pack of loaded) entries.push(await seedPack(dataStore, textStore, owner, pack, imageStore));
  const manifest = { packs: entries, seededAt: Date.now() };
  await dataStore.set(starterManifestKey(), manifest);
  return manifest;
}
