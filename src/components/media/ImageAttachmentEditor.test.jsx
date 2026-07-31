import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as client from '../../api/attachmentClient.js';
import ImageAttachmentEditor from './ImageAttachmentEditor.jsx';

const item = {
  id: 'att_1',
  description: '古城',
  mimeType: 'image/webp',
  width: 800,
  height: 600,
  byteSize: 10,
  createdAt: 1,
  updatedAt: 1,
};

afterEach(() => vi.restoreAllMocks());

describe('ImageAttachmentEditor', () => {
  it('loads images and can select a top image', async () => {
    vi.spyOn(client, 'getAttachments').mockResolvedValue({
      schemaVersion: 1,
      topImageId: null,
      items: [item],
      updatedAt: 1,
    });
    const setTop = vi.spyOn(client, 'setTopAttachment').mockResolvedValue({
      schemaVersion: 1,
      topImageId: item.id,
      items: [item],
      updatedAt: 2,
    });
    render(<ImageAttachmentEditor owner={{ type: 'world', worldId: 'w1' }} />);

    expect(await screen.findByAltText('古城')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'トップ画像にする' }));
    expect(setTop).toHaveBeenCalledWith({ type: 'world', worldId: 'w1' }, item.id);
    expect(await screen.findByText('トップ画像')).toBeInTheDocument();
  });

  it('edits and saves an image description', async () => {
    vi.spyOn(client, 'getAttachments').mockResolvedValue({
      schemaVersion: 1,
      topImageId: item.id,
      items: [item],
      updatedAt: 1,
    });
    const update = vi.spyOn(client, 'updateAttachment').mockResolvedValue({
      collection: {
        schemaVersion: 1,
        topImageId: item.id,
        items: [{ ...item, description: '夜の古城' }],
        updatedAt: 2,
      },
      item: { ...item, description: '夜の古城' },
    });
    render(<ImageAttachmentEditor owner={{ type: 'world', worldId: 'w1' }} />);
    const textarea = await screen.findByRole('textbox', { name: '画像の説明' });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, '夜の古城');
    await userEvent.click(screen.getByRole('button', { name: '説明を保存' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(
      { type: 'world', worldId: 'w1' },
      item.id,
      '夜の古城',
    ));
  });
});
