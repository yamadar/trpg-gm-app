import { apiFetch } from './apiFetch.js';

export function loginUrl(provider, returnTo = '') {
  return `/auth/${provider}/start${returnTo.startsWith('#/') ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
}

export async function startIdentityLink(provider) {
  return apiFetch(`/auth/${encodeURIComponent(provider)}/link/start`, { method: 'POST' });
}

export async function fetchMe() {
  return apiFetch('/api/me');
}

export async function fetchProviders() {
  return apiFetch('/api/auth/providers');
}

export async function patchMe(patch) {
  return apiFetch('/api/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function logout() {
  return apiFetch('/auth/logout', { method: 'POST' });
}
