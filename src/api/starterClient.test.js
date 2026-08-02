import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listStarters, importStarterPack } from './starterClient.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('starterClient', () => {
  it('fetches the manifest', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ packs: [], seededAt: null }) });
    await expect(listStarters()).resolves.toEqual({ packs: [], seededAt: null });
    expect(fetch).toHaveBeenCalledWith('/api/starters', undefined);
  });

  it('posts to the import endpoint with the pack id encoded', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ world: { id: 'w' } }) });
    await importStarterPack('arkham-1920s');
    expect(fetch).toHaveBeenCalledWith('/api/starters/arkham-1920s/import', {
      method: 'POST',
      headers: { 'X-GMDesk-CSRF': '1' },
    });
  });

  it('surfaces API errors', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(importStarterPack('arkham-1920s')).rejects.toThrow(/500/);
  });
});
