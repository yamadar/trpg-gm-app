import crypto from 'node:crypto';

const PROVIDER_USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function userProfileKey(userId) {
  return `users/${userId}/profile`;
}

export function identityKey(provider, providerUserId) {
  return `auth/identities/${provider}/${providerUserId}`;
}

export async function findOrCreateUser(dataStore, { provider, providerUserId, displayName, avatarUrl }) {
  if (!PROVIDER_USER_ID_RE.test(String(providerUserId))) {
    throw new Error('invalid provider user id');
  }
  const idKey = identityKey(provider, providerUserId);
  const identity = await dataStore.get(idKey);
  if (identity) {
    const existing = await dataStore.get(userProfileKey(identity.userId));
    if (existing) return existing;
  }
  const now = Date.now();
  const user = {
    id: `usr_${crypto.randomBytes(8).toString('hex')}`,
    displayName: displayName || 'ユーザー',
    avatarUrl: avatarUrl || null,
    createdAt: now,
    updatedAt: now,
  };
  await dataStore.set(userProfileKey(user.id), user);
  await dataStore.set(idKey, { userId: user.id });
  return user;
}

export async function getUser(dataStore, userId) {
  return dataStore.get(userProfileKey(userId));
}

export async function updateUserProfile(dataStore, userId, patch) {
  const user = await dataStore.get(userProfileKey(userId));
  if (!user) throw new Error('user not found');
  const updated = { ...user, ...patch, id: user.id, updatedAt: Date.now() };
  await dataStore.set(userProfileKey(userId), updated);
  return updated;
}
