import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard, isValidId } from './validateId.js';
import { importWorld, importCharacter, importScenario } from '../storage/importLibrary.js';

export function createImportsRouter({ dataStore, textStore }) {
  const router = Router();
  router.param('publicId', idParamGuard);

  function sendImport(res, result) {
    if (result.ok) {
      res.status(201).json(result.meta);
      return;
    }
    res.status(404).json({ error: result.reason === 'target_not_found' ? 'target world not found' : 'not found' });
  }

  router.post('/import/worlds/:publicId', asyncHandler(async (req, res) => {
    sendImport(res, await importWorld(dataStore, textStore, req.userId, req.params.publicId));
  }));

  function targetWorldIdOf(req, res) {
    const target = req.body?.targetWorldId;
    if (typeof target !== 'string' || !isValidId(target)) {
      res.status(400).json({ error: 'targetWorldId is required' });
      return null;
    }
    return target;
  }

  router.post('/import/characters/:publicId', asyncHandler(async (req, res) => {
    const target = targetWorldIdOf(req, res);
    if (target === null) return;
    sendImport(res, await importCharacter(dataStore, textStore, req.userId, req.params.publicId, target));
  }));

  router.post('/import/scenarios/:publicId', asyncHandler(async (req, res) => {
    const target = targetWorldIdOf(req, res);
    if (target === null) return;
    sendImport(res, await importScenario(dataStore, textStore, req.userId, req.params.publicId, target));
  }));

  return router;
}
