import crypto from 'node:crypto';
import {
  publicListPrefix, publicMetaKey, publicWorldDocsPrefix, publicWorldDocPath, publicRegionDocPath, publicCategoryDocPath,
  publicCharacterDocsPrefix, publicCharacterDocPath, publicScenarioDocsPrefix, publicScenarioDocPath,
  publicNovelDocsPrefix, publicNovelDocPath, publicNovelImageDir, publicNovelImagePath,
  publicAttachmentDir,
  publishWorldMapKey, publishWorldListPrefix, publishCharacterMapKey, publishCharacterListPrefix,
  publishScenarioMapKey, publishScenarioListPrefix, publishNovelMapKey, publishNovelListPrefix,
  characterAttachmentDir, novelAttachmentDir, scenarioAttachmentDir, sessionKey, sessionNovelDocPath,
  sessionNovelMetaKey, sessionImagePath, worldAttachmentDir, worldMetaKey,
} from './paths.js';
import { getWorld } from './worldLibrary.js';
import { getCharacter } from './characterLibrary.js';
import { getScenario } from './scenarioLibrary.js';
import {
  listRegions,
  getRegion,
  listCategories,
  getCategory,
  titleFromMarkdown,
} from './worldContentLibrary.js';
import { MOODS } from './moods.js';
import { characterTitle, unnamedCharacterTitle } from './characterSummary.js';
import { getUser } from '../auth/users.js';
import {
  copyAttachmentCollection,
  deleteAttachmentCollection,
  getAttachmentCollection,
  topAttachmentOf,
} from './attachmentLibrary.js';

const IMAGE_ID_RE = /^img_[A-Za-z0-9-]+$/;

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

async function snapshotAttachments(dataStore, imageStore, sourceDir, type, publicId) {
  const collection = await getAttachmentCollection(dataStore, sourceDir);
  if (imageStore) {
    await copyAttachmentCollection({
      dataStore,
      imageStore,
      sourceDir,
      targetDir: publicAttachmentDir(type, publicId),
      sourceCollection: collection,
    });
  } else if (collection.items.length > 0) {
    throw new Error('imageStore is required to publish attachments');
  }
  return collection;
}

function attachmentFields(collection) {
  return {
    attachments: collection.items.map((item) => ({ ...item })),
    topImageId: collection.topImageId,
  };
}

export async function publishWorld(dataStore, textStore, userId, worldId, owner, imageStore) {
  const world = await getWorld(dataStore, textStore, userId, worldId);
  if (!world) return { ok: false, reason: 'not_found' };
  const mapKey = publishWorldMapKey(userId, worldId);
  const publicId = await resolvePublicId(dataStore, mapKey);
  const regions = await listRegions(dataStore, textStore, userId, worldId);
  const categories = await listCategories(dataStore, textStore, userId, worldId);
  // 再公開で消えたregion/categoryの残骸を残さないため、ドキュメント一式を作り直す
  await textStore.deleteDir(publicWorldDocsPrefix(publicId));
  await textStore.write(publicWorldDocPath(publicId), world.raw);
  for (const region of regions) {
    const content = await getRegion(dataStore, textStore, userId, worldId, region.id);
    await textStore.write(publicRegionDocPath(publicId, region.id), content?.raw ?? '');
  }
  for (const category of categories) {
    const content = await getCategory(dataStore, textStore, userId, worldId, category.id);
    await textStore.write(publicCategoryDocPath(publicId, category.id), content?.raw ?? '');
  }
  const attachments = await snapshotAttachments(
    dataStore,
    imageStore,
    worldAttachmentDir(userId, worldId),
    'worlds',
    publicId,
  );
  const meta = await buildMeta(dataStore, 'worlds', publicId, owner, {
    title: world.title,
    regions,
    categories,
    moods: world.moods ?? [],
    ...attachmentFields(attachments),
  });
  return finishPublish(dataStore, 'worlds', mapKey, meta);
}

