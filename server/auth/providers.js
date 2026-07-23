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
