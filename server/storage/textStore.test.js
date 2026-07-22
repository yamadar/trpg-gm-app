// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsTextStore } from './textStore.js';

let dir;
let store;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'textstore-test-'));
  store = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createFsTextStore', () => {
  it('returns null for a missing path', async () => {
    expect(await store.read('worlds/x/world.md')).toBeNull();
  });

  it('round-trips text through write/read', async () => {
    await store.write('worlds/x/world.md', '# 世界観\n本文');
    expect(await store.read('worlds/x/world.md')).toBe('# 世界観\n本文');
  });

  it('lists files under a prefix', async () => {
    await store.write('worlds/x/regions/a.md', 'a');
    await store.write('worlds/x/regions/b.md', 'b');
    const files = await store.list('worlds/x/regions');
    expect(files.sort()).toEqual(['worlds/x/regions/a.md', 'worlds/x/regions/b.md']);
  });

  it('returns an empty list for a missing prefix', async () => {
    expect(await store.list('worlds/missing')).toEqual([]);
  });

  it('deletes a file', async () => {
    await store.write('worlds/x/world.md', 'content');
    await store.delete('worlds/x/world.md');
    expect(await store.read('worlds/x/world.md')).toBeNull();
  });

  it('does not throw when deleting a missing file', async () => {
    await expect(store.delete('worlds/missing.md')).resolves.not.toThrow();
  });

  it('deleteDir removes an entire directory subtree', async () => {
    await store.write('worlds/w1/regions/a.md', 'A');
    await store.write('worlds/w1/categories/b.md', 'B');
    await store.deleteDir('worlds/w1');
    expect(await store.list('worlds/w1/regions')).toEqual([]);
    expect(await store.list('worlds/w1/categories')).toEqual([]);
  });

  it('deleteDir is a no-op for a missing directory', async () => {
    await expect(store.deleteDir('worlds/missing')).resolves.toBeUndefined();
  });
});
