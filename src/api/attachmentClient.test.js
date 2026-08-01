import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachmentBase,
  attachmentUrl,
  deleteAttachment,
  getAttachments,
  publicAttachmentUrl,
  setTopAttachment,
  updateAttachment,
  uploadAttachment,
  uploadProfileImage,
} from './attachmentClient.js';

afterEach(() => vi.unstubAllGlobals());

function stubJson(body = {}, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('attachmentClient', () => {
  it('builds owner-specific paths and immutable image URLs', () => {
    expect(attachmentBase({ type: 'world', worldId: 'w1' })).toBe('/api/worlds/w1');
    expect(attachmentBase({ type: 'scenario', worldId: 'w1', scenarioId: 's1' })).toBe(
      '/api/worlds/w1/scenarios/s1',
    );
    expect(attachmentBase({ type: 'character', worldId: 'w1', kind: 'pc', name: 'alice' })).toBe(
      '/api/worlds/w1/characters/pc/alice',
    );
    expect(attachmentBase({ type: 'novel', sessionId: 'sess1' })).toBe('/api/sessions/sess1/novel');
    expect(attachmentUrl({ type: 'world', worldId: 'w1' }, 'att_1', 'thumbnail')).toBe(
      '/api/worlds/w1/attachments/att_1/thumbnail',
    );
    expect(publicAttachmentUrl('worlds', 'pub_1', 'att_1')).toBe(
      '/api/public/worlds/pub_1/attachments/att_1/display',
    );
  });

  it('uses JSON requests for metadata operations', async () => {
    const fetchMock = stubJson({ items: [] });
    const owner = { type: 'world', worldId: 'w1' };
    await getAttachments(owner);
    await updateAttachment(owner, 'att_1', '説明');
    await setTopAttachment(owner, 'att_1');
    await deleteAttachment(owner, 'att_1');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/worlds/w1/attachments',
      '/api/worlds/w1/attachments/att_1',
      '/api/worlds/w1/attachments/top',
      '/api/worlds/w1/attachments/att_1',
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ description: '説明' });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ imageId: 'att_1' });
    expect(fetchMock.mock.calls[3][1].method).toBe('DELETE');
  });

  it('uploads content and profile images with FormData', async () => {
    const fetchMock = stubJson({ item: { id: 'att_1' } }, 201);
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    await uploadAttachment({ type: 'novel', sessionId: 's1' }, file, '説明');
    await uploadProfileImage(file);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sessions/s1/novel/attachments');
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'X-GMDesk-CSRF': '1' });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/me/profile-image');
  });
});
