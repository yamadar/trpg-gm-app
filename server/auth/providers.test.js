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
