// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsTextStore } from './textStore.js';
import { saveWorld, getWorld, listWorlds, deleteWorld } from './worldLibrary.js';

let dir;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'world-library-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('World library functions', () => {
  it('returns null for a missing world', async () => {
    expect(await getWorld(dataStore, textStore, 'usr_1', 'missing')).toBeNull();
  });

  it('saves and retrieves a world with its raw text', async () => {
    await saveWorld(dataStore, textStore, 'usr_1', { id: 'w1', title: 'Waterdeep', raw: '# 世界観' });
    const world = await getWorld(dataStore, textStore, 'usr_1', 'w1');
    expect(world).toMatchObject({ id: 'w1', title: 'Waterdeep', raw: '# 世界観' });
    expect(typeof world.updatedAt).toBe('number');
  });

  it('lists saved worlds without their raw text', async () => {
    await saveWorld(dataStore, textStore, 'usr_1', { id: 'w1', title: 'A', raw: 'raw-a' });
    await saveWorld(dataStore, textStore, 'usr_1', { id: 'w2', title: 'B', raw: 'raw-b' });
    const worlds = await listWorlds(dataStore, 'usr_1');
    expect(worlds.map((w) => w.id).sort()).toEqual(['w1', 'w2']);
    expect(worlds[0].raw).toBeUndefined();
  });

  it('returns an empty list when there are no worlds', async () => {
    expect(await listWorlds(dataStore, 'usr_1')).toEqual([]);
  });

  it('deletes a world and its raw text', async () => {
    await saveWorld(dataStore, textStore, 'usr_1', { id: 'w1', title: 'A', raw: 'raw-a' });
    await deleteWorld(dataStore, textStore, 'usr_1', 'w1');
    expect(await getWorld(dataStore, textStore, 'usr_1', 'w1')).toBeNull();
  });

  it('overwrites an existing world on save (no create/update distinction)', async () => {
    await saveWorld(dataStore, textStore, 'usr_1', { id: 'w1', title: 'Old', raw: 'old' });
    await saveWorld(dataStore, textStore, 'usr_1', { id: 'w1', title: 'New', raw: 'new' });
    const world = await getWorld(dataStore, textStore, 'usr_1', 'w1');
    expect(world).toMatchObject({ title: 'New', raw: 'new' });
  });

  it('deleteWorld also removes region/category/scenario sub-content', async () => {
    await saveWorld(dataStore, textStore, 'usr_1', { id: 'w1', title: 'W', raw: '本文' });
    await textStore.write('users/usr_1/worlds/w1/regions/harbor.md', '港');
    await textStore.write('users/usr_1/worlds/w1/categories/magic.md', '魔法');
    await deleteWorld(dataStore, textStore, 'usr_1', 'w1');
    expect(await getWorld(dataStore, textStore, 'usr_1', 'w1')).toBeNull();
    expect(await textStore.list('users/usr_1/worlds/w1/regions')).toEqual([]);
    expect(await textStore.list('users/usr_1/worlds/w1/categories')).toEqual([]);
  });

  it('scopes worlds to their owning user (does not leak across users)', async () => {
    await saveWorld(dataStore, textStore, 'usr_1', { id: 'w1', title: 'A', raw: 'a' });
    expect(await getWorld(dataStore, textStore, 'usr_2', 'w1')).toBeNull();
    expect(await listWorlds(dataStore, 'usr_2')).toEqual([]);
  });
});
