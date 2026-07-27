import { apiFetch } from './apiFetch.js';

export async function getScenario(worldId, id) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function putScenario(worldId, id, { title, raw, recommendedRuleset, moods }) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, raw, recommendedRuleset, moods }),
  });
}

export async function listScenarios(worldId) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios`, { method: 'GET' });
}

export async function deleteScenario(worldId, id) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
