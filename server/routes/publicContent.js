import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { listPublic, getPublicWorld, getPublicItem } from '../storage/shareLibrary.js';

const TYPES = new Set(['worlds', 'characters', 'scenarios', 'novels']);

export function createPublicContentRouter({ dataStore, textStore }) {
  const router = Router();
  router.param('publicId', idParamGuard);

  router.get('/public/:type', asyncHandler(async (req, res) => {
    if (!TYPES.has(req.params.type)) {
      res.status(404).json({ error: 'unknown type' });
      return;
    }
    res.json(await listPublic(dataStore, req.params.type));
  }));

  router.get('/public/:type/:publicId', asyncHandler(async (req, res) => {
    const { type, publicId } = req.params;
    if (!TYPES.has(type)) {
      res.status(404).json({ error: 'unknown type' });
      return;
    }
    const item = type === 'worlds'
      ? await getPublicWorld(dataStore, textStore, publicId)
      : await getPublicItem(dataStore, textStore, type, publicId);
    if (!item) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(item);
  }));

  return router;
}
