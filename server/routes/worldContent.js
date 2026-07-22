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

export function createWorldContentRouter({ textStore }) {
  const router = Router();
  router.param('worldId', idParamGuard);
  router.param('region', idParamGuard);
  router.param('category', idParamGuard);

  router.get('/worlds/:worldId/source', asyncHandler(async (req, res) => {
    const raw = await getWorldSource(textStore, req.params.worldId);
    if (raw === null) {
      res.status(404).json({ error: 'source not found' });
      return;
    }
    res.json({ raw });
  }));

  router.put('/worlds/:worldId/source', asyncHandler(async (req, res) => {
    await saveWorldSource(textStore, req.params.worldId, req.body.raw);
    res.json({ raw: req.body.raw });
  }));

  router.get('/worlds/:worldId/regions', asyncHandler(async (req, res) => {
    res.json(await listRegions(textStore, req.params.worldId));
  }));

  router.get('/worlds/:worldId/regions/:region', asyncHandler(async (req, res) => {
    const raw = await getRegion(textStore, req.params.worldId, req.params.region);
    if (raw === null) {
      res.status(404).json({ error: 'region not found' });
      return;
    }
    res.json({ id: req.params.region, raw });
  }));

  router.put('/worlds/:worldId/regions/:region', asyncHandler(async (req, res) => {
    await saveRegion(textStore, req.params.worldId, req.params.region, req.body.raw);
    res.json({ id: req.params.region, raw: req.body.raw });
  }));

  router.delete('/worlds/:worldId/regions/:region', asyncHandler(async (req, res) => {
    await deleteRegion(textStore, req.params.worldId, req.params.region);
    res.status(204).end();
  }));

  router.get('/worlds/:worldId/categories', asyncHandler(async (req, res) => {
    res.json(await listCategories(textStore, req.params.worldId));
  }));

  router.get('/worlds/:worldId/categories/:category', asyncHandler(async (req, res) => {
    const raw = await getCategory(textStore, req.params.worldId, req.params.category);
    if (raw === null) {
      res.status(404).json({ error: 'category not found' });
      return;
    }
    res.json({ id: req.params.category, raw });
  }));

  router.put('/worlds/:worldId/categories/:category', asyncHandler(async (req, res) => {
    await saveCategory(textStore, req.params.worldId, req.params.category, req.body.raw);
    res.json({ id: req.params.category, raw: req.body.raw });
  }));

  router.delete('/worlds/:worldId/categories/:category', asyncHandler(async (req, res) => {
    await deleteCategory(textStore, req.params.worldId, req.params.category);
    res.status(204).end();
  }));

  return router;
}
