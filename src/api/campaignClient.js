import { apiFetch } from './apiFetch.js';

export async function listCampaigns(worldId) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/campaigns`);
}

export async function getCampaign(worldId, id) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/campaigns/${encodeURIComponent(id)}`);
}

export async function putCampaign(worldId, id, campaign) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/campaigns/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(campaign),
  });
}

export async function deleteCampaign(worldId, id) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/campaigns/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

function campaignPath(worldId, id) {
  return `/api/worlds/${encodeURIComponent(worldId)}/campaigns/${encodeURIComponent(id)}`;
}

export async function getCampaignSource(worldId, id, kind) {
  return apiFetch(`${campaignPath(worldId, id)}/source/${encodeURIComponent(kind)}`);
}

export async function putCampaignSource(worldId, id, kind, raw) {
  return apiFetch(`${campaignPath(worldId, id)}/source/${encodeURIComponent(kind)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
}

export async function getCampaignReconciliation(worldId, id, sessionId) {
  return apiFetch(
    `${campaignPath(worldId, id)}/chapters/${encodeURIComponent(sessionId)}/reconcile`,
  );
}

export async function reconcileCampaignChapter(worldId, id, sessionId) {
  return apiFetch(
    `${campaignPath(worldId, id)}/chapters/${encodeURIComponent(sessionId)}/reconcile`,
    { method: 'POST' },
  );
}

export async function acceptCampaignReconciliation(worldId, id, sessionId, body) {
  return apiFetch(
    `${campaignPath(worldId, id)}/chapters/${encodeURIComponent(sessionId)}/accept`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

export async function getCampaignPitches(worldId, id) {
  return apiFetch(`${campaignPath(worldId, id)}/next-pitches`);
}

export async function generateCampaignPitches(worldId, id, requestText = '') {
  return apiFetch(`${campaignPath(worldId, id)}/next-pitches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestText }),
  });
}

export async function generateCampaignScenario(worldId, id, pitchId, instructions = '') {
  return apiFetch(`${campaignPath(worldId, id)}/next-scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pitchId, instructions }),
  });
}
