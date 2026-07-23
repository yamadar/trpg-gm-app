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
