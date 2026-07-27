import { Router } from 'express';
import {
  saveWorldSource,
  getWorldSource,
  saveRegion,
  getRegion,
  listRegions,
  deleteRegion,
  saveCategory,
  getCategory,
  listCategories,
  deleteCategory,
} from '../storage/worldContentLibrary.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';

export function createWorldContentRouter({ dataStore, textStore }) {
  const router = Router();
  router.param('worldId', idParamGuard);
  router.param('region', idParamGuard);
  router.param('category', idParamGuard);

  router.get('/worlds/:worldId/source', asyncHandler(async (req, res) => {
    const raw = await getWorldSource(textStore, req.userId, req.params.worldId);
    if (raw === null) {
      res.status(404).json({ error: 'source not found' });
      return;
    }
    res.json({ raw });
  }));

  router.put('/worlds/:worldId/source', asyncHandler(async (req, res) => {
    if (typeof req.body.raw !== 'string') {
      res.status(400).json({ error: 'raw is required' });
      return;
    }
    await saveWorldSource(textStore, req.userId, req.params.worldId, req.body.raw);
    res.json({ raw: req.body.raw });
  }));

  router.get('/worlds/:worldId/regions', asyncHandler(async (req, res) => {
    res.json(await listRegions(dataStore, textStore, req.userId, req.params.worldId));
  }));

  router.get('/worlds/:worldId/regions/:region', asyncHandler(async (req, res) => {
    const region = await getRegion(dataStore, textStore, req.userId, req.params.worldId, req.params.region);
    if (region === null) {
      res.status(404).json({ error: 'region not found' });
      return;
    }
    res.json(region);
  }));

  router.put('/worlds/:worldId/regions/:region', asyncHandler(async (req, res) => {
    if (typeof req.body.raw !== 'string') {
      res.status(400).json({ error: 'raw is required' });
      return;
    }
    const region = await saveRegion(dataStore, textStore, req.userId, req.params.worldId, req.params.region, {
      title: typeof req.body.title === 'string' ? req.body.title : '',
      raw: req.body.raw,
    });
    res.json(region);
  }));

  router.delete('/worlds/:worldId/regions/:region', asyncHandler(async (req, res) => {
    await deleteRegion(dataStore, textStore, req.userId, req.params.worldId, req.params.region);
    res.status(204).end();
  }));

  router.get('/worlds/:worldId/categories', asyncHandler(async (req, res) => {
    res.json(await listCategories(dataStore, textStore, req.userId, req.params.worldId));
  }));

  router.get('/worlds/:worldId/categories/:category', asyncHandler(async (req, res) => {
    const category = await getCategory(dataStore, textStore, req.userId, req.params.worldId, req.params.category);
    if (category === null) {
      res.status(404).json({ error: 'category not found' });
      return;
    }
    res.json(category);
  }));

  router.put('/worlds/:worldId/categories/:category', asyncHandler(async (req, res) => {
    if (typeof req.body.raw !== 'string') {
      res.status(400).json({ error: 'raw is required' });
      return;
    }
    const category = await saveCategory(dataStore, textStore, req.userId, req.params.worldId, req.params.category, {
      title: typeof req.body.title === 'string' ? req.body.title : '',
      raw: req.body.raw,
    });
    res.json(category);
  }));

  router.delete('/worlds/:worldId/categories/:category', asyncHandler(async (req, res) => {
    await deleteCategory(dataStore, textStore, req.userId, req.params.worldId, req.params.category);
    res.status(204).end();
  }));

  return router;
}
