import { Router } from 'express';
import { sessionKey } from '../storage/paths.js';
import { asyncHandler } from './asyncHandler.js';

export function createSessionsRouter({ dataStore }) {
  const router = Router();

  router.get('/sessions', asyncHandler(async (req, res) => {
    const keys = await dataStore.list('sessions');
    const sessions = await Promise.all(keys.map((k) => dataStore.get(k)));
    res.json(sessions.filter(Boolean));
  }));

  router.get('/sessions/:id', asyncHandler(async (req, res) => {
    const session = await dataStore.get(sessionKey(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json(session);
  }));

  router.put('/sessions/:id', asyncHandler(async (req, res) => {
    const session = { ...req.body, id: req.params.id };
    await dataStore.set(sessionKey(req.params.id), session);
    res.json(session);
  }));

  router.post('/sessions/:id/novelize', asyncHandler(async (req, res) => {
    res.status(501).json({ error: 'novelization is not implemented yet' });
  }));

  return router;
}
