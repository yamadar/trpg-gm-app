async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function getRuleset(id) {
  return apiFetch(`/api/rulesets/${id}`, { method: 'GET' });
}

export async function putRuleset(id, { label, desc, hint }) {
  return apiFetch(`/api/rulesets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, desc, hint }),
  });
}

export async function listRulesets() {
  return apiFetch('/api/rulesets', { method: 'GET' });
}

export async function deleteRuleset(id) {
  const res = await fetch(`/api/rulesets/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
