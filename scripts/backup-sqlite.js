import 'dotenv/config';
import path from 'node:path';
import { createSqliteBackup } from '../server/infrastructure/sqlite/backup.js';

const args = new Set(process.argv.slice(2));

function option(name) {
  const prefix = `${name}=`;
  const value = [...args].find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

const output = option('--output');
if (!output) {
  console.error('usage: npm run backup:sqlite -- --output=/safe/path/snapshot.sqlite3 [--sqlite-path=/data/gmdesk.sqlite3] [--overwrite]');
  process.exit(1);
}

const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'server', 'data'));
const sourcePath = path.resolve(option('--sqlite-path') || process.env.SQLITE_PATH || path.join(dataDir, 'gmdesk.sqlite3'));
const destinationPath = path.resolve(output);
const report = await createSqliteBackup({
  sourcePath,
  destinationPath,
  overwrite: args.has('--overwrite'),
});
console.log(JSON.stringify(report, null, 2));
