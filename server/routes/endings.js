import { Router } from 'express';
import { sessionKey } from '../storage/paths.js';
import { saveEnding, getEnding, listEndings, deleteEnding } from '../storage/endingLibrary.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { nameEnding } from '../endingNaming.js';

export function createEndingsRouter({ dataStore, apiKey, model, fetchImpl = fetch, usage }) {
  const router = Router();
  router.param('id', idParamGuard);

  router.get('/endings', asyncHandler(async (req, res) => {
    res.json(await listEndings(dataStore, req.userId));
  }));

  router.post('/sessions/:id/ending', asyncHandler(async (req, res) => {
    if (!apiKey) {
      res.status(503).json({ error: 'ending generation is unavailable', code: 'ENDING_GENERATION_UNAVAILABLE' });
      return;
    }
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    if (!session.endedAt) {
      res.status(400).json({ error: 'session has not ended' });
      return;
    }
    // 統計はクライアントが集計して送る(サーバーはsrc/をimportできないため)。
    // 形だけを検証し、中身はセッション本体と同じくクライアントを信用する。
    const stats = req.body?.stats;
    if (typeof stats !== 'object' || stats === null || Array.isArray(stats)) {
      res.status(400).json({ error: 'stats must be an object' });
      return;
    }
    if (usage) {
      let check;
      try {
        check = await usage.consume(req.userId, 'messages');
      } catch {
        res.status(502).json({ error: 'usage check failed', code: 'USAGE_CHECK_FAILED' });
        return;
      }
      if (!check.ok) {
        res.status(429).json({ error: 'daily limit reached', resetAt: check.resetAt });
        return;
      }
    }
    let named;
    try {
      named = await nameEnding({ session, apiKey, model, fetchImpl });
    } catch {
      res.status(502).json({ error: 'ending generation failed', code: 'ENDING_GENERATION_FAILED' });
      return;
    }
    const ending = {
      sessionId: req.params.id,
      sessionTitle: session.title || '',
      endingTitle: named.endingTitle,
      summary: named.summary,
      endedAt: session.endedAt,
      recordedAt: Date.now(),
      worldId: session.worldId ?? null,
      campaignId: session.campaignId ?? null,
      rulesetId: session.rulesetId ?? null,
      formula: session.ruleset?.formula ?? null,
      moods: Array.isArray(session.moods) ? session.moods : [],
      stats,
    };
    await saveEnding(dataStore, req.userId, ending);
    res.status(201).json(ending);
  }));

  router.patch('/endings/:id', asyncHandler(async (req, res) => {
    const endingTitle = req.body?.endingTitle;
    if (typeof endingTitle !== 'string' || endingTitle.trim() === '') {
      res.status(400).json({ error: 'endingTitle is required' });
      return;
    }
    const existing = await getEnding(dataStore, req.userId, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'ending not found' });
      return;
    }
    res.json(await saveEnding(dataStore, req.userId, { ...existing, endingTitle: endingTitle.trim() }));
  }));

  router.delete('/endings/:id', asyncHandler(async (req, res) => {
    await deleteEnding(dataStore, req.userId, req.params.id);
    res.status(204).end();
  }));

  return router;
}
