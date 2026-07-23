import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessagesRouter } from './routes/messages.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createWorldsRouter } from './routes/worlds.js';
import { createCharactersRouter } from './routes/characters.js';
import { createScenariosRouter } from './routes/scenarios.js';
import { createWorldContentRouter } from './routes/worldContent.js';
import { createRulesetsRouter } from './routes/rulesets.js';
import { createFsDataStore } from './storage/dataStore.js';
import { createFsTextStore } from './storage/textStore.js';
import { createProviders } from './auth/providers.js';
import { createAuthRouter } from './auth/routes.js';
import { createRequireAuth, createOriginCheck } from './auth/middleware.js';
import { createUsage } from './auth/usage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE_URL = 'http://localhost:5173';

// env.BASE_URL is only trusted when it's a well-formed absolute URL. This
// guards against tooling that injects unrelated values into process.env
// under the same name (e.g. Vite/Vitest copy their own import.meta.env.BASE_URL
// define, which defaults to "/", into process.env.BASE_URL when the test
// runner resolves vite.config.js) — a bare "/" is not a usable origin for
// the origin-check middleware and must not silently break the server.
function resolveBaseUrl(candidate) {
  if (!candidate) return DEFAULT_BASE_URL;
  try {
    return new URL(candidate).origin !== 'null' ? candidate : DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

export function createApp({
  apiKey = process.env.ANTHROPIC_API_KEY,
  env = process.env,
  dataDir = env.DATA_DIR || path.join(__dirname, 'data'),
  fetchImpl = fetch,
  baseUrl = resolveBaseUrl(env.BASE_URL),
  secureCookies = env.NODE_ENV === 'production',
} = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  const dataStore = createFsDataStore(dataDir);
  const textStore = createFsTextStore(dataDir);
  app.locals.dataStore = dataStore;
  app.locals.textStore = textStore;

  const providers = createProviders(env);
  const usage = createUsage({
    dataStore,
    limits: {
      messages: Number(env.LIMIT_MESSAGES_PER_DAY) || 200,
      novelize: Number(env.LIMIT_NOVELIZE_PER_DAY) || 10,
    },
  });

  // ミドルウェア順序が重要:
  // 1) originCheck はセッション有無に関わらず全ミューテーションを守る
  // 2) authRouter は /auth/*, /api/me, /api/auth/providers を認証なしで公開する
  //    (ここで先にマッチさせることで、直後の requireAuth の対象から除外される)
  // 3) requireAuth 以降の /api/* はすべてログイン必須
  app.use(createOriginCheck({ baseUrl }));
  app.use(createAuthRouter({ dataStore, providers, baseUrl, fetchImpl, secureCookies }));
  app.use('/api', createRequireAuth({ dataStore }));

  app.use('/api', createMessagesRouter({ apiKey, fetchImpl, usage }));
  app.use('/api', createSessionsRouter({ dataStore, textStore, apiKey, fetchImpl, usage }));
  app.use('/api', createWorldsRouter({ dataStore, textStore }));
  app.use('/api', createCharactersRouter({ dataStore, textStore }));
  app.use('/api', createScenariosRouter({ dataStore, textStore }));
  app.use('/api', createWorldContentRouter({ textStore }));
  app.use('/api', createRulesetsRouter({ dataStore }));

  app.use((err, req, res, next) => {
    console.error(err);
    const status = typeof err.status === 'number' ? err.status : typeof err.statusCode === 'number' ? err.statusCode : 500;
    res.status(status).json({ error: err.message || 'internal server error' });
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 8787;
  createApp().listen(port, () => {
    console.log(`server listening on port ${port}`);
  });
}
