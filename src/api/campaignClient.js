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

// 204(no body)を返すため apiFetch(res.json()) は使わず生のfetchでok判定のみ行う。
export async function deleteCampaign(worldId, id) {
  const res = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/campaigns/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
