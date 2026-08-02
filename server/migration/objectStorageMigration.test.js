// @vitest-environment node
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistence } from '../persistence/createPersistence.js';
import { migrateMediaObjects } from './objectStorageMigration.js';

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function memoryStorage() {
  const objects = new Map();
  return {
    objects,
    async write(key, value) {
      const buffer = Buffer.from(value);
      objects.set(key, buffer);
      return { key, bytes: buffer.length, sha256: digest(buffer) };
    },
    async read(key) { return objects.has(key) ? Buffer.from(objects.get(key)) : null; },
    async stat(key) {
      const buffer = objects.get(key);
      return buffer ? { key, bytes: buffer.length, sha256: digest(buffer) } : null;
    },
  };
}

let directory;
let persistence;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'media-migration-'));
  persistence = createPersistence({ driver: 'sqlite', dataDir: directory });
  await persistence.dataStore.set('users/usr_owner/sessions/s1', { id: 's1' });
  await persistence.imageStore.write(
    'users/usr_owner/sessions/s1/images/a.webp',
    Buffer.from([1, 2, 3]),
  );
});

afterEach(async () => {
  persistence.close();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('object storage migration', () => {
  it('dry-runs, imports, validates, and skips an already journaled object', async () => {
    const target = memoryStorage();
    const options = {
      persistence,
      sourceStorage: persistence.objectStorage,
      targetStorage: target,
    };

    expect(await migrateMediaObjects({ ...options, dryRun: true })).toMatchObject({
      ok: true,
      totals: { objects: 1, bytes: 3 },
      uploaded: 0,
    });
    expect((await migrateMediaObjects(options))).toMatchObject({ ok: true, uploaded: 1 });
    expect((await migrateMediaObjects(options))).toMatchObject({ ok: true, skipped: 1 });
    expect(await migrateMediaObjects({ ...options, validateOnly: true })).toMatchObject({
      ok: true,
      validated: 1,
    });
  });

  it('reports a missing source without mutating the target', async () => {
    const asset = (await persistence.repositories.media.listAll())[0];
    await persistence.objectStorage.delete(asset.objectKey);
    const target = memoryStorage();
    const report = await migrateMediaObjects({
      persistence,
      sourceStorage: persistence.objectStorage,
      targetStorage: target,
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toContainEqual({ objectKey: asset.objectKey, reason: 'source_missing' });
    expect(target.objects.size).toBe(0);
  });

  it('refuses migration while a media operation is unsettled', async () => {
    await persistence.repositories.media.createPending({
      id: 'pending',
      resourceKey: 'users/usr_owner/images/pending.webp',
      ownerId: 'usr_owner',
      objectKey: 'media/usr_owner/pending.webp',
      sha256: 'a'.repeat(64),
      bytes: 1,
      mimeType: 'image/webp',
    });
    const report = await migrateMediaObjects({
      persistence,
      sourceStorage: persistence.objectStorage,
      targetStorage: memoryStorage(),
      dryRun: true,
    });
    expect(report.ok).toBe(false);
    expect(report.errors).toContainEqual({ reason: 'media_state_not_settled', count: 1 });
  });
});
