async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function getScenario(worldId, id) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function putScenario(worldId, id, { title, raw, recommendedRuleset }) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, raw, recommendedRuleset }),
  });
}

export async function listScenarios(worldId) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios`, { method: 'GET' });
}

export async function deleteScenario(worldId, id) {
  const res = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
