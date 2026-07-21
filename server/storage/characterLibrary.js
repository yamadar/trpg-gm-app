import { characterMetaKey, characterDocPath } from './paths.js';

export async function saveCharacter(dataStore, textStore, { worldId, kind, name, raw, revealed }) {
  await textStore.write(characterDocPath(worldId, kind, name), raw);
  const meta = {
    id: name,
    worldId,
    kind,
    name,
    revealed: kind === 'npc' ? !!revealed : null,
    updatedAt: Date.now(),
  };
  await dataStore.set(characterMetaKey(worldId, kind, name), meta);
  return { ...meta, raw };
}

export async function getCharacter(dataStore, textStore, worldId, kind, name) {
  const meta = await dataStore.get(characterMetaKey(worldId, kind, name));
  if (!meta) return null;
  const raw = (await textStore.read(characterDocPath(worldId, kind, name))) ?? '';
  return { ...meta, raw };
}

export async function listCharacters(dataStore, worldId, kind) {
  const keys = await dataStore.list(`worlds/${worldId}/${kind}`);
  const characters = await Promise.all(keys.map((k) => dataStore.get(k)));
  return characters.filter(Boolean);
}

export async function deleteCharacter(dataStore, textStore, worldId, kind, name) {
  await dataStore.delete(characterMetaKey(worldId, kind, name));
  await textStore.delete(characterDocPath(worldId, kind, name));
}
