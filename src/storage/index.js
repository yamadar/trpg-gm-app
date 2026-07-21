import { putSession, getSessionById, getAllSessions, deleteSession } from './indexedDbStore.js';

const PING_ID = '__ping__';

export async function isStorageAvailable() {
  try {
    if (!('indexedDB' in window)) return false;
    await putSession({ id: PING_ID, updatedAt: Date.now() });
    const r = await getSessionById(PING_ID);
    await deleteSession(PING_ID);
    return !!r;
  } catch (e) {
    console.error('storage availability check failed', e);
    return false;
  }
}

export async function listSessions() {
  try {
    const all = await getAllSessions();
    return all
      .filter((s) => s.id !== PING_ID)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) {
    console.error('listSessions failed', e);
    return [];
  }
}

export async function getSession(id) {
  try {
    return await getSessionById(id);
  } catch (e) {
    console.error('getSession failed', e);
    return null;
  }
}

export async function saveSession(session) {
  try {
    await putSession(session);
    return true;
  } catch (e) {
    console.error('saveSession failed', e);
    return false;
  }
}