export async function publishCharacter(dataStore, textStore, userId, worldId, kind, name, owner, imageStore) {
  const character = await getCharacter(dataStore, textStore, userId, worldId, kind, name);
  if (!character) return { ok: false, reason: 'not_found' };
  const mapKey = publishCharacterMapKey(userId, worldId, kind, name);
  const publicId = await resolvePublicId(dataStore, mapKey);
  await textStore.write(publicCharacterDocPath(publicId), character.raw);
  const attachments = await snapshotAttachments(
    dataStore,
    imageStore,
    characterAttachmentDir(userId, worldId, kind, name),
    'characters',
    publicId,
  );
  const worldMeta = await dataStore.get(worldMetaKey(userId, worldId));
  const meta = await buildMeta(dataStore, 'characters', publicId, owner, {
    title: characterTitle(character),
    kind,
    name,
    characterName: character.characterName ?? null,
    worldId,
    worldTitle: worldMeta?.title ?? null,
    ...attachmentFields(attachments),
  });
  return finishPublish(dataStore, 'characters', mapKey, meta);
}

export async function publishScenario(dataStore, textStore, userId, worldId, scenarioId, owner, imageStore) {
  const scenario = await getScenario(dataStore, textStore, userId, worldId, scenarioId);
  if (!scenario) return { ok: false, reason: 'not_found' };
  const mapKey = publishScenarioMapKey(userId, worldId, scenarioId);
  const publicId = await resolvePublicId(dataStore, mapKey);
  await textStore.write(publicScenarioDocPath(publicId), scenario.raw);
  const attachments = await snapshotAttachments(
    dataStore,
    imageStore,
    scenarioAttachmentDir(userId, worldId, scenarioId),
    'scenarios',
    publicId,
  );
  const worldMeta = await dataStore.get(worldMetaKey(userId, worldId));
  const meta = await buildMeta(dataStore, 'scenarios', publicId, owner, {
    title: scenario.title,
    recommendedRuleset: scenario.recommendedRuleset ?? null,
    moods: scenario.moods ?? [],
    directorGuide: scenario.directorGuide ?? null,
    worldId,
    worldTitle: worldMeta?.title ?? null,
    ...attachmentFields(attachments),
  });
  return finishPublish(dataStore, 'scenarios', mapKey, meta);
}

export async function publishNovel(dataStore, textStore, userId, sessionId, owner, imageStore) {
  const session = await dataStore.get(sessionKey(userId, sessionId));
  if (!session) return { ok: false, reason: 'not_found' };
  const text = await textStore.read(sessionNovelDocPath(userId, sessionId));
  if (text === null) return { ok: false, reason: 'novel_not_generated' };
  const mapKey = publishNovelMapKey(userId, sessionId);
  const publicId = await resolvePublicId(dataStore, mapKey);
  const novelMeta = await dataStore.get(sessionNovelMetaKey(userId, sessionId));
  const sourceImageIds = Array.isArray(novelMeta?.imageIds) ? novelMeta.imageIds : [];
  const imageIds = [];
  const attachments = await snapshotAttachments(
    dataStore,
    imageStore,
    novelAttachmentDir(userId, sessionId),
    'novels',
    publicId,
  );

  // 公開物をセッションから独立したスナップショットにする。再公開時に消えた画像も
  // 残さない。欠損画像はnullで位置を保ち、〈挿絵N〉と別画像がずれないようにする。
  if (imageStore) {
    await imageStore.deleteDir(publicNovelImageDir(publicId));
    for (const imageId of sourceImageIds) {
      if (typeof imageId !== 'string' || !IMAGE_ID_RE.test(imageId)) {
        imageIds.push(null);
        continue;
      }
      const image = await imageStore.read(sessionImagePath(userId, sessionId, imageId));
      if (!image) {
        imageIds.push(null);
        continue;
      }
      await imageStore.write(publicNovelImagePath(publicId, imageId), image);
      imageIds.push(imageId);
    }
  }

  // マーカーを保持し、公開画面が対応位置へスナップショット画像を差し込めるようにする。
  await textStore.write(publicNovelDocPath(publicId), text);
  const meta = await buildMeta(dataStore, 'novels', publicId, owner, {
    title: session.title ?? 'セッション',
    imageIds,
    ...attachmentFields(attachments),
  });
  return finishPublish(dataStore, 'novels', mapKey, meta);
}

