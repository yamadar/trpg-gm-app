// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsImageStore } from './imageStore.js';

let dir, store;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'imagestore-test-'));
  store = createFsImageStore(dir);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createFsImageStore', () => {
  it('writes and reads back binary bytes', async () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    await store.write('users/u/sessions/s/images/img_1.png', buf);
    const out = await store.read('users/u/sessions/s/images/img_1.png');
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.equals(buf)).toBe(true);
  });
  it('returns null for a missing file', async () => {
    expect(await store.read('nope.png')).toBeNull();
  });
  it('deletes a file and ignores a missing one', async () => {
    await store.write('a.png', Buffer.from([1]));
    await store.delete('a.png');
    expect(await store.read('a.png')).toBeNull();
    await expect(store.delete('a.png')).resolves.toBeUndefined();
  });
  it('deleteDir removes a whole directory', async () => {
    await store.write('users/u/sessions/s/images/x.png', Buffer.from([1]));
    await store.deleteDir('users/u/sessions/s/images');
    expect(await store.read('users/u/sessions/s/images/x.png')).toBeNull();
  });
});
