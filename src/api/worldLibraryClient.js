async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function putWorld(id, { title, raw }) {
  return apiFetch(`/api/worlds/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, raw }),
  });
}

export async function putWorldSource(id, raw) {
  return apiFetch(`/api/worlds/${id}/source`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
}

export async function getWorldSource(id) {
  return apiFetch(`/api/worlds/${id}/source`, { method: 'GET' });
}

export async function putRegion(worldId, region, raw) {
  return apiFetch(`/api/worlds/${worldId}/regions/${region}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
}

export async function putCategory(worldId, category, raw) {
  return apiFetch(`/api/worlds/${worldId}/categories/${category}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
}

export async function getWorld(id) {
  return apiFetch(`/api/worlds/${id}`, { method: 'GET' });
}

export async function listWorlds() {
  return apiFetch('/api/worlds', { method: 'GET' });
}

export async function deleteWorld(id) {
  const res = await fetch(`/api/worlds/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}

export async function listRegions(worldId) {
  return apiFetch(`/api/worlds/${worldId}/regions`, { method: 'GET' });
}

export async function getRegion(worldId, region) {
  return apiFetch(`/api/worlds/${worldId}/regions/${region}`, { method: 'GET' });
}

export async function listCategories(worldId) {
  return apiFetch(`/api/worlds/${worldId}/categories`, { method: 'GET' });
}

export async function getCategory(worldId, category) {
  return apiFetch(`/api/worlds/${worldId}/categories/${category}`, { method: 'GET' });
}
