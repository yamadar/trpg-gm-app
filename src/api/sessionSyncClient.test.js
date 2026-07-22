import { describe, it, expect, vi, afterEach } from 'vitest';
import { putSessionToServer, novelizeSession, getNovel } from './sessionSyncClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('putSessionToServer', () => {
  it('PUTs the full session object', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 's1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const session = { id: 's1', title: 'A' };
    await putSessionToServer(session);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/s1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(session) })
    );
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(putSessionToServer({ id: 's1' })).rejects.toThrow('API error 500: boom');
  });
});

describe('novelizeSession', () => {
  it('POSTs to the novelize endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    await novelizeSession('s1');
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/novelize', expect.objectContaining({ method: 'POST' }));
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => 'upstream down' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(novelizeSession('s1')).rejects.toThrow('API error 502: upstream down');
  });
});

describe('getNovel', () => {
  it('GETs the generated novel text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: '小説本文' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getNovel('s1');
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/novel', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual({ text: '小説本文' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getNovel('s1')).rejects.toThrow('API error 404: not found');
  });
});

describe('URL encoding', () => {
  it('encodes the session id for novelizeSession', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await novelizeSession('s/1');
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s%2F1/novelize', expect.objectContaining({ method: 'POST' }));
  });
});
