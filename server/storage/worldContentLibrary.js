import { worldSourceDocPath, regionDocPath, categoryDocPath } from './paths.js';

function slugFromPath(p) {
  return p.split('/').pop().replace(/\.md$/, '');
}

export async function saveWorldSource(textStore, worldId, raw) {
  await textStore.write(worldSourceDocPath(worldId), raw);
}

export async function getWorldSource(textStore, worldId) {
  return await textStore.read(worldSourceDocPath(worldId));
}

export async function saveRegion(textStore, worldId, region, raw) {
  await textStore.write(regionDocPath(worldId, region), raw);
}

export async function getRegion(textStore, worldId, region) {
  return await textStore.read(regionDocPath(worldId, region));
}

export async function listRegions(textStore, worldId) {
  const paths = await textStore.list(`worlds/${worldId}/regions`);
  return paths.map(slugFromPath);
}

export async function deleteRegion(textStore, worldId, region) {
  await textStore.delete(regionDocPath(worldId, region));
}

export async function saveCategory(textStore, worldId, category, raw) {
  await textStore.write(categoryDocPath(worldId, category), raw);
}

export async function getCategory(textStore, worldId, category) {
  return await textStore.read(categoryDocPath(worldId, category));
}

export async function listCategories(textStore, worldId) {
  const paths = await textStore.list(`worlds/${worldId}/categories`);
  return paths.map(slugFromPath);
}

export async function deleteCategory(textStore, worldId, category) {
  await textStore.delete(categoryDocPath(worldId, category));
}
