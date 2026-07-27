// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { generateImage } from './imageProvider.js';

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe('generateImage', () => {
  it('posts the prompt to the model endpoint and returns the inline image', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({ candidates: [{ content: { parts: [{ inlineData: { data: 'BASE64', mimeType: 'image/png' } }] } }] })
    );
    const out = await generateImage({ prompt: 'a castle', apiKey: 'k', model: 'image-model-test', fetchImpl });
    expect(out).toEqual({ base64: 'BASE64', mimeType: 'image/png' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/image-model-test:generateContent',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-goog-api-key': 'k' }) })
    );
  });
  it('defaults mimeType to image/png when absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ candidates: [{ content: { parts: [{ inlineData: { data: 'B' } }] } }] }));
    const out = await generateImage({ prompt: 'x', apiKey: 'k', model: 'm', fetchImpl });
    expect(out.mimeType).toBe('image/png');
  });
  it('sends referenceImages as leading inlineData parts before the text prompt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ candidates: [{ content: { parts: [{ inlineData: { data: 'B' } }] } }] }));
    await generateImage({
      prompt: 'scene',
      apiKey: 'k',
      model: 'm',
      fetchImpl,
      referenceImages: [{ base64: 'REF1', mimeType: 'image/png' }, { base64: 'REF2' }],
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.contents[0].parts).toEqual([
      { inlineData: { data: 'REF1', mimeType: 'image/png' } },
      { inlineData: { data: 'REF2', mimeType: 'image/png' } },
      { text: 'scene' },
    ]);
  });
  it('sends only the text part when no referenceImages are given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ candidates: [{ content: { parts: [{ inlineData: { data: 'B' } }] } }] }));
    await generateImage({ prompt: 'scene', apiKey: 'k', model: 'm', fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.contents[0].parts).toEqual([{ text: 'scene' }]);
  });
  it('throws when the response has no image part', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ candidates: [{ content: { parts: [{ text: 'no image' }] } }] }));
    await expect(generateImage({ prompt: 'x', apiKey: 'k', model: 'm', fetchImpl })).rejects.toThrow(/no image/);
  });
  it('throws when the upstream status is not ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' });
    await expect(generateImage({ prompt: 'x', apiKey: 'k', model: 'm', fetchImpl })).rejects.toThrow(/400/);
  });
});
