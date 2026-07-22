import { Router } from 'express';
import { saveRuleset, getRuleset, listRulesets, deleteRuleset } from '../storage/rulesetLibrary.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';

export function createRulesetsRouter({ dataStore }) {
  const router = Router();
  router.param('id', idParamGuard);

  router.get('/rulesets', asyncHandler(async (req, res) => {
    res.json(await listRulesets(dataStore));
  }));

  router.get('/rulesets/:id', asyncHandler(async (req, res) => {
    const ruleset = await getRuleset(dataStore, req.params.id);
    if (!ruleset) {
      res.status(404).json({ error: 'ruleset not found' });
      return;
    }
    res.json(ruleset);
  }));

  router.put('/rulesets/:id', asyncHandler(async (req, res) => {
    if (typeof req.body.label !== 'string') {
      res.status(400).json({ error: 'label is required' });
      return;
    }
    const ruleset = await saveRuleset(dataStore, {
      id: req.params.id,
      label: req.body.label,
      desc: req.body.desc,
      hint: req.body.hint,
      growthUnit: req.body.growthUnit,
    });
    res.json(ruleset);
  }));

  router.delete('/rulesets/:id', asyncHandler(async (req, res) => {
    await deleteRuleset(dataStore, req.params.id);
    res.status(204).end();
  }));

  return router;
}
