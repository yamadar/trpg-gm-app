import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthContext } from '../../auth/AuthContext.jsx';
import { renderWithAuth } from '../../test/renderWithAuth.jsx';
import AuthBar from './AuthBar.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = '';
});

function renderWithContext(value, ui = <AuthBar />) {
  return render(<AuthContext.Provider value={value}>{ui}</AuthContext.Provider>);
}

describe('AuthBar', () => {
  it('renders nothing while auth is loading', () => {
    const { container } = renderWithContext({
      user: null,
      loading: true,
      refresh: vi.fn(),
      logout: vi.fn(),
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a login button when logged out', () => {
    renderWithAuth(<AuthBar />, { user: null });
    expect(screen.getByText('ログイン')).toBeInTheDocument();
  });

  it('opens the login modal when the login button is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [] }) })
    );
    renderWithAuth(<AuthBar />, { user: null });
    fireEvent.click(screen.getByText('ログイン'));
    await waitFor(() =>
      expect(screen.getByText('ログイン方法が設定されていません')).toBeInTheDocument()
    );
  });

  it('shows the display name and can open the menu to logout', () => {
    renderWithAuth(<AuthBar />); // 既定ユーザー「テスト」
    fireEvent.click(screen.getByText('テスト'));
    expect(screen.getByText('ログアウト')).toBeInTheDocument();
    expect(screen.getByText('プロフィール編集')).toBeInTheDocument();
  });

  it('renders a first-letter avatar circle when no avatarUrl is set', () => {
    renderWithAuth(<AuthBar />, {
      user: { id: 'usr_test', displayName: 'テスト', avatarUrl: null },
    });
    expect(screen.getByText('テ')).toBeInTheDocument();
  });

  it('renders an avatar image when avatarUrl is set', () => {
    const { container } = renderWithAuth(<AuthBar />, {
      user: { id: 'usr_test', displayName: 'テスト', avatarUrl: 'https://example.com/a.png' },
    });
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/a.png');
  });

  it('navigates to my own user page and closes the menu when "自分のページ" is clicked', () => {
    renderWithAuth(<AuthBar />, {
      user: { id: 'usr_test', displayName: 'テスト', avatarUrl: null },
    });
    fireEvent.click(screen.getByText('テスト'));
    fireEvent.click(screen.getByText('自分のページ'));

    expect(window.location.hash).toBe('#/u/usr_test');
    expect(screen.queryByText('ログアウト')).not.toBeInTheDocument();
  });

  it('calls logout when the logout menu item is clicked', () => {
    const logout = vi.fn();
    renderWithContext({
      user: { id: 'usr_test', displayName: 'テスト', avatarUrl: null },
      loading: false,
      refresh: vi.fn(),
      logout,
    });
    fireEvent.click(screen.getByText('テスト'));
    fireEvent.click(screen.getByText('ログアウト'));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('edits the display name via the profile modal, saves, and refreshes', async () => {
    const refresh = vi.fn().mockResolvedValue();
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: {} }) });
    vi.stubGlobal('fetch', f);
    renderWithContext({
      user: { id: 'usr_test', displayName: 'テスト', avatarUrl: null },
      loading: false,
      refresh,
      logout: vi.fn(),
    });
    fireEvent.click(screen.getByText('テスト'));
    fireEvent.click(screen.getByText('プロフィール編集'));

    const input = screen.getByDisplayValue('テスト');
    fireEvent.change(input, { target: { value: '新しい名前' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const [url, options] = f.mock.calls[0];
    expect(url).toBe('/api/me');
    expect(JSON.parse(options.body)).toEqual({ displayName: '新しい名前', bio: '' });
    await waitFor(() => expect(screen.queryByText('保存')).toBeNull());
  });

  it('pre-fills the bio textarea with the user\'s current bio', () => {
    const { container } = renderWithContext({
      user: { id: 'usr_test', displayName: 'テスト', avatarUrl: null, bio: '既存の自己紹介' },
      loading: false,
      refresh: vi.fn(),
      logout: vi.fn(),
    });
    fireEvent.click(screen.getByText('テスト'));
    fireEvent.click(screen.getByText('プロフィール編集'));

    expect(container.querySelector('textarea').value).toBe('既存の自己紹介');
  });

  it('defaults the bio textarea to an empty string when the user has no bio', () => {
    const { container } = renderWithContext({
      user: { id: 'usr_test', displayName: 'テスト', avatarUrl: null },
      loading: false,
      refresh: vi.fn(),
      logout: vi.fn(),
    });
    fireEvent.click(screen.getByText('テスト'));
    fireEvent.click(screen.getByText('プロフィール編集'));

    expect(container.querySelector('textarea').value).toBe('');
  });

  it('includes the edited bio in the patchMe payload on save', async () => {
    const refresh = vi.fn().mockResolvedValue();
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: {} }) });
    vi.stubGlobal('fetch', f);
    const { container } = renderWithContext({
      user: { id: 'usr_test', displayName: 'テスト', avatarUrl: null, bio: '' },
      loading: false,
      refresh,
      logout: vi.fn(),
    });
    fireEvent.click(screen.getByText('テスト'));
    fireEvent.click(screen.getByText('プロフィール編集'));

    fireEvent.change(container.querySelector('textarea'), { target: { value: 'よろしくお願いします' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const [, options] = f.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ displayName: 'テスト', bio: 'よろしくお願いします' });
  });

  it('clears the avatar when the checkbox is checked before saving', async () => {
    const refresh = vi.fn().mockResolvedValue();
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: {} }) });
    vi.stubGlobal('fetch', f);
    renderWithContext({
      user: { id: 'usr_test', displayName: 'テスト', avatarUrl: 'https://example.com/a.png' },
      loading: false,
      refresh,
      logout: vi.fn(),
    });
    fireEvent.click(screen.getByText('テスト'));
    fireEvent.click(screen.getByText('プロフィール編集'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const [, options] = f.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ displayName: 'テスト', bio: '', avatarUrl: null });
  });

  it('shows an error in the profile modal when saving fails, and keeps the modal open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })
    );
    renderWithContext({
      user: { id: 'usr_test', displayName: 'テスト', avatarUrl: null },
      loading: false,
      refresh: vi.fn(),
      logout: vi.fn(),
    });
    fireEvent.click(screen.getByText('テスト'));
    fireEvent.click(screen.getByText('プロフィール編集'));
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText(/API error 500/)).toBeInTheDocument());
    expect(screen.getByText('保存')).toBeInTheDocument();
  });

  it('closes the profile modal via the cancel button without saving', () => {
    renderWithAuth(<AuthBar />);
    fireEvent.click(screen.getByText('テスト'));
    fireEvent.click(screen.getByText('プロフィール編集'));
    fireEvent.click(screen.getByText('キャンセル'));
    expect(screen.queryByText('保存')).toBeNull();
  });

  it('closes the menu when clicking outside', () => {
    renderWithAuth(<AuthBar />); // 既定ログイン
    fireEvent.click(screen.getByText('テスト')); // メニューを開く(表示名トグル)
    expect(screen.getByText('ログアウト')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('ログアウト')).toBeNull();
  });

  it('still opens and closes the menu via the toggle button itself (unaffected by the outside-click listener)', () => {
    renderWithAuth(<AuthBar />);
    const toggle = screen.getByText('テスト');

    // A real click is preceded by a mousedown on the same target; fire both
    // to prove the document mousedown listener doesn't fight the toggle
    // (e.g. closing on mousedown and having the click re-open it).
    fireEvent.mouseDown(toggle);
    fireEvent.click(toggle);
    expect(screen.getByText('ログアウト')).toBeInTheDocument();

    fireEvent.mouseDown(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByText('ログアウト')).toBeNull();
  });
});
