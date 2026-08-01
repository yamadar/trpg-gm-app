import { Router } from 'express';
import { saveScenario, getScenario, listScenarios, deleteScenario } from '../storage/scenarioLibrary.js';
import { unpublishScenario } from '../storage/shareLibrary.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard, isValidId } from './validateId.js';
import { isValidMoods } from '../storage/moods.js';
import { deleteAttachmentCollection } from '../storage/attachmentLibrary.js';
import { scenarioAttachmentDir } from '../storage/paths.js';

export function createScenariosRouter({ dataStore, textStore, imageStore, scenarioAnalyzer = null, usage = null }) {
  const router = Router();
  router.param('worldId', idParamGuard);
  router.param('id', idParamGuard);

  router.get('/worlds/:worldId/scenarios', asyncHandler(async (req, res) => {
    res.json(await listScenarios(dataStore, req.userId, req.params.worldId));
  }));

  router.get('/worlds/:worldId/scenarios/:id', asyncHandler(async (req, res) => {
    const scenario = await getScenario(dataStore, textStore, req.userId, req.params.worldId, req.params.id);
    if (!scenario) {
      res.status(404).json({ error: 'scenario not found' });
      return;
    }
    res.json(scenario);
  }));

  router.put('/worlds/:worldId/scenarios/:id', asyncHandler(async (req, res) => {
    if (typeof req.body.raw !== 'string' || typeof req.body.title !== 'string') {
      res.status(400).json({ error: 'title and raw are required' });
      return;
    }
    if ('moods' in req.body && !isValidMoods(req.body.moods)) {
      res.status(400).json({ error: 'moods must be an array of known mood labels' });
      return;
    }
    if (req.body.sourceCampaignId != null && !isValidId(req.body.sourceCampaignId)) {
      res.status(400).json({ error: 'sourceCampaignId must be a valid id' });
      return;
    }
    if (
      req.body.sourceCampaignRevision != null &&
      (!Number.isSafeInteger(req.body.sourceCampaignRevision) || req.body.sourceCampaignRevision < 0)
    ) {
      res.status(400).json({ error: 'sourceCampaignRevision must be a non-negative integer' });
      return;
    }
    if (req.body.generatedFromPitchId != null && !isValidId(req.body.generatedFromPitchId)) {
      res.status(400).json({ error: 'generatedFromPitchId must be a valid id' });
      return;
    }
    let directorGuide = null;
    if (scenarioAnalyzer) {
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
      try {
        directorGuide = await scenarioAnalyzer({ title: req.body.title, raw: req.body.raw });
      } catch {
        res.status(502).json({ error: 'scenario analysis failed', code: 'SCENARIO_ANALYSIS_FAILED' });
        return;
      }
    }
    const scenario = await saveScenario(dataStore, textStore, req.userId, {
      worldId: req.params.worldId,
      id: req.params.id,
      title: req.body.title,
      raw: req.body.raw,
      recommendedRuleset: req.body.recommendedRuleset,
      moods: req.body.moods,
      sourceCampaignId: req.body.sourceCampaignId,
      sourceCampaignRevision: req.body.sourceCampaignRevision,
      generatedFromPitchId: req.body.generatedFromPitchId,
      directorGuide,
    });
    res.json(scenario);
  }));

  router.delete('/worlds/:worldId/scenarios/:id', asyncHandler(async (req, res) => {
    await unpublishScenario(
      dataStore,
      textStore,
      req.userId,
      req.params.worldId,
      req.params.id,
      imageStore,
    );
    await deleteAttachmentCollection(
      dataStore,
      imageStore,
      scenarioAttachmentDir(req.userId, req.params.worldId, req.params.id),
    );
    await deleteScenario(dataStore, textStore, req.userId, req.params.worldId, req.params.id);
    res.status(204).end();
  }));

  return router;
}
