import { Router } from 'express';
import { saveRuleset, getRuleset, listRulesets, deleteRuleset } from '../storage/rulesetLibrary.js';

export function createRulesetsRouter({ dataStore }) {
  const router = Router();

  router.get('/rulesets', async (req, res) => {
    res.json(await listRulesets(dataStore));
  });

  router.get('/rulesets/:id', async (req, res) => {
    const ruleset = await getRuleset(dataStore, req.params.id);
    if (!ruleset) {
      res.status(404).json({ error: 'ruleset not found' });
      return;
    }
    res.json(ruleset);
  });

  router.put('/rulesets/:id', async (req, res) => {
    const ruleset = await saveRuleset(dataStore, {
      id: req.params.id,
      label: req.body.label,
      desc: req.body.desc,
      hint: req.body.hint,
    });
    res.json(ruleset);
  });

  router.delete('/rulesets/:id', async (req, res) => {
    await deleteRuleset(dataStore, req.params.id);
    res.status(204).end();
  });

  return router;
}
