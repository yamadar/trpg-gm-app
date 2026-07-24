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
import { buildTranscriptWithMarkers, stripImageMarkers } from '../novelMarkers.js';
import { buildIllustratedMarkdown } from '../illustratedNovel.js';

const NOVELIZE_TIMEOUT_MS = 120000;

const MARKER_INSTRUCTION =
  '\nトランスクリプト中の〈挿絵N〉は対応する場面の挿絵挿入位置である。小説本文の対応する場面の切れ目に、各マーカーを一度だけ行独立でそのまま残すこと。';

function extractText(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// pov: 'third'(既定)または 'first'。リクエストボディの pov で切り替え可能。
function buildNovelizeSystemPrompt(pov) {
  const voice = pov === 'first' ? 'PC視点の一人称' : '三人称';
  return `以下はTRPGセッションの進行ログである。プレイヤー発言とGMの地の文が交互に並んでいる。これを${voice}の小説として、場面転換や心理描写を補いながら自然な文章に書き直せ。ゲーム的な表現(選択肢・判定結果の数値等)はそのまま出力せず、物語として自然に溶け込ませること。説明文やコードブロック記号は付けず、小説本文のみを出力すること。`;
}

export function createSessionsRouter({ dataStore, textStore, imageStore, apiKey, fetchImpl = fetch, usage }) {
  const router = Router();
  router.param('id', idParamGuard);

  router.get('/sessions', asyncHandler(async (req, res) => {
    const keys = await dataStore.list(sessionListPrefix(req.userId));
    const sessions = await Promise.all(keys.map((k) => dataStore.get(k)));
    res.json(sessions.filter(Boolean));
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
    if (usage) {
      const check = await usage.consume(req.userId, 'novelize');
      if (!check.ok) {
        res.status(429).json({ error: 'daily limit reached', resetAt: check.resetAt });
        return;
      }
    }
    const { transcript, imageIds } = buildTranscriptWithMarkers(session.log);
    try {
      const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 12000,
          thinking: { type: 'disabled' },
          system:
            buildNovelizeSystemPrompt(req.body?.pov === 'first' ? 'first' : 'third') +
            (imageIds.length > 0 ? MARKER_INSTRUCTION : ''),
          messages: [{ role: 'user', content: transcript }],
        }),
        signal: AbortSignal.timeout(NOVELIZE_TIMEOUT_MS),
      });
      if (!upstream.ok) {
        const t = await upstream.text().catch(() => '');
        res.status(502).json({ error: `upstream request failed: ${t.slice(0, 200)}` });
        return;
      }
      const data = await upstream.json();
      if (data.stop_reason === 'max_tokens') {
        res.status(502).json({ error: 'novelization was truncated (max_tokens); not saved' });
        return;
      }
      const text = extractText(data.content);
      if (!text) {
        res.status(502).json({ error: 'novelization produced empty output; not saved' });
        return;
      }
      await textStore.write(sessionNovelDocPath(req.userId, req.params.id), text);
      await dataStore.set(sessionNovelMetaKey(req.userId, req.params.id), {
        turnCount: session.state?.turn_count ?? null,
        updatedAt: Date.now(),
        imageIds,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(502).json({ error: `upstream request failed: ${e.message}` });
    }
  }));

  router.get('/sessions/:id/novel', asyncHandler(async (req, res) => {
    const text = await textStore.read(sessionNovelDocPath(req.userId, req.params.id));
    if (text === null) {
      res.status(404).json({ error: 'novel not found' });
      return;
    }
    const meta = await dataStore.get(sessionNovelMetaKey(req.userId, req.params.id));
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    const currentTurn = session?.state?.turn_count ?? null;
    const stale = meta && meta.turnCount != null && currentTurn != null ? meta.turnCount !== currentTurn : false;
    res.json({ text: stripImageMarkers(text), stale });
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
