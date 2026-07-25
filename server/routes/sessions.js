import { Router } from 'express';
import {
  sessionKey,
  sessionNovelDocPath,
  sessionNovelMetaKey,
  sessionListPrefix,
  sessionImagePath,
} from '../storage/paths.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { stripImageMarkers } from '../novelMarkers.js';
import { buildIllustratedMarkdown } from '../illustratedNovel.js';

// 生成後にセッションが進んでいれば、保存済みの小説は古い。
function isStale(meta, session) {
  const currentTurn = session?.state?.turn_count ?? null;
  if (!meta || meta.turnCount == null || currentTurn == null) return false;
  return meta.turnCount !== currentTurn;
}

export function createSessionsRouter({ dataStore, textStore, imageStore, apiKey, novelJobs, usage }) {
  const router = Router();
  router.param('id', idParamGuard);

  router.get('/sessions', asyncHandler(async (req, res) => {
    const keys = await dataStore.list(sessionListPrefix(req.userId));
    const sessions = await Promise.all(keys.map((k) => dataStore.get(k)));
    res.json(sessions.filter(Boolean));
  }));

  // 一覧画面が全セッションのジョブ状態を1リクエストで取れるようにする
  // (セッションごとのポーリングだと件数分のリクエストが必要になるため)。
  router.get('/novel-jobs', asyncHandler(async (req, res) => {
    const keys = await dataStore.list(sessionListPrefix(req.userId));
    const out = {};
    for (const key of keys) {
      const id = key.slice(key.lastIndexOf('/') + 1);
      const { status, error, elapsedMs } = await novelJobs.read(req.userId, id);
      const text = await textStore.read(sessionNovelDocPath(req.userId, id));
      const meta = await dataStore.get(sessionNovelMetaKey(req.userId, id));
      const session = await dataStore.get(key);
      out[id] = {
        status,
        error,
        // 実行中のみ数値。クライアントはこれを起点に秒を補間して表示する。
        elapsedMs,
        hasNovel: text !== null,
        stale: isStale(meta, session),
        // この変更以前に生成された小説のメタにはtruncatedが無い。完結扱いにする。
        truncated: meta?.truncated === true,
      };
    }
    res.json(out);
  }));

  router.get('/sessions/:id', asyncHandler(async (req, res) => {
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json(session);
  }));

  router.put('/sessions/:id', asyncHandler(async (req, res) => {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      res.status(400).json({ error: 'session body must be an object' });
      return;
    }
    const session = { ...req.body, id: req.params.id };
    await dataStore.set(sessionKey(req.userId, req.params.id), session);
    res.json(session);
  }));

  // 生成は待たずに202を返す。進行状況は GET /novel-jobs で参照する。
  router.post('/sessions/:id/novelize', asyncHandler(async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
      return;
    }
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    // 生成中の再要求は利用枠を消費せず、そのまま現状を返す(二重起動の抑止)。
    const current = await novelJobs.read(req.userId, req.params.id);
    if (current.status === 'running') {
      res.status(202).json({ status: 'running' });
      return;
    }
    if (usage) {
      const check = await usage.consume(req.userId, 'novelize');
      if (!check.ok) {
        res.status(429).json({ error: 'daily limit reached', resetAt: check.resetAt });
        return;
      }
    }
    await novelJobs.start(req.userId, req.params.id, session, req.body?.pov === 'first' ? 'first' : 'third');
    res.status(202).json({ status: 'running' });
  }));

  router.get('/sessions/:id/novel', asyncHandler(async (req, res) => {
    const text = await textStore.read(sessionNovelDocPath(req.userId, req.params.id));
    if (text === null) {
      res.status(404).json({ error: 'novel not found' });
      return;
    }
    const meta = await dataStore.get(sessionNovelMetaKey(req.userId, req.params.id));
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    res.json({ text: stripImageMarkers(text), stale: isStale(meta, session) });
  }));

  router.get('/sessions/:id/novel/illustrated', asyncHandler(async (req, res) => {
    const text = await textStore.read(sessionNovelDocPath(req.userId, req.params.id));
    if (text === null) {
      res.status(404).json({ error: 'novel not found' });
      return;
    }
    const meta = await dataStore.get(sessionNovelMetaKey(req.userId, req.params.id));
    const imageIds = Array.isArray(meta?.imageIds) ? meta.imageIds : [];
    const images = new Map();
    for (const imageId of imageIds) {
      images.set(imageId, await imageStore.read(sessionImagePath(req.userId, req.params.id, imageId)));
    }
    res.json({ markdown: buildIllustratedMarkdown({ novelText: text, imageIds, images }) });
  }));

  return router;
}
