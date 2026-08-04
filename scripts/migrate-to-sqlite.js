import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPersistence } from '../server/persistence/createPersistence.js';
import { migrateFilesystemToSqlite } from '../server/migration/filesystemToSqlite.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));

function option(name) {
  const prefix = `${name}=`;
  const value = [...args].find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

const dryRun = args.has('--dry-run');
const validateOnly = args.has('--validate-only');
if (dryRun && validateOnly) {
  console.error('--dry-run and --validate-only are mutually exclusive');
  process.exit(1);
}
if (!dryRun && !validateOnly && !args.has('--confirm-offline')) {
  console.error('refusing online migration: stop the app and pass --confirm-offline');
  process.exit(1);
}

const dataDir = path.resolve(option('--data-dir') || process.env.DATA_DIR || path.join(__dirname, '..', 'server', 'data'));
const configuredSqlitePath = option('--sqlite-path') || process.env.SQLITE_PATH || path.join(dataDir, 'gmdesk.sqlite3');
const sqlitePath = dryRun ? ':memory:' : path.resolve(configuredSqlitePath);
const reportPath = option('--report');
const legacyOwnerId = option('--legacy-owner');
if (legacyOwnerId && !/^usr_[0-9a-f]{16}$/.test(legacyOwnerId)) {
  console.error('--legacy-owner must match usr_xxxxxxxxxxxxxxxx');
  process.exit(1);
}
const persistence = createPersistence({ driver: 'sqlite', dataDir, sqlitePath });

try {
  const report = await migrateFilesystemToSqlite({
    dataDir,
    persistence,
    dryRun,
    validateOnly,
    legacyOwnerId,
    allowSupersededLegacy: args.has('--accept-superseded-legacy'),
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
  persistence.close();
}
