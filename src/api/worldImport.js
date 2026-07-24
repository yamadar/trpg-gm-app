import { splitWorld } from './worldSplit.js';
import {
  putWorld,
  putWorldSource,
  getWorldSource,
  putRegion,
  putCategory,
  listRegions,
  listCategories,
  deleteRegion,
  deleteCategory,
} from './worldLibraryClient.js';

async function saveSplitResult(worldId, title, split, moods) {
  await putWorld(worldId, { title, raw: split.world, ...(moods !== undefined ? { moods } : {}) });
  await Promise.all(split.regions.map((r) => putRegion(worldId, r.id, r.content)));
  await Promise.all(split.categories.map((c) => putCategory(worldId, c.id, c.content)));
}

export async function importWorld(worldId, title, rawText) {
  const split = await splitWorld(rawText);
  await putWorldSource(worldId, rawText);
  await saveSplitResult(worldId, title, split);
  return split;
}

export async function reimportWorld(worldId, title, adjustmentRequest, moods) {
  const source = await getWorldSource(worldId);
  const split = await splitWorld(source.raw, adjustmentRequest);

  const newRegionIds = new Set(split.regions.map((r) => r.id));
  const newCategoryIds = new Set(split.categories.map((c) => c.id));
  const [existingRegions, existingCategories] = await Promise.all([listRegions(worldId), listCategories(worldId)]);
  await Promise.all(existingRegions.filter((id) => !newRegionIds.has(id)).map((id) => deleteRegion(worldId, id)));
  await Promise.all(
    existingCategories.filter((id) => !newCategoryIds.has(id)).map((id) => deleteCategory(worldId, id))
  );

  await saveSplitResult(worldId, title, split, moods);
  return split;
}
