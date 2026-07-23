# 認証・ユーザー管理 (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ソーシャルログイン(Google/Discord/X)とユーザー管理を導入し、サーバー上の全データをユーザー名前空間化し、AI利用に日次制限をかける。

**Architecture:** Express上に自前OAuth 2.0 (Authorization Code + PKCE)を実装。ログインはhttpOnlyクッキー + サーバーサイドセッション(SHA-256ハッシュ保存)。全データは既存`dataStore`/`textStore`のキーを`users/{userId}/...`配下に移す。フロントは`AuthContext`で認証状態を配り、未ログイン時はAI進行・ライブラリ・小説化・同期をゲートする。

**Tech Stack:** 既存スタックのみ(Express / React / vitest / supertest)。**新規依存なし**(OAuthのトークン交換・プロファイル取得は`fetchImpl`注入の生fetchで実装 — 既存のテストパターンと整合させるため。設計書の`arctic`案はこの理由で置き換え、設計書に追記済み)。

**Spec:** `docs/superpowers/specs/2026-07-23-auth-user-management-design.md`

## Global Constraints

- メールアドレスは取得も保存もしない。スコープは Google `openid profile` / Discord `identify` / X `users.read tweet.read` のみ
- 保存するユーザー情報は `{ id, displayName, avatarUrl, createdAt, updatedAt }` のみ
- 認証不要エンドポイントは `/auth/*`、`GET /api/auth/providers`、`GET /api/me`(未ログイン時 `200 { user: null }`)の3種のみ。他の`/api/*`は401
- 利用制限の既定値: `LIMIT_MESSAGES_PER_DAY=200`、`LIMIT_NOVELIZE_PER_DAY=10`。超過は `429 { error, resetAt }`。UTC日付でリセット
- ログインセッションTTLは30日スライディング(残り15日を切ったら延長)
- クッキー: `httpOnly; SameSite=Lax; Path=/`、本番のみ`Secure`
- サーバーテストは `// @vitest-environment node` + supertest + `fetchImpl`注入、クライアントは testing-library という既存パターンを踏襲
- すべてのUI文言は日本語(既存トーンに合わせ「〜が必要です」調)
- コミットは各タスク末尾で行う。コミットメッセージは既存の `feat:`/`test:`/`docs:` 規約に従う

## 実行前の注意

- 作業ツリーに未コミットの変更(`server/routes/sessions.js`ほか)が残っている場合、それはこの計画とは別の作業。**触らず**、自タスクのファイルだけをstageして`git add <個別ファイル>`でコミットすること
- 全タスク完了後の受け入れ確認: `npm test` が全パス

---

### Task 1: 認証用暗号ユーティリティ `server/auth/crypto.js`

**Files:**
- Create: `server/auth/crypto.js`
- Test: `server/auth/crypto.test.js`

**Interfaces:**
- Produces: `randomToken(): string`(base64url 32bytes) / `sha256hex(input: string): string` / `codeChallengeS256(verifier: string): string`(base64url)

- [ ] **Step 1: Write the failing test**

```js
// server/auth/crypto.test.js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { randomToken, sha256hex, codeChallengeS256 } from './crypto.js';

describe('auth crypto utils', () => {
  it('randomToken returns unique url-safe tokens', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  it('sha256hex returns a stable 64-char hex digest', () => {
    expect(sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('codeChallengeS256 matches RFC7636 appendix B example', () => {
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/auth/crypto.test.js`
Expected: FAIL (Cannot find module './crypto.js')

- [ ] **Step 3: Write implementation**

```js
// server/auth/crypto.js
import crypto from 'node:crypto';

export function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function codeChallengeS256(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/auth/crypto.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/auth/crypto.js server/auth/crypto.test.js
git commit -m "feat(auth): 暗号ユーティリティ(randomToken/sha256hex/PKCE challenge)"
```

---

### Task 2: ログインセッション管理 `server/auth/sessions.js`

**Files:**
- Create: `server/auth/sessions.js`
- Test: `server/auth/sessions.test.js`

**Interfaces:**
- Consumes: Task 1の`randomToken`/`sha256hex`
- Produces:
  - `SESSION_COOKIE = 'gmdesk_session'`(クッキー名定数)
  - `SESSION_TTL_MS`(30日)
  - `authSessionKey(tokenHash: string): string` → `auth/sessions/{tokenHash}`
  - `createAuthSession(dataStore, userId, now?): Promise<string>` — 平文トークンを返す。保存は`{ userId, createdAt, expiresAt }`
  - `getAuthSession(dataStore, token, now?): Promise<{userId,createdAt,expiresAt}|null>` — 期限切れは削除してnull。残りTTLが半分未満なら延長保存
  - `deleteAuthSession(dataStore, token): Promise<void>`

- [ ] **Step 1: Write the failing test**

```js
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
  });

  it('does not rewrite the session when plenty of TTL remains', async () => {
    const t0 = 1_000_000;
    const token = await createAuthSession(dataStore, 'usr_1', t0);
    const soon = t0 + 1000;
    const session = await getAuthSession(dataStore, token, soon);
    expect(session.expiresAt).toBe(t0 + SESSION_TTL_MS);
  });

  it('deleteAuthSession removes the session', async () => {
    const token = await createAuthSession(dataStore, 'usr_1');
    await deleteAuthSession(dataStore, token);
    expect(await getAuthSession(dataStore, token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/auth/sessions.test.js`
Expected: FAIL (Cannot find module './sessions.js')

- [ ] **Step 3: Write implementation**

```js
// server/auth/sessions.js
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
  }
  return session;
}

export async function deleteAuthSession(dataStore, token) {
  if (!token) return;
  await dataStore.delete(authSessionKey(sha256hex(token)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/auth/sessions.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/auth/sessions.js server/auth/sessions.test.js
git commit -m "feat(auth): ログインセッション(ハッシュ保存・30日スライディング)"
```

---

### Task 3: ユーザー永続化 `server/auth/users.js`

**Files:**
- Create: `server/auth/users.js`
- Test: `server/auth/users.test.js`

**Interfaces:**
- Produces:
  - `userProfileKey(userId): string` → `users/{userId}/profile`
  - `identityKey(provider, providerUserId): string` → `auth/identities/{provider}/{providerUserId}`
  - `findOrCreateUser(dataStore, { provider, providerUserId, displayName, avatarUrl }): Promise<User>` — 既存identityがあれば既存ユーザー、なければ`usr_{16hex}`で新規作成。`providerUserId`が`/^[A-Za-z0-9_-]{1,64}$/`に合わなければthrow
  - `getUser(dataStore, userId): Promise<User|null>`
  - `updateUserProfile(dataStore, userId, { displayName?, avatarUrl? }): Promise<User>` — 渡されたキーのみ更新、`updatedAt`更新
- User型: `{ id, displayName, avatarUrl, createdAt, updatedAt }`

- [ ] **Step 1: Write the failing test**

```js
// server/auth/users.test.js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from '../storage/dataStore.js';
import { findOrCreateUser, getUser, updateUserProfile, identityKey } from './users.js';

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/auth/users.test.js`
Expected: FAIL (Cannot find module './users.js')

- [ ] **Step 3: Write implementation**

```js
// server/auth/users.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/auth/users.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/auth/users.js server/auth/users.test.js
git commit -m "feat(auth): ユーザー永続化(identity逆引き・プロフィール更新)"
```

---

### Task 4: OAuthプロバイダ定義 `server/auth/providers.js`

**Files:**
- Create: `server/auth/providers.js`
- Test: `server/auth/providers.test.js`

**Interfaces:**
- Consumes: Task 1の`codeChallengeS256`
- Produces:
  - `createProviders(env): Record<string, Provider>` — env内に`GOOGLE_CLIENT_ID`+`GOOGLE_CLIENT_SECRET`(同様に`DISCORD_`/`X_`)が揃うプロバイダのみ返す
  - `redirectUri(baseUrl, name): string` → `{baseUrl}/auth/{name}/callback`
  - `authorizationUrl(provider, { baseUrl, state, codeVerifier }): string`
  - `exchangeCode(fetchImpl, provider, { baseUrl, code, codeVerifier }): Promise<string>` — access_tokenを返す。失敗throw
  - `fetchProfile(fetchImpl, provider, accessToken): Promise<{ providerUserId, displayName, avatarUrl }>`

- [ ] **Step 1: Write the failing test**

```js
// server/auth/providers.test.js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createProviders, authorizationUrl, exchangeCode, fetchProfile, redirectUri } from './providers.js';

const env = {
  GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec',
  DISCORD_CLIENT_ID: 'did', DISCORD_CLIENT_SECRET: 'dsec',
  X_CLIENT_ID: 'xid', X_CLIENT_SECRET: 'xsec',
};
const BASE = 'http://localhost:5173';

function jsonResponse(data) {
  return { ok: true, json: async () => data, text: async () => JSON.stringify(data) };
}

describe('createProviders', () => {
  it('returns only providers whose id and secret are both set', () => {
    expect(Object.keys(createProviders(env)).sort()).toEqual(['discord', 'google', 'x']);
    expect(Object.keys(createProviders({ GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec' }))).toEqual(['google']);
    expect(Object.keys(createProviders({ GOOGLE_CLIENT_ID: 'gid' }))).toEqual([]);
  });
});

describe('authorizationUrl', () => {
  it('builds a PKCE authorization URL with minimal scopes and no email', () => {
    const { google } = createProviders(env);
    const url = new URL(authorizationUrl(google, { baseUrl: BASE, state: 'st1', codeVerifier: 'ver1' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('gid');
    expect(url.searchParams.get('redirect_uri')).toBe(`${BASE}/auth/google/callback`);
    expect(url.searchParams.get('scope')).toBe('openid profile');
    expect(url.searchParams.get('state')).toBe('st1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('scope')).not.toContain('email');
  });
});

describe('exchangeCode', () => {
  it('posts form-encoded params with client credentials in the body (google)', async () => {
    const { google } = createProviders(env);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'tok' }));
    const token = await exchangeCode(fetchImpl, google, { baseUrl: BASE, code: 'c1', codeVerifier: 'v1' });
    expect(token).toBe('tok');
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(options.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('c1');
    expect(body.get('code_verifier')).toBe('v1');
    expect(body.get('client_id')).toBe('gid');
    expect(body.get('client_secret')).toBe('gsec');
    expect(body.get('redirect_uri')).toBe(redirectUri(BASE, 'google'));
  });

  it('uses Basic auth for x instead of body credentials', async () => {
    const { x } = createProviders(env);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'tok' }));
    await exchangeCode(fetchImpl, x, { baseUrl: BASE, code: 'c1', codeVerifier: 'v1' });
    const [, options] = fetchImpl.mock.calls[0];
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('xid:xsec').toString('base64')}`);
    const body = new URLSearchParams(options.body);
    expect(body.get('client_secret')).toBeNull();
  });

  it('throws when the token endpoint fails or returns no token', async () => {
    const { google } = createProviders(env);
    await expect(
      exchangeCode(async () => ({ ok: false, status: 400, text: async () => 'bad' }), google, { baseUrl: BASE, code: 'c', codeVerifier: 'v' })
    ).rejects.toThrow(/token exchange failed/);
    await expect(
      exchangeCode(async () => jsonResponse({}), google, { baseUrl: BASE, code: 'c', codeVerifier: 'v' })
    ).rejects.toThrow(/no access_token/);
  });
});

