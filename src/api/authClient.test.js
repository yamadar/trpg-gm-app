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
