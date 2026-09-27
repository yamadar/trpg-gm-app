import { apiFetch } from './apiFetch.js';
import { rememberSessionSync } from './sessionSyncClient.js';

export async function deleteSceneImage(sessionId, imageId) {
  const result = await apiFetch(sceneImageUrl(sessionId, imageId), { method: 'DELETE' });
  rememberSessionSync(result.session);
  return result.session;
}

export async function generateSceneImage(sessionId, logIndex) {
  return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logIndex }),
  });
}

export function sceneImageUrl(sessionId, imageId) {
  return `/api/sessions/${encodeURIComponent(sessionId)}/images/${encodeURIComponent(imageId)}`;
}

export async function getConfig() {
  return apiFetch('/api/config');
}
