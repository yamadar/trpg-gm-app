import { worldMetaKey, worldDocPath } from './paths.js';

export async function saveWorld(dataStore, textStore, { id, title, raw }) {
  await textStore.write(worldDocPath(id), raw);
  const meta = { id, title, updatedAt: Date.now() };
  await dataStore.set(worldMetaKey(id), meta);
  return { ...meta, raw };
}

export async function getWorld(dataStore, textStore, id) {
  const meta = await dataStore.get(worldMetaKey(id));
  if (!meta) return null;
  const raw = (await textStore.read(worldDocPath(id))) ?? '';
  return { ...meta, raw };
}

export async function listWorlds(dataStore) {
  const keys = await dataStore.list('worlds');
  const worlds = await Promise.all(keys.map((k) => dataStore.get(k)));
  return worlds.filter(Boolean);
}

export async function deleteWorld(dataStore, textStore, id) {
  await dataStore.delete(worldMetaKey(id));
  await textStore.deleteDir(`worlds/${id}`);
}
