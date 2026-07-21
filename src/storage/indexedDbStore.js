import { openDB } from 'idb';

export const DB_NAME = 'trpg-gm-app';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';

let dbInstance = null;

function getDb() {
  if (dbInstance) {
    return dbInstance;
  }
  dbInstance = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
    },
  });
  return dbInstance;
}

export async function putSession(session) {
  const db = await getDb();
  await db.put(STORE_SESSIONS, session);
}

export async function getSessionById(id) {
  const db = await getDb();
  return (await db.get(STORE_SESSIONS, id)) || null;
}

export async function getAllSessions() {
  const db = await getDb();
  return db.getAll(STORE_SESSIONS);
}

export async function deleteSession(id) {
  const db = await getDb();
  await db.delete(STORE_SESSIONS, id);
}

export async function closeDb() {
  if (dbInstance) {
    const db = await dbInstance;
    db.close();
    dbInstance = null;
  }
}
