import { splitWorld } from './worldSplit.js';
import { putWorld, putWorldSource, getWorldSource, putRegion, putCategory } from './worldLibraryClient.js';

async function saveSplitResult(worldId, title, split) {
  await putWorld(worldId, { title, raw: split.world });
  await Promise.all(split.regions.map((r) => putRegion(worldId, r.id, r.content)));
  await Promise.all(split.categories.map((c) => putCategory(worldId, c.id, c.content)));
}

export async function importWorld(worldId, title, rawText) {
  const split = await splitWorld(rawText);
  await putWorldSource(worldId, rawText);
  await saveSplitResult(worldId, title, split);
  return split;
}

export async function reimportWorld(worldId, title, adjustmentRequest) {
  const source = await getWorldSource(worldId);
  const split = await splitWorld(source.raw, adjustmentRequest);
  await saveSplitResult(worldId, title, split);
  return split;
}
