// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { saveEnding, getEnding, listEndings, deleteEnding } from './endingLibrary.js';

let dir;
let dataStore;

function ending(overrides = {}) {
  return { sessionId: 's1', endingTitle: '灰は星を数えない', endedAt: 100, stats: { total: 3 }, ...overrides };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ending-library-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('endingLibrary', () => {
  it('returns null for a missing ending', async () => {
    expect(await getEnding(dataStore, 'u1', 'nope')).toBeNull();
  });

  it('saves and retrieves an ending', async () => {
    await saveEnding(dataStore, 'u1', ending());
    expect(await getEnding(dataStore, 'u1', 's1')).toMatchObject({ sessionId: 's1', endingTitle: '灰は星を数えない' });
  });

  it('overwrites the record for the same session', async () => {
    await saveEnding(dataStore, 'u1', ending());
    await saveEnding(dataStore, 'u1', ending({ endingTitle: '書き直した題' }));
    expect((await getEnding(dataStore, 'u1', 's1')).endingTitle).toBe('書き直した題');
  });

  it('lists endings newest first', async () => {
    await saveEnding(dataStore, 'u1', ending({ sessionId: 'old', endedAt: 100 }));
    await saveEnding(dataStore, 'u1', ending({ sessionId: 'new', endedAt: 300 }));
    await saveEnding(dataStore, 'u1', ending({ sessionId: 'mid', endedAt: 200 }));
    expect((await listEndings(dataStore, 'u1')).map((e) => e.sessionId)).toEqual(['new', 'mid', 'old']);
  });

  it('returns an empty list for a user with no endings', async () => {
    expect(await listEndings(dataStore, 'u1')).toEqual([]);
  });

  it('scopes endings per user', async () => {
    await saveEnding(dataStore, 'u1', ending());
    expect(await listEndings(dataStore, 'u2')).toEqual([]);
    expect(await getEnding(dataStore, 'u2', 's1')).toBeNull();
  });

  it('deletes an ending and tolerates deleting a missing one', async () => {
    await saveEnding(dataStore, 'u1', ending());
    await deleteEnding(dataStore, 'u1', 's1');
    expect(await getEnding(dataStore, 'u1', 's1')).toBeNull();
    await expect(deleteEnding(dataStore, 'u1', 's1')).resolves.toBeUndefined();
  });
});
