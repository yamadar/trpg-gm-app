import crypto from 'node:crypto';
import { findOrCreateUser } from './users.js';
import { createAuthSession, SESSION_COOKIE } from './sessions.js';

export async function createTestUserSession(dataStore, { displayName = 'テストユーザー' } = {}) {
  const user = await findOrCreateUser(dataStore, {
    provider: 'google',
    providerUserId: `test-${crypto.randomBytes(6).toString('hex')}`,
    displayName,
    avatarUrl: null,
  });
  const token = await createAuthSession(dataStore, user.id);
  return { user, cookie: `${SESSION_COOKIE}=${token}` };
}
