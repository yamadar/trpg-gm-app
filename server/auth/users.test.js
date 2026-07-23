// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from '../storage/dataStore.js';
import { findOrCreateUser, getUser, updateUserProfile, identityKey, userProfileKey } from './users.js';

let dir;
let dataStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-users-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const profile = { provider: 'google', providerUserId: '12345', displayName: '太郎', avatarUrl: 'https://example.com/a.png' };

describe('users', () => {
  it('creates a new user with provider profile as initial values', async () => {
    const user = await findOrCreateUser(dataStore, profile);
    expect(user.id).toMatch(/^usr_[0-9a-f]{16}$/);
    expect(user.displayName).toBe('太郎');
    expect(user.avatarUrl).toBe('https://example.com/a.png');
    expect(await getUser(dataStore, user.id)).toEqual(user);
  });

  it('returns the same user on second login with the same identity', async () => {
    const first = await findOrCreateUser(dataStore, profile);
    const second = await findOrCreateUser(dataStore, { ...profile, displayName: '別名' });
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('太郎'); // 2回目以降はプロバイダ値で上書きしない
  });

  it('different identities create different users', async () => {
    const a = await findOrCreateUser(dataStore, profile);
    const b = await findOrCreateUser(dataStore, { ...profile, provider: 'discord' });
    expect(b.id).not.toBe(a.id);
  });

  it('stores the identity mapping', async () => {
    const user = await findOrCreateUser(dataStore, profile);
    expect(await dataStore.get(identityKey('google', '12345'))).toEqual({ userId: user.id });
  });

  it('rejects a filesystem-unsafe providerUserId', async () => {
    await expect(findOrCreateUser(dataStore, { ...profile, providerUserId: '../evil' })).rejects.toThrow();
  });

  it('updateUserProfile changes only given fields', async () => {
    const user = await findOrCreateUser(dataStore, profile);
    const updated = await updateUserProfile(dataStore, user.id, { avatarUrl: null });
    expect(updated.avatarUrl).toBeNull();
    expect(updated.displayName).toBe('太郎');
    expect(updated.updatedAt).toBeGreaterThanOrEqual(user.updatedAt);
  });

  it('creates users with an empty bio by default', async () => {
    const user = await findOrCreateUser(dataStore, profile);
    expect(user.bio).toBe('');
  });

  it('getUser backfills bio for records saved before the field existed', async () => {
    const user = await findOrCreateUser(dataStore, profile);
    // bioフィールドを持たない旧レコードを直接書き戻す
    const raw = await dataStore.get(userProfileKey(user.id));
    delete raw.bio;
    await dataStore.set(userProfileKey(user.id), raw);
    expect((await getUser(dataStore, user.id)).bio).toBe('');
  });

  it('updateUserProfile can set and clear bio', async () => {
    const user = await findOrCreateUser(dataStore, profile);
    expect((await updateUserProfile(dataStore, user.id, { bio: 'よろしく' })).bio).toBe('よろしく');
    expect((await updateUserProfile(dataStore, user.id, { bio: '' })).bio).toBe('');
  });
});
