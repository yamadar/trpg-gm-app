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

export async function deleteEnding(sessionId) {
  return apiFetch(`/api/endings/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
}
