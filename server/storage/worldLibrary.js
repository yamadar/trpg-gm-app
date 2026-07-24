import { worldMetaKey, worldDocPath, worldListPrefix } from './paths.js';

export async function saveWorld(dataStore, textStore, userId, { id, title, raw, moods }) {
  await textStore.write(worldDocPath(userId, id), raw);
  const meta = { id, title, moods: Array.isArray(moods) ? moods : [], updatedAt: Date.now() };
  await dataStore.set(worldMetaKey(userId, id), meta);
  return { ...meta, raw };
}

export async function getWorld(dataStore, textStore, userId, id) {
  const meta = await dataStore.get(worldMetaKey(userId, id));
  if (!meta) return null;
  const raw = (await textStore.read(worldDocPath(userId, id))) ?? '';
  return { ...meta, moods: meta.moods ?? [], raw };
}

export async function listWorlds(dataStore, userId) {
  const keys = await dataStore.list(worldListPrefix(userId));
  const metas = await Promise.all(keys.map((k) => dataStore.get(k)));
  return metas.filter(Boolean).map((m) => ({ ...m, moods: m.moods ?? [] }));
}

export async function deleteWorld(dataStore, textStore, userId, id) {
  await dataStore.delete(worldMetaKey(userId, id));
  await textStore.deleteDir(`${worldListPrefix(userId)}/${id}`);
}
