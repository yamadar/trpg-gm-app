import { Router } from 'express';
import { saveCharacter, getCharacter, listCharacters, deleteCharacter } from '../storage/characterLibrary.js';

export function createCharactersRouter({ dataStore, textStore }) {
  const router = Router();

  router.get('/worlds/:worldId/characters/:kind', async (req, res) => {
    res.json(await listCharacters(dataStore, req.params.worldId, req.params.kind));
  });

  router.get('/worlds/:worldId/characters/:kind/:name', async (req, res) => {
    const character = await getCharacter(dataStore, textStore, req.params.worldId, req.params.kind, req.params.name);
    if (!character) {
      res.status(404).json({ error: 'character not found' });
      return;
    }
    res.json(character);
  });

  router.put('/worlds/:worldId/characters/:kind/:name', async (req, res) => {
    const character = await saveCharacter(dataStore, textStore, {
      worldId: req.params.worldId,
      kind: req.params.kind,
      name: req.params.name,
      raw: req.body.raw,
      revealed: req.body.revealed,
    });
    res.json(character);
  });

  router.delete('/worlds/:worldId/characters/:kind/:name', async (req, res) => {
    await deleteCharacter(dataStore, textStore, req.params.worldId, req.params.kind, req.params.name);
    res.status(204).end();
  });

  return router;
}
