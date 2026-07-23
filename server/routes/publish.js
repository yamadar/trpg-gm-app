import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard, kindParamGuard } from './validateId.js';
import { getUser } from '../auth/users.js';
import {
  publishWorld, publishCharacter, publishScenario, publishNovel,
  unpublishWorld, unpublishCharacter, unpublishScenario, unpublishNovel,
  getPublishedWorlds, getPublishedCharacters, getPublishedScenarios, getPublishedNovels,
} from '../storage/shareLibrary.js';

export function createPublishRouter({ dataStore, textStore }) {
  const router = Router();
  for (const p of ['worldId', 'name', 'scenarioId', 'sessionId']) router.param(p, idParamGuard);
  router.param('kind', kindParamGuard);

  async function ownerOf(req) {
    const user = await getUser(dataStore, req.userId);
    return { id: req.userId, displayName: user?.displayName ?? 'ユーザー' };
  }

  function send(res, result) {
    if (result.ok) {
      res.json({ publicId: result.meta.publicId });
      return;
    }
    if (result.reason === 'novel_not_generated') {
      res.status(409).json({ error: 'novelize first' });
      return;
    }
    res.status(404).json({ error: 'not found' });
  }

  router.post('/publish/worlds/:worldId', asyncHandler(async (req, res) => {
    send(res, await publishWorld(dataStore, textStore, req.userId, req.params.worldId, await ownerOf(req)));
  }));
  router.post('/publish/worlds/:worldId/characters/:kind/:name', asyncHandler(async (req, res) => {
    send(res, await publishCharacter(dataStore, textStore, req.userId, req.params.worldId, req.params.kind, req.params.name, await ownerOf(req)));
  }));
  router.post('/publish/worlds/:worldId/scenarios/:scenarioId', asyncHandler(async (req, res) => {
    send(res, await publishScenario(dataStore, textStore, req.userId, req.params.worldId, req.params.scenarioId, await ownerOf(req)));
  }));
  router.post('/publish/sessions/:sessionId/novel', asyncHandler(async (req, res) => {
    send(res, await publishNovel(dataStore, textStore, req.userId, req.params.sessionId, await ownerOf(req)));
  }));

  router.delete('/publish/worlds/:worldId', asyncHandler(async (req, res) => {
    await unpublishWorld(dataStore, textStore, req.userId, req.params.worldId);
    res.status(204).end();
  }));
  router.delete('/publish/worlds/:worldId/characters/:kind/:name', asyncHandler(async (req, res) => {
    await unpublishCharacter(dataStore, textStore, req.userId, req.params.worldId, req.params.kind, req.params.name);
    res.status(204).end();
  }));
  router.delete('/publish/worlds/:worldId/scenarios/:scenarioId', asyncHandler(async (req, res) => {
    await unpublishScenario(dataStore, textStore, req.userId, req.params.worldId, req.params.scenarioId);
    res.status(204).end();
  }));
  router.delete('/publish/sessions/:sessionId/novel', asyncHandler(async (req, res) => {
    await unpublishNovel(dataStore, textStore, req.userId, req.params.sessionId);
    res.status(204).end();
  }));

  router.get('/publish/worlds', asyncHandler(async (req, res) => {
    res.json(await getPublishedWorlds(dataStore, req.userId));
  }));
  router.get('/publish/worlds/:worldId/characters/:kind', asyncHandler(async (req, res) => {
    res.json(await getPublishedCharacters(dataStore, req.userId, req.params.worldId, req.params.kind));
  }));
  router.get('/publish/worlds/:worldId/scenarios', asyncHandler(async (req, res) => {
    res.json(await getPublishedScenarios(dataStore, req.userId, req.params.worldId));
  }));
  router.get('/publish/sessions', asyncHandler(async (req, res) => {
    res.json(await getPublishedNovels(dataStore, req.userId));
  }));

  return router;
}
