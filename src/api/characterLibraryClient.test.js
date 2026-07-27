import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCharacter, putCharacter, listCharacters, deleteCharacter, putCharacterParsed } from './characterLibraryClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getCharacter', () => {
  it('GETs a character', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'alice' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getCharacter('w1', 'pc', 'alice');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/characters/pc/alice',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual({ id: 'alice' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getCharacter('w1', 'pc', 'missing')).rejects.toThrow('API error 404: not found');
  });
});

describe('putCharacter', () => {
  it('PUTs the user-entered name, raw, and revealed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'alice' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putCharacter('w1', 'pc', 'alice', {
      characterName: 'アリス',
      raw: 'PC名: アリス',
      revealed: undefined,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/characters/pc/alice',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ characterName: 'アリス', raw: 'PC名: アリス', revealed: undefined }),
      })
    );
  });
});

describe('listCharacters', () => {
  it('GETs the list for a world and kind', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'alice' }] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listCharacters('w1', 'pc');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/characters/pc',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual([{ id: 'alice' }]);
  });
});

describe('deleteCharacter', () => {
  it('DELETEs a character and does not attempt to parse a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteCharacter('w1', 'pc', 'alice')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/characters/pc/alice',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteCharacter('w1', 'pc', 'alice')).rejects.toThrow('API error 500: boom');
  });
});

describe('putCharacterParsed', () => {
  it('PUTs parsed and parsedHash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'alice' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putCharacterParsed('w1', 'pc', 'alice', { parsed: { goal: 'x', bonds: 'y' }, parsedHash: 'h1' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/characters/pc/alice/parsed',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ parsed: { goal: 'x', bonds: 'y' }, parsedHash: 'h1' }),
      })
    );
  });
});

describe('URL encoding', () => {
  it('encodes worldId/kind/name segments for getCharacter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await getCharacter('w#1', 'pc', 'a/b');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w%231/characters/pc/a%2Fb',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
