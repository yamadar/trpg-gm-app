import { Router } from 'express';
import { saveScenario, getScenario, listScenarios, deleteScenario } from '../storage/scenarioLibrary.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';

export function createScenariosRouter({ dataStore, textStore }) {
  const router = Router();
  router.param('worldId', idParamGuard);
  router.param('id', idParamGuard);

  router.get('/worlds/:worldId/scenarios', asyncHandler(async (req, res) => {
    res.json(await listScenarios(dataStore, req.params.worldId));
  }));

  router.get('/worlds/:worldId/scenarios/:id', asyncHandler(async (req, res) => {
    const scenario = await getScenario(dataStore, textStore, req.params.worldId, req.params.id);
    if (!scenario) {
      res.status(404).json({ error: 'scenario not found' });
      return;
    }
    res.json(scenario);
  }));

  router.put('/worlds/:worldId/scenarios/:id', asyncHandler(async (req, res) => {
    const scenario = await saveScenario(dataStore, textStore, {
      worldId: req.params.worldId,
      id: req.params.id,
      title: req.body.title,
      raw: req.body.raw,
      recommendedRuleset: req.body.recommendedRuleset,
    });
    res.json(scenario);
  }));

  router.delete('/worlds/:worldId/scenarios/:id', asyncHandler(async (req, res) => {
    await deleteScenario(dataStore, textStore, req.params.worldId, req.params.id);
    res.status(204).end();
  }));

  return router;
}
