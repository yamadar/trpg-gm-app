import {
  worldSourceDocPath,
  regionDocPath,
  regionMetaKey,
  categoryDocPath,
  categoryMetaKey,
} from './paths.js';

function slugFromPath(p) {
  return p.split('/').pop().replace(/\.md$/, '');
}

export function titleFromMarkdown(raw, fallback) {
  const normalized = String(raw ?? '').replace(/\\n/g, '\n');
  const heading = normalized.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1];
  const firstText = normalized
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#{1,6}|[-*+]|\d+\.)\s*/, '').trim())
    .find(Boolean);
  const title = heading || firstText || fallback;
  return title
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
    .slice(0, 100);
}

export async function saveWorldSource(textStore, userId, worldId, raw) {
  await textStore.write(worldSourceDocPath(userId, worldId), raw);
}

export async function getWorldSource(textStore, userId, worldId) {
  return await textStore.read(worldSourceDocPath(userId, worldId));
}

export async function saveRegion(dataStore, textStore, userId, worldId, region, { title, raw }) {
  await textStore.write(regionDocPath(userId, worldId, region), raw);
  const meta = { id: region, title: title?.trim() || titleFromMarkdown(raw, '名称未設定の地域') };
  await dataStore.set(regionMetaKey(userId, worldId, region), meta);
  return { ...meta, raw };
}

export async function getRegion(dataStore, textStore, userId, worldId, region) {
  const raw = await textStore.read(regionDocPath(userId, worldId, region));
  if (raw === null) return null;
  const meta = await dataStore.get(regionMetaKey(userId, worldId, region));
  return { id: region, title: meta?.title || titleFromMarkdown(raw, '名称未設定の地域'), raw };
}

export async function listRegions(dataStore, textStore, userId, worldId) {
  const paths = await textStore.list(`users/${userId}/worlds/${worldId}/regions`);
  return Promise.all(
    paths
      .filter((p) => p.endsWith('.md'))
      .map(async (p) => {
        const id = slugFromPath(p);
        const meta = await dataStore.get(regionMetaKey(userId, worldId, id));
        if (meta?.title) return { id, title: meta.title };
        const raw = await textStore.read(regionDocPath(userId, worldId, id));
        return { id, title: titleFromMarkdown(raw, '名称未設定の地域') };
      })
  );
}

export async function deleteRegion(dataStore, textStore, userId, worldId, region) {
  await textStore.delete(regionDocPath(userId, worldId, region));
  await dataStore.delete(regionMetaKey(userId, worldId, region));
}

export async function saveCategory(dataStore, textStore, userId, worldId, category, { title, raw }) {
  await textStore.write(categoryDocPath(userId, worldId, category), raw);
  const meta = { id: category, title: title?.trim() || titleFromMarkdown(raw, '名称未設定のカテゴリ') };
  await dataStore.set(categoryMetaKey(userId, worldId, category), meta);
  return { ...meta, raw };
}

export async function getCategory(dataStore, textStore, userId, worldId, category) {
  const raw = await textStore.read(categoryDocPath(userId, worldId, category));
  if (raw === null) return null;
  const meta = await dataStore.get(categoryMetaKey(userId, worldId, category));
  return { id: category, title: meta?.title || titleFromMarkdown(raw, '名称未設定のカテゴリ'), raw };
}

export async function listCategories(dataStore, textStore, userId, worldId) {
  const paths = await textStore.list(`users/${userId}/worlds/${worldId}/categories`);
  return Promise.all(
    paths
      .filter((p) => p.endsWith('.md'))
      .map(async (p) => {
        const id = slugFromPath(p);
        const meta = await dataStore.get(categoryMetaKey(userId, worldId, id));
        if (meta?.title) return { id, title: meta.title };
        const raw = await textStore.read(categoryDocPath(userId, worldId, id));
        return { id, title: titleFromMarkdown(raw, '名称未設定のカテゴリ') };
      })
  );
}

export async function deleteCategory(dataStore, textStore, userId, worldId, category) {
  await textStore.delete(categoryDocPath(userId, worldId, category));
  await dataStore.delete(categoryMetaKey(userId, worldId, category));
}
