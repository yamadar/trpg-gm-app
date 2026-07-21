import { rulesetMetaKey } from './paths.js';

export async function saveRuleset(dataStore, { id, label, desc, hint }) {
  const meta = { id, label, desc, hint, updatedAt: Date.now() };
  await dataStore.set(rulesetMetaKey(id), meta);
  return meta;
}

export async function getRuleset(dataStore, id) {
  return (await dataStore.get(rulesetMetaKey(id))) ?? null;
}

export async function listRulesets(dataStore) {
  const keys = await dataStore.list('rulesets');
  const rulesets = await Promise.all(keys.map((k) => dataStore.get(k)));
  return rulesets.filter(Boolean);
}

export async function deleteRuleset(dataStore, id) {
  await dataStore.delete(rulesetMetaKey(id));
}
