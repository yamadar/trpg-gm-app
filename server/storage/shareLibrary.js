import crypto from 'node:crypto';
import {
  publicListPrefix, publicMetaKey, publicWorldDocsPrefix, publicWorldDocPath, publicRegionDocPath, publicCategoryDocPath,
  publicCharacterDocsPrefix, publicCharacterDocPath, publicScenarioDocsPrefix, publicScenarioDocPath,
  publicNovelDocsPrefix, publicNovelDocPath,
  publishWorldMapKey, publishWorldListPrefix, publishCharacterMapKey, publishCharacterListPrefix,
  publishScenarioMapKey, publishScenarioListPrefix, publishNovelMapKey, publishNovelListPrefix,
  sessionKey, sessionNovelDocPath, worldMetaKey,
} from './paths.js';
import { getWorld } from './worldLibrary.js';
import { getCharacter } from './characterLibrary.js';
import { getScenario } from './scenarioLibrary.js';
import { listRegions, getRegion, listCategories, getCategory } from './worldContentLibrary.js';
import { MOODS } from './moods.js';
import { stripImageMarkers } from '../novelMarkers.js';

function newPublicId() {
  return `pub_${crypto.randomBytes(6).toString('hex')}`;
}

// mappingがあれば同じpublicIdへ上書き(再公開)、なければ採番
async function resolvePublicId(dataStore, mapKey) {
  const map = await dataStore.get(mapKey);
  return map?.publicId ?? newPublicId();
}

// publishedAtは初回公開時刻を維持する
async function buildMeta(dataStore, type, publicId, owner, fields) {
  const existing = await dataStore.get(publicMetaKey(type, publicId));
  const now = Date.now();
  return {
    publicId,
    ownerId: owner.id,
    ownerName: owner.displayName,
    publishedAt: existing?.publishedAt ?? now,
    updatedAt: now,
    ...fields,
  };
}

async function finishPublish(dataStore, type, mapKey, meta) {
  await dataStore.set(publicMetaKey(type, meta.publicId), meta);
  await dataStore.set(mapKey, { publicId: meta.publicId });
  return { ok: true, meta };
}

export async function publishWorld(dataStore, textStore, userId, worldId, owner) {
  const world = await getWorld(dataStore, textStore, userId, worldId);
  if (!world) return { ok: false, reason: 'not_found' };
  const mapKey = publishWorldMapKey(userId, worldId);
  const publicId = await resolvePublicId(dataStore, mapKey);
  const regions = await listRegions(textStore, userId, worldId);
  const categories = await listCategories(textStore, userId, worldId);
  // 再公開で消えたregion/categoryの残骸を残さないため、ドキュメント一式を作り直す
  await textStore.deleteDir(publicWorldDocsPrefix(publicId));
  await textStore.write(publicWorldDocPath(publicId), world.raw);
  for (const region of regions) {
    await textStore.write(publicRegionDocPath(publicId, region), (await getRegion(textStore, userId, worldId, region)) ?? '');
  }
  for (const category of categories) {
    await textStore.write(publicCategoryDocPath(publicId, category), (await getCategory(textStore, userId, worldId, category)) ?? '');
  }
  const meta = await buildMeta(dataStore, 'worlds', publicId, owner, {
    title: world.title,
    regions,
    categories,
    moods: world.moods ?? [],
  });
  return finishPublish(dataStore, 'worlds', mapKey, meta);
}

export async function publishCharacter(dataStore, textStore, userId, worldId, kind, name, owner) {
  const character = await getCharacter(dataStore, textStore, userId, worldId, kind, name);
  if (!character) return { ok: false, reason: 'not_found' };
  const mapKey = publishCharacterMapKey(userId, worldId, kind, name);
  const publicId = await resolvePublicId(dataStore, mapKey);
  await textStore.write(publicCharacterDocPath(publicId), character.raw);
  const worldMeta = await dataStore.get(worldMetaKey(userId, worldId));
  const meta = await buildMeta(dataStore, 'characters', publicId, owner, {
    title: name,
    kind,
    name,
    worldId,
    worldTitle: worldMeta?.title ?? null,
  });
  return finishPublish(dataStore, 'characters', mapKey, meta);
}

export async function publishScenario(dataStore, textStore, userId, worldId, scenarioId, owner) {
  const scenario = await getScenario(dataStore, textStore, userId, worldId, scenarioId);
  if (!scenario) return { ok: false, reason: 'not_found' };
  const mapKey = publishScenarioMapKey(userId, worldId, scenarioId);
  const publicId = await resolvePublicId(dataStore, mapKey);
  await textStore.write(publicScenarioDocPath(publicId), scenario.raw);
  const worldMeta = await dataStore.get(worldMetaKey(userId, worldId));
  const meta = await buildMeta(dataStore, 'scenarios', publicId, owner, {
    title: scenario.title,
    recommendedRuleset: scenario.recommendedRuleset ?? null,
    moods: scenario.moods ?? [],
    worldId,
    worldTitle: worldMeta?.title ?? null,
  });
  return finishPublish(dataStore, 'scenarios', mapKey, meta);
}

export async function publishNovel(dataStore, textStore, userId, sessionId, owner) {
  const session = await dataStore.get(sessionKey(userId, sessionId));
  if (!session) return { ok: false, reason: 'not_found' };
  const text = await textStore.read(sessionNovelDocPath(userId, sessionId));
  if (text === null) return { ok: false, reason: 'novel_not_generated' };
  const mapKey = publishNovelMapKey(userId, sessionId);
  const publicId = await resolvePublicId(dataStore, mapKey);
  // 挿絵マーカー(〈挿絵N〉)は公開ギャラリーへ漏らさない
  await textStore.write(publicNovelDocPath(publicId), stripImageMarkers(text));
  const meta = await buildMeta(dataStore, 'novels', publicId, owner, { title: session.title ?? 'セッション' });
  return finishPublish(dataStore, 'novels', mapKey, meta);
}

