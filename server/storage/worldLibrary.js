import { worldMetaKey, worldDocPath, worldListPrefix } from './paths.js';

export async function saveWorld(dataStore, textStore, userId, { id, title, raw }) {
  await textStore.write(worldDocPath(userId, id), raw);
  const meta = { id, title, updatedAt: Date.now() };
  await dataStore.set(worldMetaKey(userId, id), meta);
  return { ...meta, raw };
}

export async function getWorld(dataStore, textStore, userId, id) {
  const meta = await dataStore.get(worldMetaKey(userId, id));
  if (!meta) return null;
  const raw = (await textStore.read(worldDocPath(userId, id))) ?? '';
  return { ...meta, raw };
}

export async function listWorlds(dataStore, userId) {
  const keys = await dataStore.list(worldListPrefix(userId));
  const worlds = await Promise.all(keys.map((k) => dataStore.get(k)));
  return worlds.filter(Boolean);
}

export async function deleteWorld(dataStore, textStore, userId, id) {
  await dataStore.delete(worldMetaKey(userId, id));
  await textStore.deleteDir(`${worldListPrefix(userId)}/${id}`);
}
