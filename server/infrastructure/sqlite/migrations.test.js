// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openSqliteDatabase } from './database.js';
import { availableMigrationVersion, currentMigrationVersion, runMigrations } from './migrations.js';

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
});
