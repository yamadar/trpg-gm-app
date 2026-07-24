import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSceneImage, sceneImageUrl, getConfig } from './sceneImageClient.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ imageId: 'img_1', newAppearances: [] }) }));
});

describe('sceneImageClient', () => {
  it('POSTs logIndex to the images endpoint', async () => {
    await generateSceneImage('s 1', 2);
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/s%201/images',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ logIndex: 2 }) })
    );
  });
  it('builds an encoded image URL', () => {
    expect(sceneImageUrl('s 1', 'img_x')).toBe('/api/sessions/s%201/images/img_x');
  });
  it('GETs the config endpoint', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ imageGen: true }) });
    expect(await getConfig()).toEqual({ imageGen: true });
  });
});