async function unpublishByMap(dataStore, textStore, type, mapKey, docsPrefixFn) {
  const map = await dataStore.get(mapKey);
  if (!map) return;
  await textStore.deleteDir(docsPrefixFn(map.publicId));
  await dataStore.delete(publicMetaKey(type, map.publicId));
  await dataStore.delete(mapKey);
}

export async function unpublishWorld(dataStore, textStore, userId, worldId) {
  await unpublishByMap(dataStore, textStore, 'worlds', publishWorldMapKey(userId, worldId), publicWorldDocsPrefix);
}

export async function unpublishCharacter(dataStore, textStore, userId, worldId, kind, name) {
  await unpublishByMap(dataStore, textStore, 'characters', publishCharacterMapKey(userId, worldId, kind, name), publicCharacterDocsPrefix);
}

export async function unpublishScenario(dataStore, textStore, userId, worldId, scenarioId) {
  await unpublishByMap(dataStore, textStore, 'scenarios', publishScenarioMapKey(userId, worldId, scenarioId), publicScenarioDocsPrefix);
}

export async function unpublishNovel(dataStore, textStore, userId, sessionId) {
  await unpublishByMap(dataStore, textStore, 'novels', publishNovelMapKey(userId, sessionId), publicNovelDocsPrefix);
}

// deleteWorld用: 配下の公開キャラ/シナリオ→世界本体の順に解除
export async function unpublishWorldCascade(dataStore, textStore, userId, worldId) {
  for (const kind of ['pc', 'npc']) {
    for (const key of await dataStore.list(publishCharacterListPrefix(userId, worldId, kind))) {
      await unpublishCharacter(dataStore, textStore, userId, worldId, kind, key.split('/').pop());
    }
  }
  for (const key of await dataStore.list(publishScenarioListPrefix(userId, worldId))) {
    await unpublishScenario(dataStore, textStore, userId, worldId, key.split('/').pop());
  }
  await unpublishWorld(dataStore, textStore, userId, worldId);
}

export async function listPublic(dataStore, type) {
  const keys = await dataStore.list(publicListPrefix(type));
  const metas = (await Promise.all(keys.map((k) => dataStore.get(k)))).filter(Boolean);
  return metas.sort((a, b) => b.publishedAt - a.publishedAt);
}

export async function queryPublic(dataStore, type, { q, moods, ruleset, ownerId, limit, offset } = {}) {
  const all = await listPublic(dataStore, type);
  const norm = (s) => String(s ?? '').toLowerCase();
  const query = norm(q).trim();
  const moodSet = new Set((moods ?? []).filter((m) => MOODS.includes(m)));

  const filtered = all.filter((meta) => {
    if (ownerId && meta.ownerId !== ownerId) return false;
    if (ruleset && meta.recommendedRuleset !== ruleset) return false;
    if (moodSet.size > 0 && !(meta.moods ?? []).some((m) => moodSet.has(m))) return false;
    if (query) {
      const haystack = [meta.title, meta.ownerName, meta.worldTitle].map(norm).join('\n');
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const lim = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 20;
  const off = Number.isFinite(Number(offset)) && Number(offset) > 0 ? Number(offset) : 0;
  const items = filtered.slice(off, off + lim);
  return { items, total: filtered.length, hasMore: off + items.length < filtered.length };
}

export async function getPublicWorld(dataStore, textStore, publicId) {
  const meta = await dataStore.get(publicMetaKey('worlds', publicId));
  if (!meta) return null;
  const raw = (await textStore.read(publicWorldDocPath(publicId))) ?? '';
  const regions = await Promise.all(
    (meta.regions ?? []).map(async (name) => ({ name, raw: (await textStore.read(publicRegionDocPath(publicId, name))) ?? '' }))
  );
  const categories = await Promise.all(
    (meta.categories ?? []).map(async (name) => ({ name, raw: (await textStore.read(publicCategoryDocPath(publicId, name))) ?? '' }))
  );
  return { ...meta, raw, regions, categories };
}

const ITEM_DOC_PATH = {
  characters: publicCharacterDocPath,
  scenarios: publicScenarioDocPath,
  novels: publicNovelDocPath,
};

export async function getPublicItem(dataStore, textStore, type, publicId) {
  const meta = await dataStore.get(publicMetaKey(type, publicId));
  if (!meta) return null;
  const raw = (await textStore.read(ITEM_DOC_PATH[type](publicId))) ?? '';
  return { ...meta, raw };
}

async function mapFromPrefix(dataStore, prefix) {
  const out = {};
  for (const key of await dataStore.list(prefix)) {
    const map = await dataStore.get(key);
    if (map?.publicId) out[key.split('/').pop()] = map.publicId;
  }
  return out;
}

export async function getPublishedWorlds(dataStore, userId) {
  return mapFromPrefix(dataStore, publishWorldListPrefix(userId));
}

export async function getPublishedCharacters(dataStore, userId, worldId, kind) {
  return mapFromPrefix(dataStore, publishCharacterListPrefix(userId, worldId, kind));
}

export async function getPublishedScenarios(dataStore, userId, worldId) {
  return mapFromPrefix(dataStore, publishScenarioListPrefix(userId, worldId));
}

export async function getPublishedNovels(dataStore, userId) {
  return mapFromPrefix(dataStore, publishNovelListPrefix(userId));
}
