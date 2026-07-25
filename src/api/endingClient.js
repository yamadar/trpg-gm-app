import { apiFetch } from './apiFetch.js';

export async function recordEnding(sessionId, stats) {
  return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/ending`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stats }),
  });
}

export async function listEndings() {
  return apiFetch('/api/endings');
}

export async function renameEnding(sessionId, endingTitle) {
  return apiFetch(`/api/endings/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endingTitle }),
  });
}

// 204(本文なし)を返すため、JSONを読むapiFetchではなく素のfetchを使う
// (src/api/campaignClient.js の削除と同じ流儀)。
export async function deleteEnding(sessionId) {
  const res = await fetch(`/api/endings/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
