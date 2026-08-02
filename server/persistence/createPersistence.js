import path from 'node:path';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { createFsImageStore } from '../storage/imageStore.js';
import { openSqliteDatabase, sqliteReadiness } from '../infrastructure/sqlite/database.js';
import { createSqliteDataStore } from '../infrastructure/sqlite/dataStore.js';
import { createSqliteTextStore } from '../infrastructure/sqlite/textStore.js';
import { createSqliteCoordinator } from '../infrastructure/sqlite/coordinator.js';
import { createFileUsageRepository, createSqliteUsageRepository } from './usageRepository.js';
import { createKeyedLock } from '../keyedLock.js';

export const DATABASE_DRIVERS = new Set(['filesystem', 'sqlite']);

export function resolveDatabaseDriver(value) {
  const driver = String(value || 'filesystem').trim().toLowerCase();
  if (!DATABASE_DRIVERS.has(driver)) {
    throw new Error(`DATABASE_DRIVER must be filesystem or sqlite (got: ${value})`);
  }
  return driver;
}

export function resolveSqlitePath(value, dataDir) {
  const configured = String(value || '').trim();
  if (!configured) return path.join(dataDir, 'gmdesk.sqlite3');
  return path.isAbsolute(configured) ? configured : path.resolve(configured);
}

export function createPersistence({
  driver = 'filesystem',
  dataDir,
  sqlitePath,
  mediaDir = dataDir,
} = {}) {
  const selected = resolveDatabaseDriver(driver);
  const imageStore = createFsImageStore(mediaDir);
  if (selected === 'filesystem') {
    const dataStore = createFsDataStore(dataDir);
    const withTransactionLock = createKeyedLock();
    const transaction = (operation) => withTransactionLock('filesystem-transaction', operation);
    return {
      driver: selected,
      dataStore,
      textStore: createFsTextStore(dataDir),
      imageStore,
      transaction,
      repositories: {
        usage: createFileUsageRepository({ dataStore, transaction }),
      },
      metrics: () => ({}),
      readiness: () => ({ ok: true, driver: selected, migrationVersion: null }),
      close() {},
    };
  }

  const filename = resolveSqlitePath(sqlitePath, dataDir);
  const db = openSqliteDatabase(filename);
  const coordinator = createSqliteCoordinator(db);
  return {
    driver: selected,
    sqlitePath: filename,
    db,
    dataStore: createSqliteDataStore(db, { coordinator }),
    textStore: createSqliteTextStore(db, { coordinator }),
    imageStore,
    transaction: coordinator.transaction,
    repositories: {
      usage: createSqliteUsageRepository({ db, coordinator }),
    },
    metrics: coordinator.snapshotMetrics,
    readiness: () => ({ driver: selected, ...sqliteReadiness(db) }),
    close: () => db.close(),
  };
}
