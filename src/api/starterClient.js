import { apiFetch } from './apiFetch.js';

export async function listStarters() {
  return apiFetch('/api/starters');
}

export async function importStarterPack(packId) {
  return apiFetch(`/api/starters/${encodeURIComponent(packId)}/import`, { method: 'POST' });
}
