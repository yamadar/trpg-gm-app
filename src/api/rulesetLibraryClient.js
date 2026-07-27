import { apiFetch } from './apiFetch.js';

export async function getRuleset(id) {
  return apiFetch(`/api/rulesets/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function putRuleset(id, { label, desc, hint, growthUnit, formula }) {
  return apiFetch(`/api/rulesets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, desc, hint, growthUnit, formula }),
  });
}

export async function listRulesets() {
  return apiFetch('/api/rulesets', { method: 'GET' });
}

export async function deleteRuleset(id) {
  return apiFetch(`/api/rulesets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
