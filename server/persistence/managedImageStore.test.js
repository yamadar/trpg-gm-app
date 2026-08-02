// @vitest-environment node
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistence } from './createPersistence.js';
import { createManagedImageStore, reconcileMediaAssets } from './managedImageStore.js';

function hash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function createMemoryObjectStorage() {
  const objects = new Map();
  let writeError = null;
  let deleteError = null;
  return {
    objects,
    failNextWrite(error = new Error('upload failed')) { writeError = error; },
    failNextDelete(error = new Error('delete failed')) { deleteError = error; },
    async write(key, value) {
      if (writeError) {
        const error = writeError;
        writeError = null;
        throw error;
      }
      const buffer = Buffer.from(value);
      objects.set(key, buffer);
      return { key, bytes: buffer.length, sha256: hash(buffer) };
    },
    async read(key) { return objects.has(key) ? Buffer.from(objects.get(key)) : null; },
    async stat(key) {
      const buffer = objects.get(key);
      return buffer ? { key, bytes: buffer.length, sha256: hash(buffer) } : null;
    },
    async delete(key) {
      if (deleteError) {
        const error = deleteError;
        deleteError = null;
        throw error;
      }
      objects.delete(key);
    },
  };
}

let directory;
let persistence;
let objectStorage;
let store;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'managed-media-'));
  persistence = createPersistence({ driver: 'sqlite', dataDir: directory });
  objectStorage = createMemoryObjectStorage();
  store = createManagedImageStore({
    objectStorage,
    mediaRepository: persistence.repositories.media,
    ownerForResource: async () => 'usr_owner',
  });
});

afterEach(async () => {
  persistence.close();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('managed image store', () => {
  it('uploads an immutable object, binds the logical path, and charges actual bytes', async () => {
    const key = 'users/usr_owner/sessions/s1/images/a.webp';
    await store.write(key, Buffer.from([1, 2, 3]));

    const asset = await persistence.repositories.media.get(key);
    expect(asset).toMatchObject({
      resourceKey: key,
      ownerId: 'usr_owner',
      state: 'ready',
      bytes: 3,
      mimeType: 'image/webp',
    });
    expect(asset.objectKey).toMatch(/^media\/usr_owner\/[0-9a-f-]+\.webp$/);
    expect(await store.read(key)).toEqual(Buffer.from([1, 2, 3]));
    expect(await persistence.repositories.storage.usedBytes('usr_owner')).toBe(3);
  });

  it('keeps the old binding when replacement upload fails', async () => {
    const key = 'users/usr_owner/sessions/s1/images/a.png';
    await store.write(key, Buffer.from([1, 2]));
    const previous = await persistence.repositories.media.get(key);
    objectStorage.failNextWrite();

    await expect(store.write(key, Buffer.from([9, 9, 9]))).rejects.toThrow('upload failed');
    expect((await persistence.repositories.media.get(key)).id).toBe(previous.id);
    expect(await store.read(key)).toEqual(Buffer.from([1, 2]));
    expect(await persistence.repositories.storage.usedBytes('usr_owner')).toBe(2);
    expect(persistence.db.prepare("SELECT COUNT(*) AS count FROM media_assets WHERE state = 'failed'").get().count)
      .toBe(1);
  });

  it('swaps the binding and deletes the previous object after replacement', async () => {
    const key = 'users/usr_owner/sessions/s1/images/a.png';
    await store.write(key, Buffer.from([1]));
    const previous = await persistence.repositories.media.get(key);
    await store.write(key, Buffer.from([2, 3, 4]));

    const current = await persistence.repositories.media.get(key);
    expect(current.id).not.toBe(previous.id);
    expect(objectStorage.objects.has(previous.objectKey)).toBe(false);
    expect((await persistence.repositories.media.getAsset(previous.id)).state).toBe('deleted');
    expect(await persistence.repositories.storage.usedBytes('usr_owner')).toBe(3);
  });

  it('removes the binding before object deletion and recovers a failed delete', async () => {
    const key = 'users/usr_owner/sessions/s1/images/a.png';
    await store.write(key, Buffer.from([1, 2]));
    const asset = await persistence.repositories.media.get(key);
    objectStorage.failNextDelete();

    await expect(store.delete(key)).rejects.toThrow('delete failed');
    expect(await store.read(key)).toBeNull();
    expect((await persistence.repositories.media.getAsset(asset.id)).state).toBe('deleting');
    expect(await persistence.repositories.storage.usedBytes('usr_owner')).toBe(0);

    expect(await reconcileMediaAssets({
      objectStorage,
      mediaRepository: persistence.repositories.media,
    })).toEqual({ found: 1, activated: 0, failed: 0, deleted: 1 });
    expect((await persistence.repositories.media.getAsset(asset.id)).state).toBe('deleted');
  });

  it('activates an uploaded pending object during reconciliation', async () => {
    const key = 'users/usr_owner/sessions/s1/images/recovered.webp';
    const buffer = Buffer.from([7, 8]);
    const asset = await persistence.repositories.media.createPending({
      id: 'pending-1',
      resourceKey: key,
      ownerId: 'usr_owner',
      objectKey: 'media/usr_owner/pending-1.webp',
      sha256: hash(buffer),
      bytes: buffer.length,
      mimeType: 'image/webp',
    });
    await objectStorage.write(asset.objectKey, buffer);

    expect(await reconcileMediaAssets({
      objectStorage,
      mediaRepository: persistence.repositories.media,
    })).toEqual({ found: 1, activated: 1, failed: 0, deleted: 0 });
    expect(await store.read(key)).toEqual(buffer);
  });

  it('deletes every bound object below a logical prefix', async () => {
    await store.write('users/usr_owner/images/a/display.webp', Buffer.from([1]));
    await store.write('users/usr_owner/images/a/thumb.webp', Buffer.from([2]));
    await store.write('users/usr_owner/images/b/display.webp', Buffer.from([3]));
    await store.deleteDir('users/usr_owner/images/a');
    expect(await store.read('users/usr_owner/images/a/display.webp')).toBeNull();
    expect(await store.read('users/usr_owner/images/a/thumb.webp')).toBeNull();
    expect(await store.read('users/usr_owner/images/b/display.webp')).toEqual(Buffer.from([3]));
  });
});
