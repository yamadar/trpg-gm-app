import { apiFetch } from './apiFetch.js';

async function rawDelete(url) {
  return apiFetch(url, { method: 'DELETE' });
}

export async function listPublic(type, { q, moods, ruleset, ownerId, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (moods && moods.length > 0) params.set('moods', moods.join(','));
  if (ruleset) params.set('ruleset', ruleset);
  if (ownerId) params.set('ownerId', ownerId);
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const qs = params.toString();
  return apiFetch(`/api/public/${encodeURIComponent(type)}${qs ? `?${qs}` : ''}`);
}

export async function getPublic(type, publicId) {
  return apiFetch(`/api/public/${encodeURIComponent(type)}/${encodeURIComponent(publicId)}`);
}

export function publicNovelImageUrl(publicId, imageId) {
  return `/api/public/novels/${encodeURIComponent(publicId)}/images/${encodeURIComponent(imageId)}`;
}

export async function publishWorld(worldId) {
  return apiFetch(`/api/publish/worlds/${encodeURIComponent(worldId)}`, { method: 'POST' });
}

export async function unpublishWorld(worldId) {
  return rawDelete(`/api/publish/worlds/${encodeURIComponent(worldId)}`);
}

export async function publishCharacter(worldId, kind, name) {
  return apiFetch(
    `/api/publish/worlds/${encodeURIComponent(worldId)}/characters/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`,
    { method: 'POST' }
  );
}

export async function unpublishCharacter(worldId, kind, name) {
  return rawDelete(
    `/api/publish/worlds/${encodeURIComponent(worldId)}/characters/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`
  );
}

export async function publishScenario(worldId, scenarioId) {
  return apiFetch(
    `/api/publish/worlds/${encodeURIComponent(worldId)}/scenarios/${encodeURIComponent(scenarioId)}`,
    { method: 'POST' }
  );
}

export async function unpublishScenario(worldId, scenarioId) {
  return rawDelete(
    `/api/publish/worlds/${encodeURIComponent(worldId)}/scenarios/${encodeURIComponent(scenarioId)}`
  );
}

export async function publishNovel(sessionId) {
  return apiFetch(`/api/publish/sessions/${encodeURIComponent(sessionId)}/novel`, { method: 'POST' });
}

export async function unpublishNovel(sessionId) {
  return rawDelete(`/api/publish/sessions/${encodeURIComponent(sessionId)}/novel`);
}

export async function publishedWorlds() {
  return apiFetch('/api/publish/worlds');
}

export async function publishedCharacters(worldId, kind) {
  return apiFetch(`/api/publish/worlds/${encodeURIComponent(worldId)}/characters/${encodeURIComponent(kind)}`);
}

export async function publishedScenarios(worldId) {
  return apiFetch(`/api/publish/worlds/${encodeURIComponent(worldId)}/scenarios`);
}

export async function publishedNovels() {
  return apiFetch('/api/publish/sessions');
}

// duplicate: 取り込み済みでも、もう1つ別のものとして取り込む。省略時はサーバーが
// 409 { error: 'already_imported', existing } を返すので、呼び出し側で確認を挟む。
export async function importWorld(publicId, { duplicate = false } = {}) {
  return apiFetch(`/api/import/worlds/${encodeURIComponent(publicId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ duplicate }),
  });
}

export async function importCharacter(publicId, targetWorldId, { duplicate = false } = {}) {
  return apiFetch(`/api/import/characters/${encodeURIComponent(publicId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetWorldId, duplicate }),
  });
}

export async function importScenario(publicId, targetWorldId, { duplicate = false } = {}) {
  return apiFetch(`/api/import/scenarios/${encodeURIComponent(publicId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetWorldId, duplicate }),
  });
}

export async function getUserProfile(userId) {
  return apiFetch(`/api/users/${encodeURIComponent(userId)}`);
}