describe('fetchProfile', () => {
  it('normalizes a google userinfo response', async () => {
    const { google } = createProviders(env);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ sub: '111', name: '太郎', picture: 'https://p/x.png' }));
    const profile = await fetchProfile(fetchImpl, google, 'tok');
    expect(profile).toEqual({ providerUserId: '111', displayName: '太郎', avatarUrl: 'https://p/x.png' });
    const [, options] = fetchImpl.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer tok');
  });

  it('normalizes a discord @me response and builds the avatar CDN url', async () => {
    const { discord } = createProviders(env);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: '222', username: 'taro', global_name: 'タロー', avatar: 'abc' }));
    const profile = await fetchProfile(fetchImpl, discord, 'tok');
    expect(profile).toEqual({
      providerUserId: '222',
      displayName: 'タロー',
      avatarUrl: 'https://cdn.discordapp.com/avatars/222/abc.png',
    });
  });

  it('normalizes an x users/me response', async () => {
    const { x } = createProviders(env);
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { id: '333', name: 'タロー', username: 'taro', profile_image_url: 'https://p/x.png' } })
    );
    const profile = await fetchProfile(fetchImpl, x, 'tok');
    expect(profile).toEqual({ providerUserId: '333', displayName: 'タロー', avatarUrl: 'https://p/x.png' });
  });

  it('throws when the profile endpoint fails', async () => {
    const { google } = createProviders(env);
    await expect(
      fetchProfile(async () => ({ ok: false, status: 401 }), google, 'tok')
    ).rejects.toThrow(/profile fetch failed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/auth/providers.test.js`
Expected: FAIL (Cannot find module './providers.js')

- [ ] **Step 3: Write implementation**

```js
// server/auth/providers.js
import { codeChallengeS256 } from './crypto.js';

const UPSTREAM_TIMEOUT_MS = 15000;

const DEFS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    profileUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid profile',
    tokenAuth: 'body',
    envPrefix: 'GOOGLE',
    normalizeProfile: (d) => ({
      providerUserId: String(d.sub),
      displayName: d.name || 'ユーザー',
      avatarUrl: d.picture || null,
    }),
  },
  discord: {
    authUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    profileUrl: 'https://discord.com/api/users/@me',
    scope: 'identify',
    tokenAuth: 'body',
    envPrefix: 'DISCORD',
    normalizeProfile: (d) => ({
      providerUserId: String(d.id),
      displayName: d.global_name || d.username || 'ユーザー',
      avatarUrl: d.avatar ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png` : null,
    }),
  },
  x: {
    authUrl: 'https://x.com/i/oauth2/authorize',
    tokenUrl: 'https://api.x.com/2/oauth2/token',
    profileUrl: 'https://api.x.com/2/users/me?user.fields=profile_image_url',
    scope: 'users.read tweet.read',
    tokenAuth: 'basic',
    envPrefix: 'X',
    normalizeProfile: (d) => ({
      providerUserId: String(d.data.id),
      displayName: d.data.name || d.data.username || 'ユーザー',
      avatarUrl: d.data.profile_image_url || null,
    }),
  },
};

export function createProviders(env) {
  const providers = {};
  for (const [name, def] of Object.entries(DEFS)) {
    const clientId = env[`${def.envPrefix}_CLIENT_ID`];
    const clientSecret = env[`${def.envPrefix}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) continue;
    providers[name] = { name, ...def, clientId, clientSecret };
  }
  return providers;
}

export function redirectUri(baseUrl, name) {
  return `${baseUrl}/auth/${name}/callback`;
}

export function authorizationUrl(provider, { baseUrl, state, codeVerifier }) {
  const url = new URL(provider.authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', provider.clientId);
  url.searchParams.set('redirect_uri', redirectUri(baseUrl, provider.name));
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallengeS256(codeVerifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export async function exchangeCode(fetchImpl, provider, { baseUrl, code, codeVerifier }) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(baseUrl, provider.name),
    code_verifier: codeVerifier,
  });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (provider.tokenAuth === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString('base64')}`;
  } else {
    params.set('client_id', provider.clientId);
    params.set('client_secret', provider.clientSecret);
  }
  const res = await fetchImpl(provider.tokenUrl, {
    method: 'POST',
    headers,
    body: params.toString(),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  const data = await res.json();
  if (!data.access_token) throw new Error('token exchange returned no access_token');
  return data.access_token;
}

export async function fetchProfile(fetchImpl, provider, accessToken) {
  const res = await fetchImpl(provider.profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`profile fetch failed (${res.status})`);
  return provider.normalizeProfile(await res.json());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/auth/providers.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add server/auth/providers.js server/auth/providers.test.js
git commit -m "feat(auth): Google/Discord/XのOAuth2プロバイダ定義(PKCE・最小スコープ)"
```

---

### Task 5: 認証ミドルウェア `server/auth/middleware.js`

**Files:**
- Create: `server/auth/middleware.js`
- Test: `server/auth/middleware.test.js`

**Interfaces:**
- Consumes: Task 2の`getAuthSession`/`SESSION_COOKIE`
- Produces:
  - `parseCookies(header: string|undefined): Record<string,string>`
  - `createRequireAuth({ dataStore }): express middleware` — 成功時`req.userId`を設定、失敗時`401 { error: 'login required' }`
  - `createOriginCheck({ baseUrl }): express middleware` — POST/PUT/PATCH/DELETEでOriginヘッダがあり`baseUrl`のoriginと不一致なら`403 { error: 'origin not allowed' }`。Originなし(同一オリジンのfetchやcurl)は通す

- [ ] **Step 1: Write the failing test**

```js
// server/auth/middleware.test.js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createFsDataStore } from '../storage/dataStore.js';
import { createAuthSession, SESSION_COOKIE } from './sessions.js';
import { parseCookies, createRequireAuth, createOriginCheck } from './middleware.js';

let dir;
let dataStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-mw-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('parseCookies', () => {
  it('parses a cookie header', () => {
    expect(parseCookies('a=1; b=hello%20world')).toEqual({ a: '1', b: 'hello world' });
  });
  it('returns an empty object for undefined', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe('createRequireAuth', () => {
  function buildApp() {
    const app = express();
    app.use(createRequireAuth({ dataStore }));
    app.get('/whoami', (req, res) => res.json({ userId: req.userId }));
    return app;
  }

  it('rejects a request without a session cookie', async () => {
    const res = await request(buildApp()).get('/whoami');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('login required');
  });

  it('rejects an unknown token', async () => {
    const res = await request(buildApp()).get('/whoami').set('Cookie', `${SESSION_COOKIE}=bogus`);
    expect(res.status).toBe(401);
  });

  it('sets req.userId for a valid session', async () => {
    const token = await createAuthSession(dataStore, 'usr_1');
    const res = await request(buildApp()).get('/whoami').set('Cookie', `${SESSION_COOKIE}=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('usr_1');
  });
});

