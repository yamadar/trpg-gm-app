import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import Library from './Library.jsx';
import { renderWithAuth } from '../test/renderWithAuth.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(worlds = []) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => worlds }));
}

describe('Library', () => {
  it('shows the World tab by default', async () => {
    stubFetch([]);
    renderWithAuth(<Library onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('World一覧')).toBeInTheDocument());
  });

  it('shows a world-selector dropdown only on the Character/Scenario tabs', async () => {
    stubFetch([{ id: 'w1', title: 'World A', updatedAt: 1 }]);
    renderWithAuth(<Library onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('World一覧')).toBeInTheDocument());
    expect(screen.queryByText('World: 選択してください')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Character'));
    await waitFor(() => expect(screen.getByText('World: 選択してください')).toBeInTheDocument());
  });

  it('shows guidance in the Character tab when no world is selected', async () => {
    stubFetch([]);
    renderWithAuth(<Library onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Character'));
    await waitFor(() =>
      expect(screen.getByText('先にWorldタブでWorldを作成・選択してください。')).toBeInTheDocument()
    );
  });

  it('calls onClose when the close button is clicked', async () => {
    stubFetch([]);
    const onClose = vi.fn();
    renderWithAuth(<Library onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('World一覧')).toBeInTheDocument());
    fireEvent.click(screen.getByText('閉じる'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an error banner when listWorlds fails on mount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }));
    renderWithAuth(<Library onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/World一覧の取得に失敗した/)).toBeInTheDocument());
  });

  it('shows a login prompt instead of tabs when logged out', () => {
    renderWithAuth(<Library onClose={vi.fn()} />, { user: null });
    expect(screen.getByText(/ログインが必要/)).toBeInTheDocument();
    expect(screen.queryByText('World')).not.toBeInTheDocument();
    expect(screen.getByText('閉じる')).toBeInTheDocument();
  });
});
