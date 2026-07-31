import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedStarters } from '../server/starters/seed.js';
import { createFsDataStore } from '../server/storage/dataStore.js';
import { createFsTextStore } from '../server/storage/textStore.js';
import { createFsImageStore } from '../server/storage/imageStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'server', 'data');

const manifest = await seedStarters(createFsDataStore(dataDir), createFsTextStore(dataDir), {
  imageStore: createFsImageStore(dataDir),
});
console.log(`seeded ${manifest.packs.length} starter packs into ${dataDir}`);
