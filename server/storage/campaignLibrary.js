import { campaignMetaKey, campaignListPrefix } from './paths.js';

export async function saveCampaign(dataStore, userId, { id, worldId, title, carriedPc, chapters }) {
  const existing = await dataStore.get(campaignMetaKey(userId, worldId, id));
  const now = Date.now();
  const meta = {
    id,
    worldId,
    title,
    carriedPc: carriedPc ?? { raw: '', xp: 0 },
    chapters: Array.isArray(chapters) ? chapters : [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await dataStore.set(campaignMetaKey(userId, worldId, id), meta);
  return meta;
}

export async function getCampaign(dataStore, userId, worldId, id) {
  return (await dataStore.get(campaignMetaKey(userId, worldId, id))) ?? null;
}

export async function listCampaigns(dataStore, userId, worldId) {
  const keys = await dataStore.list(campaignListPrefix(userId, worldId));
  const metas = await Promise.all(keys.map((k) => dataStore.get(k)));
  return metas.filter(Boolean);
}
