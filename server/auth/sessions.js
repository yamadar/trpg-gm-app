import { randomToken, sha256hex } from './crypto.js';

export const SESSION_COOKIE = 'gmdesk_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RENEW_THRESHOLD_MS = SESSION_TTL_MS / 2;

export function authSessionKey(tokenHash) {
  return `auth/sessions/${tokenHash}`;
}

export async function createAuthSession(dataStore, userId, now = Date.now()) {
  const token = randomToken();
  await dataStore.set(authSessionKey(sha256hex(token)), {
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  return token;
}

export async function getAuthSession(dataStore, token, now = Date.now()) {
  if (!token) return null;
  const key = authSessionKey(sha256hex(token));
  const session = await dataStore.get(key);
  if (!session) return null;
  if (session.expiresAt <= now) {
    await dataStore.delete(key);
    return null;
  }
  if (session.expiresAt - now < RENEW_THRESHOLD_MS) {
    session.expiresAt = now + SESSION_TTL_MS;
    await dataStore.set(key, session);
    // Marked only on the in-memory object returned to the caller, after the
    // persisted write above, so `renewed` is never itself written to storage.
    session.renewed = true;
  }
  return session;
}

export async function deleteAuthSession(dataStore, token) {
  if (!token) return;
  await dataStore.delete(authSessionKey(sha256hex(token)));
}
