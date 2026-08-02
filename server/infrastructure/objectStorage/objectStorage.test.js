// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFilesystemObjectStorage } from './filesystemObjectStorage.js';
import { createS3ObjectStorage } from './s3ObjectStorage.js';

function missing() {
  const error = new Error('missing');
  error.name = 'NoSuchKey';
  error.$metadata = { httpStatusCode: 404 };
  return error;
}

function createMemoryS3Client() {
  const objects = new Map();
  const calls = [];
  return {
    objects,
    calls,
    async send(command) {
      calls.push(command);
      const input = command.input;
      switch (command.constructor.name) {
        case 'PutObjectCommand':
          objects.set(input.Key, {
            body: Buffer.from(input.Body),
            metadata: input.Metadata,
          });
          return {};
        case 'GetObjectCommand': {
          const row = objects.get(input.Key);
          if (!row) throw missing();
          return { Body: { transformToByteArray: async () => row.body } };
        }
        case 'HeadObjectCommand': {
          const row = objects.get(input.Key);
          if (!row) throw missing();
          return { ContentLength: row.body.length, Metadata: row.metadata, ETag: 'etag' };
        }
        case 'DeleteObjectCommand':
          objects.delete(input.Key);
          return {};
        case 'ListObjectsV2Command': {
          const keys = [...objects.keys()].filter((key) => key.startsWith(input.Prefix)).sort();
          const offset = input.ContinuationToken ? Number(input.ContinuationToken) : 0;
          const page = keys.slice(offset, offset + 1);
          return {
            Contents: page.map((Key) => ({ Key, Size: objects.get(Key).body.length, ETag: 'etag' })),
            IsTruncated: offset + 1 < keys.length,
            NextContinuationToken: String(offset + 1),
          };
        }
        case 'DeleteObjectsCommand':
          for (const item of input.Delete.Objects) objects.delete(item.Key);
          return {};
        default:
          throw new Error(`unexpected command ${command.constructor.name}`);
      }
    },
  };
}

function objectStorageContract(name, factory) {
  describe(name, () => {
    let store;
    beforeEach(async () => { store = await factory(); });

    it('writes, reads, stats, and overwrites exact bytes', async () => {
      const first = Buffer.from([1, 2, 3]);
      const receipt = await store.write('users/u/images/a.webp', first);
      expect(receipt).toMatchObject({ key: 'users/u/images/a.webp', bytes: 3 });
      expect(receipt.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(await store.read('users/u/images/a.webp')).toEqual(first);
      expect(await store.stat('users/u/images/a.webp')).toMatchObject({ bytes: 3, sha256: receipt.sha256 });

      await store.write('users/u/images/a.webp', Buffer.from([9]));
      expect(await store.read('users/u/images/a.webp')).toEqual(Buffer.from([9]));
    });

    it('lists a prefix across pages and deletes only that prefix', async () => {
      await store.write('users/u/images/a.webp', Buffer.from([1]));
      await store.write('users/u/images/nested/b.webp', Buffer.from([2, 3]));
      await store.write('users/other/images/c.webp', Buffer.from([4]));
      expect((await store.list('users/u/images')).map((row) => row.key)).toEqual([
        'users/u/images/a.webp',
        'users/u/images/nested/b.webp',
      ]);
      await store.deleteDir('users/u/images');
      expect(await store.read('users/u/images/a.webp')).toBeNull();
      expect(await store.read('users/other/images/c.webp')).toEqual(Buffer.from([4]));
    });

    it('treats missing reads and deletes as idempotent', async () => {
      expect(await store.read('users/u/images/missing.webp')).toBeNull();
      expect(await store.stat('users/u/images/missing.webp')).toBeNull();
      await expect(store.delete('users/u/images/missing.webp')).resolves.toBeUndefined();
      await expect(store.deleteDir('users/u/images/missing')).resolves.toBeUndefined();
    });

    it('rejects traversal and absolute keys', async () => {
      await expect(store.write('../escape.webp', Buffer.from([1]))).rejects.toThrow(/invalid|relative/);
      await expect(store.read('/absolute.webp')).rejects.toThrow(/relative/);
    });
  });
}

let directory;
afterEach(async () => {
  if (directory) await fs.rm(directory, { recursive: true, force: true });
  directory = null;
});

objectStorageContract('FilesystemObjectStorage', async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'object-storage-'));
  return createFilesystemObjectStorage(directory);
});

const memoryS3 = createMemoryS3Client();
objectStorageContract('S3ObjectStorage', async () => {
  memoryS3.objects.clear();
  memoryS3.calls.length = 0;
  return createS3ObjectStorage({ bucket: 'private', prefix: 'gmdesk', client: memoryS3 });
});

describe('S3ObjectStorage namespace', () => {
  it('never exposes or deletes keys outside configured prefix', async () => {
    const client = createMemoryS3Client();
    client.objects.set('outside/keep.webp', { body: Buffer.from([1]), metadata: {} });
    const store = createS3ObjectStorage({ bucket: 'private', prefix: 'tenant/app', client });
    await store.write('users/u/a.webp', Buffer.from([2]));
    expect(client.objects.has('tenant/app/users/u/a.webp')).toBe(true);
    await store.deleteDir('users/u');
    expect(client.objects.has('outside/keep.webp')).toBe(true);
  });
});
