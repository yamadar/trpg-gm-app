import { Router } from 'express';
import { saveCharacter, getCharacter, listCharacters, deleteCharacter, saveCharacterParsed } from '../storage/characterLibrary.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard, kindParamGuard } from './validateId.js';

export function createCharactersRouter({ dataStore, textStore }) {
  const router = Router();
  router.param('worldId', idParamGuard);
  router.param('kind', kindParamGuard);
  router.param('name', idParamGuard);

  router.get('/worlds/:worldId/characters/:kind', asyncHandler(async (req, res) => {
    res.json(await listCharacters(dataStore, req.params.worldId, req.params.kind));
  }));

  router.get('/worlds/:worldId/characters/:kind/:name', asyncHandler(async (req, res) => {
    const character = await getCharacter(dataStore, textStore, req.params.worldId, req.params.kind, req.params.name);
    if (!character) {
      res.status(404).json({ error: 'character not found' });
      return;
    }
    res.json(character);
  }));

  router.put('/worlds/:worldId/characters/:kind/:name', asyncHandler(async (req, res) => {
    const character = await saveCharacter(dataStore, textStore, {
      worldId: req.params.worldId,
      kind: req.params.kind,
      name: req.params.name,
      raw: req.body.raw,
      revealed: req.body.revealed,
    });
    res.json(character);
  }));

  router.delete('/worlds/:worldId/characters/:kind/:name', asyncHandler(async (req, res) => {
    await deleteCharacter(dataStore, textStore, req.params.worldId, req.params.kind, req.params.name);
    res.status(204).end();
  }));

  router.put('/worlds/:worldId/characters/:kind/:name/parsed', asyncHandler(async (req, res) => {
    const character = await saveCharacterParsed(dataStore, req.params.worldId, req.params.kind, req.params.name, {
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
