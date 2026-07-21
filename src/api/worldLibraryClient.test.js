import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  putWorld,
  putWorldSource,
  getWorldSource,
  putRegion,
  putCategory,
  getWorld,
  listWorlds,
  deleteWorld,
} from './worldLibraryClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('putWorld', () => {
  it('PUTs to /api/worlds/:id with title and raw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'w1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await putWorld('w1', { title: 'A', raw: 'raw text' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ title: 'A', raw: 'raw text' }) })
    );
    expect(result).toEqual({ id: 'w1' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(putWorld('w1', { title: 'A', raw: 'x' })).rejects.toThrow('API error 500: boom');
  });
});

describe('putWorldSource / getWorldSource', () => {
  it('PUTs source text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ raw: 'x' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putWorldSource('w1', '原文');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/source',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ raw: '原文' }) })
    );
  });

  it('GETs source text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ raw: '原文' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getWorldSource('w1');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1/source', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual({ raw: '原文' });
  });
});

describe('putRegion / putCategory', () => {
  it('PUTs a region', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'waterdeep' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putRegion('w1', 'waterdeep', '地域詳細');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/regions/waterdeep',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ raw: '地域詳細' }) })
    );
  });

  it('PUTs a category', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'magic-system' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putCategory('w1', 'magic-system', 'カテゴリ詳細');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/categories/magic-system',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ raw: 'カテゴリ詳細' }) })
    );
  });
});

describe('getWorld', () => {
  it('GETs a world', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'w1', title: 'A', raw: 'x', updatedAt: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getWorld('w1');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual({ id: 'w1', title: 'A', raw: 'x', updatedAt: 1 });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getWorld('missing')).rejects.toThrow('API error 404: not found');
  });
});

describe('listWorlds', () => {
  it('GETs the full world list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'w1', title: 'A' }] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listWorlds();
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual([{ id: 'w1', title: 'A' }]);
  });
});

describe('deleteWorld', () => {
  it('DELETEs a world and does not attempt to parse a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteWorld('w1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteWorld('w1')).rejects.toThrow('API error 500: boom');
  });
});
