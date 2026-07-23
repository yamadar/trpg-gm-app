import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from './App.jsx';
import * as shareClient from './api/shareClient.js';

afterEach(() => {
  window.location.hash = '';
});

describe('App', () => {
  it('shows the home screen after the initial storage check completes', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());
    expect(screen.getByText('+ 新規プレイ')).toBeInTheDocument();
  });

  it('navigates to the library screen and back', async () => {
    // ライブラリはログイン必須なので、/api/meはログイン済みユーザーを返す必要がある
    // (それ以外のURL、たとえばWorld一覧取得は空配列を返す)。
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({ ok: true, json: async () => ({ user: { id: 'usr_test', displayName: 'テスト' } }) });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    fireEvent.click(screen.getByText('素材ライブラリ'));
    await waitFor(() => expect(screen.getByText('素材ライブラリ')).toBeInTheDocument());
    expect(screen.getByText('World一覧')).toBeInTheDocument();

    fireEvent.click(screen.getByText('閉じる'));
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    vi.unstubAllGlobals();
  });

  it('navigates to the public gallery screen and back, without requiring login', async () => {
    // ギャラリーは未ログインでも閲覧できる想定なので、/api/meは未ログイン(userなし)を返す。
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({ ok: true, json: async () => ({ user: null }) });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    fireEvent.click(screen.getByText('公開ギャラリー'));
    await waitFor(() => expect(screen.getByText('まだ公開されたものがありません')).toBeInTheDocument());

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

  it('renders UserPage when the hash matches #/u/{userId}, keeping AuthBar visible', async () => {
    window.location.hash = '#/u/usr_x';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ user: null }) }))
    );
    const profileSpy = vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_x',
      displayName: 'Xavier',
      avatarUrl: null,
      bio: '',
    });
    const itemsSpy = vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue({
      novels: [],
      worlds: [],
      characters: [],
      scenarios: [],
    });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Xavier')).toBeInTheDocument());
    expect(profileSpy).toHaveBeenCalledWith('usr_x');
    expect(itemsSpy).toHaveBeenCalledWith('usr_x');
    expect(screen.getByText('ログイン')).toBeInTheDocument();
    expect(screen.queryByText("GM's Desk")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