async function unpublishByMap(dataStore, textStore, type, mapKey, docsPrefixFn, binaryStore) {
  const map = await dataStore.get(mapKey);
  if (!map) return;
  await textStore.deleteDir(docsPrefixFn(map.publicId));
  await deleteAttachmentCollection(
    dataStore,
    binaryStore,
    publicAttachmentDir(type, map.publicId),
  );
  if (binaryStore) await binaryStore.deleteDir(docsPrefixFn(map.publicId));
  await dataStore.delete(publicMetaKey(type, map.publicId));
  await dataStore.delete(mapKey);
}

export async function unpublishWorld(dataStore, textStore, userId, worldId, imageStore) {
  await unpublishByMap(
    dataStore,
    textStore,
    'worlds',
    publishWorldMapKey(userId, worldId),
    publicWorldDocsPrefix,
    imageStore,
  );
}

export async function unpublishCharacter(dataStore, textStore, userId, worldId, kind, name, imageStore) {
  await unpublishByMap(
    dataStore,
    textStore,
    'characters',
    publishCharacterMapKey(userId, worldId, kind, name),
    publicCharacterDocsPrefix,
    imageStore,
  );
}

export async function unpublishScenario(dataStore, textStore, userId, worldId, scenarioId, imageStore) {
  await unpublishByMap(
    dataStore,
    textStore,
    'scenarios',
    publishScenarioMapKey(userId, worldId, scenarioId),
    publicScenarioDocsPrefix,
    imageStore,
  );
}

export async function unpublishNovel(dataStore, textStore, userId, sessionId, imageStore) {
  await unpublishByMap(
    dataStore,
    textStore,
    'novels',
    publishNovelMapKey(userId, sessionId),
    publicNovelDocsPrefix,
    imageStore
  );
}

// deleteWorld用: 配下の公開キャラ/シナリオ→世界本体の順に解除
export async function unpublishWorldCascade(dataStore, textStore, userId, worldId, imageStore) {
  for (const kind of ['pc', 'npc']) {
    for (const key of await dataStore.list(publishCharacterListPrefix(userId, worldId, kind))) {
      await unpublishCharacter(dataStore, textStore, userId, worldId, kind, key.split('/').pop(), imageStore);
    }
  }
  for (const key of await dataStore.list(publishScenarioListPrefix(userId, worldId))) {
    await unpublishScenario(dataStore, textStore, userId, worldId, key.split('/').pop(), imageStore);
  }
  await unpublishWorld(dataStore, textStore, userId, worldId, imageStore);
}

export async function listPublic(dataStore, type) {
  const keys = await dataStore.list(publicListPrefix(type));
  const metas = (await Promise.all(keys.map((k) => dataStore.get(k)))).filter(Boolean);
  const ownerIds = [...new Set(metas.map((meta) => meta.ownerId).filter(Boolean))];
  const owners = new Map(
    await Promise.all(ownerIds.map(async (ownerId) => [ownerId, await getUser(dataStore, ownerId)]))
  );
  const withCurrentOwnerNames = metas.map((meta) => withOwnerName(meta, owners.get(meta.ownerId)));
  return withCurrentOwnerNames.sort((a, b) => b.publishedAt - a.publishedAt);
}

async function withCurrentOwnerName(dataStore, meta) {
  const owner = await getUser(dataStore, meta.ownerId);
  return withOwnerName(meta, owner);
}

function withOwnerName(meta, owner) {
  return owner?.displayName && owner.displayName !== meta.ownerName
    ? { ...meta, ownerName: owner.displayName }
    : meta;
}

