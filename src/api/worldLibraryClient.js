import { apiFetch } from './apiFetch.js';

export async function putWorld(id, { title, raw, moods }) {
  return apiFetch(`/api/worlds/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, raw, moods }),
  });
}

export async function putWorldSource(id, raw) {
  return apiFetch(`/api/worlds/${encodeURIComponent(id)}/source`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
}

export async function getWorldSource(id) {
  return apiFetch(`/api/worlds/${encodeURIComponent(id)}/source`, { method: 'GET' });
}

export async function putRegion(worldId, region, { title, raw }) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/regions/${encodeURIComponent(region)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, raw }),
  });
}

export async function putCategory(worldId, category, { title, raw }) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/categories/${encodeURIComponent(category)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, raw }),
  });
}

export async function getWorld(id) {
  return apiFetch(`/api/worlds/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function listWorlds() {
  return apiFetch('/api/worlds', { method: 'GET' });
}

export async function deleteWorld(id) {
  return apiFetch(`/api/worlds/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listRegions(worldId) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/regions`, { method: 'GET' });
}

export async function getRegion(worldId, region) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/regions/${encodeURIComponent(region)}`, { method: 'GET' });
}

export async function listCategories(worldId) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/categories`, { method: 'GET' });
}

export async function getCategory(worldId, category) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/categories/${encodeURIComponent(category)}`, { method: 'GET' });
}

export async function deleteRegion(worldId, region) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/regions/${encodeURIComponent(region)}`, {
    method: 'DELETE',
  });
}

export async function deleteCategory(worldId, category) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/categories/${encodeURIComponent(category)}`, {
    method: 'DELETE',
  });
}
