import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));
const MIGRATION_FILE_RE = /^(\d+)_.*\.sql$/;

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function loadMigrations(migrationsDir) {
  const migrations = fs.readdirSync(migrationsDir)
    .filter((name) => MIGRATION_FILE_RE.test(name))
    .sort((a, b) => Number(a.match(MIGRATION_FILE_RE)[1]) - Number(b.match(MIGRATION_FILE_RE)[1]))
    .map((name) => {
      const version = Number(name.match(MIGRATION_FILE_RE)[1]);
      const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
      return { version, name, sql, checksum: checksum(sql) };
    });
  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`duplicate SQLite migration version ${migration.version}`);
    }
    versions.add(migration.version);
  }
  return migrations;
}

export function availableMigrationVersion(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  return loadMigrations(migrationsDir).at(-1)?.version ?? 0;
}

export function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY CHECK (version > 0),
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms >= 0)
    ) STRICT
  `);
}

export function runMigrations(db, {
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  now = Date.now,
} = {}) {
  ensureMigrationTable(db);
  const migrations = loadMigrations(migrationsDir);
  const applied = new Map(
    db.prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => [Number(row.version), row]),
  );

  for (const migration of migrations) {
    const existing = applied.get(migration.version);
    if (existing) {
      if (existing.name !== migration.name || existing.checksum !== migration.checksum) {
        throw new Error(`SQLite migration ${migration.version} checksum mismatch`);
      }
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare(`
        INSERT INTO schema_migrations(version, name, checksum, applied_at_ms)
        VALUES (?, ?, ?, ?)
      `).run(migration.version, migration.name, migration.checksum, now());
      db.exec('COMMIT');
      applied.set(migration.version, {
        version: migration.version,
        name: migration.name,
        checksum: migration.checksum,
      });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return {
    currentVersion: migrations.at(-1)?.version ?? 0,
    appliedVersions: [...applied.keys()].sort((a, b) => a - b),
    availableVersions: migrations.map((migration) => migration.version),
  };
}

export function currentMigrationVersion(db) {
  ensureMigrationTable(db);
  return Number(db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get().version);
}

export { DEFAULT_MIGRATIONS_DIR };
