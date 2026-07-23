import { characterMetaKey, characterDocPath } from './paths.js';

export async function saveCharacter(dataStore, textStore, userId, { worldId, kind, name, raw, revealed }) {
  await textStore.write(characterDocPath(userId, worldId, kind, name), raw);
  const meta = {
    id: name,
    worldId,
    kind,
    name,
    revealed: kind === 'npc' ? !!revealed : null,
    parsed: null,
    parsedHash: null,
    updatedAt: Date.now(),
  };
  await dataStore.set(characterMetaKey(userId, worldId, kind, name), meta);
  return { ...meta, raw };
}

export async function getCharacter(dataStore, textStore, userId, worldId, kind, name) {
  const meta = await dataStore.get(characterMetaKey(userId, worldId, kind, name));
  if (!meta) return null;
  const raw = (await textStore.read(characterDocPath(userId, worldId, kind, name))) ?? '';
  return { ...meta, raw };
}

export async function listCharacters(dataStore, userId, worldId, kind) {
  const keys = await dataStore.list(`users/${userId}/worlds/${worldId}/${kind}`);
  const characters = await Promise.all(keys.map((k) => dataStore.get(k)));
  return characters.filter(Boolean);
}

export async function deleteCharacter(dataStore, textStore, userId, worldId, kind, name) {
  await dataStore.delete(characterMetaKey(userId, worldId, kind, name));
  await textStore.delete(characterDocPath(userId, worldId, kind, name));
}

export async function saveCharacterParsed(dataStore, userId, worldId, kind, name, { parsed, parsedHash }) {
  const meta = await dataStore.get(characterMetaKey(userId, worldId, kind, name));
  if (!meta) return null;
  const updated = { ...meta, parsed, parsedHash, updatedAt: Date.now() };
  await dataStore.set(characterMetaKey(userId, worldId, kind, name), updated);
  return updated;
}
