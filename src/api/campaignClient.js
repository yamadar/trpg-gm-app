import { apiFetch } from './apiFetch.js';

export async function listCampaigns(worldId) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/campaigns`);
}

export async function getCampaign(worldId, id) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/campaigns/${encodeURIComponent(id)}`);
}

export async function putCampaign(worldId, id, { title, carriedPc, chapters }) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/campaigns/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, carriedPc, chapters }),
  });
}

export async function deleteCampaign(worldId, id) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/campaigns/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
