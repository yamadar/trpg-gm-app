import { worldMetaKey, worldDocPath, worldListPrefix } from './paths.js';

// sourcePublicId: 公開素材から取り込んだ複製であることの印。同じ公開素材を取り込み直した
// ときに複製を増やさないための手掛かりで、importLibrary が付ける。素材ライブラリからの
// 通常の保存では渡ってこないため、明示指定が無ければ既存の値をそのまま残す
// (編集しただけで取り込み元を見失い、次の取り込みで複製が生えるのを防ぐ)。
export async function saveWorld(dataStore, textStore, userId, { id, title, raw, moods, sourcePublicId }) {
  await textStore.write(worldDocPath(userId, id), raw);
  const prev = await dataStore.get(worldMetaKey(userId, id));
  const meta = {
    id,
    title,
    moods: Array.isArray(moods) ? moods : [],
    sourcePublicId: sourcePublicId ?? prev?.sourcePublicId ?? null,
    updatedAt: Date.now(),
  };
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
