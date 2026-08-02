// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistence } from '../persistence/createPersistence.js';
import { migrateFilesystemToSqlite } from './filesystemToSqlite.js';

let dir;
let persistence;

async function write(relativePath, value) {
  const filename = path.join(dir, relativePath);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, value);
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-to-sqlite-'));
  persistence = createPersistence({
    driver: 'sqlite',
    dataDir: dir,
    sqlitePath: path.join(dir, 'target.sqlite3'),
  });
});

afterEach(async () => {
  persistence.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('filesystem to SQLite migration', () => {
  it('imports JSON and Markdown, retains media, and records an ownership manifest', async () => {
    await write('users/usr_1/profile.json', JSON.stringify({ id: 'usr_1', displayName: 'A' }));
    await write('users/usr_1/worlds/w1.json', JSON.stringify({ id: 'w1', title: 'World' }));
    await write('users/usr_1/worlds/w1/world.md', '# World');
    await write('users/usr_1/worlds/w1/attachments/a/display.webp', Buffer.from([1, 2, 3]));
    const report = await migrateFilesystemToSqlite({ dataDir: dir, persistence, now: () => 10 });

    expect(report).toMatchObject({ ok: true, imported: 3, retainedMedia: 1 });
    expect(report.owners.usr_1).toMatchObject({ files: 4 });
    expect(await persistence.dataStore.get('users/usr_1/worlds/w1')).toEqual({ id: 'w1', title: 'World' });
    expect(await persistence.textStore.read('users/usr_1/worlds/w1/world.md')).toBe('# World');
    expect(persistence.db.prepare('SELECT COUNT(*) AS count FROM migration_journal').get().count).toBe(4);
  });

  it('is idempotent and skips unchanged journal entries', async () => {
    await write('users/usr_1/profile.json', JSON.stringify({ id: 'usr_1' }));
    await migrateFilesystemToSqlite({ dataDir: dir, persistence });
    const second = await migrateFilesystemToSqlite({ dataDir: dir, persistence });
    expect(second.skipped).toBe(1);
    expect(persistence.db.prepare('SELECT COUNT(*) AS count FROM migration_journal').get().count).toBe(1);
  });

  it('quarantines malformed JSON and unknown Party owners without discarding files', async () => {
    await write('users/usr_1/broken.json', '{');
    await write('sharedSessions/party_missing/events/000000000001.json', JSON.stringify({ type: 'event' }));
    const report = await migrateFilesystemToSqlite({ dataDir: dir, persistence });
    expect(report.ok).toBe(false);
    expect(report.quarantined.map((item) => item.reason).sort()).toEqual([
      'json_parse_failed',
      'party_owner_missing',
    ]);
    expect(persistence.db.prepare('SELECT COUNT(*) AS count FROM migration_quarantine').get().count).toBe(2);
    expect(await fs.readFile(path.join(dir, 'users/usr_1/broken.json'), 'utf8')).toBe('{');
  });

  it('does not touch destination data during dry-run', async () => {
    await write('users/usr_1/profile.json', JSON.stringify({ id: 'usr_1' }));
    const report = await migrateFilesystemToSqlite({ dataDir: dir, persistence, dryRun: true });
    expect(report.mode).toBe('dry-run');
    expect(await persistence.dataStore.get('users/usr_1/profile')).toBeNull();
    expect(persistence.db.prepare('SELECT COUNT(*) AS count FROM migration_journal').get().count).toBe(0);
  });

  it('quarantines missing references and destination conflicts', async () => {
    await write('auth/identities/google/provider-1.json', JSON.stringify({ userId: 'usr_missing' }));
    await write('users/usr_1/profile.json', JSON.stringify({ id: 'usr_1', displayName: 'source' }));
    await persistence.dataStore.set('users/usr_1/profile', { id: 'usr_1', displayName: 'destination' });
    const report = await migrateFilesystemToSqlite({ dataDir: dir, persistence });

    expect(report.quarantined).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: 'auth/identities/google/provider-1.json', reason: 'reference_missing' }),
      expect.objectContaining({ sourcePath: 'users/usr_1/profile.json', reason: 'destination_conflict' }),
    ]));
    expect(await persistence.dataStore.get('users/usr_1/profile'))
      .toMatchObject({ displayName: 'destination' });
  });

  it('detects target drift in validate-only mode', async () => {
    await write('users/usr_1/profile.json', JSON.stringify({ id: 'usr_1', displayName: 'A' }));
    await migrateFilesystemToSqlite({ dataDir: dir, persistence });
    await persistence.dataStore.set('users/usr_1/profile', { id: 'usr_1', displayName: 'changed' });
    const report = await migrateFilesystemToSqlite({ dataDir: dir, persistence, validateOnly: true });
    expect(report.ok).toBe(false);
    expect(report.validationErrors).toEqual([
      { sourcePath: 'users/usr_1/profile.json', reason: 'target_mismatch' },
    ]);
  });

  it('imports legacy daily usage into atomic counters', async () => {
    await write('users/usr_1/usage/2026-08-02.json', JSON.stringify({ messages: 4, textTokens: 1200 }));
    await migrateFilesystemToSqlite({ dataDir: dir, persistence });
    expect(persistence.db.prepare(`
      SELECT used_units FROM usage_counters
      WHERE scope = 'user' AND owner_id = 'usr_1' AND day = '2026-08-02' AND kind = 'textTokens'
    `).get().used_units).toBe(1200);
  });
});
