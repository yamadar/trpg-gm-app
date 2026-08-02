import path from 'node:path';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { createFilesystemObjectStorage } from '../infrastructure/objectStorage/filesystemObjectStorage.js';
import { createS3ObjectStorage } from '../infrastructure/objectStorage/s3ObjectStorage.js';
import { openSqliteDatabase, sqliteReadiness } from '../infrastructure/sqlite/database.js';
import { createSqliteCoordinator } from '../infrastructure/sqlite/coordinator.js';
import { createFileUsageRepository, createSqliteUsageRepository } from './usageRepository.js';
import { createSqliteStorageRepository } from './storageRepository.js';
import { createFileJobRepository, createSqliteJobRepository } from './jobRepository.js';
import {
  createSqliteMediaOwnerResolver,
  createSqliteMediaRepository,
} from './mediaRepository.js';
import { createManagedImageStore, reconcileMediaAssets } from './managedImageStore.js';
import {
  createFileModuleRepositories,
  createScopedModuleStores,
  createSqliteModulePersistence,
} from './moduleRepository.js';
import { createKeyedLock } from '../keyedLock.js';

export const DATABASE_DRIVERS = new Set(['filesystem', 'sqlite']);
export const OBJECT_STORAGE_DRIVERS = new Set(['filesystem', 's3']);

export function resolveDatabaseDriver(value) {
  const driver = String(value || 'filesystem').trim().toLowerCase();
  if (!DATABASE_DRIVERS.has(driver)) {
    throw new Error(`DATABASE_DRIVER must be filesystem or sqlite (got: ${value})`);
  }
  return driver;
}

export function resolveObjectStorageDriver(value) {
  const driver = String(value || 'filesystem').trim().toLowerCase();
  if (!OBJECT_STORAGE_DRIVERS.has(driver)) {
    throw new Error(`OBJECT_STORAGE_DRIVER must be filesystem or s3 (got: ${value})`);
  }
  return driver;
}

function resolveBoolean(value, name) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be true or false (got: ${value})`);
}

export function resolveSqlitePath(value, dataDir) {
  const configured = String(value || '').trim();
  if (!configured) return path.join(dataDir, 'gmdesk.sqlite3');
  if (configured === ':memory:') return configured;
  return path.isAbsolute(configured) ? configured : path.resolve(configured);
}

export function createPersistence({
  driver = 'filesystem',
  dataDir,
  sqlitePath,
  mediaDir = dataDir,
  objectStorageDriver = 'filesystem',
  objectStorageBucket,
  objectStorageRegion,
  objectStorageEndpoint,
  objectStoragePrefix,
  objectStorageForcePathStyle = false,
  objectStorageClient,
} = {}) {
  const selected = resolveDatabaseDriver(driver);
  const selectedObjectStorage = resolveObjectStorageDriver(objectStorageDriver);
  if (selectedObjectStorage === 's3' && selected !== 'sqlite') {
    throw new Error('OBJECT_STORAGE_DRIVER=s3 requires DATABASE_DRIVER=sqlite for durable media accounting');
  }
  const objectStorage = selectedObjectStorage === 's3'
    ? createS3ObjectStorage({
        bucket: objectStorageBucket,
        region: objectStorageRegion,
        endpoint: objectStorageEndpoint,
        prefix: objectStoragePrefix,
        forcePathStyle: resolveBoolean(objectStorageForcePathStyle, 'OBJECT_STORAGE_FORCE_PATH_STYLE'),
        client: objectStorageClient,
      })
    : createFilesystemObjectStorage(mediaDir);
  if (selected === 'filesystem') {
    const dataStore = createFsDataStore(dataDir);
    const textStore = createFsTextStore(dataDir);
    const withTransactionLock = createKeyedLock();
    const transaction = (operation) => withTransactionLock('filesystem-transaction', operation);
    const modules = createFileModuleRepositories({ dataStore, textStore, transaction });
    const scopes = createApplicationScopes(modules);
    return {
      driver: selected,
      objectStorageDriver: selectedObjectStorage,
      objectStorage,
      dataStore,
      textStore,
      imageStore: objectStorage,
      transaction,
      repositories: {
        usage: createFileUsageRepository({ dataStore, transaction }),
        jobs: createFileJobRepository({ dataStore, transaction }),
        modules,
      },
      scopes,
      auditModules: async () => ({ ok: true, driver: 'filesystem' }),
      metrics: () => ({}),
      reconcileMedia: async () => ({ found: 0, activated: 0, failed: 0, deleted: 0 }),
      readiness: () => ({
        ok: true,
        driver: selected,
        objectStorageDriver: selectedObjectStorage,
        migrationVersion: null,
        expectedMigrationVersion: null,
      }),
      close: () => objectStorage.close(),
    };
  }

  const filename = resolveSqlitePath(sqlitePath, dataDir);
  const db = openSqliteDatabase(filename);
  const coordinator = createSqliteCoordinator(db);
  const modulePersistence = createSqliteModulePersistence(db, { coordinator });
  const scopes = createApplicationScopes(modulePersistence.modules);
  const storageRepository = createSqliteStorageRepository({ db, coordinator });
  const mediaRepository = createSqliteMediaRepository({ db, coordinator });
  const imageStore = createManagedImageStore({
    objectStorage,
    mediaRepository,
    ownerForResource: createSqliteMediaOwnerResolver(db),
  });
  return {
    driver: selected,
    objectStorageDriver: selectedObjectStorage,
    objectStorage,
    sqlitePath: filename,
    db,
    dataStore: modulePersistence.dataStore,
    textStore: modulePersistence.textStore,
    imageStore,
    transaction: coordinator.transaction,
    repositories: {
      usage: createSqliteUsageRepository({ db, coordinator }),
      storage: storageRepository,
      media: mediaRepository,
      jobs: createSqliteJobRepository({ db, coordinator }),
      modules: modulePersistence.modules,
    },
    scopes,
    auditModules: modulePersistence.audit,
    reconcileMedia: () => reconcileMediaAssets({ objectStorage, mediaRepository }),
    metrics: coordinator.snapshotMetrics,
    readiness: () => ({
      driver: selected,
      objectStorageDriver: selectedObjectStorage,
      ...sqliteReadiness(db),
    }),
    close: () => {
      try {
        objectStorage.close();
      } finally {
        db.close();
      }
    },
  };
}

function createApplicationScopes(modules) {
  const scope = (...names) => createScopedModuleStores(modules, names);
  return {
    auth: scope('auth'),
    publicRead: scope('publishing', 'auth'),
    sessions: scope('sessions', 'jobs', 'publishing'),
    party: scope('party', 'auth', 'sessions', 'campaigns'),
    endings: scope('sessions'),
    sceneImages: scope('sessions'),
    attachments: scope('library', 'auth'),
    library: scope('library', 'publishing'),
    worldContent: scope('library'),
    rulesets: scope('library'),
    campaigns: scope('campaigns', 'sessions', 'library'),
    publishing: scope('publishing', 'library', 'sessions', 'auth'),
    imports: scope('publishing', 'library', 'auth'),
  };
}
