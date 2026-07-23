import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateLegacyData } from '../server/storage/migrateLegacyData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userId = process.argv[2];
if (!userId || !/^usr_[0-9a-f]{16}$/.test(userId)) {
  console.error('usage: node scripts/migrate-legacy-data.js <usr_xxxxxxxxxxxxxxxx>');
  process.exit(1);
}
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'server', 'data');
const moved = await migrateLegacyData(dataDir, userId);
console.log(moved.length ? `moved: ${moved.join(', ')} -> users/${userId}/` : 'nothing to migrate');
