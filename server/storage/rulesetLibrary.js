import { rulesetMetaKey, rulesetListPrefix } from './paths.js';

export async function saveRuleset(dataStore, userId, { id, label, desc, hint, growthUnit }) {
  const meta = { id, label, desc, hint, growthUnit, updatedAt: Date.now() };
  await dataStore.set(rulesetMetaKey(userId, id), meta);
  return meta;
}

export async function getRuleset(dataStore, userId, id) {
  return (await dataStore.get(rulesetMetaKey(userId, id))) ?? null;
}

export async function listRulesets(dataStore, userId) {
  const keys = await dataStore.list(rulesetListPrefix(userId));
  const rulesets = await Promise.all(keys.map((k) => dataStore.get(k)));
  return rulesets.filter(Boolean);
}

export async function deleteRuleset(dataStore, userId, id) {
  await dataStore.delete(rulesetMetaKey(userId, id));
}
