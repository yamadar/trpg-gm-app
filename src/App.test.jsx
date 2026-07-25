import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from './App.jsx';
import * as shareClient from './api/shareClient.js';
import * as starterClient from './api/starterClient.js';

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
        if (String(url).includes('/api/public/')) {
          return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0, hasMore: false }) });
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
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });

    render(<App />);

    await waitFor(() => expect(screen.getByText('Xavier')).toBeInTheDocument());
    expect(profileSpy).toHaveBeenCalledWith('usr_x');
    expect(listSpy).toHaveBeenCalledWith('novels', expect.objectContaining({ ownerId: 'usr_x' }));
    expect(screen.getByText('ログイン')).toBeInTheDocument();
    expect(screen.queryByText("GM's Desk")).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('renders the ending gallery for the #/endings route', async () => {
    window.location.hash = '#/endings';
    try {
      render(<App />);
      expect(await screen.findByText('エンディング図鑑')).toBeInTheDocument();
    } finally {
      window.location.hash = '';
    }
  });

  it('clears the starter context when the plain new-session button is used', async () => {
    // 「+ 新規プレイ」から入った Setup が、直前のスターター選択を引きずらないこと
    // (引きずると World/Scenario が勝手に選択済みになる)。
    // 「+ 新規プレイ」はログイン必須で無効化されるため、/api/me はログイン済みユーザーを返す。
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({ ok: true, json: async () => ({ user: { id: 'usr_test', displayName: 'テスト' } }) });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: [], seededAt: null });
    render(<App />);
    const newButton = await screen.findByText('+ 新規プレイ');
    await waitFor(() => expect(newButton).not.toBeDisabled()); // ログイン確認が終わるまで待つ
    fireEvent.click(newButton);
    expect(await screen.findByText('1. 世界観')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
