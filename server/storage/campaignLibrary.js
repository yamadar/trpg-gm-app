import {
  campaignMetaKey,
  campaignListPrefix,
  campaignSourceDocPath,
  campaignDraftKey,
  campaignPitchesKey,
} from './paths.js';
import { emptyCampaignState, normalizeCampaignState } from '../campaignState.js';

export const CAMPAIGN_SOURCE_KINDS = ['bible', 'cast', 'timeline'];

export async function saveCampaign(
  dataStore,
  userId,
  {
    id,
    worldId,
    title,
    carriedPc,
    carriedPcs,
    chapters,
    currentState,
    directorGuide,
    canonRevision,
    rulesetId,
  },
) {
  const existing = await dataStore.get(campaignMetaKey(userId, worldId, id));
  const now = Date.now();
  const meta = {
    id,
    worldId,
    title,
    carriedPc: carriedPc ?? existing?.carriedPc ?? { raw: '', xp: 0 },
    carriedPcs: Array.isArray(carriedPcs)
      ? carriedPcs
      : existing?.carriedPcs ?? (carriedPc ? [{ id: 'pc', ...carriedPc }] : []),
    chapters: Array.isArray(chapters) ? chapters : existing?.chapters ?? [],
    currentState: normalizeCampaignState(currentState ?? existing?.currentState ?? emptyCampaignState()),
    directorGuide: directorGuide === undefined ? existing?.directorGuide ?? null : directorGuide,
    canonRevision: Number.isSafeInteger(canonRevision)
      ? Math.max(0, canonRevision)
      : existing?.canonRevision ?? 0,
    rulesetId: rulesetId ?? existing?.rulesetId ?? 'simple',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await dataStore.set(campaignMetaKey(userId, worldId, id), meta);
  return meta;
}

export async function getCampaign(dataStore, userId, worldId, id) {
  const meta = await dataStore.get(campaignMetaKey(userId, worldId, id));
  if (!meta) return null;
  return {
    ...meta,
    carriedPc: meta.carriedPc ?? { raw: '', xp: 0 },
    carriedPcs: Array.isArray(meta.carriedPcs)
      ? meta.carriedPcs
      : meta.carriedPc ? [{ id: 'pc', ...meta.carriedPc }] : [],
    chapters: Array.isArray(meta.chapters) ? meta.chapters : [],
    currentState: normalizeCampaignState(meta.currentState),
    directorGuide: meta.directorGuide ?? null,
    canonRevision: meta.canonRevision ?? 0,
    rulesetId: meta.rulesetId ?? 'simple',
  };
}

export async function listCampaigns(dataStore, userId, worldId) {
  const keys = await dataStore.list(campaignListPrefix(userId, worldId));
  const metas = await Promise.all(keys.map((k) => dataStore.get(k)));
  return metas.filter(Boolean).map((meta) => ({
    id: meta.id,
    worldId: meta.worldId,
    title: meta.title,
    carriedPc: meta.carriedPc ?? { raw: '', xp: 0 },
    carriedPcs: Array.isArray(meta.carriedPcs)
      ? meta.carriedPcs
      : meta.carriedPc ? [{ id: 'pc', ...meta.carriedPc }] : [],
    chapters: (meta.chapters || []).map(({ outcome: _outcome, ...chapter }) => chapter),
    canonRevision: meta.canonRevision ?? 0,
    rulesetId: meta.rulesetId ?? 'simple',
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  }));
}

export async function deleteCampaign(dataStore, textStore, userId, worldId, id) {
  // SP1時点の内部呼び出し(deleteCampaign(dataStore, userId, worldId, id))も受ける。
  if (typeof textStore === 'string') {
    id = worldId;
    worldId = userId;
    userId = textStore;
    textStore = null;
  }
  const campaignDir = `${campaignListPrefix(userId, worldId)}/${id}`;
  const draftKeys = await dataStore.list(`${campaignDir}/drafts`);
  await Promise.all(draftKeys.map((key) => dataStore.delete(key)));
  await dataStore.delete(campaignMetaKey(userId, worldId, id));
  await dataStore.delete(campaignPitchesKey(userId, worldId, id));
  if (textStore) await textStore.deleteDir(campaignDir);
}

export async function getCampaignSource(textStore, userId, worldId, id, kind) {
  return (await textStore.read(campaignSourceDocPath(userId, worldId, id, kind))) ?? '';
}

export async function saveCampaignSource(textStore, userId, worldId, id, kind, raw) {
  await textStore.write(campaignSourceDocPath(userId, worldId, id, kind), raw);
  return raw;
}

export async function getCampaignSources(textStore, userId, worldId, id) {
  const [bible, cast, timeline] = await Promise.all(
    CAMPAIGN_SOURCE_KINDS.map((kind) => getCampaignSource(textStore, userId, worldId, id, kind)),
  );
  return { bible, cast, timeline };
}

export async function saveCampaignDraft(dataStore, userId, worldId, campaignId, sessionId, draft) {
  await dataStore.set(campaignDraftKey(userId, worldId, campaignId, sessionId), draft);
  return draft;
}

export async function getCampaignDraft(dataStore, userId, worldId, campaignId, sessionId) {
  return (await dataStore.get(campaignDraftKey(userId, worldId, campaignId, sessionId))) ?? null;
}

export async function saveCampaignPitches(dataStore, userId, worldId, campaignId, pitches) {
  await dataStore.set(campaignPitchesKey(userId, worldId, campaignId), pitches);
  return pitches;
}

export async function getCampaignPitches(dataStore, userId, worldId, campaignId) {
  return (await dataStore.get(campaignPitchesKey(userId, worldId, campaignId))) ?? null;
}
