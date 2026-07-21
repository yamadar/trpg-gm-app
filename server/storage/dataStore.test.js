// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';

let dir;
let store;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'datastore-test-'));
  store = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createFsDataStore', () => {
  it('returns null for a missing key', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('round-trips a value through set/get', async () => {
    await store.set('sessions/abc', { id: 'abc', title: 'test' });
    expect(await store.get('sessions/abc')).toEqual({ id: 'abc', title: 'test' });
  });

  it('lists keys under a prefix', async () => {
    await store.set('sessions/a', { id: 'a' });
    await store.set('sessions/b', { id: 'b' });
    const keys = await store.list('sessions');
    expect(keys.sort()).toEqual(['sessions/a', 'sessions/b']);
  });

  it('returns an empty list for a missing prefix', async () => {
    expect(await store.list('nothing')).toEqual([]);
  });

  it('deletes a key', async () => {
    await store.set('sessions/a', { id: 'a' });
    await store.delete('sessions/a');
    expect(await store.get('sessions/a')).toBeNull();
  });
});
