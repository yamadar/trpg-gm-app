// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openSqliteDatabase } from '../infrastructure/sqlite/database.js';
import { createSqliteCoordinator } from '../infrastructure/sqlite/coordinator.js';
import { createSqliteDataStore } from '../infrastructure/sqlite/dataStore.js';
import { createSqliteTextStore } from '../infrastructure/sqlite/textStore.js';
import { createPersistence } from './createPersistence.js';
import { createSqliteStorageRepository } from './storageRepository.js';

let dir;
let persistence;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-repository-'));
  persistence = createPersistence({ driver: 'sqlite', dataDir: dir });
});

afterEach(async () => {
  persistence.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('SQLite storage ledger', () => {
  it('tracks exact logical bytes across record and document updates and deletes', async () => {
    const { dataStore, textStore } = persistence;
    await dataStore.set('users/usr_1/profile', { id: 'usr_1' });
    await textStore.write('users/usr_1/worlds/w1/world.md', '世界');
    const initial = Buffer.byteLength(JSON.stringify({ id: 'usr_1' }), 'utf8') + Buffer.byteLength('世界', 'utf8');
    expect(await persistence.repositories.storage.usedBytes('usr_1')).toBe(initial);

    await dataStore.set('users/usr_1/profile', { id: 'usr_1', bio: 'longer' });
    const updated = Buffer.byteLength(JSON.stringify({ id: 'usr_1', bio: 'longer' }), 'utf8')
      + Buffer.byteLength('世界', 'utf8');
    expect(await persistence.repositories.storage.usedBytes('usr_1')).toBe(updated);

    await textStore.deleteDir('users/usr_1/worlds/w1');
    expect(await persistence.repositories.storage.usedBytes('usr_1'))
      .toBe(Buffer.byteLength(JSON.stringify({ id: 'usr_1', bio: 'longer' }), 'utf8'));
  });

  it('reassigns public documents and media when public metadata is finalized', async () => {
    await persistence.textStore.write('public/worlds/pub_1/world.md', '# Public');
    await persistence.imageStore.write('public/worlds/pub_1/attachments/a/display.webp', Buffer.from([1, 2, 3]));
    expect(await persistence.repositories.storage.usedBytes('usr_1')).toBe(0);

    const meta = { publicId: 'pub_1', ownerId: 'usr_1', title: 'Public' };
    await persistence.dataStore.set('public/worlds/pub_1', meta);
    const expected = Buffer.byteLength(JSON.stringify(meta), 'utf8')
      + Buffer.byteLength('# Public', 'utf8')
      + 3;
    expect(await persistence.repositories.storage.usedBytes('usr_1')).toBe(expected);
    expect(await persistence.repositories.storage.audit()).toContainEqual({
      ownerId: 'usr_1',
      usedBytes: expected,
      measuredBytes: expected,
    });
  });

  it('does not charge derived Party membership indexes', async () => {
    await persistence.dataStore.set('users/usr_1/sharedSessions/party_1', {
      sessionId: 'party_1',
      ownerId: 'usr_owner',
    });
    expect(await persistence.repositories.storage.usedBytes('usr_1')).toBe(0);
    expect(await persistence.repositories.storage.usedBytes('usr_owner')).toBe(0);
  });

  it('reserves atomically, releases idempotently, and expires abandoned reservations', async () => {
    persistence.close();
    let timestamp = 100;
    const db = openSqliteDatabase(path.join(dir, 'quota.sqlite3'));
    const coordinator = createSqliteCoordinator(db, { now: () => timestamp });
    const storage = createSqliteStorageRepository({ db, coordinator, now: () => timestamp });
    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => storage.reserve({
          ownerId: 'usr_1', bytes: 30, limitBytes: 100, ttlMs: 50,
        })),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(3);
      await storage.release(results.find((result) => result.ok).id);
      await storage.release(results.find((result) => result.ok).id);
      expect((await storage.reserve({ ownerId: 'usr_1', bytes: 30, limitBytes: 100, ttlMs: 50 })).ok).toBe(true);

      timestamp = 1000;
      expect((await storage.reserve({ ownerId: 'usr_1', bytes: 100, limitBytes: 100, ttlMs: 50 })).ok).toBe(true);
      expect(db.prepare('SELECT COUNT(*) AS count FROM storage_reservations').get().count).toBe(1);
    } finally {
      db.close();
      persistence = { close() {} };
    }
  });
});
