import { scenarioAttachmentDir, scenarioMetaKey, scenarioDocPath } from './paths.js';
import { getAttachmentCollection, topAttachmentOf } from './attachmentLibrary.js';

// rawはユーザー入力そのものをsource of truthとして保存する。directorGuideはrawを
// 書き換えた本文ではなく、AI GMが進行判断に使う派生データ。
// sourcePublicId の扱いは saveWorld と同じ(取り込み元の印を編集保存で失わせない)。
export async function saveScenario(
  dataStore,
  textStore,
  userId,
  {
    worldId,
    id,
    title,
    raw,
    recommendedRuleset,
    moods,
    sourcePublicId,
    sourceCampaignId,
    sourceCampaignRevision,
    generatedFromPitchId,
    directorGuide,
  },
) {
  await textStore.write(scenarioDocPath(userId, worldId, id), raw);
  const prev = await dataStore.get(scenarioMetaKey(userId, worldId, id));
  const meta = {
    id,
    worldId,
    title,
    recommendedRuleset: recommendedRuleset ?? null,
    moods: Array.isArray(moods) ? moods : [],
    sourcePublicId: sourcePublicId ?? prev?.sourcePublicId ?? null,
    sourceCampaignId: sourceCampaignId ?? prev?.sourceCampaignId ?? null,
    sourceCampaignRevision: sourceCampaignRevision ?? prev?.sourceCampaignRevision ?? null,
    generatedFromPitchId: generatedFromPitchId ?? prev?.generatedFromPitchId ?? null,
    // rawの更新と古いガイドの組み合わせを残さない。解析結果を同時に渡さない
    // 内部保存経路ではnullへ戻し、誤った進行判断より原文単独を優先する。
    directorGuide: directorGuide ?? null,
    updatedAt: Date.now(),
  };
  await dataStore.set(scenarioMetaKey(userId, worldId, id), meta);
  return { ...meta, raw };
}

export async function getScenario(dataStore, textStore, userId, worldId, id) {
  const meta = await dataStore.get(scenarioMetaKey(userId, worldId, id));
  if (!meta) return null;
  const raw = (await textStore.read(scenarioDocPath(userId, worldId, id))) ?? '';
  return { ...meta, moods: meta.moods ?? [], raw };
}

export async function listScenarios(dataStore, userId, worldId) {
  const keys = await dataStore.list(`users/${userId}/worlds/${worldId}/scenarios`);
  const metas = await Promise.all(keys.map((k) => dataStore.get(k)));
  // 進行ガイドは大きく、一覧カードでは不要。シナリオ選択後のgetScenarioで取得する。
  return Promise.all(
    metas.filter(Boolean).map(async ({ directorGuide: _directorGuide, ...m }) => {
      const collection = await getAttachmentCollection(
        dataStore,
        scenarioAttachmentDir(userId, worldId, m.id),
      );
      const topImage = topAttachmentOf(collection);
      return { ...m, moods: m.moods ?? [], ...(topImage ? { topImage } : {}) };
    }),
  );
}

export async function deleteScenario(dataStore, textStore, userId, worldId, id) {
  await dataStore.delete(scenarioMetaKey(userId, worldId, id));
  await textStore.delete(scenarioDocPath(userId, worldId, id));
}
