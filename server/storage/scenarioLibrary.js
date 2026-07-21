import { scenarioMetaKey, scenarioDocPath } from './paths.js';

export async function saveScenario(dataStore, textStore, { worldId, id, title, raw, recommendedRuleset }) {
  await textStore.write(scenarioDocPath(worldId, id), raw);
  const meta = {
    id,
    worldId,
    title,
    recommendedRuleset: recommendedRuleset ?? null,
    updatedAt: Date.now(),
  };
  await dataStore.set(scenarioMetaKey(worldId, id), meta);
  return { ...meta, raw };
}

export async function getScenario(dataStore, textStore, worldId, id) {
  const meta = await dataStore.get(scenarioMetaKey(worldId, id));
  if (!meta) return null;
  const raw = (await textStore.read(scenarioDocPath(worldId, id))) ?? '';
  return { ...meta, raw };
}

export async function listScenarios(dataStore, worldId) {
  const keys = await dataStore.list(`worlds/${worldId}/scenarios`);
  const scenarios = await Promise.all(keys.map((k) => dataStore.get(k)));
  return scenarios.filter(Boolean);
}

export async function deleteScenario(dataStore, textStore, worldId, id) {
  await dataStore.delete(scenarioMetaKey(worldId, id));
  await textStore.delete(scenarioDocPath(worldId, id));
}
