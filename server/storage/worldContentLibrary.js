import { worldSourceDocPath, regionDocPath, categoryDocPath } from './paths.js';

function slugFromPath(p) {
  return p.split('/').pop().replace(/\.md$/, '');
}

export async function saveWorldSource(textStore, userId, worldId, raw) {
  await textStore.write(worldSourceDocPath(userId, worldId), raw);
}

export async function getWorldSource(textStore, userId, worldId) {
  return await textStore.read(worldSourceDocPath(userId, worldId));
}

export async function saveRegion(textStore, userId, worldId, region, raw) {
  await textStore.write(regionDocPath(userId, worldId, region), raw);
}

export async function getRegion(textStore, userId, worldId, region) {
  return await textStore.read(regionDocPath(userId, worldId, region));
}

export async function listRegions(textStore, userId, worldId) {
  const paths = await textStore.list(`users/${userId}/worlds/${worldId}/regions`);
  return paths.map(slugFromPath);
}

export async function deleteRegion(textStore, userId, worldId, region) {
  await textStore.delete(regionDocPath(userId, worldId, region));
}

export async function saveCategory(textStore, userId, worldId, category, raw) {
  await textStore.write(categoryDocPath(userId, worldId, category), raw);
}

export async function getCategory(textStore, userId, worldId, category) {
  return await textStore.read(categoryDocPath(userId, worldId, category));
}

export async function listCategories(textStore, userId, worldId) {
  const paths = await textStore.list(`users/${userId}/worlds/${worldId}/categories`);
  return paths.map(slugFromPath);
}

export async function deleteCategory(textStore, userId, worldId, category) {
  await textStore.delete(categoryDocPath(userId, worldId, category));
}