async function withCharacterDisplayName(textStore, meta) {
  if (!textStore) return meta;
  const raw = (await textStore.read(publicCharacterDocPath(meta.publicId))) ?? '';
  const title = characterTitle({
    characterName: meta.characterName,
    parsed: meta.parsed,
    raw,
    kind: meta.kind,
  });
  if (title !== unnamedCharacterTitle(meta.kind)) return { ...meta, title };
  // 新しい公開データはAI抽出済みの表示名をtitleへ保存する。旧データでもtitleが
  // 内部nameと異なるなら、その表示名を維持する。
  if (meta.title && meta.title !== meta.name) return meta;
  return { ...meta, title };
}

export async function queryPublic(dataStore, type, { q, moods, ruleset, ownerId, limit, offset } = {}, textStore) {
  const listed = await listPublic(dataStore, type);
  // 旧公開データはtitleへ内部識別子を保存している。本文から表示名を補完し、
  // 再公開されていない既存カードもPC/NPC名で表示・検索できるようにする。
  const all =
    type === 'characters'
      ? await Promise.all(listed.map((meta) => withCharacterDisplayName(textStore, meta)))
      : listed;
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
  const items = filtered.slice(off, off + lim).map((meta) => {
    const { attachments = [], topImageId = null, ...listMeta } = meta;
    const topImage = topAttachmentOf({ items: attachments, topImageId });
    if (type !== 'scenarios') return { ...listMeta, ...(topImage ? { topImage } : {}) };
    // 進行ガイドは公開一覧・検索には不要。詳細取得とインポート時だけ返す。
    const { directorGuide: _directorGuide, ...listedMeta } = listMeta;
    return { ...listedMeta, ...(topImage ? { topImage } : {}) };
  });
  return { items, total: filtered.length, hasMore: off + items.length < filtered.length };
}

export async function getPublicWorld(dataStore, textStore, publicId) {
  const storedMeta = await dataStore.get(publicMetaKey('worlds', publicId));
  if (!storedMeta) return null;
  const meta = await withCurrentOwnerName(dataStore, storedMeta);
  const raw = (await textStore.read(publicWorldDocPath(publicId))) ?? '';
  const regions = await Promise.all(
    (meta.regions ?? []).map(async (entry) => {
      const id = typeof entry === 'string' ? entry : entry.id;
      const raw = (await textStore.read(publicRegionDocPath(publicId, id))) ?? '';
      return {
        name: id,
        title:
          typeof entry === 'string'
            ? titleFromMarkdown(raw, '名称未設定の地域')
            : entry.title || titleFromMarkdown(raw, '名称未設定の地域'),
        raw,
      };
    })
  );
  const categories = await Promise.all(
    (meta.categories ?? []).map(async (entry) => {
      const id = typeof entry === 'string' ? entry : entry.id;
      const raw = (await textStore.read(publicCategoryDocPath(publicId, id))) ?? '';
      return {
        name: id,
        title:
          typeof entry === 'string'
            ? titleFromMarkdown(raw, '名称未設定のカテゴリ')
            : entry.title || titleFromMarkdown(raw, '名称未設定のカテゴリ'),
        raw,
      };
    })
  );
  return { ...meta, raw, regions, categories };
}

const ITEM_DOC_PATH = {
  characters: publicCharacterDocPath,
  scenarios: publicScenarioDocPath,
  novels: publicNovelDocPath,
};

export async function getPublicItem(dataStore, textStore, type, publicId) {
  const storedMeta = await dataStore.get(publicMetaKey(type, publicId));
  if (!storedMeta) return null;
  const meta = await withCurrentOwnerName(dataStore, storedMeta);
  const raw = (await textStore.read(ITEM_DOC_PATH[type](publicId))) ?? '';
  if (type === 'characters') {
    const extractedTitle = characterTitle({
      characterName: meta.characterName,
      parsed: meta.parsed,
      raw,
      kind: meta.kind,
    });
    const title =
      extractedTitle !== unnamedCharacterTitle(meta.kind)
        ? extractedTitle
        : meta.title && meta.title !== meta.name
          ? meta.title
          : extractedTitle;
    return { ...meta, title, raw };
  }
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
