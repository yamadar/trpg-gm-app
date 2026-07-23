import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  listPublic, getPublic,
  publishWorld, unpublishWorld,
  publishCharacter, unpublishCharacter,
  publishScenario, unpublishScenario,
  publishNovel, unpublishNovel,
  publishedWorlds, publishedCharacters, publishedScenarios, publishedNovels,
  importWorld, importCharacter, importScenario,
} from './shareClient.js';

afterEach(() => vi.unstubAllGlobals());

function stubJsonFetch(body = {}, status = 200) {
  const f = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', f);
  return f;
}

function stub204Fetch() {
  const f = vi.fn().mockResolvedValue({
    ok: true,
    status: 204,
    json: async () => { throw new Error('no body'); },
    text: async () => '',
  });
  vi.stubGlobal('fetch', f);
  return f;
}

describe('shareClient', () => {
  describe('listPublic / getPublic', () => {
    it('listPublic GETs /api/public/{type}', async () => {
      const f = stubJsonFetch([{ publicId: 'p1' }]);
      expect(await listPublic('worlds')).toEqual([{ publicId: 'p1' }]);
      expect(f.mock.calls[0][0]).toBe('/api/public/worlds');
      expect(f.mock.calls[0][1]?.method ?? 'GET').toBe('GET');
    });

    it('getPublic GETs /api/public/{type}/{publicId}', async () => {
      const f = stubJsonFetch({ title: 'World' });
      expect(await getPublic('worlds', 'pub-1')).toEqual({ title: 'World' });
      expect(f.mock.calls[0][0]).toBe('/api/public/worlds/pub-1');
    });

    it('encodeURIComponent is applied to path segments', async () => {
      const f = stubJsonFetch({});
      await getPublic('worlds', 'a/b c');
      expect(f.mock.calls[0][0]).toBe(`/api/public/worlds/${encodeURIComponent('a/b c')}`);
    });
  });

  describe('publish / unpublish worlds', () => {
    it('publishWorld POSTs /api/publish/worlds/{worldId}', async () => {
      const f = stubJsonFetch({ publicId: 'pub-w1' });
      expect(await publishWorld('w1')).toEqual({ publicId: 'pub-w1' });
      const [url, options] = f.mock.calls[0];
      expect(url).toBe('/api/publish/worlds/w1');
      expect(options.method).toBe('POST');
    });

    it('unpublishWorld DELETEs /api/publish/worlds/{worldId}', async () => {
      const f = stub204Fetch();
      await unpublishWorld('w1');
      const [url, options] = f.mock.calls[0];
      expect(url).toBe('/api/publish/worlds/w1');
      expect(options.method).toBe('DELETE');
    });

    it('unpublishWorld does not throw on a 204 empty body', async () => {
      stub204Fetch();
      await expect(unpublishWorld('w1')).resolves.not.toThrow();
    });

    it('unpublishWorld throws on a non-ok response', async () => {
      const f = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
      vi.stubGlobal('fetch', f);
      await expect(unpublishWorld('w1')).rejects.toThrow('API error 404');
    });
  });

  describe('publish / unpublish characters', () => {
    it('publishCharacter POSTs /api/publish/worlds/{worldId}/characters/{kind}/{name}', async () => {
      const f = stubJsonFetch({ publicId: 'pub-c1' });
      expect(await publishCharacter('w1', 'pc', 'Alice')).toEqual({ publicId: 'pub-c1' });
      const [url, options] = f.mock.calls[0];
      expect(url).toBe('/api/publish/worlds/w1/characters/pc/Alice');
      expect(options.method).toBe('POST');
    });

    it('unpublishCharacter DELETEs the same path', async () => {
      const f = stub204Fetch();
      await unpublishCharacter('w1', 'pc', 'Alice');
      const [url, options] = f.mock.calls[0];
      expect(url).toBe('/api/publish/worlds/w1/characters/pc/Alice');
      expect(options.method).toBe('DELETE');
    });

    it('encodeURIComponent is applied to worldId/kind/name segments', async () => {
      const f = stubJsonFetch({});
      await publishCharacter('w 1', 'p c', 'A/B');
      expect(f.mock.calls[0][0]).toBe(
        `/api/publish/worlds/${encodeURIComponent('w 1')}/characters/${encodeURIComponent('p c')}/${encodeURIComponent('A/B')}`
      );
    });
  });

  describe('publish / unpublish scenarios', () => {
    it('publishScenario POSTs /api/publish/worlds/{worldId}/scenarios/{scenarioId}', async () => {
      const f = stubJsonFetch({ publicId: 'pub-s1' });
      expect(await publishScenario('w1', 's1')).toEqual({ publicId: 'pub-s1' });
      const [url, options] = f.mock.calls[0];
      expect(url).toBe('/api/publish/worlds/w1/scenarios/s1');
      expect(options.method).toBe('POST');
    });

    it('unpublishScenario DELETEs the same path', async () => {
      const f = stub204Fetch();
      await unpublishScenario('w1', 's1');
      const [url, options] = f.mock.calls[0];
      expect(url).toBe('/api/publish/worlds/w1/scenarios/s1');
      expect(options.method).toBe('DELETE');
    });
  });

  describe('publish / unpublish novel', () => {
    it('publishNovel POSTs /api/publish/sessions/{sessionId}/novel', async () => {
      const f = stubJsonFetch({ publicId: 'pub-n1' });
      expect(await publishNovel('sess1')).toEqual({ publicId: 'pub-n1' });
      const [url, options] = f.mock.calls[0];
      expect(url).toBe('/api/publish/sessions/sess1/novel');
      expect(options.method).toBe('POST');
    });

    it('unpublishNovel DELETEs the same path', async () => {
      const f = stub204Fetch();
      await unpublishNovel('sess1');
      const [url, options] = f.mock.calls[0];
      expect(url).toBe('/api/publish/sessions/sess1/novel');
      expect(options.method).toBe('DELETE');
    });
  });

  describe('published* listing', () => {
    it('publishedWorlds GETs /api/publish/worlds', async () => {
      const f = stubJsonFetch({ w1: 'pub-w1' });
      expect(await publishedWorlds()).toEqual({ w1: 'pub-w1' });
      expect(f.mock.calls[0][0]).toBe('/api/publish/worlds');
    });

    it('publishedCharacters GETs /api/publish/worlds/{worldId}/characters/{kind}', async () => {
      const f = stubJsonFetch({ Alice: 'pub-c1' });
      expect(await publishedCharacters('w1', 'pc')).toEqual({ Alice: 'pub-c1' });
      expect(f.mock.calls[0][0]).toBe('/api/publish/worlds/w1/characters/pc');
    });

    it('publishedScenarios GETs /api/publish/worlds/{worldId}/scenarios', async () => {
      const f = stubJsonFetch({ s1: 'pub-s1' });
      expect(await publishedScenarios('w1')).toEqual({ s1: 'pub-s1' });
      expect(f.mock.calls[0][0]).toBe('/api/publish/worlds/w1/scenarios');
    });

    it('publishedNovels GETs /api/publish/sessions', async () => {
      const f = stubJsonFetch({ sess1: 'pub-n1' });
      expect(await publishedNovels()).toEqual({ sess1: 'pub-n1' });
      expect(f.mock.calls[0][0]).toBe('/api/publish/sessions');
    });
  });

  describe('import*', () => {
    it('importWorld POSTs /api/import/worlds/{publicId}', async () => {
      const f = stubJsonFetch({ id: 'w-new' });
      expect(await importWorld('pub-w1')).toEqual({ id: 'w-new' });
      const [url, options] = f.mock.calls[0];
      expect(url).toBe('/api/import/worlds/pub-w1');
      expect(options.method).toBe('POST');
    });

    it('importCharacter POSTs /api/import/characters/{publicId} with a targetWorldId body', async () => {
      const f = stubJsonFetch({ name: 'Alice' });
      expect(await importCharacter('pub-c1', 'w2')).toEqual({ name: 'Alice' });
      const [url, options] = f.mock.calls[0];
      expect(url).toBe('/api/import/characters/pub-c1');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ targetWorldId: 'w2' });
    });

    it('importScenario POSTs /api/import/scenarios/{publicId} with a targetWorldId body', async () => {
      const f = stubJsonFetch({ id: 's-new' });
      expect(await importScenario('pub-s1', 'w2')).toEqual({ id: 's-new' });
      const [url, options] = f.mock.calls[0];
      expect(url).toBe('/api/import/scenarios/pub-s1');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ targetWorldId: 'w2' });
    });

    it('encodeURIComponent is applied to publicId/targetWorldId segments', async () => {
      const f = stubJsonFetch({});
      await importWorld('pub 1');
      expect(f.mock.calls[0][0]).toBe(`/api/import/worlds/${encodeURIComponent('pub 1')}`);
    });
  });
});
