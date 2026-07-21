import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Library from './Library.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(worlds = []) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => worlds }));
}

describe('Library', () => {
  it('shows the World tab by default', async () => {
    stubFetch([]);
    render(<Library onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('World一覧')).toBeInTheDocument());
  });

  it('shows a world-selector dropdown only on the Character/Scenario tabs', async () => {
    stubFetch([{ id: 'w1', title: 'World A', updatedAt: 1 }]);
    render(<Library onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('World一覧')).toBeInTheDocument());
    expect(screen.queryByText('World: 選択してください')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Character'));
    await waitFor(() => expect(screen.getByText('World: 選択してください')).toBeInTheDocument());
  });

  it('shows guidance in the Character tab when no world is selected', async () => {
    stubFetch([]);
    render(<Library onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Character'));
    await waitFor(() =>
      expect(screen.getByText('先にWorldタブでWorldを作成・選択してください。')).toBeInTheDocument()
    );
  });

  it('calls onClose when the close button is clicked', async () => {
    stubFetch([]);
    const onClose = vi.fn();
    render(<Library onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('World一覧')).toBeInTheDocument());
    fireEvent.click(screen.getByText('閉じる'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