describe('createOriginCheck', () => {
  function buildApp() {
    const app = express();
    app.use(createOriginCheck({ baseUrl: 'http://localhost:5173' }));
    app.post('/x', (req, res) => res.json({ ok: true }));
    app.get('/x', (req, res) => res.json({ ok: true }));
    return app;
  }

  it('allows a matching origin and requests without an origin header', async () => {
    expect((await request(buildApp()).post('/x').set('Origin', 'http://localhost:5173')).status).toBe(200);
    expect((await request(buildApp()).post('/x')).status).toBe(200);
  });

  it('rejects a cross-origin mutation', async () => {
    const res = await request(buildApp()).post('/x').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('does not restrict GET', async () => {
    expect((await request(buildApp()).get('/x').set('Origin', 'https://evil.example')).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/auth/middleware.test.js`
Expected: FAIL (Cannot find module './middleware.js')

- [ ] **Step 3: Write implementation**

```js
// server/auth/middleware.js
import { getAuthSession, SESSION_COOKIE } from './sessions.js';

export function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createRequireAuth({ dataStore }) {
  return async (req, res, next) => {
    try {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      const session = await getAuthSession(dataStore, token);
      if (!session) {
        res.status(401).json({ error: 'login required' });
        return;
      }
      req.userId = session.userId;
      next();
    } catch (e) {
      next(e);
    }
  };
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createOriginCheck({ baseUrl }) {
  const allowed = new URL(baseUrl).origin;
  return (req, res, next) => {
    if (MUTATING_METHODS.has(req.method) && req.headers.origin && req.headers.origin !== allowed) {
      res.status(403).json({ error: 'origin not allowed' });
      return;
    }
    next();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/auth/middleware.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/auth/middleware.js server/auth/middleware.test.js
git commit -m "feat(auth): requireAuth/Origin検証ミドルウェアとクッキーパーサ"
```

---

### Task 6: 利用制限 `server/auth/usage.js`

**Files:**
- Create: `server/auth/usage.js`
- Test: `server/auth/usage.test.js`

**Interfaces:**
- Produces:
  - `usageKey(userId, day): string` → `users/{userId}/usage/{YYYY-MM-DD}`
  - `createUsage({ dataStore, limits, now? }): { consume(userId, kind): Promise<{ok:true}|{ok:false,resetAt:number}> }`
  - `limits`は`{ messages: number, novelize: number }`。`now`はテスト用に注入可能な`() => epochMs`
  - `resetAt`は翌UTC0時のepoch ms

- [ ] **Step 1: Write the failing test**

```js
// server/auth/usage.test.js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from '../storage/dataStore.js';
import { createUsage, usageKey } from './usage.js';

let dir;
let dataStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 6, 23, 10, 0, 0); // 2026-07-23T10:00:00Z

describe('usage limits', () => {
  it('allows consumption up to the limit, then rejects with resetAt', async () => {
    const usage = createUsage({ dataStore, limits: { messages: 2, novelize: 1 }, now: () => T0 });
    expect((await usage.consume('usr_1', 'messages')).ok).toBe(true);
    expect((await usage.consume('usr_1', 'messages')).ok).toBe(true);
    const third = await usage.consume('usr_1', 'messages');
    expect(third.ok).toBe(false);
    expect(third.resetAt).toBe(Date.UTC(2026, 6, 24));
  });

  it('tracks kinds independently', async () => {
    const usage = createUsage({ dataStore, limits: { messages: 1, novelize: 1 }, now: () => T0 });
    await usage.consume('usr_1', 'messages');
    expect((await usage.consume('usr_1', 'novelize')).ok).toBe(true);
  });

  it('tracks users independently', async () => {
    const usage = createUsage({ dataStore, limits: { messages: 1, novelize: 1 }, now: () => T0 });
    await usage.consume('usr_1', 'messages');
    expect((await usage.consume('usr_2', 'messages')).ok).toBe(true);
  });

  it('resets on the next UTC day', async () => {
    let t = T0;
    const usage = createUsage({ dataStore, limits: { messages: 1, novelize: 1 }, now: () => t });
    await usage.consume('usr_1', 'messages');
    expect((await usage.consume('usr_1', 'messages')).ok).toBe(false);
    t = Date.UTC(2026, 6, 24, 0, 0, 1);
    expect((await usage.consume('usr_1', 'messages')).ok).toBe(true);
  });

  it('persists counters under the user namespace', async () => {
    const usage = createUsage({ dataStore, limits: { messages: 5, novelize: 5 }, now: () => T0 });
    await usage.consume('usr_1', 'messages');
    expect(await dataStore.get(usageKey('usr_1', '2026-07-23'))).toEqual({ messages: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/auth/usage.test.js`
Expected: FAIL (Cannot find module './usage.js')

- [ ] **Step 3: Write implementation**

```js
// server/auth/usage.js
export function usageKey(userId, day) {
  return `users/${userId}/usage/${day}`;
}

function utcDay(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function nextUtcMidnight(epochMs) {
  const d = new Date(epochMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export function createUsage({ dataStore, limits, now = Date.now }) {
  return {
    async consume(userId, kind) {
      const limit = limits[kind];
      if (typeof limit !== 'number') throw new Error(`unknown usage kind: ${kind}`);
      const t = now();
      const key = usageKey(userId, utcDay(t));
      const counts = (await dataStore.get(key)) || {};
      const used = counts[kind] || 0;
      if (used >= limit) return { ok: false, resetAt: nextUtcMidnight(t) };
      counts[kind] = used + 1;
      await dataStore.set(key, counts);
      return { ok: true };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/auth/usage.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/auth/usage.js server/auth/usage.test.js
git commit -m "feat(auth): ユーザー単位の日次利用カウンタ(UTCリセット)"
```

---

### Task 7: 認証ルーター `server/auth/routes.js`

**Files:**
- Create: `server/auth/routes.js`
- Test: `server/auth/routes.test.js`

**Interfaces:**
- Consumes: Task 1-5の全モジュール
- Produces: `createAuthRouter({ dataStore, providers, baseUrl, fetchImpl?, secureCookies? }): Router`
  - `GET /auth/:provider/start` — stateとcode_verifierを`gmdesk_oauth`クッキー(10分)に保存し302
  - `GET /auth/:provider/callback` — 検証→交換→プロファイル→findOrCreateUser→セッション発行→`/`へ302。失敗時`/?auth_error=1`へ302
  - `POST /auth/logout` — セッション破棄、`200 { ok: true }`
  - `GET /api/auth/providers` — `200 { providers: string[] }`
  - `GET /api/me` — `200 { user: User|null }`(認証不要)
  - `PATCH /api/me` — `{ displayName?: string, avatarUrl?: null }`。未ログイン401。displayNameはtrim後1〜50文字でなければ400。avatarUrlはnull以外400。`200 { user }`

- [ ] **Step 1: Write the failing test**

```js
// server/auth/routes.test.js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createFsDataStore } from '../storage/dataStore.js';
import { createProviders } from './providers.js';
import { createAuthRouter } from './routes.js';
import { SESSION_COOKIE } from './sessions.js';

const BASE = 'http://localhost:5173';
const env = { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec' };

let dir;
let dataStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-routes-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function buildApp(fetchImpl) {
  const app = express();
  app.use(express.json());
  app.use(createAuthRouter({
    dataStore,
    providers: createProviders(env),
    baseUrl: BASE,
    fetchImpl,
    secureCookies: false,
  }));
  return app;
}

// Google成功パスのモック: token交換→userinfoの2連続fetch
function googleFetchMock() {
  return vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tok' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ sub: '111', name: '太郎', picture: null }) });
}

function cookieHeader(res, name) {
  const raw = (res.headers['set-cookie'] || []).find((c) => c.startsWith(`${name}=`));
  return raw ? raw.split(';')[0] : null;
}

async function login(app, fetchImpl) {
  const start = await request(app).get('/auth/google/start');
  const oauthCookie = cookieHeader(start, 'gmdesk_oauth');
  const state = new URL(start.headers.location).searchParams.get('state');
  const cb = await request(app)
    .get(`/auth/google/callback?code=c1&state=${state}`)
    .set('Cookie', oauthCookie);
  return { cb, sessionCookie: cookieHeader(cb, SESSION_COOKIE) };
}

describe('auth routes', () => {
  it('start redirects to the provider and sets the oauth cookie', async () => {
    const res = await request(buildApp()).get('/auth/google/start');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('https://accounts.google.com/');
    expect(cookieHeader(res, 'gmdesk_oauth')).toBeTruthy();
  });

  it('start returns 404 for an unconfigured provider', async () => {
    expect((await request(buildApp()).get('/auth/discord/start')).status).toBe(404);
  });

  it('callback creates a user, sets a session cookie and redirects home', async () => {
    const app = buildApp(googleFetchMock());
    const { cb, sessionCookie } = await login(app);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/');
    expect(sessionCookie).toBeTruthy();
    const me = await request(app).get('/api/me').set('Cookie', sessionCookie);
    expect(me.body.user.displayName).toBe('太郎');
  });

  it('callback with a state mismatch redirects to /?auth_error=1 without a session', async () => {
    const app = buildApp(googleFetchMock());
    const start = await request(app).get('/auth/google/start');
    const res = await request(app)
      .get('/auth/google/callback?code=c1&state=WRONG')
      .set('Cookie', cookieHeader(start, 'gmdesk_oauth'));
    expect(res.headers.location).toBe('/?auth_error=1');
    expect(cookieHeader(res, SESSION_COOKIE)).toBeNull();
  });

  it('callback redirects to /?auth_error=1 when the token exchange fails', async () => {
    const app = buildApp(vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'no' }));
    const { cb } = await login(app);
    expect(cb.headers.location).toBe('/?auth_error=1');
  });

  it('GET /api/me returns { user: null } when logged out', async () => {
    const res = await request(buildApp()).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ user: null });
  });

  it('GET /api/auth/providers lists configured providers only', async () => {
    const res = await request(buildApp()).get('/api/auth/providers');
    expect(res.body).toEqual({ providers: ['google'] });
  });

  it('logout destroys the session', async () => {
    const app = buildApp(googleFetchMock());
    const { sessionCookie } = await login(app);
    await request(app).post('/auth/logout').set('Cookie', sessionCookie);
    const me = await request(app).get('/api/me').set('Cookie', sessionCookie);
    expect(me.body.user).toBeNull();
  });

  it('PATCH /api/me updates displayName and clears avatarUrl', async () => {
    const app = buildApp(googleFetchMock());
    const { sessionCookie } = await login(app);
    const res = await request(app)
      .patch('/api/me')
      .set('Cookie', sessionCookie)
      .send({ displayName: '  新しい名前  ', avatarUrl: null });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('新しい名前');
    expect(res.body.user.avatarUrl).toBeNull();
  });

  it('PATCH /api/me validates input', async () => {
    const app = buildApp(googleFetchMock());
    const { sessionCookie } = await login(app);
    expect((await request(app).patch('/api/me').send({ displayName: 'x' })).status).toBe(401);
    expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ displayName: '' })).status).toBe(400);
    expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ displayName: 'あ'.repeat(51) })).status).toBe(400);
    expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ avatarUrl: 'https://x' })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/auth/routes.test.js`
Expected: FAIL (Cannot find module './routes.js')

- [ ] **Step 3: Write implementation**

```js
// server/auth/routes.js
import { Router } from 'express';
import { randomToken } from './crypto.js';
import { authorizationUrl, exchangeCode, fetchProfile } from './providers.js';
import { findOrCreateUser, getUser, updateUserProfile } from './users.js';
import { createAuthSession, deleteAuthSession, getAuthSession, SESSION_COOKIE, SESSION_TTL_MS } from './sessions.js';
import { parseCookies } from './middleware.js';
import { asyncHandler } from '../routes/asyncHandler.js';

const OAUTH_COOKIE = 'gmdesk_oauth';
const OAUTH_COOKIE_TTL_MS = 10 * 60 * 1000;

export function createAuthRouter({
  dataStore,
  providers,
  baseUrl,
  fetchImpl = fetch,
  secureCookies = process.env.NODE_ENV === 'production',
}) {
  const router = Router();
  const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: secureCookies, path: '/' };

  router.get('/auth/:provider/start', (req, res) => {
    const provider = providers[req.params.provider];
    if (!provider) {
      res.status(404).json({ error: 'unknown provider' });
      return;
    }
    const state = randomToken();
    const codeVerifier = randomToken();
    res.cookie(OAUTH_COOKIE, JSON.stringify({ provider: provider.name, state, codeVerifier }), {
      ...cookieOpts,
      maxAge: OAUTH_COOKIE_TTL_MS,
    });
    res.redirect(authorizationUrl(provider, { baseUrl, state, codeVerifier }));
  });

  router.get('/auth/:provider/callback', async (req, res) => {
    try {
      const provider = providers[req.params.provider];
      const raw = parseCookies(req.headers.cookie)[OAUTH_COOKIE];
      const saved = raw ? JSON.parse(raw) : null;
      if (!provider || !saved || saved.provider !== provider.name || !req.query.code || saved.state !== req.query.state) {
        throw new Error('oauth state mismatch');
      }
      const accessToken = await exchangeCode(fetchImpl, provider, {
        baseUrl,
        code: String(req.query.code),
        codeVerifier: saved.codeVerifier,
      });
      const profile = await fetchProfile(fetchImpl, provider, accessToken);
      const user = await findOrCreateUser(dataStore, { provider: provider.name, ...profile });
      const token = await createAuthSession(dataStore, user.id);
      res.clearCookie(OAUTH_COOKIE, cookieOpts);
      res.cookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: SESSION_TTL_MS });
      res.redirect('/');
    } catch (e) {
      console.error('oauth callback failed:', e.message);
      res.clearCookie(OAUTH_COOKIE, cookieOpts);
      res.redirect('/?auth_error=1');
    }
  });

  router.post('/auth/logout', asyncHandler(async (req, res) => {
    await deleteAuthSession(dataStore, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, cookieOpts);
    res.json({ ok: true });
  }));

  router.get('/api/auth/providers', (req, res) => {
    res.json({ providers: Object.keys(providers) });
  });

  async function currentUser(req) {
    const session = await getAuthSession(dataStore, parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    return session ? await getUser(dataStore, session.userId) : null;
  }

  router.get('/api/me', asyncHandler(async (req, res) => {
    res.json({ user: await currentUser(req) });
  }));

  router.patch('/api/me', asyncHandler(async (req, res) => {
    const user = await currentUser(req);
    if (!user) {
      res.status(401).json({ error: 'login required' });
      return;
    }
    const patch = {};
    if ('displayName' in req.body) {
      const name = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : null;
      if (!name || name.length > 50) {
        res.status(400).json({ error: 'displayName must be a 1-50 character string' });
        return;
      }
      patch.displayName = name;
    }
    if ('avatarUrl' in req.body) {
      if (req.body.avatarUrl !== null) {
        res.status(400).json({ error: 'avatarUrl can only be cleared (null)' });
        return;
      }
      patch.avatarUrl = null;
    }
    res.json({ user: await updateUserProfile(dataStore, user.id, patch) });
  }));

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/auth/routes.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add server/auth/routes.js server/auth/routes.test.js
git commit -m "feat(auth): OAuthフロー・/api/me・providersエンドポイント"
```

---

### Task 8: ストレージのユーザー名前空間化(paths + ライブラリモジュール)

**Files:**
- Modify: `server/storage/paths.js`(全関数)
- Modify: `server/storage/rulesetLibrary.js` / `worldLibrary.js` / `characterLibrary.js` / `scenarioLibrary.js` / `worldContentLibrary.js`
- Test: 上記5モジュールの既存`.test.js` + `server/storage/paths.test.js` を新シグネチャに更新

**Interfaces:**
- Produces(paths.js — 全関数の新シグネチャ。第1引数に`userId`を追加):

```js
sessionListPrefix(userId)                       // `users/${userId}/sessions` (新規)
sessionKey(userId, sessionId)                   // `users/${userId}/sessions/${sessionId}`
sessionNovelDocPath(userId, sessionId)          // `users/${userId}/sessions/${sessionId}/novel.md`
sessionNovelMetaKey(userId, sessionId)          // `users/${userId}/sessions/${sessionId}/novel`
worldListPrefix(userId)                         // `users/${userId}/worlds` (新規)
worldMetaKey(userId, worldId)
worldDocPath(userId, worldId)
worldSourceDocPath(userId, worldId)
regionDocPath(userId, worldId, region)
categoryDocPath(userId, worldId, category)
characterDocPath(userId, worldId, kind, name)
characterMetaKey(userId, worldId, kind, name)
scenarioDocPath(userId, worldId, scenarioId)
scenarioMetaKey(userId, worldId, scenarioId)
campaignMetaKey(userId, worldId, campaignId)
rulesetListPrefix(userId)                       // `users/${userId}/rulesets` (新規)
rulesetMetaKey(userId, rulesetId)
```

- Produces(ライブラリ — `userId`をstore引数群の直後に挿入):

```js
// rulesetLibrary.js
saveRuleset(dataStore, userId, { id, label, desc, hint, growthUnit })
getRuleset(dataStore, userId, id)
listRulesets(dataStore, userId)                 // list(rulesetListPrefix(userId))
deleteRuleset(dataStore, userId, id)
// worldLibrary.js
saveWorld(dataStore, textStore, userId, { id, title, raw })
getWorld(dataStore, textStore, userId, id)
listWorlds(dataStore, userId)                   // list(worldListPrefix(userId))
deleteWorld(dataStore, textStore, userId, id)
// characterLibrary.js
saveCharacter(dataStore, textStore, userId, { worldId, kind, name, raw, revealed })
getCharacter(dataStore, textStore, userId, worldId, kind, name)
listCharacters(dataStore, userId, worldId, kind)
deleteCharacter(dataStore, textStore, userId, worldId, kind, name)
saveCharacterParsed(dataStore, userId, worldId, kind, name, { parsed, parsedHash })
// scenarioLibrary.js
saveScenario(dataStore, textStore, userId, { worldId, id, title, raw, recommendedRuleset })
getScenario(dataStore, textStore, userId, worldId, id)
listScenarios(dataStore, userId, worldId)
deleteScenario(dataStore, textStore, userId, worldId, id)
// worldContentLibrary.js — 全関数で textStore の直後に userId
saveWorldSource(textStore, userId, worldId, raw)
getWorldSource(textStore, userId, worldId)
saveRegion(textStore, userId, worldId, region, raw)
getRegion(textStore, userId, worldId, region)
listRegions(textStore, userId, worldId)
deleteRegion(textStore, userId, worldId, region)
saveCategory(textStore, userId, worldId, category, raw)
getCategory(textStore, userId, worldId, category)
listCategories(textStore, userId, worldId)
deleteCategory(textStore, userId, worldId, category)
```

新paths.jsの完全な実装:

```js
// server/storage/paths.js
export function sessionListPrefix(userId) {
  return `users/${userId}/sessions`;
}

export function sessionKey(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}`;
}

export function sessionNovelDocPath(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}/novel.md`;
}

export function sessionNovelMetaKey(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}/novel`;
}

export function worldListPrefix(userId) {
  return `users/${userId}/worlds`;
}

export function worldMetaKey(userId, worldId) {
  return `users/${userId}/worlds/${worldId}`;
}

export function worldDocPath(userId, worldId) {
  return `users/${userId}/worlds/${worldId}/world.md`;
}

export function worldSourceDocPath(userId, worldId) {
  return `users/${userId}/worlds/${worldId}/source.md`;
}

export function regionDocPath(userId, worldId, region) {
  return `users/${userId}/worlds/${worldId}/regions/${region}.md`;
}

export function categoryDocPath(userId, worldId, category) {
  return `users/${userId}/worlds/${worldId}/categories/${category}.md`;
}

export function characterDocPath(userId, worldId, kind, name) {
  return `users/${userId}/worlds/${worldId}/${kind}/${name}.md`;
}

export function characterMetaKey(userId, worldId, kind, name) {
  return `users/${userId}/worlds/${worldId}/${kind}/${name}.parsed`;
}

export function scenarioDocPath(userId, worldId, scenarioId) {
  return `users/${userId}/worlds/${worldId}/scenarios/${scenarioId}/scenario.md`;
}

export function scenarioMetaKey(userId, worldId, scenarioId) {
  return `users/${userId}/worlds/${worldId}/scenarios/${scenarioId}`;
}

export function campaignMetaKey(userId, worldId, campaignId) {
  return `users/${userId}/worlds/${worldId}/campaigns/${campaignId}/campaign`;
}

export function rulesetListPrefix(userId) {
  return `users/${userId}/rulesets`;
}

export function rulesetMetaKey(userId, rulesetId) {
  return `users/${userId}/rulesets/${rulesetId}`;
}
```

- [ ] **Step 1: paths.test.jsを新シグネチャに書き換えて失敗を確認**

既存の各アサーションに`'usr_1'`を第1引数として追加し、期待値のプレフィックスを`users/usr_1/`付きに変える。例: `expect(sessionKey('usr_1', 's1')).toBe('users/usr_1/sessions/s1')`。新規の`sessionListPrefix`/`worldListPrefix`/`rulesetListPrefix`のテストも追加。

Run: `npx vitest run server/storage/paths.test.js`
Expected: FAIL

- [ ] **Step 2: paths.jsを上記コードに置き換えてpaths.test.jsをパスさせる**

Run: `npx vitest run server/storage/paths.test.js`
Expected: PASS

- [ ] **Step 3: 5つのライブラリモジュールの既存テストを新シグネチャに更新して失敗を確認**

機械的変更: 各テスト内の呼び出しに`'usr_1'`をstore引数群の直後に挿入(上のシグネチャ表どおり)。「ユーザーを跨いで見えない」ことを保証するテストを`rulesetLibrary.test.js`に1本追加:

```js
it('does not leak rulesets across users', async () => {
  await saveRuleset(dataStore, 'usr_1', { id: 'r1', label: 'A' });
  expect(await getRuleset(dataStore, 'usr_2', 'r1')).toBeNull();
  expect(await listRulesets(dataStore, 'usr_2')).toEqual([]);
});
```

Run: `npx vitest run server/storage/`
Expected: FAIL(ライブラリ5モジュールのテスト)

- [ ] **Step 4: ライブラリ5モジュールを新シグネチャに更新してパスさせる**

各関数で`userId`を受け取り、paths.jsヘルパー呼び出しに渡すだけ(ロジック変更なし)。`listRulesets`は`dataStore.list(rulesetListPrefix(userId))`、`listWorlds`は`dataStore.list(worldListPrefix(userId))`に変更。参考として`rulesetLibrary.js`の完全な新実装:

```js
// server/storage/rulesetLibrary.js
import { rulesetMetaKey, rulesetListPrefix } from './paths.js';

export async function saveRuleset(dataStore, userId, { id, label, desc, hint, growthUnit }) {
  const ruleset = { id, label, desc: desc ?? '', hint: hint ?? '', growthUnit: growthUnit ?? 'xp' };
  await dataStore.set(rulesetMetaKey(userId, id), ruleset);
  return ruleset;
}

export async function getRuleset(dataStore, userId, id) {
  return dataStore.get(rulesetMetaKey(userId, id));
}

export async function listRulesets(dataStore, userId) {
  const keys = await dataStore.list(rulesetListPrefix(userId));
  const rulesets = await Promise.all(keys.map((k) => dataStore.get(k)));
  return rulesets.filter(Boolean);
}

export async function deleteRuleset(dataStore, userId, id) {
  await dataStore.delete(rulesetMetaKey(userId, id));
}
```

(注: 実ファイルの中身が上と細部で異なる場合は**実ファイルのロジックを維持**し、`userId`の貫通のみ行うこと。`deleteWorld`のカスケード削除も同様に、各削除対象キーへ`userId`を渡すだけでロジックは変えない。)

Run: `npx vitest run server/storage/`
Expected: PASS(全ストレージテスト)

この時点で`server/routes/`のテストはコンパイルエラー/失敗になるが、それはTask 9で直すのでここでは無視してよい。

- [ ] **Step 5: Commit**

```bash
git add server/storage/
git commit -m "feat(storage): 全キーをusers/{userId}配下に名前空間化"
```

---

### Task 9: ルーターのユーザー名前空間対応

**Files:**
- Modify: `server/routes/sessions.js` / `worlds.js` / `characters.js` / `scenarios.js` / `worldContent.js` / `rulesets.js`
- Test: 上記6ルーターの既存`.test.js`を更新

**Interfaces:**
- Consumes: Task 8の新シグネチャ。`req.userId`(Task 5のrequireAuthが設定。ルーターは設定済みであることを前提にする)
- Produces: 各ルーターのcreate関数シグネチャは**変更なし**。ハンドラ内部で`req.userId`を渡すだけ

変更パターン(機械的):

1. **sessions.js**: `dataStore.list('sessions')` → `dataStore.list(sessionListPrefix(req.userId))`(importに`sessionListPrefix`追加)。`sessionKey(req.params.id)` → `sessionKey(req.userId, req.params.id)`。`sessionNovelDocPath`/`sessionNovelMetaKey`も同様に`req.userId`を第1引数に
2. **rulesets.js**: `listRulesets(dataStore)` → `listRulesets(dataStore, req.userId)`、`getRuleset(dataStore, req.params.id)` → `getRuleset(dataStore, req.userId, req.params.id)`、save/deleteも同様
3. **worlds.js / characters.js / scenarios.js / worldContent.js**: 各ライブラリ関数呼び出しで、store引数群の直後に`req.userId`を挿入(Task 8のシグネチャ表どおり)

テスト更新パターン — 各ルーターテストの`buildApp`で、ルーターをマウントする**前**にスタブ認証ミドルウェアを挟む:

```js
app.use((req, res, next) => {
  req.userId = 'usr_test';
  next();
});
app.use('/api', createSessionsRouter({ dataStore, textStore, apiKey, fetchImpl }));
```

既存のアサーションはそのまま通るはず(APIレスポンス形は不変)。加えて`sessions.test.js`に分離テストを1本追加:

```js
it('does not see sessions of another user', async () => {
  await request(app).put('/api/sessions/s1').send({ title: 'A' }); // usr_test として保存
  // 別ユーザーでappを作り直す
  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.userId = 'usr_other'; next(); });
  app.use('/api', createSessionsRouter({ dataStore, textStore, apiKey: 'test-key' }));
  expect((await request(app).get('/api/sessions/s1')).status).toBe(404);
  expect((await request(app).get('/api/sessions')).body).toEqual([]);
});
```

- [ ] **Step 1: 6ルーターのテストにスタブ認証を追加し、分離テストを書いて失敗を確認**

Run: `npx vitest run server/routes/`
Expected: FAIL(ルーター実装が旧シグネチャのため)

- [ ] **Step 2: 6ルーターを上記パターンで更新してパスさせる**

Run: `npx vitest run server/routes/`
Expected: PASS

- [ ] **Step 3: サーバー全テスト確認**

Run: `npx vitest run server/`
Expected: `server/index.test.js`以外PASS(index.test.jsはTask 11で対応。失敗していても次へ進んでよいが、失敗理由が401/名前空間以外なら止まって原因を調べること)

- [ ] **Step 4: Commit**

```bash
git add server/routes/
git commit -m "feat(routes): 全APIルートをreq.userIdで名前空間化"
```

---

### Task 10: AI呼び出しへの利用制限適用(messages / novelize)

**Files:**
- Modify: `server/routes/messages.js`
- Modify: `server/routes/sessions.js`(novelizeハンドラ)
- Test: `server/routes/messages.test.js` / `server/routes/sessions.test.js` に429ケース追加

**Interfaces:**
- Consumes: Task 6の`createUsage`が返す`usage.consume(userId, kind)`
- Produces:
  - `createMessagesRouter({ apiKey, fetchImpl, usage })` — `usage`は省略可(省略時は制限なし=既存テスト互換)
  - `createSessionsRouter({ dataStore, textStore, apiKey, fetchImpl, usage })` — 同上
  - 超過時: `429 { error: 'daily limit reached', resetAt }`

- [ ] **Step 1: Write the failing tests**

`messages.test.js`に追加(buildAppは既存のものに`usage`パラメータを通せるよう拡張):

```js
it('returns 429 when the daily message limit is exhausted', async () => {
  const usage = { consume: async () => ({ ok: false, resetAt: 123 }) };
  buildApp({ usage });
  const res = await request(app).post('/api/messages').send({ messages: [] });
  expect(res.status).toBe(429);
  expect(res.body).toEqual({ error: 'daily limit reached', resetAt: 123 });
});

it('consumes usage with the messages kind and proceeds when allowed', async () => {
  const consume = vi.fn().mockResolvedValue({ ok: true });
  const fetchImpl = vi.fn().mockResolvedValue({ status: 200, text: async () => '{}' });
  buildApp({ usage: { consume }, fetchImpl });
  await request(app).post('/api/messages').send({ messages: [] });
  expect(consume).toHaveBeenCalledWith(undefined, 'messages'); // req.userIdはスタブなしなのでundefined
  expect(fetchImpl).toHaveBeenCalled();
});
```

`sessions.test.js`のnovelize節に追加:

```js
it('returns 429 from novelize when the daily limit is exhausted', async () => {
  buildApp({ usage: { consume: async () => ({ ok: false, resetAt: 456 }) } });
  await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
  const res = await request(app).post('/api/sessions/s1/novelize');
  expect(res.status).toBe(429);
  expect(res.body.resetAt).toBe(456);
});
```

Run: `npx vitest run server/routes/messages.test.js server/routes/sessions.test.js`
Expected: FAIL

- [ ] **Step 2: Implement**

`messages.js` — シグネチャを`{ apiKey, fetchImpl = fetch, usage }`にし、バリデーション通過後・upstream呼び出し前に:

```js
if (usage) {
  const check = await usage.consume(req.userId, 'messages');
  if (!check.ok) {
    res.status(429).json({ error: 'daily limit reached', resetAt: check.resetAt });
    return;
  }
}
```

(routerハンドラを`async`化し、既存のtry/catchの外側・apiKeyチェックの後に置く)

`sessions.js`のnovelizeハンドラ — シグネチャに`usage`を追加し、セッション404チェックの後・upstream呼び出し前に同じブロックを`'novelize'` kindで挿入。

Run: `npx vitest run server/routes/messages.test.js server/routes/sessions.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add server/routes/messages.js server/routes/sessions.js server/routes/messages.test.js server/routes/sessions.test.js
git commit -m "feat(routes): AI呼び出しに日次利用制限(429)を適用"
```

---

### Task 11: サーバー組み立て(index.js配線)とテストヘルパー

**Files:**
- Modify: `server/index.js`
- Create: `server/auth/testHelpers.js`
- Modify: `server/index.test.js`
- Modify: `vite.config.js`(`/auth`プロキシ追加)

**Interfaces:**
- Produces:
  - `createApp({ apiKey, dataDir, fetchImpl, env, baseUrl, secureCookies })` — `env`既定`process.env`、`baseUrl`既定`env.BASE_URL || 'http://localhost:5173'`、`dataDir`既定`env.DATA_DIR || server/data`
  - `server/auth/testHelpers.js`: `createTestUserSession(dataStore, { displayName? }): Promise<{ user, cookie }>` — cookieは`'gmdesk_session=<token>'`形式。supertestの`.set('Cookie', cookie)`にそのまま渡せる
- ミドルウェア順序(重要): `express.json` → `originCheck` → `authRouter`(/auth/*, /api/me, /api/auth/providers) → `requireAuth`(/api) → 各既存ルーター

- [ ] **Step 1: testHelpers実装**

```js
// server/auth/testHelpers.js
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
```

- [ ] **Step 2: index.test.jsを新しい世界観に更新して失敗を確認**

方針: 既存の各テストは`createTestUserSession(app.locals.dataStore)`で得たcookieを付けて叩くよう更新。さらに以下を追加:

```js
it('rejects /api requests without a session', async () => {
  expect((await request(app).get('/api/sessions')).status).toBe(401);
  expect((await request(app).post('/api/messages').send({ messages: [] })).status).toBe(401);
});

it('serves /api/me as null and providers list without auth', async () => {
  expect((await request(app).get('/api/me')).body).toEqual({ user: null });
  expect((await request(app).get('/api/auth/providers')).status).toBe(200);
});

it('keeps data separated between two users end to end', async () => {
  const a = await createTestUserSession(app.locals.dataStore);
  const b = await createTestUserSession(app.locals.dataStore);
  await request(app).put('/api/sessions/s1').set('Cookie', a.cookie).send({ title: 'Aの卓' });
  expect((await request(app).get('/api/sessions/s1').set('Cookie', b.cookie)).status).toBe(404);
  expect((await request(app).get('/api/sessions/s1').set('Cookie', a.cookie)).status).toBe(200);
});

it('enforces the daily message limit via env', async () => {
  app = createApp({ apiKey: 'test-key', dataDir: dir, fetchImpl, env: { LIMIT_MESSAGES_PER_DAY: '1' } });
  const { cookie } = await createTestUserSession(app.locals.dataStore);
  expect((await request(app).post('/api/messages').set('Cookie', cookie).send({ messages: [] })).status).toBe(200);
  expect((await request(app).post('/api/messages').set('Cookie', cookie).send({ messages: [] })).status).toBe(429);
});

it('rejects cross-origin mutations', async () => {
  const { cookie } = await createTestUserSession(app.locals.dataStore);
  const res = await request(app)
    .put('/api/sessions/s1')
    .set('Cookie', cookie)
    .set('Origin', 'https://evil.example')
    .send({ title: 'x' });
  expect(res.status).toBe(403);
});
```

Run: `npx vitest run server/index.test.js`
Expected: FAIL

- [ ] **Step 3: index.jsを更新**

```js
// server/index.js
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessagesRouter } from './routes/messages.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createWorldsRouter } from './routes/worlds.js';
import { createCharactersRouter } from './routes/characters.js';
import { createScenariosRouter } from './routes/scenarios.js';
import { createWorldContentRouter } from './routes/worldContent.js';
import { createRulesetsRouter } from './routes/rulesets.js';
import { createFsDataStore } from './storage/dataStore.js';
import { createFsTextStore } from './storage/textStore.js';
import { createProviders } from './auth/providers.js';
import { createAuthRouter } from './auth/routes.js';
import { createRequireAuth, createOriginCheck } from './auth/middleware.js';
import { createUsage } from './auth/usage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({
  apiKey = process.env.ANTHROPIC_API_KEY,
  env = process.env,
  dataDir = env.DATA_DIR || path.join(__dirname, 'data'),
  fetchImpl = fetch,
  baseUrl = env.BASE_URL || 'http://localhost:5173',
  secureCookies = env.NODE_ENV === 'production',
} = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  const dataStore = createFsDataStore(dataDir);
  const textStore = createFsTextStore(dataDir);
  app.locals.dataStore = dataStore;
  app.locals.textStore = textStore;

  const providers = createProviders(env);
  const usage = createUsage({
    dataStore,
    limits: {
      messages: Number(env.LIMIT_MESSAGES_PER_DAY) || 200,
      novelize: Number(env.LIMIT_NOVELIZE_PER_DAY) || 10,
    },
  });

  app.use(createOriginCheck({ baseUrl }));
  app.use(createAuthRouter({ dataStore, providers, baseUrl, fetchImpl, secureCookies }));
  app.use('/api', createRequireAuth({ dataStore }));

  app.use('/api', createMessagesRouter({ apiKey, fetchImpl, usage }));
  app.use('/api', createSessionsRouter({ dataStore, textStore, apiKey, fetchImpl, usage }));
  app.use('/api', createWorldsRouter({ dataStore, textStore }));
  app.use('/api', createCharactersRouter({ dataStore, textStore }));
  app.use('/api', createScenariosRouter({ dataStore, textStore }));
  app.use('/api', createWorldContentRouter({ textStore }));
  app.use('/api', createRulesetsRouter({ dataStore }));

  app.use((err, req, res, next) => {
    console.error(err);
    const status = typeof err.status === 'number' ? err.status : typeof err.statusCode === 'number' ? err.statusCode : 500;
    res.status(status).json({ error: err.message || 'internal server error' });
  });

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 8787;
  createApp().listen(port, () => {
    console.log(`server listening on port ${port}`);
  });
}
```

`vite.config.js`のproxyに`'/auth': 'http://localhost:8787'`を追加:

```js
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/`
Expected: 全PASS

- [ ] **Step 5: Commit**

```bash
git add server/index.js server/index.test.js server/auth/testHelpers.js vite.config.js
git commit -m "feat(server): 認証・利用制限・名前空間をアプリ全体に配線"
```

---

### Task 12: 既存データ移行スクリプト

**Files:**
- Create: `server/storage/migrateLegacyData.js`
- Create: `scripts/migrate-legacy-data.js`
- Test: `server/storage/migrateLegacyData.test.js`

**Interfaces:**
- Produces:
  - `migrateLegacyData(dataDir, userId): Promise<string[]>` — `dataDir`直下の`sessions`/`worlds`/`rulesets`ディレクトリを`users/{userId}/`配下へ`fs.rename`で移動し、移動したディレクトリ名の配列を返す。存在しないものはスキップ。移動先が既に存在する場合はthrow(二重実行防止)
  - CLI: `node scripts/migrate-legacy-data.js <userId>`(`DATA_DIR`環境変数対応)

- [ ] **Step 1: Write the failing test**

```js
// server/storage/migrateLegacyData.test.js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrateLegacyData } from './migrateLegacyData.js';

let dir;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'migrate-test-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('migrateLegacyData', () => {
  it('moves legacy top-level dirs under users/{userId} and keeps contents', async () => {
    await fs.mkdir(path.join(dir, 'sessions'), { recursive: true });
    await fs.writeFile(path.join(dir, 'sessions', 's1.json'), '{"id":"s1"}');
    await fs.mkdir(path.join(dir, 'worlds', 'w1'), { recursive: true });
    await fs.writeFile(path.join(dir, 'worlds', 'w1.json'), '{"id":"w1"}');

    const moved = await migrateLegacyData(dir, 'usr_1');
    expect(moved.sort()).toEqual(['sessions', 'worlds']);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'users', 'usr_1', 'sessions', 's1.json'), 'utf-8')).id).toBe('s1');
    await expect(fs.access(path.join(dir, 'sessions'))).rejects.toThrow();
  });

  it('skips missing dirs and returns an empty list when nothing to move', async () => {
    expect(await migrateLegacyData(dir, 'usr_1')).toEqual([]);
  });

  it('throws instead of overwriting an existing destination', async () => {
    await fs.mkdir(path.join(dir, 'sessions'), { recursive: true });
    await fs.mkdir(path.join(dir, 'users', 'usr_1', 'sessions'), { recursive: true });
    await expect(migrateLegacyData(dir, 'usr_1')).rejects.toThrow(/already exists/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/storage/migrateLegacyData.test.js`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```js
// server/storage/migrateLegacyData.js
import fs from 'node:fs/promises';
import path from 'node:path';

const LEGACY_DIRS = ['sessions', 'worlds', 'rulesets'];

export async function migrateLegacyData(dataDir, userId) {
  const moved = [];
  for (const name of LEGACY_DIRS) {
    const from = path.join(dataDir, name);
    const to = path.join(dataDir, 'users', userId, name);
    try {
      await fs.access(from);
    } catch {
      continue;
    }
    let destExists = true;
    try {
      await fs.access(to);
    } catch {
      destExists = false;
    }
    if (destExists) throw new Error(`migration destination already exists: ${to}`);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(from, to);
    moved.push(name);
  }
  return moved;
}
```

```js
// scripts/migrate-legacy-data.js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateLegacyData } from '../server/storage/migrateLegacyData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const userId = process.argv[2];
if (!userId || !/^usr_[0-9a-f]{16}$/.test(userId)) {
  console.error('usage: node scripts/migrate-legacy-data.js <usr_xxxxxxxxxxxxxxxx>');
  process.exit(1);
}
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'server', 'data');
const moved = await migrateLegacyData(dataDir, userId);
console.log(moved.length ? `moved: ${moved.join(', ')} -> users/${userId}/` : 'nothing to migrate');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/storage/migrateLegacyData.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/storage/migrateLegacyData.js server/storage/migrateLegacyData.test.js scripts/migrate-legacy-data.js
git commit -m "feat(storage): 認証以前のデータをユーザー配下へ移す一回限りの移行スクリプト"
```

---

### Task 13: クライアント共通fetchと認証APIクライアント

**Files:**
- Create: `src/api/apiFetch.js`
- Create: `src/api/authClient.js`
- Modify: `src/api/client.js`(callClaudeを`apiFetch`利用に)
- Modify: `src/api/sessionSyncClient.js`(ローカル`apiFetch`を共通版に差し替え + `listServerSessions`追加)
- Test: `src/api/apiFetch.test.js` / `src/api/authClient.test.js`、既存`client.test.js`/`sessionSyncClient.test.js`の更新

**Interfaces:**
- Produces:
  - `apiFetch(url, options?): Promise<any>` — `res.ok`ならjson。401は`Error('ログインが必要です。右上からログインしてください。')`(`err.status = 401`)、429は`Error('本日のAI利用上限に達しました。明日また遊べます。')`(`err.status = 429`)、その他は既存形式`API error {status}: {body先頭200字}`(`err.status`付き)
  - `authClient.js`: `fetchMe(): Promise<{user}>` / `fetchProviders(): Promise<{providers}>` / `patchMe(patch): Promise<{user}>` / `logout(): Promise<{ok}>` / `loginUrl(provider): string` → `/auth/{provider}/start`
  - `sessionSyncClient.js`に追加: `listServerSessions(): Promise<Session[]>` — `GET /api/sessions`

- [ ] **Step 1: Write the failing tests**

```js
// src/api/apiFetch.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch } from './apiFetch.js';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status, body = '{}') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  }));
}

describe('apiFetch', () => {
  it('returns parsed json on success', async () => {
    stubFetch(200, '{"a":1}');
    expect(await apiFetch('/api/x')).toEqual({ a: 1 });
  });

  it('maps 401 to a login-required message', async () => {
    stubFetch(401, '{"error":"login required"}');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toContain('ログインが必要');
    expect(err.status).toBe(401);
  });

  it('maps 429 to a daily-limit message', async () => {
    stubFetch(429, '{"error":"daily limit reached","resetAt":1}');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toContain('本日のAI利用上限');
    expect(err.status).toBe(429);
  });

  it('keeps the generic message for other errors', async () => {
    stubFetch(500, 'boom');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toContain('API error 500');
    expect(err.status).toBe(500);
  });
});
```

```js
// src/api/authClient.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMe, fetchProviders, patchMe, logout, loginUrl } from './authClient.js';

afterEach(() => vi.unstubAllGlobals());

describe('authClient', () => {
  it('loginUrl builds the start path', () => {
    expect(loginUrl('google')).toBe('/auth/google/start');
  });

  it('fetchMe GETs /api/me', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: null }) });
    vi.stubGlobal('fetch', f);
    expect(await fetchMe()).toEqual({ user: null });
    expect(f.mock.calls[0][0]).toBe('/api/me');
  });

  it('patchMe PATCHes /api/me with a json body', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: { id: 'u' } }) });
    vi.stubGlobal('fetch', f);
    await patchMe({ displayName: '名前' });
    const [url, options] = f.mock.calls[0];
    expect(url).toBe('/api/me');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({ displayName: '名前' });
  });

  it('logout POSTs /auth/logout', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', f);
    await logout();
    expect(f.mock.calls[0][0]).toBe('/auth/logout');
    expect(f.mock.calls[0][1].method).toBe('POST');
  });

  it('fetchProviders GETs /api/auth/providers', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: ['google'] }) });
    vi.stubGlobal('fetch', f);
    expect(await fetchProviders()).toEqual({ providers: ['google'] });
  });
});
```

Run: `npx vitest run src/api/apiFetch.test.js src/api/authClient.test.js`
Expected: FAIL (module not found)

- [ ] **Step 2: Write implementations**

```js
// src/api/apiFetch.js
export async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    let message;
    if (res.status === 401) message = 'ログインが必要です。右上からログインしてください。';
    else if (res.status === 429) message = '本日のAI利用上限に達しました。明日また遊べます。';
    else message = `API error ${res.status}: ${t.slice(0, 200)}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
```

```js
// src/api/authClient.js
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
```

`src/api/client.js` — `callClaude`の中身を`apiFetch('/api/messages', {...})`に置き換え(importを追加し、手書きのres.okチェックを削除)。`extractText`等は不変。

`src/api/sessionSyncClient.js` — ローカルの`apiFetch`定義を削除して`import { apiFetch } from './apiFetch.js'`に。末尾に追加:

```js
export async function listServerSessions() {
  return apiFetch('/api/sessions');
}
```

既存の`client.test.js`/`sessionSyncClient.test.js`でエラーメッセージ文言を検証している箇所があれば、新メッセージ(401/429時)に合わせて更新。通常ステータスの文言は不変なので大半はそのまま通るはず。

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/api/`
Expected: 全PASS

- [ ] **Step 4: Commit**

```bash
git add src/api/apiFetch.js src/api/apiFetch.test.js src/api/authClient.js src/api/authClient.test.js src/api/client.js src/api/sessionSyncClient.js src/api/client.test.js src/api/sessionSyncClient.test.js
git commit -m "feat(client): 共通apiFetch(401/429文言)と認証APIクライアント"
```

---

### Task 14: AuthContext

**Files:**
- Create: `src/auth/AuthContext.jsx`
- Create: `src/test/renderWithAuth.jsx`
- Test: `src/auth/AuthContext.test.jsx`

**Interfaces:**
- Consumes: Task 13の`fetchMe`/`logout`
- Produces:
  - `AuthContext`(named export、テスト用)
  - `AuthProvider({ children })` — マウント時に`fetchMe`。値は`{ user, loading, refresh, logout }`
  - `useAuth(): { user, loading, refresh, logout }`
  - `renderWithAuth(ui, { user? })` — テスト用。既定user=`{ id: 'usr_test', displayName: 'テスト', avatarUrl: null }`。`user: null`で未ログイン状態を再現

- [ ] **Step 1: Write the failing test**

```jsx
// src/auth/AuthContext.test.jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from './AuthContext.jsx';

afterEach(() => vi.unstubAllGlobals());

function Probe() {
  const { user, loading, logout } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      <div>{user ? `hello ${user.displayName}` : 'logged out'}</div>
      <button onClick={logout}>logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  it('loads the current user on mount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ user: { id: 'u1', displayName: '太郎' } }),
    }));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('hello 太郎')).toBeInTheDocument());
  });

  it('treats a fetch failure as logged out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('logged out')).toBeInTheDocument());
  });

  it('logout clears the user even when the request fails', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: 'u1', displayName: '太郎' } }) })
      .mockRejectedValueOnce(new Error('down'));
    vi.stubGlobal('fetch', f);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => screen.getByText('hello 太郎'));
    await userEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByText('logged out')).toBeInTheDocument());
  });
});
```

(注: `userEvent`が依存に無い場合は`fireEvent.click`で代替すること。既存テストの慣習に合わせる。)

Run: `npx vitest run src/auth/AuthContext.test.jsx`
Expected: FAIL

- [ ] **Step 2: Write implementation**

```jsx
// src/auth/AuthContext.jsx
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { fetchMe, logout as apiLogout } from '../api/authClient.js';

export const AuthContext = createContext({
  user: null,
  loading: true,
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { user: me } = await fetchMe();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // サーバー側の失敗に関わらずクライアントはログアウト状態にする
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

```jsx
// src/test/renderWithAuth.jsx
import { render } from '@testing-library/react';
import { AuthContext } from '../auth/AuthContext.jsx';

export function renderWithAuth(ui, { user = { id: 'usr_test', displayName: 'テスト', avatarUrl: null }, ...options } = {}) {
  return render(
    <AuthContext.Provider value={{ user, loading: false, refresh: async () => {}, logout: async () => {} }}>
      {ui}
    </AuthContext.Provider>,
    options
  );
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/auth/AuthContext.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 4: Commit**

```bash
git add src/auth/AuthContext.jsx src/auth/AuthContext.test.jsx src/test/renderWithAuth.jsx
git commit -m "feat(auth): AuthContext(/api/meロード・logout)とテストヘルパー"
```

---

### Task 15: ログインUI(AuthBar / LoginModal)とApp組み込み

**Files:**
- Create: `src/components/auth/LoginModal.jsx`
- Create: `src/components/auth/AuthBar.jsx`
- Modify: `src/App.jsx`
- Test: `src/components/auth/LoginModal.test.jsx` / `src/components/auth/AuthBar.test.jsx`、`src/App.test.jsx`更新

**Interfaces:**
- Consumes: Task 13の`fetchProviders`/`loginUrl`/`patchMe`、Task 14の`useAuth`/`AuthProvider`、既存UI部品(`Button`/`Card`/`Field`)、`src/theme.js`の`COLORS`/`F_MONO`等
- Produces:
  - `LoginModal({ onClose })` — マウント時に`fetchProviders`し、有効プロバイダのボタン(表示名: Google / Discord / X)を表示。クリックで`window.location.assign(loginUrl(provider))`。プロバイダ0件時は「ログイン方法が設定されていません」表示
  - `AuthBar()` — 画面右上に固定表示。`loading`中は何も出さない。未ログイン: 「ログイン」ボタン→LoginModal。ログイン中: アバター(なければ表示名頭文字の丸)+表示名→開閉メニュー(「プロフィール編集」(表示名入力+アバター削除チェックの小モーダル、保存で`patchMe`→`refresh`)、「ログアウト」)
  - App.jsx — 全体を`<AuthProvider>`で包み、`<AuthBar />`を最上部に配置。マウント時に`location.search`に`auth_error=1`があれば「ログインに失敗しました。もう一度お試しください。」バナーを表示し、`history.replaceState`でクエリを除去

- [ ] **Step 1: Write failing tests**(要点のみ抜粋 — 実装者は同スタイルで全ケース書くこと)

```jsx
// src/components/auth/LoginModal.test.jsx の中心ケース
it('lists configured providers and navigates on click', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: ['google', 'x'] }) }));
  // jsdomはwindow.locationが差し替え不可なので、delete後に代入する定番の回避策を使う
  const assign = vi.fn();
  const original = window.location;
  delete window.location;
  window.location = { ...original, assign };
  render(<LoginModal onClose={() => {}} />);
  await waitFor(() => screen.getByText('Google'));
  expect(screen.queryByText('Discord')).toBeNull();
  fireEvent.click(screen.getByText('Google'));
  expect(assign).toHaveBeenCalledWith('/auth/google/start');
});
```

```jsx
// src/components/auth/AuthBar.test.jsx の中心ケース
it('shows a login button when logged out', () => {
  renderWithAuth(<AuthBar />, { user: null });
  expect(screen.getByText('ログイン')).toBeInTheDocument();
});

it('shows the display name and can open the menu to logout', () => {
  renderWithAuth(<AuthBar />); // 既定ユーザー「テスト」
  fireEvent.click(screen.getByText('テスト'));
  expect(screen.getByText('ログアウト')).toBeInTheDocument();
  expect(screen.getByText('プロフィール編集')).toBeInTheDocument();
});
```

`App.test.jsx`: 既存テストが`fetch`をstubしていない場合、`/api/me`呼び出しで失敗→未ログイン扱いになるだけで既存アサーションは通るはず。`auth_error=1`バナーのテストを1本追加。

Run: `npx vitest run src/components/auth/ src/App.test.jsx`
Expected: FAIL

- [ ] **Step 2: Implement LoginModal / AuthBar / App変更**

LoginModal(完全実装):

```jsx
// src/components/auth/LoginModal.jsx
import { useEffect, useState } from 'react';
import { COLORS, F_DISPLAY, F_BODY } from '../../theme.js';
import Button from '../ui/Button.jsx';
import { fetchProviders, loginUrl } from '../../api/authClient.js';

const LABELS = { google: 'Google', discord: 'Discord', x: 'X' };

export default function LoginModal({ onClose }) {
  const [providers, setProviders] = useState(null);

  useEffect(() => {
    fetchProviders()
      .then(({ providers: p }) => setProviders(p))
      .catch(() => setProviders([]));
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.paper, borderRadius: 8, padding: 24, minWidth: 280 }}
      >
        <div style={{ fontFamily: F_DISPLAY, fontSize: 16, color: COLORS.ink, marginBottom: 12 }}>
          ログイン
        </div>
        <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft, marginBottom: 16 }}>
          プレイの進行・素材ライブラリ・小説化にはログインが必要です。メールアドレスは取得しません。
        </div>
        {providers === null && <div style={{ fontFamily: F_BODY, fontSize: 13 }}>読み込み中…</div>}
        {providers?.length === 0 && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.stamp }}>
            ログイン方法が設定されていません
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(providers || []).map((p) => (
            <Button key={p} variant="brass" onClick={() => window.location.assign(loginUrl(p))}>
              {LABELS[p] || p} でログイン
            </Button>
          ))}
        </div>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Button variant="ghost" onClick={onClose}>閉じる</Button>
        </div>
      </div>
    </div>
  );
}
```

AuthBarはLoginModal同様のスタイルで実装(構成はInterfaces欄のとおり: 状態`menuOpen`/`editOpen`/`loginOpen`、プロフィール編集モーダルは`Field`+`Button`で`patchMe({ displayName })`と`patchMe({ avatarUrl: null })`、保存成功で`refresh()`と閉じる、失敗時はモーダル内にエラーメッセージ表示)。`position: 'fixed', top: 12, right: 16, zIndex: 90`。

App.jsx変更(構造):

```jsx
export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

function AppInner() {
  // 既存のstate・ハンドラは全てここへ移動(中身は不変)
  const [authError, setAuthError] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_error') === '1') {
      setAuthError(true);
      params.delete('auth_error');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);
  return (
    <div style={{ background: COLORS.paper, minHeight: '100vh', color: COLORS.ink }}>
      <AuthBar />
      {authError && (
        <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.stamp, textAlign: 'center', padding: '8px 12px' }}>
          ログインに失敗しました。もう一度お試しください。
        </div>
      )}
      {/* 既存のview切替はそのまま */}
    </div>
  );
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/components/auth/ src/App.test.jsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/auth/ src/App.jsx src/App.test.jsx
git commit -m "feat(ui): ログインバー・ログインモーダル・プロフィール編集"
```

---

### Task 16: 未ログイン時のゲート(Play / Home / Library)

**Files:**
- Modify: `src/screens/Play.jsx` / `src/screens/Home.jsx` / `src/screens/Library.jsx`
- Test: `src/screens/Play.test.jsx` / `src/screens/Home.test.jsx` / `src/screens/Library.test.jsx` 更新(`renderWithAuth`利用に書き換え)

**Interfaces:**
- Consumes: Task 14の`useAuth`/`renderWithAuth`
- Produces(挙動):
  - **Play**: `const { user, loading: authLoading } = useAuth()`。`runTurn`冒頭に未ログインガード(`if (!user) { setError('プレイの進行にはログインが必要です。右上からログインしてください。'); return false; }`)。初回自動ターンのuseEffectは`authLoading`が解けてから発火(`if (authLoading) return;`を先頭に追加し、依存配列に`authLoading`)。サーバー同期は`if (user) putSessionToServer(...)`に変更(未ログインでは呼ばない)
  - **Home**: 未ログイン時、「+ 新規プレイ」と各セッションの「小説化」ボタンを`disabled`にし、ボタン群の下に`「プレイと小説化にはログインが必要です(右上からログイン)」`の案内(F_MONO 12px, COLORS.faint)を表示。「素材ライブラリ」「続きから再開」(閲覧)は許可
  - **Library**: `useAuth()`で未ログイン(かつ`!loading`)なら、タブの代わりに案内(「素材ライブラリの利用にはログインが必要です。右上からログインしてください。」+閉じるボタン)を表示

- [ ] **Step 1: 各テストを更新して失敗を確認**

既存のrender呼び出しを`renderWithAuth`(ログイン済み既定)に置き換え → 既存アサーションは全部そのまま通る状態を保つ。未ログインケースを各画面に追加:

```jsx
// Home.test.jsx
it('disables new play and novelize when logged out', () => {
  renderWithAuth(<Home sessions={[fakeSession]} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />, { user: null });
  expect(screen.getByText('+ 新規プレイ')).toBeDisabled();
  expect(screen.getByText('小説化')).toBeDisabled();
  expect(screen.getByText(/ログインが必要/)).toBeInTheDocument();
});

// Library.test.jsx
it('shows a login prompt instead of tabs when logged out', () => {
  renderWithAuth(<Library onClose={vi.fn()} />, { user: null });
  expect(screen.getByText(/ログインが必要/)).toBeInTheDocument();
});

// Play.test.jsx
it('refuses to run a turn when logged out', async () => {
  renderWithAuth(<Play session={sessionWithLog} setSession={vi.fn()} onExit={vi.fn()} />, { user: null });
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '進む' } });
  fireEvent.click(screen.getByText('送信')); // 実際のボタンラベルに合わせること
  await waitFor(() => expect(screen.getByText(/ログインが必要/)).toBeInTheDocument());
});
```

(注: Play.test.jsxのボタンラベル・入力要素の特定は既存テストの書き方をコピーすること。`sessionWithLog`は`log`が空でないセッション — 空だと初回自動ターンが走って別経路になる。)

Run: `npx vitest run src/screens/`
Expected: FAIL(新ケースのみ。既存ケースがrenderWithAuth化で壊れたらそれも直す)

- [ ] **Step 2: 3画面を実装**

上記Interfaces欄の挙動どおり。Playの変更点は3箇所のみ(runTurnガード / 初回effectのauthLoading待ち / 同期のif (user)ガード)。差分を最小に保つ。

Run: `npx vitest run src/screens/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/screens/
git commit -m "feat(ui): 未ログイン時のプレイ・ライブラリ・小説化ゲート"
```

---

### Task 17: ログイン後のローカルセッション引き継ぎ

**Files:**
- Create: `src/auth/useSessionTakeover.js`
- Modify: `src/App.jsx`(AppInnerに組み込み)
- Test: `src/auth/useSessionTakeover.test.jsx`

**Interfaces:**
- Consumes: `useAuth`、`listSessions`(`src/storage/index.js`)、`listServerSessions`/`putSessionToServer`(`src/api/sessionSyncClient.js`)、`ConfirmModal`(`src/components/library/ConfirmModal.jsx` — 既存propsはファイルを読んで合わせること)
- Produces: `useSessionTakeover(): { pendingCount, confirm, dismiss }`
  - ログイン状態が「未ログイン→ログイン済み」に変わったとき(初回ロードでログイン済みの場合も含む)に1回だけ実行: `listSessions()`と`listServerSessions()`を突き合わせ、「サーバーに無い、またはローカルの`updatedAt`が新しい」セッションを候補にし`pendingCount`を設定
  - `confirm()` — 候補を順に`putSessionToServer`し、`pendingCount`を0に。失敗はconsole.errorのみ(プレイ阻害しない)
  - `dismiss()` — 何もアップロードせず`pendingCount`を0に
  - AppInnerで`pendingCount > 0`のとき`ConfirmModal`を表示: 「このブラウザに保存されたセッション{n}件をアカウントに保存しますか?」

- [ ] **Step 1: Write the failing test**

```jsx
// src/auth/useSessionTakeover.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthContext } from './AuthContext.jsx';
import { useSessionTakeover } from './useSessionTakeover.js';

vi.mock('../storage/index.js', () => ({ listSessions: vi.fn() }));
vi.mock('../api/sessionSyncClient.js', () => ({
  listServerSessions: vi.fn(),
  putSessionToServer: vi.fn().mockResolvedValue({}),
}));
import { listSessions } from '../storage/index.js';
import { listServerSessions, putSessionToServer } from '../api/sessionSyncClient.js';

function wrapper(user) {
  return ({ children }) => (
    <AuthContext.Provider value={{ user, loading: false, refresh: async () => {}, logout: async () => {} }}>
      {children}
    </AuthContext.Provider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('useSessionTakeover', () => {
  it('counts local sessions missing on the server or locally newer', async () => {
    listSessions.mockResolvedValue([
      { id: 'a', updatedAt: 200 },
      { id: 'b', updatedAt: 100 },
      { id: 'c', updatedAt: 100 },
    ]);
    listServerSessions.mockResolvedValue([
      { id: 'b', updatedAt: 300 }, // サーバーが新しい → 対象外
      { id: 'c', updatedAt: 50 },  // ローカルが新しい → 対象
    ]);
    const { result } = renderHook(() => useSessionTakeover(), { wrapper: wrapper({ id: 'u1' }) });
    await waitFor(() => expect(result.current.pendingCount).toBe(2)); // a と c
  });

  it('confirm uploads the candidates and clears the count', async () => {
    listSessions.mockResolvedValue([{ id: 'a', updatedAt: 200 }]);
    listServerSessions.mockResolvedValue([]);
    const { result } = renderHook(() => useSessionTakeover(), { wrapper: wrapper({ id: 'u1' }) });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    await act(() => result.current.confirm());
    expect(putSessionToServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(result.current.pendingCount).toBe(0);
  });

  it('does nothing while logged out', async () => {
    listSessions.mockResolvedValue([{ id: 'a', updatedAt: 1 }]);
    const { result } = renderHook(() => useSessionTakeover(), { wrapper: wrapper(null) });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.pendingCount).toBe(0);
    expect(listServerSessions).not.toHaveBeenCalled();
  });

  it('dismiss clears without uploading', async () => {
    listSessions.mockResolvedValue([{ id: 'a', updatedAt: 200 }]);
    listServerSessions.mockResolvedValue([]);
    const { result } = renderHook(() => useSessionTakeover(), { wrapper: wrapper({ id: 'u1' }) });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    act(() => result.current.dismiss());
    expect(result.current.pendingCount).toBe(0);
    expect(putSessionToServer).not.toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/auth/useSessionTakeover.test.jsx`
Expected: FAIL

- [ ] **Step 2: Write implementation**

```js
// src/auth/useSessionTakeover.js
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { listSessions } from '../storage/index.js';
import { listServerSessions, putSessionToServer } from '../api/sessionSyncClient.js';

export function useSessionTakeover() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState([]);
  const checkedForRef = useRef(null); // 同一ユーザーで1回だけ

  useEffect(() => {
    if (!user || checkedForRef.current === user.id) return;
    checkedForRef.current = user.id;
    (async () => {
      try {
        const [local, server] = await Promise.all([listSessions(), listServerSessions()]);
        const serverById = new Map(server.map((s) => [s.id, s]));
        setCandidates(
          local.filter((s) => {
            const remote = serverById.get(s.id);
            return !remote || (s.updatedAt || 0) > (remote.updatedAt || 0);
          })
        );
      } catch (e) {
        console.error('session takeover check failed', e);
      }
    })();
  }, [user]);

  const confirm = useCallback(async () => {
    for (const session of candidates) {
      try {
        await putSessionToServer(session);
      } catch (e) {
        console.error('session upload failed', e);
      }
    }
    setCandidates([]);
  }, [candidates]);

  const dismiss = useCallback(() => setCandidates([]), []);

  return { pendingCount: candidates.length, confirm, dismiss };
}
```

App.jsxのAppInnerに組み込み: `const takeover = useSessionTakeover();` + `takeover.pendingCount > 0`で`ConfirmModal`表示(メッセージ「このブラウザに保存されたセッション{takeover.pendingCount}件をアカウントに保存しますか?」、確定→`takeover.confirm()`、キャンセル→`takeover.dismiss()`。ConfirmModalの実propsは実ファイルを読んで合わせる)。

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/auth/ src/App.test.jsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/auth/useSessionTakeover.js src/auth/useSessionTakeover.test.jsx src/App.jsx
git commit -m "feat(auth): ログイン後のローカルセッション引き継ぎ"
```

---

### Task 18: ドキュメント更新・.env.example・受け入れ確認

**Files:**
- Modify: `docs/01-architecture.md` / `docs/04-persistence.md`
- Create: `.env.example`
- Test: フルスイート

- [ ] **Step 1: docs更新**

- `01-architecture.md`: プロキシサーバーの箇条書きに「自前OAuth 2.0(Google/Discord/X, PKCE)によるソーシャルログインとhttpOnlyクッキーのサーバーサイドセッション」「全APIは要認証で`users/{userId}`名前空間」「AI呼び出しはユーザー単位の日次利用制限」を追記。デプロイ形態にBASE_URL/DATA_DIR/永続ディスク前提を追記
- `04-persistence.md`: サーバー側のキー構造を`users/{userId}/...`に更新し、`auth/identities`・`auth/sessions`・`users/{userId}/profile`・`users/{userId}/usage/{day}`を追加。API表に`/auth/*`・`/api/me`・`/api/auth/providers`と、認証必須・429の記述を追加

- [ ] **Step 2: .env.example作成**

```bash
# .env.example
ANTHROPIC_API_KEY=
BASE_URL=http://localhost:5173
# DATA_DIR=/data            # 本番: 永続ディスクのマウント先
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
X_CLIENT_ID=
X_CLIENT_SECRET=
LIMIT_MESSAGES_PER_DAY=200
LIMIT_NOVELIZE_PER_DAY=10
```

- [ ] **Step 3: 受け入れ確認**

Run: `npm test`
Expected: 全テストPASS。1つでも落ちていたら直してから次へ

- [ ] **Step 4: Commit**

```bash
git add docs/01-architecture.md docs/04-persistence.md .env.example
git commit -m "docs: 認証・名前空間・利用制限をアーキテクチャ/永続化ドキュメントに反映"
```

---

## 完了条件

- `npm test` 全パス
- `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`を設定して`npm run dev` → 右上「ログイン」→Google認可→戻ってきて表示名が出る(手動確認)
- 未ログインで「+ 新規プレイ」が押せず、素材ライブラリが案内表示になる(手動確認)
