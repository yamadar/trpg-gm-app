import { Router } from 'express';
import { saveWorld, getWorld, listWorlds, deleteWorld } from '../storage/worldLibrary.js';
import { unpublishWorldCascade } from '../storage/shareLibrary.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';

export function createWorldsRouter({ dataStore, textStore }) {
  const router = Router();
  router.param('id', idParamGuard);

  router.get('/worlds', asyncHandler(async (req, res) => {
    res.json(await listWorlds(dataStore, req.userId));
  }));

  router.get('/worlds/:id', asyncHandler(async (req, res) => {
    const world = await getWorld(dataStore, textStore, req.userId, req.params.id);
    if (!world) {
      res.status(404).json({ error: 'world not found' });
      return;
    }
    res.json(world);
  }));

  router.put('/worlds/:id', asyncHandler(async (req, res) => {
    if (typeof req.body.raw !== 'string' || typeof req.body.title !== 'string') {
      res.status(400).json({ error: 'title and raw are required' });
      return;
    }
    const world = await saveWorld(dataStore, textStore, req.userId, {
      id: req.params.id,
      title: req.body.title,
      raw: req.body.raw,
    });
    res.json(world);
  }));

  router.delete('/worlds/:id', asyncHandler(async (req, res) => {
    await unpublishWorldCascade(dataStore, textStore, req.userId, req.params.id);
    await deleteWorld(dataStore, textStore, req.userId, req.params.id);
    res.status(204).end();
  }));

  return router;
}
