import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from './App.jsx';

describe('App', () => {
  it('shows the home screen after the initial storage check completes', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());
    expect(screen.getByText('+ 新規プレイ')).toBeInTheDocument();
  });

  it('navigates to the library screen and back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    fireEvent.click(screen.getByText('素材ライブラリ'));
    await waitFor(() => expect(screen.getByText('素材ライブラリ')).toBeInTheDocument());
    expect(screen.getByText('World一覧')).toBeInTheDocument();

    fireEvent.click(screen.getByText('閉じる'));
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    vi.unstubAllGlobals();
  });

  it('shows an auth error banner when the URL has auth_error=1 and strips the query param', async () => {
    window.history.pushState({}, '', '/?auth_error=1');
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByText('ログインに失敗しました。もう一度お試しください。')
      ).toBeInTheDocument()
    );
    expect(window.location.search).toBe('');

    window.history.pushState({}, '', '/');
  });
});
