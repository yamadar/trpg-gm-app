import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  availableMigrationVersion,
  currentMigrationVersion,
  runMigrations,
} from './migrations.js';

const MIN_SQLITE_VERSION = '3.37.0';
const require = createRequire(import.meta.url);

function versionParts(version) {
  return String(version).split('.').map((part) => Number(part) || 0);
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function configureSqlite(db) {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA journal_mode = WAL');
}

export function openSqliteDatabase(filename, {
  migrate = true,
  migrationsDir,
  now = Date.now,
} = {}) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  // node:sqliteを選択時まで読み込まない。filesystem運用中の旧Node環境で、
  // 未使用driverのimportだけを理由に起動不能になるのを避ける。
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename);
  try {
    configureSqlite(db);
    const sqliteVersion = String(db.prepare('SELECT sqlite_version() AS version').get().version);
    if (compareVersions(sqliteVersion, MIN_SQLITE_VERSION) < 0) {
      throw new Error(`SQLite ${MIN_SQLITE_VERSION} or newer is required; found ${sqliteVersion}`);
    }
    if (migrate) runMigrations(db, { migrationsDir, now });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function sqliteReadiness(db) {
  const row = db.prepare('SELECT 1 AS ok').get();
  const migrationVersion = currentMigrationVersion(db);
  const expectedMigrationVersion = availableMigrationVersion();
  return {
    ok: Number(row?.ok) === 1 && migrationVersion === expectedMigrationVersion,
    sqliteVersion: String(db.prepare('SELECT sqlite_version() AS version').get().version),
    migrationVersion,
    expectedMigrationVersion,
  };
}
