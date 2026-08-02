import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTextOperationsRouter } from './routes/textOperations.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createEndingsRouter } from './routes/endings.js';
import { createWorldsRouter } from './routes/worlds.js';
import { createCharactersRouter } from './routes/characters.js';
import { createScenariosRouter } from './routes/scenarios.js';
import { createCampaignsRouter } from './routes/campaigns.js';
import { createPartySessionsRouter } from './routes/partySessions.js';
import { createWorldContentRouter } from './routes/worldContent.js';
import { createRulesetsRouter } from './routes/rulesets.js';
import { createPublicContentRouter } from './routes/publicContent.js';
import { createPublishRouter } from './routes/publish.js';
import { createImportsRouter } from './routes/imports.js';
import { createConfigRouter } from './routes/config.js';
import { createSceneImagesRouter } from './routes/sceneImages.js';
import { createAttachmentsRouter } from './routes/attachments.js';
import { createNovelJobRunner } from './novelJobs.js';
import { seedStarters } from './starters/seed.js';
import { createFsDataStore } from './storage/dataStore.js';
import { createFsTextStore } from './storage/textStore.js';
import { createFsImageStore } from './storage/imageStore.js';
import { createStorageGuard, createStorageOwnerResolver } from './storage/storageGuard.js';
import { createProviders } from './auth/providers.js';
import { createAuthRouter } from './auth/routes.js';
import { createRequireAuth, createOriginCheck } from './auth/middleware.js';
import { createUsage } from './auth/usage.js';
import { analyzeScenarioForPlay } from './scenarioAnalysis.js';
import {
  reconcileCampaignChapter,
  generateCampaignPitches,
  generateCampaignScenario,
} from './campaignGeneration.js';
import { generatePartyResolution } from './partyGeneration.js';
import { createPartyService } from './partyService.js';
import { createKeyedLock } from './keyedLock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE_URL = 'http://localhost:5173';
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "manifest-src 'self'",
].join('; ');

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
}

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
  env = process.env,
  apiKey = env.GEMINI_TEXT_API_KEY,
  dataDir = env.DATA_DIR || path.join(__dirname, 'data'),
  fetchImpl = fetch,
  baseUrl = resolveBaseUrl(env.BASE_URL),
  secureCookies = resolveSecureCookies(env.SECURE_COOKIES, baseUrl),
  staticDir = resolveStaticDir(env.STATIC_DIR),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(express.json({ limit: '2mb' }));

  const dataStore = createFsDataStore(dataDir);
  const textStore = createFsTextStore(dataDir);
  const imageStore = createFsImageStore(dataDir);
  const textModel = String(env.GEMINI_TEXT_MODEL || '').trim();
  const geminiImageApiKey = env.GEMINI_IMAGE_API_KEY;
  const geminiImageModel = String(env.GEMINI_IMAGE_MODEL || '').trim();
  if (apiKey && !textModel) {
    throw new Error('GEMINI_TEXT_MODEL must be configured when GEMINI_TEXT_API_KEY is set');
  }
  if (geminiImageApiKey && !geminiImageModel) {
    throw new Error('GEMINI_IMAGE_MODEL must be configured when GEMINI_IMAGE_API_KEY is set');
  }
  app.locals.dataStore = dataStore;
  app.locals.textStore = textStore;

  const providers = createProviders(env);
  const usage = createUsage({
    dataStore,
    limits: {
      messages: parseLimit(env.LIMIT_MESSAGES_PER_DAY, 200),
      textTokens: parseLimit(env.LIMIT_TEXT_TOKENS_PER_DAY, 500_000),
      novelize: parseLimit(env.LIMIT_NOVELIZE_PER_DAY, 10),
      images: parseLimit(env.LIMIT_IMAGES_PER_DAY, 30),
    },
    globalLimits: {
      textTokens: parseLimit(env.LIMIT_GLOBAL_TEXT_TOKENS_PER_DAY, 5_000_000),
    },
  });
  const novelJobs = createNovelJobRunner({ dataStore, textStore, apiKey, model: textModel, fetchImpl });
  const withSessionLock = createKeyedLock();

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
  app.use('/api', createPublicContentRouter({ dataStore, textStore, imageStore })); // 公開ギャラリーは認証不要
  app.use('/api', createConfigRouter({ imageGenEnabled: !!geminiImageApiKey })); // 機能検出は認証不要
  app.use('/api', createRequireAuth({ dataStore, cookieOptions }));
  app.use('/api', createStorageGuard({
    dataDir,
    maxUserBytes: parseLimit(env.MAX_USER_STORAGE_BYTES, 256 * 1024 * 1024),
    minFreeBytes: parseLimit(env.MIN_FREE_STORAGE_BYTES, 256 * 1024 * 1024),
    writeHeadroomBytes: parseLimit(env.STORAGE_WRITE_HEADROOM_BYTES, 12 * 1024 * 1024),
    ownerIdForRequest: createStorageOwnerResolver({ dataStore }),
  }));

  app.use('/api', createTextOperationsRouter({
    apiKey,
    model: textModel,
    fetchImpl,
    usage,
    maxConcurrent: parseLimit(env.LIMIT_TEXT_CONCURRENT, 6),
  }));
  app.use('/api', createSessionsRouter({
    dataStore,
    textStore,
    imageStore,
    apiKey,
    novelJobs,
    usage,
    withSessionLock,
  }));
  const partyService = createPartyService({
    dataStore,
    usage,
    generator: apiKey
      ? (args) => generatePartyResolution({
          ...args,
          apiKey,
          model: textModel,
          fetchImpl,
        })
      : null,
  });
  app.locals.partyService = partyService;
  app.use('/api', createPartySessionsRouter({ service: partyService }));
  app.use('/api', createEndingsRouter({ dataStore, apiKey, model: textModel, fetchImpl, usage }));
  app.use('/api', createSceneImagesRouter({
    dataStore,
    imageStore,
    geminiTextApiKey: apiKey,
    geminiTextModel: textModel,
    geminiImageApiKey,
    geminiImageModel,
    fetchImpl,
    usage,
    withSessionLock,
  }));
  app.use('/api', createAttachmentsRouter({ dataStore, textStore, imageStore }));
  app.use('/api', createWorldsRouter({ dataStore, textStore, imageStore }));
  app.use('/api', createCharactersRouter({ dataStore, textStore, imageStore }));
  app.use('/api', createScenariosRouter({
    dataStore,
    textStore,
    imageStore,
    usage,
    scenarioAnalyzer: apiKey
      ? ({ title, raw }) => analyzeScenarioForPlay({
          title,
          raw,
          apiKey,
          model: textModel,
          fetchImpl,
        })
      : null,
  }));
  const campaignGenerator = apiKey
    ? {
        reconcile: (args) => reconcileCampaignChapter({
          ...args,
          apiKey,
          model: textModel,
          fetchImpl,
        }),
        pitches: (args) => generateCampaignPitches({
          ...args,
          apiKey,
          model: textModel,
          fetchImpl,
        }),
        scenario: (args) => generateCampaignScenario({
          ...args,
          apiKey,
          model: textModel,
          fetchImpl,
        }),
      }
    : null;
  app.use('/api', createCampaignsRouter({
    dataStore,
    textStore,
    generator: campaignGenerator,
    usage,
  }));
  app.use('/api', createWorldContentRouter({ dataStore, textStore }));
  app.use('/api', createRulesetsRouter({ dataStore }));
  app.use('/api', createPublishRouter({ dataStore, textStore, imageStore }));
  app.use('/api', createImportsRouter({ dataStore, textStore, imageStore }));

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
    const requestId = crypto.randomUUID();
    const rawStatus = typeof err?.status === 'number'
      ? err.status
      : typeof err?.statusCode === 'number'
        ? err.statusCode
        : 500;
    const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
    // 本文、query、Cookie、Authorization、例外message/stackをログ対象にしない。
    // requestIdでクライアント報告と安全な最小メタデータを対応付ける。
    console.error('request failed', {
      requestId,
      method: req.method,
      path: req.path,
      status,
      errorName: err?.name || 'Error',
      errorCode: err?.code || null,
    });
    if (status >= 500) {
      const upstream = status === 502 || status === 503;
      res.status(status).json({
        error: upstream ? 'upstream service error' : 'internal server error',
        code: upstream ? 'UPSTREAM_ERROR' : 'INTERNAL_SERVER_ERROR',
        requestId,
      });
      return;
    }
    const publicErrors = {
      400: ['bad request', 'BAD_REQUEST'],
      401: ['login required', 'UNAUTHORIZED'],
      403: ['forbidden', 'FORBIDDEN'],
      404: ['not found', 'NOT_FOUND'],
      409: ['conflict', 'CONFLICT'],
      413: ['request too large', 'REQUEST_TOO_LARGE'],
      429: ['too many requests', 'TOO_MANY_REQUESTS'],
    };
    const [error, code] = publicErrors[status] || ['request failed', 'REQUEST_FAILED'];
    res.status(status).json({ error, code, requestId });
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 8787;
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  // server/data/ はgitignore対象でデプロイ先では空から始まりうる。冪等なので毎回走らせて復元する。
  // 失敗してもアプリ自体は動くべきなので、ログだけ出して起動を続ける。
  seedStarters(createFsDataStore(dataDir), createFsTextStore(dataDir), {
    imageStore: createFsImageStore(dataDir),
  })
    .then((m) => console.log(`seeded ${m.packs.length} starter packs`))
    .catch((error) => console.error('starter seed failed', {
      name: error?.name || 'Error',
      code: error?.code || null,
    }))
    .finally(() => {
      createApp().listen(port, () => {
        console.log(`server listening on port ${port}`);
      });
    });
}
