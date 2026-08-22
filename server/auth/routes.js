import { Router } from 'express';
import { randomToken } from './crypto.js';
import { authorizationUrl, exchangeCode, fetchProfile } from './providers.js';
import {
  findOrCreateUser,
  getUser,
  linkProviderIdentity,
  updateUserProfile,
} from './users.js';
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
  transaction = async (operation) => operation(),
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

  // 既存アカウントへ別のログイン方法を追加する。OAuth callbackの前に、現在の
  // セッションから所有者を確定するため、cookie内の値だけでリンク先を選ばない。
  router.post('/auth/:provider/link/start', asyncHandler(async (req, res) => {
    const provider = providers[req.params.provider];
    const user = await currentUser(req);
    if (!user) {
      res.status(401).json({ error: 'login required' });
      return;
    }
    if (!provider) {
      res.status(404).json({ error: 'unknown provider' });
      return;
    }
    const state = randomToken();
    const codeVerifier = randomToken();
    res.cookie(OAUTH_COOKIE, JSON.stringify({
      provider: provider.name,
      state,
      codeVerifier,
      intent: 'link',
    }), {
      ...cookieOpts,
      maxAge: OAUTH_COOKIE_TTL_MS,
    });
    res.json({ url: authorizationUrl(provider, { baseUrl, state, codeVerifier }) });
  }));

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
      if (saved.intent === 'link') {
        const user = await currentUser(req);
        if (!user) {
          const error = new Error('login required to link provider');
          error.code = 'LINK_SESSION_MISSING';
          throw error;
        }
        await transaction(() => linkProviderIdentity(dataStore, {
          userId: user.id,
          provider: provider.name,
          providerUserId: profile.providerUserId,
        }));
        res.clearCookie(OAUTH_COOKIE, cookieOpts);
        res.redirect(`/?auth_linked=${encodeURIComponent(provider.name)}`);
        return;
      }
      const user = await transaction(() => findOrCreateUser(dataStore, { provider: provider.name, ...profile }));
      const token = await createAuthSession(dataStore, user.id);
      res.clearCookie(OAUTH_COOKIE, cookieOpts);
      res.cookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: SESSION_TTL_MS });
      res.redirect('/');
    } catch (error) {
      console.error('oauth callback failed', {
        name: error?.name || 'Error',
        code: error?.code || null,
      });
      res.clearCookie(OAUTH_COOKIE, cookieOpts);
      res.redirect(error?.code === 'IDENTITY_ALREADY_LINKED'
        ? '/?auth_link_error=identity_in_use'
        : '/?auth_error=1');
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
    // This route is mounted before requireAuth (see index.js), so it is not
    // protected by that middleware and must enforce its own 401 here.
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
    if ('bio' in req.body) {
      const bio = typeof req.body.bio === 'string' ? req.body.bio.trim() : null;
      if (bio === null || bio.length > 500) {
        res.status(400).json({ error: 'bio must be a string of at most 500 characters' });
        return;
      }
      patch.bio = bio;
    }
    await updateUserProfile(dataStore, user.id, patch);
    res.json({ user: await getUser(dataStore, user.id) });
  }));

  return router;
}
