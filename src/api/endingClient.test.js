import { describe, it, expect, vi, afterEach } from 'vitest';
import { recordEnding, listEndings, renameEnding, deleteEnding } from './endingClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonFetch(body) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body });
}

describe('recordEnding', () => {
  it('POSTs the stats to the session ending endpoint', async () => {
    const fetchMock = jsonFetch({ sessionId: 's1', endingTitle: '題' });
    vi.stubGlobal('fetch', fetchMock);
    const stats = { total: 3 };

    const out = await recordEnding('s1', stats);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/s1/ending',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ stats }) })
    );
    expect(out.endingTitle).toBe('題');
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => 'boom' }));
    await expect(recordEnding('s1', {})).rejects.toThrow('API error 502: boom');
  });
});

describe('listEndings', () => {
  it('GETs the ending list', async () => {
    const fetchMock = jsonFetch([{ sessionId: 's1' }]);
    vi.stubGlobal('fetch', fetchMock);

    const out = await listEndings();

    expect(fetchMock).toHaveBeenCalledWith('/api/endings', undefined);
    expect(out).toHaveLength(1);
  });
});

describe('renameEnding', () => {
  it('PATCHes the new title', async () => {
    const fetchMock = jsonFetch({ sessionId: 's1', endingTitle: '新題' });
    vi.stubGlobal('fetch', fetchMock);

    await renameEnding('s1', '新題');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/endings/s1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ endingTitle: '新題' }) })
    );
  });
});

describe('deleteEnding', () => {
  it('DELETEs the ending without parsing a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteEnding('s1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/endings/s1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'nope' }));
    await expect(deleteEnding('s1')).rejects.toThrow('API error 404: nope');
  });
});
