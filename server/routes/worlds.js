import { Router } from 'express';
import { saveWorld, getWorld, listWorlds, deleteWorld } from '../storage/worldLibrary.js';

export function createWorldsRouter({ dataStore, textStore }) {
  const router = Router();

  router.get('/worlds', async (req, res) => {
    res.json(await listWorlds(dataStore));
  });

  router.get('/worlds/:id', async (req, res) => {
    const world = await getWorld(dataStore, textStore, req.params.id);
    if (!world) {
      res.status(404).json({ error: 'world not found' });
      return;
    }
    res.json(world);
  });

  router.put('/worlds/:id', async (req, res) => {
    const world = await saveWorld(dataStore, textStore, {
      id: req.params.id,
      title: req.body.title,
      raw: req.body.raw,
    });
    res.json(world);
  });

  router.delete('/worlds/:id', async (req, res) => {
    await deleteWorld(dataStore, textStore, req.params.id);
    res.status(204).end();
  });

  return router;
}
