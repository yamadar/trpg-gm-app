import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessagesRouter } from './routes/messages.js';
import { createFsDataStore } from './storage/dataStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({
  apiKey = process.env.ANTHROPIC_API_KEY,
  dataDir = path.join(__dirname, 'data'),
  fetchImpl = fetch,
} = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const dataStore = createFsDataStore(dataDir);
  app.locals.dataStore = dataStore;

  app.use('/api', createMessagesRouter({ apiKey, fetchImpl }));

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 8787;
  createApp().listen(port, () => {
    console.log(`server listening on port ${port}`);
  });
}
