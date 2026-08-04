import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createS3ObjectStorage } from '../server/infrastructure/objectStorage/s3ObjectStorage.js';
import { migrateMediaObjects } from '../server/migration/objectStorageMigration.js';
import { createPersistence } from '../server/persistence/createPersistence.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));

function option(name) {
  const prefix = `${name}=`;
  const value = [...args].find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function booleanOption(name, fallback = false) {
  const value = option(name);
  if (value == null) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) return false;
  throw new Error(`${name} must be true or false`);
}

const dryRun = args.has('--dry-run');
const validateOnly = args.has('--validate-only');
if (dryRun && validateOnly) {
  console.error('--dry-run and --validate-only are mutually exclusive');
  process.exit(1);
}
if (!dryRun && !validateOnly && !args.has('--confirm-offline')) {
  console.error('refusing online media migration: stop writes and pass --confirm-offline');
  process.exit(1);
}

const dataDir = path.resolve(option('--data-dir') || process.env.DATA_DIR || path.join(__dirname, '..', 'server', 'data'));
const mediaDir = path.resolve(option('--media-dir') || process.env.MEDIA_DIR || dataDir);
const sqlitePath = path.resolve(option('--sqlite-path') || process.env.SQLITE_PATH || path.join(dataDir, 'gmdesk.sqlite3'));
const reportPath = option('--report');
const bucket = option('--bucket') || process.env.OBJECT_STORAGE_BUCKET;
const region = option('--region') || process.env.OBJECT_STORAGE_REGION;
const endpoint = option('--endpoint') || process.env.OBJECT_STORAGE_ENDPOINT;
const prefix = option('--prefix') || process.env.OBJECT_STORAGE_PREFIX;
const forcePathStyle = booleanOption(
  '--force-path-style',
  ['1', 'true', 'yes', 'on'].includes(String(process.env.OBJECT_STORAGE_FORCE_PATH_STYLE || '').toLowerCase()),
);

const persistence = createPersistence({
  driver: 'sqlite',
  dataDir,
  sqlitePath,
  mediaDir,
  objectStorageDriver: 'filesystem',
});
let targetStorage;

try {
  targetStorage = createS3ObjectStorage({ bucket, region, endpoint, prefix, forcePathStyle });
  const report = await migrateMediaObjects({
    persistence,
    sourceStorage: persistence.objectStorage,
    targetStorage,
    dryRun,
    validateOnly,
  });
  const serialized = JSON.stringify(report, null, 2);
  if (reportPath) {
    const absoluteReportPath = path.resolve(reportPath);
    await fs.mkdir(path.dirname(absoluteReportPath), { recursive: true });
    await fs.writeFile(absoluteReportPath, `${serialized}\n`, 'utf8');
  }
  console.log(serialized);
  if (!report.ok) process.exitCode = 2;
} finally {
  targetStorage?.close();
  persistence.close();
}
