import { Router } from 'express';
import {
  CAMPAIGN_SOURCE_KINDS,
  saveCampaign,
  getCampaign,
  listCampaigns,
  deleteCampaign,
  getCampaignSource,
  saveCampaignSource,
  getCampaignSources,
  saveCampaignDraft,
  getCampaignDraft,
  saveCampaignPitches,
  getCampaignPitches,
} from '../storage/campaignLibrary.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { campaignPitchesKey, sessionKey, worldDocPath } from '../storage/paths.js';
import { applyCampaignChanges, CAMPAIGN_CHANGE_KINDS } from '../campaignState.js';

const SAFE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function isSafeId(value) {
  return typeof value === 'string' && value !== '.' && value !== '..' && SAFE_ID_RE.test(value);
}

function cleanText(value, max = 12000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeChanges(changes, now = Date.now()) {
  return (Array.isArray(changes) ? changes : [])
    .filter((change) => CAMPAIGN_CHANGE_KINDS.includes(change?.kind))
    .map((change, index) => ({
      id: isSafeId(change.id) ? change.id : `change_${now.toString(36)}_${index}`,
      kind: change.kind,
      targetId: isSafeId(change.target_id ?? change.targetId) ? change.target_id ?? change.targetId : '',
      title: cleanText(change.title, 300),
      details: cleanText(change.details, 3000),
      status: cleanText(change.status, 80),
      progress: Number.isFinite(change.progress)
        ? Math.max(0, Math.min(100, Math.round(change.progress)))
        : 0,
      visibility: change.visibility === 'gm' ? 'gm' : 'all',
      reason: cleanText(change.reason, 1200),
      sourceLogIndexes: Array.isArray(change.source_log_indexes ?? change.sourceLogIndexes)
        ? (change.source_log_indexes ?? change.sourceLogIndexes)
            .filter(Number.isSafeInteger)
            .filter((n) => n >= 0)
            .slice(0, 20)
        : [],
    }))
    .filter((change) => change.title || change.details || change.kind === 'thread_resolve');
}

function normalizePitches(items, now = Date.now()) {
  return (Array.isArray(items) ? items : []).slice(0, 3).map((pitch, index) => ({
    id: `pitch_${now.toString(36)}_${index}`,
    title: cleanText(pitch.title, 200) || `次話案${index + 1}`,
    hook: cleanText(pitch.hook, 1200),
    centralConflict: cleanText(pitch.central_conflict ?? pitch.centralConflict, 1200),
    involvedCharacters: Array.isArray(pitch.involved_characters ?? pitch.involvedCharacters)
      ? (pitch.involved_characters ?? pitch.involvedCharacters).map((v) => cleanText(v, 200)).filter(Boolean)
      : [],
    threads: Array.isArray(pitch.threads) ? pitch.threads.map((v) => cleanText(v, 300)).filter(Boolean) : [],
    timelineEffects: Array.isArray(pitch.timeline_effects ?? pitch.timelineEffects)
      ? (pitch.timeline_effects ?? pitch.timelineEffects).map((v) => cleanText(v, 500)).filter(Boolean)
      : [],
    continuityReasons: Array.isArray(pitch.continuity_reasons ?? pitch.continuityReasons)
      ? (pitch.continuity_reasons ?? pitch.continuityReasons).map((v) => cleanText(v, 500)).filter(Boolean)
      : [],
    tone: cleanText(pitch.tone, 200),
    estimatedLength: cleanText(pitch.estimated_length ?? pitch.estimatedLength, 200),
    consistencyNotes: Array.isArray(pitch.consistency_notes ?? pitch.consistencyNotes)
      ? (pitch.consistency_notes ?? pitch.consistencyNotes).map((v) => cleanText(v, 500)).filter(Boolean)
      : [],
  }));
}

function normalizeProposedPcs(generated, session) {
  const sessionPcs = Array.isArray(session.pcs) ? session.pcs : [];
  const generatedById = new Map(
    (Array.isArray(generated.proposed_pcs ?? generated.proposedPcs)
      ? generated.proposed_pcs ?? generated.proposedPcs
      : []).map((pc) => [pc.id, pc]),
  );
  if (sessionPcs.length > 0) {
    return sessionPcs.map((pc, index) => {
      const proposed = generatedById.get(pc.id) || {};
      return {
        id: pc.id,
        characterName: cleanText(proposed.character_name ?? proposed.characterName ?? pc.characterName, 200) || `PC ${index + 1}`,
        raw: cleanText(proposed.raw, 30000) || pc.raw || '',
        xp: Number.isFinite(proposed.xp)
          ? Math.max(0, Math.round(proposed.xp))
          : Math.max(0, Math.round(session.state?.party?.pcs?.[pc.id]?.xp ?? 0)),
      };
    });
  }
  return [];
}

function hasPendingChapter(campaign) {
  return (campaign.chapters || []).some((chapter) => chapter.status !== 'reconciled');
}

function mergeCampaignChapters(existingChapters, requestedChapters) {
  if (!Array.isArray(requestedChapters)) return existingChapters || [];
  const merged = new Map(
    (existingChapters || []).map((chapter) => [chapter.sessionId || chapter.chapterId, chapter]),
  );
  for (const requested of requestedChapters) {
    const key = requested?.sessionId || requested?.chapterId;
    if (!key) continue;
    const existing = merged.get(key);
    // 一度精算済みになった章を、古いクライアントのended章で巻き戻さない。
    merged.set(
      key,
      existing?.status === 'reconciled'
        ? { ...requested, ...existing }
        : { ...existing, ...requested },
    );
  }
  return [...merged.values()];
}

async function consumeGeneration(usage, userId) {
  if (!usage) return { ok: true };
  try {
    return await usage.consume(userId, 'messages');
  } catch (error) {
    const wrapped = new Error(`usage check failed: ${error.message}`);
    wrapped.status = 502;
    throw wrapped;
  }
}

export function createCampaignsRouter({
  dataStore,
  textStore,
  generator = null,
  usage = null,
  now = Date.now,
}) {
  const router = Router();
  router.param('worldId', idParamGuard);
  router.param('id', idParamGuard);
  router.param('sessionId', idParamGuard);
  const locks = new Map();

  async function withCampaignLock(key, operation) {
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    locks.set(key, current);
    try {
      return await current;
    } finally {
      if (locks.get(key) === current) locks.delete(key);
    }
  }

  async function loadCampaign(req, res) {
    const campaign = await getCampaign(dataStore, req.userId, req.params.worldId, req.params.id);
    if (!campaign) res.status(404).json({ error: 'campaign not found' });
    return campaign;
  }

  router.get('/worlds/:worldId/campaigns', asyncHandler(async (req, res) => {
    res.json(await listCampaigns(dataStore, req.userId, req.params.worldId));
  }));

  router.get('/worlds/:worldId/campaigns/:id', asyncHandler(async (req, res) => {
    const campaign = await loadCampaign(req, res);
    if (campaign) res.json(campaign);
  }));

  router.put('/worlds/:worldId/campaigns/:id', asyncHandler(async (req, res) => {
    const { title, carriedPc, carriedPcs, chapters } = req.body || {};
    if (typeof title !== 'string' || typeof carriedPc?.raw !== 'string' || typeof carriedPc?.xp !== 'number') {
      res.status(400).json({ error: 'title and carriedPc { raw, xp } are required' });
      return;
    }
    if (chapters !== undefined && !Array.isArray(chapters)) {
      res.status(400).json({ error: 'chapters must be an array' });
      return;
    }
    if (carriedPcs !== undefined && !Array.isArray(carriedPcs)) {
      res.status(400).json({ error: 'carriedPcs must be an array' });
      return;
    }
    const lockKey = `${req.userId}/${req.params.worldId}/${req.params.id}`;
    const result = await withCampaignLock(lockKey, async () => {
      const existing = await getCampaign(dataStore, req.userId, req.params.worldId, req.params.id);
      const existingRevision = existing?.canonRevision ?? 0;
      if (
        existing &&
        Number.isSafeInteger(req.body.canonRevision) &&
        req.body.canonRevision !== existingRevision
      ) {
        return {
          status: 409,
          body: { error: 'campaign canon changed', code: 'STALE_CANON', current: existing },
        };
      }
      if (existingRevision > 0 && !Number.isSafeInteger(req.body.canonRevision)) {
        return {
          status: 409,
          body: { error: 'canonRevision is required for this campaign', code: 'CANON_REVISION_REQUIRED' },
        };
      }

      const mergedChapters = existing
        ? mergeCampaignChapters(existing.chapters, chapters)
        : chapters;
      const campaign = await saveCampaign(dataStore, req.userId, {
        id: req.params.id,
        worldId: req.params.worldId,
        title: title.trim() || '無題のキャンペーン',
        carriedPc,
        carriedPcs,
        chapters: mergedChapters,
        // currentState/canonRevisionは章精算acceptだけが変更する。
        currentState: existing?.currentState ?? req.body.currentState,
        directorGuide: existing ? existing.directorGuide : req.body.directorGuide,
        canonRevision: existingRevision || req.body.canonRevision,
        rulesetId: req.body.rulesetId,
      });
      return { status: 200, body: campaign };
    });
    res.status(result.status).json(result.body);
  }));

  router.get('/worlds/:worldId/campaigns/:id/source/:kind', asyncHandler(async (req, res) => {
    if (!CAMPAIGN_SOURCE_KINDS.includes(req.params.kind)) {
      res.status(404).json({ error: 'unknown campaign source kind' });
      return;
    }
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const raw = await getCampaignSource(
      textStore,
      req.userId,
      req.params.worldId,
      req.params.id,
      req.params.kind,
    );
    res.json({ kind: req.params.kind, raw });
  }));

  router.put('/worlds/:worldId/campaigns/:id/source/:kind', asyncHandler(async (req, res) => {
    if (!CAMPAIGN_SOURCE_KINDS.includes(req.params.kind)) {
      res.status(404).json({ error: 'unknown campaign source kind' });
      return;
    }
    if (typeof req.body?.raw !== 'string') {
      res.status(400).json({ error: 'raw is required' });
      return;
    }
    const lockKey = `${req.userId}/${req.params.worldId}/${req.params.id}`;
    const result = await withCampaignLock(lockKey, async () => {
      const campaign = await getCampaign(dataStore, req.userId, req.params.worldId, req.params.id);
      if (!campaign) return { status: 404, body: { error: 'campaign not found' } };
      await saveCampaignSource(
        textStore,
        req.userId,
        req.params.worldId,
        req.params.id,
        req.params.kind,
        req.body.raw,
      );
      await saveCampaign(dataStore, req.userId, { ...campaign, directorGuide: null });
      // 候補は原典3文書にも依存する。原典更新後の古い候補をScenario化させない。
      await dataStore.delete(campaignPitchesKey(req.userId, req.params.worldId, req.params.id));
      return { status: 200, body: { kind: req.params.kind, raw: req.body.raw } };
    });
    res.status(result.status).json(result.body);
  }));

  router.get('/worlds/:worldId/campaigns/:id/chapters/:sessionId/reconcile', asyncHandler(async (req, res) => {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const draft = await getCampaignDraft(
      dataStore,
      req.userId,
      req.params.worldId,
      req.params.id,
      req.params.sessionId,
    );
    if (!draft) {
      res.status(404).json({ error: 'campaign reconciliation draft not found' });
      return;
    }
    res.json(draft);
  }));

  router.post('/worlds/:worldId/campaigns/:id/chapters/:sessionId/reconcile', asyncHandler(async (req, res) => {
    if (!generator?.reconcile) {
      res.status(503).json({ error: 'campaign generation is not configured' });
      return;
    }
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const session = await dataStore.get(sessionKey(req.userId, req.params.sessionId));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    if (session.campaignId !== campaign.id || session.worldId !== campaign.worldId) {
      res.status(409).json({ error: 'session does not belong to this campaign' });
      return;
    }
    if (!session.endedAt) {
      res.status(400).json({ error: 'session must be ended before reconciliation' });
      return;
    }
    const existing = await getCampaignDraft(
      dataStore,
      req.userId,
      campaign.worldId,
      campaign.id,
      session.id,
    );
    if (existing?.status === 'accepted') {
      res.json(existing);
      return;
    }
    const existingChapter = (campaign.chapters || []).find((chapter) => chapter.sessionId === session.id);
    if (existingChapter?.status === 'reconciled') {
      res.status(409).json({ error: 'chapter is already reconciled', code: 'ALREADY_RECONCILED' });
      return;
    }
    if (
      existing?.status === 'ready' &&
      existing.sourceTurnCount === (session.state?.turn_count ?? 0) &&
      existing.sourceSessionUpdatedAt === session.updatedAt &&
      existing.basedOnCanonRevision === (campaign.canonRevision ?? 0)
    ) {
      res.json(existing);
      return;
    }
    const usageResult = await consumeGeneration(usage, req.userId);
    if (!usageResult.ok) {
      res.status(429).json({ error: 'daily limit reached', resetAt: usageResult.resetAt });
      return;
    }
    const [sources, worldRaw] = await Promise.all([
      getCampaignSources(textStore, req.userId, campaign.worldId, campaign.id),
      textStore.read(worldDocPath(req.userId, campaign.worldId)),
    ]);
    let generated;
    try {
      generated = await generator.reconcile({ campaign, sources, worldRaw: worldRaw || '', session });
    } catch (error) {
      res.status(502).json({ error: `campaign reconciliation failed: ${error.message}` });
      return;
    }
    const timestamp = now();
    const draft = {
      campaignId: campaign.id,
      sessionId: session.id,
      sourceTurnCount: session.state?.turn_count ?? 0,
      sourceSessionUpdatedAt: session.updatedAt,
      basedOnCanonRevision: campaign.canonRevision ?? 0,
      status: 'ready',
      summary: cleanText(generated.summary, 5000),
      proposedPcRaw: cleanText(generated.proposed_pc_raw ?? generated.proposedPcRaw, 30000) || session.pc?.raw || '',
      proposedPcs: normalizeProposedPcs(generated, session),
      changes: normalizeChanges(generated.changes, timestamp),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await saveCampaignDraft(dataStore, req.userId, campaign.worldId, campaign.id, session.id, draft);
    res.status(201).json(draft);
  }));

  router.post('/worlds/:worldId/campaigns/:id/chapters/:sessionId/accept', asyncHandler(async (req, res) => {
    const lockKey = `${req.userId}/${req.params.worldId}/${req.params.id}`;
    const result = await withCampaignLock(lockKey, async () => {
      const campaign = await getCampaign(dataStore, req.userId, req.params.worldId, req.params.id);
      if (!campaign) return { status: 404, body: { error: 'campaign not found' } };
      const session = await dataStore.get(sessionKey(req.userId, req.params.sessionId));
      if (!session) return { status: 404, body: { error: 'session not found' } };
      const draft = await getCampaignDraft(
        dataStore,
        req.userId,
        campaign.worldId,
        campaign.id,
        session.id,
      );
      if (!draft) return { status: 404, body: { error: 'campaign reconciliation draft not found' } };
      if (draft.status === 'accepted') return { status: 200, body: campaign };
      const existingChapter = (campaign.chapters || []).find((chapter) => chapter.sessionId === session.id);
      if (existingChapter?.status === 'reconciled') {
        await saveCampaignDraft(dataStore, req.userId, campaign.worldId, campaign.id, session.id, {
          ...draft,
          status: 'accepted',
          acceptedChangeIds: (existingChapter.outcome?.changes || []).map((change) => change.id),
          acceptedAt: existingChapter.reconciledAt || now(),
          updatedAt: now(),
        });
        return { status: 200, body: campaign };
      }
      if (
        draft.sourceTurnCount !== (session.state?.turn_count ?? 0) ||
        draft.sourceSessionUpdatedAt !== session.updatedAt
      ) {
        return { status: 409, body: { error: 'session changed after reconciliation', code: 'STALE_SESSION' } };
      }
      if (draft.basedOnCanonRevision !== (campaign.canonRevision ?? 0)) {
        return { status: 409, body: { error: 'campaign canon changed after reconciliation', code: 'STALE_CANON' } };
      }
      const proposedById = new Map((draft.changes || []).map((change) => [change.id, change]));
      let changes;
      if (Array.isArray(req.body?.changes)) {
        changes = req.body.changes.map((change) => {
          const proposed = proposedById.get(change.id);
          if (!proposed) return null;
          return {
            ...proposed,
            title: cleanText(change.title ?? proposed.title, 300),
            details: cleanText(change.details ?? proposed.details, 3000),
            status: cleanText(change.status ?? proposed.status, 80),
            progress: Number.isFinite(change.progress)
              ? Math.max(0, Math.min(100, Math.round(change.progress)))
              : proposed.progress,
            visibility: change.visibility === 'gm' ? 'gm' : proposed.visibility,
          };
        }).filter(Boolean);
      } else {
        const acceptedIds = new Set(
          Array.isArray(req.body?.acceptedChangeIds)
            ? req.body.acceptedChangeIds
            : (draft.changes || []).map((c) => c.id),
        );
        changes = (draft.changes || []).filter((change) => acceptedIds.has(change.id));
      }
      const summary = cleanText(req.body?.summary ?? draft.summary, 5000);
      const pcRaw = cleanText(req.body?.pcRaw ?? draft.proposedPcRaw, 30000) || session.pc?.raw || '';
      const proposedPcsById = new Map((draft.proposedPcs || []).map((pc) => [pc.id, pc]));
      const carriedPcs = (Array.isArray(req.body?.pcs) ? req.body.pcs : draft.proposedPcs || [])
        .map((pc) => {
          const proposed = proposedPcsById.get(pc.id);
          if (!proposed) return null;
          return {
            ...proposed,
            characterName: cleanText(pc.characterName ?? proposed.characterName, 200),
            raw: cleanText(pc.raw ?? proposed.raw, 30000) || proposed.raw,
            xp: Number.isFinite(pc.xp) ? Math.max(0, Math.round(pc.xp)) : proposed.xp,
          };
        })
        .filter(Boolean);
      const chapter = {
        chapterId: `chapter_${session.id}`,
        sessionId: session.id,
        scenarioId: session.scenario?.id,
        title: session.title,
        status: 'reconciled',
        endedAt: session.endedAt,
        reconciledAt: now(),
        outcome: { summary, changes },
      };
      const chapters = [...(campaign.chapters || [])];
      const chapterIndex = chapters.findIndex((item) => item.sessionId === session.id);
      if (chapterIndex === -1) chapters.push(chapter);
      else chapters[chapterIndex] = { ...chapters[chapterIndex], ...chapter };
      const saved = await saveCampaign(dataStore, req.userId, {
        ...campaign,
        chapters,
        carriedPc: { raw: pcRaw, xp: session.state?.xp || 0 },
        carriedPcs: carriedPcs.length
          ? carriedPcs
          : [{ id: session.pc?.id || 'pc', characterName: session.pc?.name || '', raw: pcRaw, xp: session.state?.xp || 0 }],
        currentState: applyCampaignChanges(campaign.currentState, changes),
        canonRevision: (campaign.canonRevision ?? 0) + 1,
        rulesetId: session.rulesetId || campaign.rulesetId,
      });
      await saveCampaignDraft(dataStore, req.userId, campaign.worldId, campaign.id, session.id, {
        ...draft,
        status: 'accepted',
        acceptedChangeIds: changes.map((change) => change.id),
        acceptedAt: now(),
        updatedAt: now(),
      });
      await dataStore.delete(campaignPitchesKey(req.userId, campaign.worldId, campaign.id));
      return { status: 200, body: saved };
    });
    res.status(result.status).json(result.body);
  }));

  router.get('/worlds/:worldId/campaigns/:id/next-pitches', asyncHandler(async (req, res) => {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    if (hasPendingChapter(campaign)) {
      res.status(409).json({ error: 'campaign has unreconciled chapters', code: 'PENDING_RECONCILIATION' });
      return;
    }
    const pitches = await getCampaignPitches(dataStore, req.userId, campaign.worldId, campaign.id);
    if (!pitches) {
      res.status(404).json({ error: 'campaign pitches not found' });
      return;
    }
    res.json(pitches);
  }));

  router.post('/worlds/:worldId/campaigns/:id/next-pitches', asyncHandler(async (req, res) => {
    if (!generator?.pitches) {
      res.status(503).json({ error: 'campaign generation is not configured' });
      return;
    }
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    if (hasPendingChapter(campaign)) {
      res.status(409).json({ error: 'campaign has unreconciled chapters', code: 'PENDING_RECONCILIATION' });
      return;
    }
    const usageResult = await consumeGeneration(usage, req.userId);
    if (!usageResult.ok) {
      res.status(429).json({ error: 'daily limit reached', resetAt: usageResult.resetAt });
      return;
    }
    const [sources, worldRaw] = await Promise.all([
      getCampaignSources(textStore, req.userId, campaign.worldId, campaign.id),
      textStore.read(worldDocPath(req.userId, campaign.worldId)),
    ]);
    let generated;
    try {
      generated = await generator.pitches({
        campaign,
        sources,
        worldRaw: worldRaw || '',
        requestText: cleanText(req.body?.requestText, 4000),
      });
    } catch (error) {
      res.status(502).json({ error: `campaign pitch generation failed: ${error.message}` });
      return;
    }
    const timestamp = now();
    const pitches = {
      basedOnCanonRevision: campaign.canonRevision ?? 0,
      requestText: cleanText(req.body?.requestText, 4000),
      pitches: normalizePitches(generated.pitches, timestamp),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await saveCampaignPitches(dataStore, req.userId, campaign.worldId, campaign.id, pitches);
    res.status(201).json(pitches);
  }));

  router.post('/worlds/:worldId/campaigns/:id/next-scenario', asyncHandler(async (req, res) => {
    if (!generator?.scenario) {
      res.status(503).json({ error: 'campaign generation is not configured' });
      return;
    }
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    if (hasPendingChapter(campaign)) {
      res.status(409).json({ error: 'campaign has unreconciled chapters', code: 'PENDING_RECONCILIATION' });
      return;
    }
    const stored = await getCampaignPitches(dataStore, req.userId, campaign.worldId, campaign.id);
    if (!stored || stored.basedOnCanonRevision !== (campaign.canonRevision ?? 0)) {
      res.status(409).json({ error: 'campaign pitches are stale', code: 'STALE_PITCHES' });
      return;
    }
    const pitch = stored.pitches.find((item) => item.id === req.body?.pitchId);
    if (!pitch) {
      res.status(400).json({ error: 'known pitchId is required' });
      return;
    }
    const usageResult = await consumeGeneration(usage, req.userId);
    if (!usageResult.ok) {
      res.status(429).json({ error: 'daily limit reached', resetAt: usageResult.resetAt });
      return;
    }
    const [sources, worldRaw] = await Promise.all([
      getCampaignSources(textStore, req.userId, campaign.worldId, campaign.id),
      textStore.read(worldDocPath(req.userId, campaign.worldId)),
    ]);
    try {
      const scenario = await generator.scenario({
        campaign,
        sources,
        worldRaw: worldRaw || '',
        pitch,
        instructions: cleanText(req.body?.instructions, 4000),
      });
      res.status(201).json({
        ...scenario,
        pitchId: pitch.id,
        basedOnCanonRevision: campaign.canonRevision ?? 0,
      });
    } catch (error) {
      res.status(502).json({ error: `campaign scenario generation failed: ${error.message}` });
    }
  }));

  router.delete('/worlds/:worldId/campaigns/:id', asyncHandler(async (req, res) => {
    await deleteCampaign(dataStore, textStore, req.userId, req.params.worldId, req.params.id);
    res.status(204).end();
  }));

  return router;
}
