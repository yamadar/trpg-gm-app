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
  listRegions,
  getRegion,
  listCategories,
  getCategory,
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

describe('listRegions', () => {
  it('GETs the region id list for a world', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ['waterdeep', 'sword-coast'] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listRegions('w1');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1/regions', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual(['waterdeep', 'sword-coast']);
  });
});

describe('getRegion', () => {
  it('GETs a single region', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'waterdeep', raw: '地域詳細' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getRegion('w1', 'waterdeep');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/regions/waterdeep',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual({ id: 'waterdeep', raw: '地域詳細' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRegion('w1', 'missing')).rejects.toThrow('API error 404: not found');
  });
});

describe('listCategories', () => {
  it('GETs the category id list for a world', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ['magic-system'] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listCategories('w1');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1/categories', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual(['magic-system']);
  });
});

describe('getCategory', () => {
  it('GETs a single category', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'magic-system', raw: 'カテゴリ詳細' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getCategory('w1', 'magic-system');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/categories/magic-system',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual({ id: 'magic-system', raw: 'カテゴリ詳細' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getCategory('w1', 'missing')).rejects.toThrow('API error 404: not found');
  });
});

describe('URL encoding', () => {
  it('encodes special characters in the world id for getWorld', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await getWorld('a/b#c');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/a%2Fb%23c', expect.objectContaining({ method: 'GET' }));
  });
});
