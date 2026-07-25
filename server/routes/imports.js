import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard, isValidId } from './validateId.js';
import { importWorld, importCharacter, importScenario } from '../storage/importLibrary.js';
import { starterManifestKey } from '../storage/paths.js';

export function createImportsRouter({ dataStore, textStore }) {
  const router = Router();
  router.param('publicId', idParamGuard);
  router.param('packId', idParamGuard);

  function sendImport(res, result) {
    if (result.ok) {
      res.status(201).json(result.meta);
      return;
    }
    res.status(404).json({ error: result.reason === 'target_not_found' ? 'target world not found' : 'not found' });
  }

  router.post('/import/worlds/:publicId', asyncHandler(async (req, res) => {
    sendImport(res, await importWorld(dataStore, textStore, req.userId, req.params.publicId));
  }));

  function targetWorldIdOf(req, res) {
    const target = req.body?.targetWorldId;
    if (typeof target !== 'string' || !isValidId(target)) {
      res.status(400).json({ error: 'targetWorldId is required' });
      return null;
    }
    return target;
  }

  router.post('/import/characters/:publicId', asyncHandler(async (req, res) => {
    const target = targetWorldIdOf(req, res);
    if (target === null) return;
    sendImport(res, await importCharacter(dataStore, textStore, req.userId, req.params.publicId, target));
  }));

  router.post('/import/scenarios/:publicId', asyncHandler(async (req, res) => {
    const target = targetWorldIdOf(req, res);
    if (target === null) return;
    sendImport(res, await importScenario(dataStore, textStore, req.userId, req.params.publicId, target));
  }));

  // 一括インポート。クライアントから /api/import/* を6回(World→Scenario→PC×2→NPC×2)叩くと途中で失敗したときに
  // 「Worldだけできて中身が無い」状態が残り、リトライで -2 付きの重複が生える。
  // サーバー側の1呼び出しにまとめて、失敗はエラー1つで返す。
  router.post('/starters/:packId/import', asyncHandler(async (req, res) => {
    const manifest = await dataStore.get(starterManifestKey());
    const pack = (manifest?.packs ?? []).find((p) => p.packId === req.params.packId);
    if (!pack) {
      res.status(404).json({ error: 'unknown starter pack' });
      return;
    }

    // preferredId には manifest 側の packId を渡す(パスパラメータではなく、
    // 自分が書いたマニフェストの値を使う)
    const world = await importWorld(dataStore, textStore, req.userId, pack.worldPublicId, { preferredId: pack.packId });
    if (!world.ok) {
      res.status(500).json({ error: 'starter world is missing; re-run the seed' });
      return;
    }
    const worldId = world.meta.id;

    // preferredId には manifest 側の scenarioId を渡す(worldと同じ理由)。
    // scenarioId を持たない旧マニフェストも有り得るので、その場合は従来の
    // slugify(title)フォールバックにそのまま任せる
    const scenario = await importScenario(dataStore, textStore, req.userId, pack.scenarioPublicId, worldId, {
      preferredId: pack.scenarioId,
    });
    if (!scenario.ok) {
      res.status(500).json({ error: 'starter scenario is missing; re-run the seed' });
      return;
    }

    const imported = { pcs: [], npcs: [] };
    for (const [field, ids] of [['pcs', pack.pcPublicIds ?? []], ['npcs', pack.npcPublicIds ?? []]]) {
      for (const publicId of ids) {
        const result = await importCharacter(dataStore, textStore, req.userId, publicId, worldId);
        if (!result.ok) {
          res.status(500).json({ error: 'starter character is missing; re-run the seed' });
          return;
        }
        imported[field].push(result.meta);
      }
    }

    res.status(201).json({ world: world.meta, scenario: scenario.meta, ...imported });
  }));

  return router;
}
