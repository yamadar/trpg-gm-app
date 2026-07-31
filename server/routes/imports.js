import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard, isValidId } from './validateId.js';
import { importWorld, importCharacter, importScenario } from '../storage/importLibrary.js';
import { starterManifestKey } from '../storage/paths.js';

export function createImportsRouter({ dataStore, textStore, imageStore }) {
  const router = Router();
  router.param('publicId', idParamGuard);
  router.param('packId', idParamGuard);

  function sendImport(res, result) {
    if (result.ok) {
      res.status(201).json(result.meta);
      return;
    }
    // 取り込み済み。黙って複製すると、押した回数だけ -2 / -3 付きの素材が積み上がる。
    // 「別のものとして取り込むか」を決めるのはユーザーなので、既存を添えて突き返し、
    // duplicate:true で叩き直してもらう。
    if (result.reason === 'already_imported') {
      res.status(409).json({ error: 'already_imported', existing: result.existing });
      return;
    }
    res.status(404).json({ error: result.reason === 'target_not_found' ? 'target world not found' : 'not found' });
  }

  // duplicate:true は「取り込み済みだと分かったうえで、もう1つ別に取り込む」の意思表示。
  function onDuplicateOf(req) {
    return req.body?.duplicate === true ? 'copy' : 'reject';
  }

  router.post('/import/worlds/:publicId', asyncHandler(async (req, res) => {
    sendImport(res, await importWorld(dataStore, textStore, req.userId, req.params.publicId, {
      onDuplicate: onDuplicateOf(req),
      imageStore,
    }));
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
    sendImport(res, await importCharacter(dataStore, textStore, req.userId, req.params.publicId, target, {
      onDuplicate: onDuplicateOf(req),
      imageStore,
    }));
  }));

  router.post('/import/scenarios/:publicId', asyncHandler(async (req, res) => {
    const target = targetWorldIdOf(req, res);
    if (target === null) return;
    sendImport(res, await importScenario(dataStore, textStore, req.userId, req.params.publicId, target, {
      onDuplicate: onDuplicateOf(req),
      imageStore,
    }));
  }));

  // 一括インポート。クライアントから /api/import/* を6回(World→Scenario→PC×2→NPC×2)叩くと途中で失敗したときに
  // 「Worldだけできて中身が無い」状態が残り、リトライで -2 付きの重複が生える。
  // サーバー側の1呼び出しにまとめて、失敗はエラー1つで返す。
  //
  // onDuplicate:'reuse': この入口(「この冒険を始める」)は同じ一式を何度でも始められる導線なので、
  // 押すたびに素材が増えては困る。取り込み済みなら既存の World / Scenario / Character を
  // そのまま返して遊び始めさせる(中身は上書きしないので、取り込み後の書き換えも残る)。
  router.post('/starters/:packId/import', asyncHandler(async (req, res) => {
    const manifest = await dataStore.get(starterManifestKey());
    const pack = (manifest?.packs ?? []).find((p) => p.packId === req.params.packId);
    if (!pack) {
      res.status(404).json({ error: 'unknown starter pack' });
      return;
    }

    // preferredId には manifest 側の packId を渡す(パスパラメータではなく、
    // 自分が書いたマニフェストの値を使う)
    const world = await importWorld(dataStore, textStore, req.userId, pack.worldPublicId, {
      preferredId: pack.packId,
      onDuplicate: 'reuse',
      imageStore,
    });
    if (!world.ok) {
      res.status(500).json({ error: 'starter world is missing; re-run the seed' });
      return;
    }
    const worldId = world.meta.id;

    // 新マニフェストは複数話を `scenarios` に持つ。旧マニフェストは singular の
    // scenarioId/scenarioPublicId だけなので、同じ配列形へ正規化して処理する。
    const scenarioEntries = Array.isArray(pack.scenarios) && pack.scenarios.length > 0
      ? pack.scenarios
      : [{ id: pack.scenarioId, publicId: pack.scenarioPublicId }];
    const scenarios = [];
    for (const entry of scenarioEntries) {
      // preferredId には manifest 側の id を渡す(worldと同じ理由)。id を持たない
      // 旧マニフェストは従来のslugify(title)フォールバックへ任せる。
      const result = await importScenario(dataStore, textStore, req.userId, entry.publicId, worldId, {
        preferredId: entry.id,
        onDuplicate: 'reuse',
        imageStore,
      });
      if (!result.ok) {
        res.status(500).json({ error: 'starter scenario is missing; re-run the seed' });
        return;
      }
      scenarios.push(result.meta);
    }

    const imported = { pcs: [], npcs: [] };
    for (const [field, ids] of [['pcs', pack.pcPublicIds ?? []], ['npcs', pack.npcPublicIds ?? []]]) {
      for (const publicId of ids) {
        const result = await importCharacter(dataStore, textStore, req.userId, publicId, worldId, {
          onDuplicate: 'reuse',
          imageStore,
        });
        if (!result.ok) {
          res.status(500).json({ error: 'starter character is missing; re-run the seed' });
          return;
        }
        imported[field].push(result.meta);
      }
    }

    // `scenario` はSetupへ渡す開始話。全話は素材ライブラリへ取り込み済みで、
    // API利用者は `scenarios` から続話も確認できる。
    res.status(201).json({ world: world.meta, scenario: scenarios[0], scenarios, ...imported });
  }));

  return router;
}
