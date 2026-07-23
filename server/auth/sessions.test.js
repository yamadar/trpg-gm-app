// server/auth/sessions.test.js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from '../storage/dataStore.js';
import {
  createAuthSession, getAuthSession, deleteAuthSession, authSessionKey, SESSION_TTL_MS,
} from './sessions.js';
import { sha256hex } from './crypto.js';

let dir;
let dataStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-sessions-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('auth sessions', () => {
  it('creates a session and resolves it by token', async () => {
    const token = await createAuthSession(dataStore, 'usr_1');
    const session = await getAuthSession(dataStore, token);
    expect(session.userId).toBe('usr_1');
  });

  it('stores only the sha256 hash of the token', async () => {
    const token = await createAuthSession(dataStore, 'usr_1');
    expect(await dataStore.get(authSessionKey(sha256hex(token)))).not.toBeNull();
    expect(await dataStore.get(authSessionKey(token))).toBeNull();
  });

  it('returns null for an unknown or empty token', async () => {
    expect(await getAuthSession(dataStore, 'no-such-token')).toBeNull();
    expect(await getAuthSession(dataStore, undefined)).toBeNull();
  });

  it('deletes an expired session and returns null', async () => {
    const t0 = 1_000_000;
    const token = await createAuthSession(dataStore, 'usr_1', t0);
    const after = t0 + SESSION_TTL_MS + 1;
    expect(await getAuthSession(dataStore, token, after)).toBeNull();
    expect(await dataStore.get(authSessionKey(sha256hex(token)))).toBeNull();
  });

  it('slides the expiry when less than half of the TTL remains', async () => {
    const t0 = 1_000_000;
    const token = await createAuthSession(dataStore, 'usr_1', t0);
    const later = t0 + SESSION_TTL_MS * 0.6;
    const session = await getAuthSession(dataStore, token, later);
    expect(session.expiresAt).toBe(later + SESSION_TTL_MS);
    expect(session.renewed).toBe(true);
    const persisted = await dataStore.get(authSessionKey(sha256hex(token)));
    expect(persisted.renewed).toBeUndefined();
    expect('renewed' in persisted).toBe(false);
  });

  it('does not rewrite the session when plenty of TTL remains', async () => {
    const t0 = 1_000_000;
    const token = await createAuthSession(dataStore, 'usr_1', t0);
    const soon = t0 + 1000;
    const session = await getAuthSession(dataStore, token, soon);
    expect(session.expiresAt).toBe(t0 + SESSION_TTL_MS);
    expect(session.renewed).toBeFalsy();
  });

  it('deleteAuthSession removes the session', async () => {
    const token = await createAuthSession(dataStore, 'usr_1');
    await deleteAuthSession(dataStore, token);
    expect(await getAuthSession(dataStore, token)).toBeNull();
  });
});
