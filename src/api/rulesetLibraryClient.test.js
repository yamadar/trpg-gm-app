import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRuleset, putRuleset, listRulesets, deleteRuleset } from './rulesetLibraryClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getRuleset', () => {
  it('GETs a ruleset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'homebrew' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getRuleset('homebrew');
    expect(fetchMock).toHaveBeenCalledWith('/api/rulesets/homebrew', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual({ id: 'homebrew' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRuleset('missing')).rejects.toThrow('API error 404: not found');
  });
});

describe('putRuleset', () => {
  it('PUTs label, desc, hint, and growthUnit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'homebrew' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putRuleset('homebrew', { label: '自作ルール', desc: '独自ルール', hint: '演出ヒント', growthUnit: 'CP' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rulesets/homebrew',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ label: '自作ルール', desc: '独自ルール', hint: '演出ヒント', growthUnit: 'CP' }),
      })
    );
  });
});

describe('listRulesets', () => {
  it('GETs the full ruleset list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'homebrew' }] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listRulesets();
    expect(fetchMock).toHaveBeenCalledWith('/api/rulesets', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual([{ id: 'homebrew' }]);
  });
});

describe('deleteRuleset', () => {
  it('DELETEs a ruleset and does not attempt to parse a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteRuleset('homebrew')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/rulesets/homebrew', expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteRuleset('homebrew')).rejects.toThrow('API error 500: boom');
  });
});
