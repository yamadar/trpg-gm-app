import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import UserPage from './UserPage.jsx';
import * as shareClient from '../api/shareClient.js';
import * as hashRoute from '../router/useHashRoute.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import { renderWithAuth } from '../test/renderWithAuth.jsx';

const DEFAULT_AUTH_VALUE = {
  user: { id: 'usr_test', displayName: 'テスト', avatarUrl: null },
  loading: false,
  refresh: async () => {},
  logout: async () => {},
};

function rerenderWithAuth(rerender, ui) {
  rerender(<AuthContext.Provider value={DEFAULT_AUTH_VALUE}>{ui}</AuthContext.Provider>);
}

const PUBLISHED_AT = 1700000000000;
const EXPECTED_DATE = new Date(PUBLISHED_AT).toLocaleDateString('ja-JP');

const EMPTY_ITEMS = { novels: [], worlds: [], characters: [], scenarios: [] };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('UserPage', () => {
  it('fetches profile and public items in parallel and renders the header + default novels tab', async () => {
    const profileSpy = vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Alice',
      avatarUrl: null,
      bio: 'よろしくお願いします',
    });
    const itemsSpy = vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue({
      ...EMPTY_ITEMS,
      novels: [{ publicId: 'n1', title: 'Epic Adventure', ownerName: 'Alice', publishedAt: PUBLISHED_AT }],
    });

    renderWithAuth(<UserPage userId="usr_1" />);

    await waitFor(() => expect(profileSpy).toHaveBeenCalledWith('usr_1'));
    expect(itemsSpy).toHaveBeenCalledWith('usr_1');

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('よろしくお願いします')).toBeInTheDocument();
    expect(screen.getByText('Epic Adventure')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(EXPECTED_DATE.replace(/\//g, '\\/')))).toBeInTheDocument();
  });

  it('hides the bio paragraph when bio is empty', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Bob',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue(EMPTY_ITEMS);

    const { container } = renderWithAuth(<UserPage userId="usr_1" />);
    await screen.findByText('Bob');
    expect(container.querySelector('p')).not.toBeInTheDocument();
  });

  it('shows an avatar image when avatarUrl is present', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Carol',
      avatarUrl: 'https://example.com/carol.png',
      bio: '',
    });
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue(EMPTY_ITEMS);

    const { container } = renderWithAuth(<UserPage userId="usr_1" />);
    await screen.findByText('Carol');
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img.src).toBe('https://example.com/carol.png');
  });

  it('shows a first-letter circle instead of an image when avatarUrl is null', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Dana',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue(EMPTY_ITEMS);

    const { container } = renderWithAuth(<UserPage userId="usr_1" />);
    await screen.findByText('Dana');
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it('switches tabs and shows only that type\'s cards', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Eve',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue({
      novels: [{ publicId: 'n1', title: 'Novel X', ownerName: 'Eve', publishedAt: PUBLISHED_AT }],
      worlds: [{ publicId: 'w1', title: 'World Y', ownerName: 'Eve', publishedAt: PUBLISHED_AT }],
      characters: [],
      scenarios: [],
    });

    renderWithAuth(<UserPage userId="usr_1" />);
    expect(await screen.findByText('Novel X')).toBeInTheDocument();
    expect(screen.queryByText('World Y')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('世界観'));
    await waitFor(() => expect(screen.getByText('World Y')).toBeInTheDocument());
    expect(screen.queryByText('Novel X')).not.toBeInTheDocument();
  });

  it('shows the empty-list message when the current tab has no items', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Frank',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue(EMPTY_ITEMS);

    renderWithAuth(<UserPage userId="usr_1" />);
    await waitFor(() => expect(screen.getByText('まだ公開されたものがありません')).toBeInTheDocument());
  });

  it('shows a loading indicator while fetching', async () => {
    let resolveProfile;
    vi.spyOn(shareClient, 'getUserProfile').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProfile = resolve;
        })
    );
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue(EMPTY_ITEMS);

    renderWithAuth(<UserPage userId="usr_1" />);
    expect(screen.getByText('読み込み中…')).toBeInTheDocument();

    resolveProfile({ id: 'usr_1', displayName: 'Grace', avatarUrl: null, bio: '' });
    await waitFor(() => expect(screen.queryByText('読み込み中…')).not.toBeInTheDocument());
  });

  it('shows "ユーザーが見つかりません" and a back button when the profile 404s', async () => {
    const err = new Error('user not found');
    err.status = 404;
    vi.spyOn(shareClient, 'getUserProfile').mockRejectedValue(err);
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue(EMPTY_ITEMS);
    const clearHashSpy = vi.spyOn(hashRoute, 'clearHash').mockImplementation(() => {});

    renderWithAuth(<UserPage userId="usr_missing" />);
    await waitFor(() => expect(screen.getByText('ユーザーが見つかりません')).toBeInTheDocument());

    fireEvent.click(screen.getByText('← 戻る'));
    expect(clearHashSpy).toHaveBeenCalledTimes(1);
  });

  it('shows a fetch-error message on a non-404 failure', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockRejectedValue(new Error('boom'));
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue(EMPTY_ITEMS);

    renderWithAuth(<UserPage userId="usr_1" />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });

  it('calls clearHash when the header back button is clicked', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Henry',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue(EMPTY_ITEMS);
    const clearHashSpy = vi.spyOn(hashRoute, 'clearHash').mockImplementation(() => {});

    renderWithAuth(<UserPage userId="usr_1" />);
    await screen.findByText('Henry');
    fireEvent.click(screen.getByText('← 戻る'));
    expect(clearHashSpy).toHaveBeenCalledTimes(1);
  });

  it('fetches the detail via getPublic on card click and renders PublicItemDetail without an author link', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Ivy',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue({
      ...EMPTY_ITEMS,
      novels: [{ publicId: 'n1', title: 'Epic Adventure', ownerName: 'Nora', publishedAt: PUBLISHED_AT }],
    });
    const getPublicSpy = vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'n1',
      title: 'Epic Adventure',
      ownerName: 'Nora',
      publishedAt: PUBLISHED_AT,
      raw: '物語本文',
    });

    renderWithAuth(<UserPage userId="usr_1" />);
    fireEvent.click(await screen.findByText('Epic Adventure'));

    await waitFor(() => expect(getPublicSpy).toHaveBeenCalledWith('novels', 'n1'));
    expect(await screen.findByText('物語本文')).toBeInTheDocument();

    const ownerEl = screen.getByText('Nora');
    expect(ownerEl.tagName).not.toBe('BUTTON');

    fireEvent.click(screen.getByText('← 一覧に戻る'));
    await waitFor(() => expect(screen.queryByText('物語本文')).not.toBeInTheDocument());
    expect(screen.getByText('Epic Adventure')).toBeInTheDocument();
  });

  it('resets an open detail view back to the list when switching tabs', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Jill',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue({
      ...EMPTY_ITEMS,
      novels: [{ publicId: 'n1', title: 'Epic Adventure', ownerName: 'Nora', publishedAt: PUBLISHED_AT }],
    });
    const getPublicSpy = vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'n1',
      title: 'Epic Adventure',
      ownerName: 'Nora',
      publishedAt: PUBLISHED_AT,
      raw: '物語本文',
    });

    renderWithAuth(<UserPage userId="usr_1" />);
    fireEvent.click(await screen.findByText('Epic Adventure'));

    await waitFor(() => expect(getPublicSpy).toHaveBeenCalledWith('novels', 'n1'));
    expect(await screen.findByText('物語本文')).toBeInTheDocument();

    fireEvent.click(screen.getByText('世界観'));

    await waitFor(() => expect(screen.queryByText('物語本文')).not.toBeInTheDocument());
    expect(screen.getByText('まだ公開されたものがありません')).toBeInTheDocument();
    expect(screen.queryByText('Epic Adventure')).not.toBeInTheDocument();
  });

  it('ignores a stale profile response after userId changes', async () => {
    let resolveStaleProfile;
    const profileSpy = vi
      .spyOn(shareClient, 'getUserProfile')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStaleProfile = resolve;
          })
      )
      .mockResolvedValueOnce({ id: 'usr_B', displayName: 'Bob', avatarUrl: null, bio: '' });
    vi.spyOn(shareClient, 'getUserPublicItems').mockResolvedValue(EMPTY_ITEMS);

    const { rerender } = renderWithAuth(<UserPage userId="usr_A" />);
    await waitFor(() => expect(profileSpy).toHaveBeenCalledWith('usr_A'));

    rerenderWithAuth(rerender, <UserPage userId="usr_B" />);
    await waitFor(() => expect(profileSpy).toHaveBeenCalledWith('usr_B'));
    expect(await screen.findByText('Bob')).toBeInTheDocument();

    // usr_A の遅れたレスポンスが後から解決しても、Bob の表示を上書きしない。
    await act(async () => {
      resolveStaleProfile({ id: 'usr_A', displayName: 'Alice', avatarUrl: null, bio: '' });
      await Promise.resolve();
    });

    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
});
