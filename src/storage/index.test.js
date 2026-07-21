import { describe, it, expect, beforeEach } from 'vitest';
import { deleteDB } from 'idb';
import { isStorageAvailable, listSessions, getSession, saveSession } from './index.js';
import { DB_NAME, closeDb } from './indexedDbStore.js';

beforeEach(
  async () => {
    await closeDb();
    await deleteDB(DB_NAME);
  },
  15000
);

describe('client session storage', () => {
  it('reports storage as available', async () => {
    expect(await isStorageAvailable()).toBe(true);
  });

  it('cleans up the internal ping record after checking availability', async () => {
    await isStorageAvailable();
    expect(await getSession('__ping__')).toBeNull();
  });

  it('returns null for a missing session', async () => {
    expect(await getSession('missing')).toBeNull();
  });

  it('saves and retrieves a session by id', async () => {
    await saveSession({ id: 's1', title: 'Test', updatedAt: 1 });
    expect(await getSession('s1')).toMatchObject({ id: 's1', title: 'Test' });
  });

  it('lists sessions sorted by updatedAt descending, excluding the internal ping key', async () => {
    await saveSession({ id: 's1', title: 'Old', updatedAt: 1 });
    await saveSession({ id: 's2', title: 'New', updatedAt: 2 });
    const sessions = await listSessions();
    expect(sessions.map((s) => s.id)).toEqual(['s2', 's1']);
  });
});
