import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deleteDB } from 'idb';
import { isStorageAvailable, listSessions, getSession, saveSession } from './index.js';
import * as idb from './indexedDbStore.js';
import { DB_NAME, closeDb } from './indexedDbStore.js';

beforeEach(
  async () => {
    await closeDb();
    await deleteDB(DB_NAME);
  },
  15000
);

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('reports storage unavailable when the ping write rejects', async () => {
    vi.spyOn(idb, 'putSession').mockRejectedValueOnce(new Error('quota exceeded'));
    expect(await isStorageAvailable()).toBe(false);
  });

  it('saveSession returns false when the write rejects, without throwing', async () => {
    vi.spyOn(idb, 'putSession').mockRejectedValueOnce(new Error('disk full'));
    await expect(saveSession({ id: 'x', updatedAt: 1 })).resolves.toBe(false);
  });

  it('listSessions returns an empty array when the underlying read rejects', async () => {
    vi.spyOn(idb, 'getAllSessions').mockRejectedValueOnce(new Error('io error'));
    expect(await listSessions()).toEqual([]);
  });

  it('getSession returns null when the underlying read rejects', async () => {
    vi.spyOn(idb, 'getSessionById').mockRejectedValueOnce(new Error('io error'));
    expect(await getSession('x')).toBeNull();
  });
});
