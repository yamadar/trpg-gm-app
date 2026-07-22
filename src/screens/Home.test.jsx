import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Home, { sanitizeFilename } from './Home.jsx';
import * as sessionSyncClient from '../api/sessionSyncClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Home', () => {
  it('shows the storage warning when storage is unavailable', () => {
    render(<Home sessions={[]} storageOk={false} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText(/保存機能\(IndexedDB\)が使えていない/)).toBeInTheDocument();
  });

  it('does not show the warning when storage is available', () => {
    render(<Home sessions={[]} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.queryByText(/保存機能\(IndexedDB\)が使えていない/)).not.toBeInTheDocument();
  });

  it('lists resumable sessions with scene and last line', () => {
    const sessions = [
      {
        id: 's1',
        title: 'セッションA',
        updatedAt: 1,
        state: { current_scene: '森', turn_count: 3 },
        log: [{ role: 'gm', text: '森の奥から物音がした。' }],
      },
    ];
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText('セッションA')).toBeInTheDocument();
    expect(screen.getByText(/シーン:/)).toBeInTheDocument();
    expect(screen.getByText(/森の奥から物音がした。/)).toBeInTheDocument();
  });

  it('shows a placeholder last line when the session has no log yet', () => {
    const sessions = [{ id: 's1', title: 'セッションB', updatedAt: 1, state: {}, log: [] }];
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText('(まだ進行なし)')).toBeInTheDocument();
  });

  it('calls onOpenLibrary when the library button is clicked', () => {
    const onOpenLibrary = vi.fn();
    render(<Home sessions={[]} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={onOpenLibrary} />);
    fireEvent.click(screen.getByText('素材ライブラリ'));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });

  it('novelizes a session and triggers a file download when "小説化" is clicked, without navigating into the session', async () => {
    const novelizeSpy = vi.spyOn(sessionSyncClient, 'novelizeSession').mockResolvedValue({ ok: true });
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({ text: '小説本文' });
    const createObjectURLSpy = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURLSpy = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: createObjectURLSpy, revokeObjectURL: revokeObjectURLSpy });

    const sessions = [{ id: 's1', title: 'セッションA', updatedAt: 1, state: {}, log: [] }];
    const onContinue = vi.fn();
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={onContinue} onOpenLibrary={vi.fn()} />);

    fireEvent.click(screen.getByText('小説化'));

    await waitFor(() => expect(novelizeSpy).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(sessionSyncClient.getNovel).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(createObjectURLSpy).toHaveBeenCalled());
    // 「小説化」ボタンはカード全体のonClick(onContinue、セッションへの遷移)の内側にあるため、
    // イベント伝播を止めていないと誤って遷移してしまう。stopPropagationの検証。
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('shows an error message when novelization fails', async () => {
    vi.spyOn(sessionSyncClient, 'novelizeSession').mockRejectedValue(new Error('upstream down'));
    const sessions = [{ id: 's1', title: 'セッションA', updatedAt: 1, state: {}, log: [] }];
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    fireEvent.click(screen.getByText('小説化'));

    await waitFor(() => expect(screen.getByText(/小説化に失敗した/)).toBeInTheDocument());
  });

  it('sanitizes filesystem-unsafe and dot-only titles', () => {
    expect(sanitizeFilename('a/b:c')).toBe('a_b_c');
    expect(sanitizeFilename('..')).toBe('session');
    expect(sanitizeFilename('')).toBe('session');
    expect(sanitizeFilename('普通のタイトル')).toBe('普通のタイトル');
  });

  it('keeps each session novelize button independent (concurrent guard is per-session)', async () => {
    let resolveA;
    vi.spyOn(sessionSyncClient, 'novelizeSession').mockImplementation((id) =>
      id === 's1'
        ? new Promise((r) => {
            resolveA = r;
          })
        : Promise.resolve({ ok: true })
    );
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({ text: '本文' });
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:x'), revokeObjectURL: vi.fn() });

    const sessions = [
      { id: 's1', title: 'A', updatedAt: 2, state: {}, log: [] },
      { id: 's2', title: 'B', updatedAt: 1, state: {}, log: [] },
    ];
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    const buttons = screen.getAllByText('小説化');
    fireEvent.click(buttons[0]); // s1の小説化を開始(pendingのまま)
    await waitFor(() => expect(screen.getByText('小説化中…')).toBeInTheDocument());
    // s1が「小説化中…」になっても、s2のボタンは独立して「小説化」のまま(単一ガードではない)
    expect(screen.getAllByText('小説化').length).toBe(1);
    if (resolveA) resolveA({ ok: true });
    vi.restoreAllMocks();
  });
});
