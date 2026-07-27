import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  putSessionToServer,
  novelizeSession,
  getNovel,
  getIllustratedNovel,
  listNovelJobs,
  SESSION_CONFLICT_EVENT,
} from './sessionSyncClient.js';

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
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(session),
        headers: expect.objectContaining({ 'If-Match': '"0"', 'X-Device-Id': expect.any(String) }),
      })
    );
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(putSessionToServer({ id: 's1' })).rejects.toThrow('API error 500: boom');
  });

  it('dispatches server progress with a conflict event on 409', async () => {
    const remote = { id: 's-conflict', title: 'remote', _sync: { revision: 2 } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ code: 'SESSION_CONFLICT', current: remote }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const listener = vi.fn();
    window.addEventListener(SESSION_CONFLICT_EVENT, listener);

    await expect(putSessionToServer({ id: 's-conflict', title: 'local' })).rejects.toMatchObject({ status: 409 });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].detail).toMatchObject({
      sessionId: 's-conflict',
      local: { title: 'local' },
      remote: { title: 'remote' },
    });
    window.removeEventListener(SESSION_CONFLICT_EVENT, listener);
  });

  it('does not send queued stale writes after the first write conflicts', async () => {
    const remote = { id: 's-queued', title: 'remote', _sync: { revision: 2 } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ code: 'SESSION_CONFLICT', current: remote }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = putSessionToServer({ id: 's-queued', title: 'local-1' });
    const queued = putSessionToServer({ id: 's-queued', title: 'local-2' });

    await expect(first).rejects.toMatchObject({ status: 409 });
    await expect(queued).rejects.toMatchObject({ code: 'SESSION_SYNC_BLOCKED' });
    expect(fetchMock).toHaveBeenCalledOnce();
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

describe('getIllustratedNovel', () => {
  it('GETs the illustrated novel endpoint with an encoded id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ html: '<!doctype html>' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getIllustratedNovel('s 1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/s%201/novel/illustrated',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual({ html: '<!doctype html>' });
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

describe('listNovelJobs', () => {
  it('GETs the novel job map', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ s1: { status: 'running', error: null, hasNovel: false, stale: false } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const jobs = await listNovelJobs();

    expect(fetchMock).toHaveBeenCalledWith('/api/novel-jobs', undefined);
    expect(jobs.s1.status).toBe('running');
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(listNovelJobs()).rejects.toThrow('API error 500: boom');
  });
});
