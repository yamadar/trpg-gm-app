// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openSqliteDatabase } from './database.js';
import {
  availableMigrationVersion,
  currentMigrationVersion,
  DEFAULT_MIGRATIONS_DIR,
  runMigrations,
} from './migrations.js';

const dirs = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('SQLite migrations', () => {
  it('applies numbered migrations once and records checksums', () => {
    const db = openSqliteDatabase(':memory:');
    const version = currentMigrationVersion(db);
    expect(version).toBe(availableMigrationVersion());
    expect(version).toBeGreaterThanOrEqual(1);
    expect(runMigrations(db).currentVersion).toBe(version);
    expect(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count).toBe(version);
    db.close();
  });

  it('rejects a changed migration checksum', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-migrations-'));
    dirs.push(dir);
    await fs.writeFile(path.join(dir, '001_test.sql'), 'CREATE TABLE sample(id INTEGER PRIMARY KEY) STRICT;');
    const db = openSqliteDatabase(':memory:', { migrationsDir: dir });
    await fs.writeFile(path.join(dir, '001_test.sql'), 'CREATE TABLE changed(id INTEGER PRIMARY KEY) STRICT;');
    expect(() => runMigrations(db, { migrationsDir: dir })).toThrow(/checksum mismatch/);
    db.close();
  });

  it('backfills existing media ledger rows into ready assets and bindings', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-media-backfill-'));
    dirs.push(dir);
    const legacyMigrations = path.join(dir, 'migrations');
    await fs.mkdir(legacyMigrations);
    for (const name of (await fs.readdir(DEFAULT_MIGRATIONS_DIR)).filter((name) => /^00[1-5]_/.test(name))) {
      await fs.copyFile(path.join(DEFAULT_MIGRATIONS_DIR, name), path.join(legacyMigrations, name));
    }
    const db = openSqliteDatabase(':memory:', { migrationsDir: legacyMigrations });
    db.prepare(`
      INSERT INTO storage_items(item_type, resource_key, owner_id, charged_bytes, updated_at_ms)
      VALUES ('media', 'users/usr_owner/images/a.webp', 'usr_owner', 42, 100)
    `).run();
    db.prepare(`
      INSERT INTO domain_records(
        key, module, resource_type, owner_id, value_json, logical_bytes, revision, updated_at_ms
      ) VALUES (
        'users/usr_owner/sessions/s1', 'sessions', 'session', 'usr_owner',
        '{"id":"s1","title":"Before upgrade","_sync":{"revision":4}}', 68, 4, 100
      )
    `).run();
    db.prepare(`
      INSERT INTO documents(path, module, resource_type, owner_id, content, logical_bytes, updated_at_ms)
      VALUES ('users/usr_owner/worlds/w1/world.md', 'library', 'library-document', 'usr_owner', '# World', 7, 100)
    `).run();

    runMigrations(db);
    expect(db.prepare('SELECT * FROM media_assets').get()).toMatchObject({
      id: 'legacy:users/usr_owner/images/a.webp',
      object_key: 'users/usr_owner/images/a.webp',
      state: 'ready',
      byte_size: 42,
    });
    expect(db.prepare('SELECT * FROM media_bindings').get()).toMatchObject({
      resource_key: 'users/usr_owner/images/a.webp',
      asset_id: 'legacy:users/usr_owner/images/a.webp',
    });
    expect(db.prepare("SELECT charged_bytes FROM storage_items WHERE item_type = 'media'").get().charged_bytes)
      .toBe(42);
    expect(db.prepare('SELECT entity_id, title, revision FROM session_records').get()).toEqual({
      entity_id: 's1',
      title: 'Before upgrade',
      revision: 4,
    });
    expect(db.prepare('SELECT content FROM library_documents').get().content).toBe('# World');
    db.close();
  });
});
