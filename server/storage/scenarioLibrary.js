import { scenarioMetaKey, scenarioDocPath } from './paths.js';

export async function saveScenario(dataStore, textStore, userId, { worldId, id, title, raw, recommendedRuleset, moods }) {
  await textStore.write(scenarioDocPath(userId, worldId, id), raw);
  const meta = {
    id,
    worldId,
    title,
    recommendedRuleset: recommendedRuleset ?? null,
    moods: Array.isArray(moods) ? moods : [],
    updatedAt: Date.now(),
  };
  await dataStore.set(scenarioMetaKey(userId, worldId, id), meta);
  return { ...meta, raw };
}

export async function getScenario(dataStore, textStore, userId, worldId, id) {
  const meta = await dataStore.get(scenarioMetaKey(userId, worldId, id));
  if (!meta) return null;
  const raw = (await textStore.read(scenarioDocPath(userId, worldId, id))) ?? '';
  return { ...meta, moods: meta.moods ?? [], raw };
}

export async function listScenarios(dataStore, userId, worldId) {
  const keys = await dataStore.list(`users/${userId}/worlds/${worldId}/scenarios`);
  const metas = await Promise.all(keys.map((k) => dataStore.get(k)));
  return metas.filter(Boolean).map((m) => ({ ...m, moods: m.moods ?? [] }));
}

export async function deleteScenario(dataStore, textStore, userId, worldId, id) {
  await dataStore.delete(scenarioMetaKey(userId, worldId, id));
  await textStore.delete(scenarioDocPath(userId, worldId, id));
}
