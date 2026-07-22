async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function getRuleset(id) {
  return apiFetch(`/api/rulesets/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function putRuleset(id, { label, desc, hint, growthUnit }) {
  return apiFetch(`/api/rulesets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, desc, hint, growthUnit }),
  });
}

export async function listRulesets() {
  return apiFetch('/api/rulesets', { method: 'GET' });
}

export async function deleteRuleset(id) {
  const res = await fetch(`/api/rulesets/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
