import { Router } from 'express';
import { saveCharacter, getCharacter, listCharacterSummaries, deleteCharacter, saveCharacterParsed } from '../storage/characterLibrary.js';
import { unpublishCharacter } from '../storage/shareLibrary.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard, kindParamGuard } from './validateId.js';

export function createCharactersRouter({ dataStore, textStore }) {
  const router = Router();
  router.param('worldId', idParamGuard);
  router.param('kind', kindParamGuard);
  router.param('name', idParamGuard);

  router.get('/worlds/:worldId/characters/:kind', asyncHandler(async (req, res) => {
    res.json(await listCharacterSummaries(dataStore, textStore, req.userId, req.params.worldId, req.params.kind));
  }));

  router.get('/worlds/:worldId/characters/:kind/:name', asyncHandler(async (req, res) => {
    const character = await getCharacter(dataStore, textStore, req.userId, req.params.worldId, req.params.kind, req.params.name);
    if (!character) {
      res.status(404).json({ error: 'character not found' });
      return;
    }
    res.json(character);
  }));

  router.put('/worlds/:worldId/characters/:kind/:name', asyncHandler(async (req, res) => {
    if (typeof req.body.raw !== 'string') {
      res.status(400).json({ error: 'raw is required' });
      return;
    }
    if (req.body.characterName !== undefined && typeof req.body.characterName !== 'string') {
      res.status(400).json({ error: 'characterName must be a string' });
      return;
    }
    const character = await saveCharacter(dataStore, textStore, req.userId, {
      worldId: req.params.worldId,
      kind: req.params.kind,
      name: req.params.name,
      characterName: req.body.characterName,
      raw: req.body.raw,
      revealed: req.body.revealed,
    });
    res.json(character);
  }));

  router.delete('/worlds/:worldId/characters/:kind/:name', asyncHandler(async (req, res) => {
    await unpublishCharacter(dataStore, textStore, req.userId, req.params.worldId, req.params.kind, req.params.name);
    await deleteCharacter(dataStore, textStore, req.userId, req.params.worldId, req.params.kind, req.params.name);
    res.status(204).end();
  }));

  router.put('/worlds/:worldId/characters/:kind/:name/parsed', asyncHandler(async (req, res) => {
    const character = await saveCharacterParsed(dataStore, req.userId, req.params.worldId, req.params.kind, req.params.name, {
      parsed: req.body.parsed,
      parsedHash: req.body.parsedHash,
    });
    if (!character) {
      res.status(404).json({ error: 'character not found' });
      return;
    }
    res.json(character);
  }));

  return router;
}
