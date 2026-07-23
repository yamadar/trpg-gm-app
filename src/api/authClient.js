import { apiFetch } from './apiFetch.js';

export function loginUrl(provider) {
  return `/auth/${provider}/start`;
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
