import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import NovelReader from './NovelReader.jsx';
import * as sessionSyncClient from '../api/sessionSyncClient.js';
import * as attachmentClient from '../api/attachmentClient.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';

describe('NovelReader', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(attachmentClient, 'getAttachments').mockResolvedValue({ topImageId: null, items: [] });
  });

  it('shows private top and gallery attachments using the same layout as a public novel', async () => {
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({
      title: '霧の港', raw: '本文', imageIds: [], stale: false, truncated: false,
    });
    vi.spyOn(attachmentClient, 'getAttachments').mockResolvedValue({
      topImageId: 'att_top',
      items: [
        { id: 'att_top', description: '港の夜景' },
        { id: 'att_extra', description: '古い地図' },
      ],
    });

    renderWithAuth(<NovelReader sessionId="sess_1" />);

    expect(await screen.findByRole('img', { name: '港の夜景' })).toHaveAttribute(
      'src', '/api/sessions/sess_1/novel/attachments/att_top/display',
    );
    expect(screen.getByRole('img', { name: '古い地図' })).toHaveAttribute(
      'src', '/api/sessions/sess_1/novel/attachments/att_extra/display',
    );
  });

  it('renders generated text and inserts private scene images at their markers', async () => {
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({
      title: '霧の港',
      raw: '港へ着いた。\n〈挿絵1〉\n鐘が鳴った。',
      imageIds: ['img_scene1'],
      stale: false,
      truncated: false,
    });

    renderWithAuth(<NovelReader sessionId="sess_1" />);

    expect(await screen.findByText('霧の港')).toBeInTheDocument();
    expect(screen.getByText('港へ着いた。')).toBeInTheDocument();
    expect(screen.getByText('鐘が鳴った。')).toBeInTheDocument();
    expect(screen.queryByText('〈挿絵1〉')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: '場面の挿絵 1' })).toHaveAttribute(
      'src',
      '/api/sessions/sess_1/images/img_scene1',
    );
  });

  it('renders text from the previous API response shape during a server restart', async () => {
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({ text: '旧APIでも読める本文', stale: false });
    vi.spyOn(sessionSyncClient, 'getServerSession').mockResolvedValue({
      id: 'sess_1',
      title: '再起動前の小説',
      log: [{ role: 'gm', image: { imageId: 'img_old' } }],
    });

    renderWithAuth(<NovelReader sessionId="sess_1" />);

    expect(await screen.findByText('再起動前の小説')).toBeInTheDocument();
    expect(screen.getByText('旧APIでも読める本文')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '場面の挿絵 1' })).not.toBeInTheDocument();
  });

  it('shows a private-reader error when the server denies access', async () => {
    vi.spyOn(sessionSyncClient, 'getNovel').mockRejectedValue(Object.assign(new Error('API error 401'), { status: 401 }));

    renderWithAuth(<NovelReader sessionId="sess_1" />, { user: null });

    await waitFor(() => expect(screen.getByText('小説を読むにはログインが必要です')).toBeInTheDocument());
  });
});
