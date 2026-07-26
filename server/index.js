import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessagesRouter } from './routes/messages.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createWorldsRouter } from './routes/worlds.js';
import { createCharactersRouter } from './routes/characters.js';
import { createScenariosRouter } from './routes/scenarios.js';
import { createCampaignsRouter } from './routes/campaigns.js';
import { createWorldContentRouter } from './routes/worldContent.js';
import { createRulesetsRouter } from './routes/rulesets.js';
import { createPublicContentRouter } from './routes/publicContent.js';
import { createPublishRouter } from './routes/publish.js';
import { createImportsRouter } from './routes/imports.js';
import { createConfigRouter } from './routes/config.js';
import { createSceneImagesRouter } from './routes/sceneImages.js';
import { createFsDataStore } from './storage/dataStore.js';
import { createFsTextStore } from './storage/textStore.js';
import { createFsImageStore } from './storage/imageStore.js';
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

function parseLimit(value, def) {
  const s = String(value ?? '').trim();
  if (s === '') return def;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

// セッションクッキーのSecure属性は`SECURE_COOKIES`で明示制御する。NODE_ENVは
// npmのdevDependencies省略やライブラリ側の最適化など無関係な意味を同時に背負って
// おり、セキュリティ設定の根拠にすると「ビルド都合でNODE_ENVを変えたらSecureが
// 黙って外れる」事故を招くため、専用の変数に分離している。
//
// 未設定時はBASE_URLのスキームから導く(Secure属性付きクッキーはHTTPSでしか
// 保存されないため、https=有効・http=無効以外に妥当な既定値がない)。
// 値が不正なときは起動を止める。タイプミスで黙ってSecureが外れる方が危険。
export function resolveSecureCookies(value, baseUrl) {
  const s = String(value ?? '').trim().toLowerCase();
  if (TRUE_VALUES.has(s)) return true;
  if (FALSE_VALUES.has(s)) return false;
  if (s !== '') {
    throw new Error(
      `SECURE_COOKIES must be one of true/false, 1/0, yes/no, on/off (got: ${value})`,
    );
  }
  return new URL(baseUrl).protocol === 'https:';
}

// ビルド済みフロント(dist/)の配信は`STATIC_DIR`が指定されたときだけ行う。
// 開発時はViteのdevサーバーが5173でフロントを配信し、/api・/auth だけを
// このサーバーへプロキシする(vite.config.js)ため、配信は不要。
// 相対パスはリポジトリルート基準で解決するので、本番では`STATIC_DIR=dist`でよい。
export function resolveStaticDir(value) {
  const s = String(value ?? '').trim();
  if (s === '') return null;
  return path.isAbsolute(s) ? s : path.join(__dirname, '..', s);
}

export function createApp({
  apiKey = process.env.ANTHROPIC_API_KEY,
  env = process.env,
  dataDir = env.DATA_DIR || path.join(__dirname, 'data'),
  fetchImpl = fetch,
  baseUrl = resolveBaseUrl(env.BASE_URL),
  secureCookies = resolveSecureCookies(env.SECURE_COOKIES, baseUrl),
  staticDir = resolveStaticDir(env.STATIC_DIR),
} = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  const dataStore = createFsDataStore(dataDir);
  const textStore = createFsTextStore(dataDir);
  const imageStore = createFsImageStore(dataDir);
  const geminiApiKey = env.GEMINI_API_KEY;
  const geminiModel = env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
  app.locals.dataStore = dataStore;
  app.locals.textStore = textStore;

  const providers = createProviders(env);
  const usage = createUsage({
    dataStore,
    limits: {
      messages: parseLimit(env.LIMIT_MESSAGES_PER_DAY, 200),
      novelize: parseLimit(env.LIMIT_NOVELIZE_PER_DAY, 10),
      images: parseLimit(env.LIMIT_IMAGES_PER_DAY, 30),
    },
  });

  // ミドルウェア順序が重要:
  // 1) originCheck はセッション有無に関わらず全ミューテーションを守る
  // 2) authRouter は /auth/*, /api/me, /api/auth/providers を認証なしで公開する
  //    (ここで先にマッチさせることで、直後の requireAuth の対象から除外される)
  // 3) publicContentRouter (公開ギャラリー閲覧) も authRouter の直後・requireAuth の前に
  //    マウントし、未認証での閲覧を許可する
  // 4) requireAuth 以降の /api/* はすべてログイン必須
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' };

  app.use(createOriginCheck({ baseUrl }));
  app.use(createAuthRouter({ dataStore, providers, baseUrl, fetchImpl, secureCookies }));
  app.use('/api', createPublicContentRouter({ dataStore, textStore })); // 公開ギャラリーは認証不要
  app.use('/api', createConfigRouter({ imageGenEnabled: !!geminiApiKey })); // 機能検出は認証不要
  app.use('/api', createRequireAuth({ dataStore, cookieOptions }));

  app.use('/api', createMessagesRouter({ apiKey, fetchImpl, usage }));
  app.use('/api', createSessionsRouter({ dataStore, textStore, imageStore, apiKey, fetchImpl, usage }));
  app.use('/api', createSceneImagesRouter({ dataStore, imageStore, anthropicApiKey: apiKey, geminiApiKey, geminiModel, fetchImpl, usage }));
  app.use('/api', createWorldsRouter({ dataStore, textStore }));
  app.use('/api', createCharactersRouter({ dataStore, textStore }));
  app.use('/api', createScenariosRouter({ dataStore, textStore }));
  app.use('/api', createCampaignsRouter({ dataStore }));
  app.use('/api', createWorldContentRouter({ textStore }));
  app.use('/api', createRulesetsRouter({ dataStore }));
  app.use('/api', createPublishRouter({ dataStore, textStore }));
  app.use('/api', createImportsRouter({ dataStore, textStore }));

  // 静的配信はAPIルーターより後にマウントする。先に置くと dist/ 側の
  // ファイル名と衝突したパスがAPIより優先されてしまうため。
  if (staticDir) {
    app.use(express.static(staticDir));
    // SPAフォールバック: クライアントルーティング用に、未知のGETへ index.html を返す。
    // /api・/auth 配下は対象外にして、存在しないAPIパスがHTMLで200を返すのを防ぐ
    // (認証必須APIの401もここで握り潰さない)。
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path === '/api' || req.path === '/auth') return next();
      if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return next();
      res.sendFile(path.join(staticDir, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
  }

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
