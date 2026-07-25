import { endingKey, endingListPrefix } from './paths.js';

// エンディング記録は sessionId をキーにする。1セッションにつき記録は1つで、
// 記録し直し(命名の再試行・改名)は同じキーへの上書きになる。
export async function saveEnding(dataStore, userId, ending) {
  await dataStore.set(endingKey(userId, ending.sessionId), ending);
  return ending;
}

export async function getEnding(dataStore, userId, sessionId) {
  return (await dataStore.get(endingKey(userId, sessionId))) ?? null;
}

export async function listEndings(dataStore, userId) {
  const keys = await dataStore.list(endingListPrefix(userId));
  const list = await Promise.all(keys.map((k) => dataStore.get(k)));
  return list.filter(Boolean).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
}

export async function deleteEnding(dataStore, userId, sessionId) {
  await dataStore.delete(endingKey(userId, sessionId));
}
