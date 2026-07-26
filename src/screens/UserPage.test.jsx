import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import UserPage from './UserPage.jsx';
import * as shareClient from '../api/shareClient.js';
import { AuthContext } from '../auth/AuthContext.jsx';
import { renderWithAuth } from '../test/renderWithAuth.jsx';
import { parseRoute } from '../navigation/routes.js';
import { BreadcrumbProvider } from '../navigation/BreadcrumbContext.jsx';
import Breadcrumb from '../components/nav/Breadcrumb.jsx';

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

const EMPTY_PAGE = { items: [], total: 0, hasMore: false };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('UserPage', () => {
  it('fetches the profile and the owner-filtered novels list, rendering the header + default tab', async () => {
    const profileSpy = vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Alice',
      avatarUrl: null,
      bio: 'よろしくお願いします',
    });
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue({
      items: [{ publicId: 'n1', title: 'Epic Adventure', ownerName: 'Alice', publishedAt: PUBLISHED_AT }],
      total: 1,
      hasMore: false,
    });

    renderWithAuth(<UserPage userId="usr_1" />);

    await waitFor(() => expect(profileSpy).toHaveBeenCalledWith('usr_1'));
    await waitFor(() =>
      expect(listSpy).toHaveBeenCalledWith('novels', {
        q: '',
        moods: [],
        ruleset: '',
        ownerId: 'usr_1',
        limit: 20,
        offset: 0,
      })
    );

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('よろしくお願いします')).toBeInTheDocument();
    expect(screen.getByText('Epic Adventure')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(EXPECTED_DATE.replace(/\//g, '\\/')))).toBeInTheDocument();
  });

  it('no longer renders its own back buttons', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Xavier',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });

    renderWithAuth(<UserPage userId="usr_1" />);
    expect(await screen.findByText('Xavier')).toBeInTheDocument();
    expect(screen.queryByText('← 戻る')).not.toBeInTheDocument();
  });

  it('fetches the list with ownerId set to the page userId', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_42',
      displayName: 'Zed',
      avatarUrl: null,
      bio: '',
    });
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

    renderWithAuth(<UserPage userId="usr_42" />);

    await waitFor(() =>
      expect(listSpy).toHaveBeenCalledWith('novels', expect.objectContaining({ ownerId: 'usr_42' }))
    );
  });

  it('hides the bio paragraph when bio is empty', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Bob',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

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
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

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
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

    const { container } = renderWithAuth(<UserPage userId="usr_1" />);
    await screen.findByText('Dana');
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it("switches tabs and shows only that type's cards", async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Eve',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'novels') {
        return {
          items: [{ publicId: 'n1', title: 'Novel X', ownerName: 'Eve', publishedAt: PUBLISHED_AT }],
          total: 1,
          hasMore: false,
        };
      }
      if (type === 'worlds') {
        return {
          items: [{ publicId: 'w1', title: 'World Y', ownerName: 'Eve', publishedAt: PUBLISHED_AT }],
          total: 1,
          hasMore: false,
        };
      }
      return EMPTY_PAGE;
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
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

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
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

    renderWithAuth(<UserPage userId="usr_1" />);
    expect(screen.getByText('読み込み中…')).toBeInTheDocument();

    resolveProfile({ id: 'usr_1', displayName: 'Grace', avatarUrl: null, bio: '' });
    await waitFor(() => expect(screen.queryByText('読み込み中…')).not.toBeInTheDocument());
  });

  it('shows "ユーザーが見つかりません" and never exposes the raw userId in the breadcrumb', async () => {
    const err = new Error('user not found');
    err.status = 404;
    vi.spyOn(shareClient, 'getUserProfile').mockRejectedValue(err);
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

    const route = parseRoute('#/u/usr_missing');
    renderWithAuth(
      <BreadcrumbProvider>
        <Breadcrumb route={route} />
        <UserPage userId="usr_missing" />
      </BreadcrumbProvider>
    );
    await waitFor(() => expect(screen.getByText('ユーザーが見つかりません')).toBeInTheDocument());
    expect(screen.queryByText('usr_missing')).not.toBeInTheDocument();
    // not-found 状態でも自前の戻るボタンを描画しない。
    expect(screen.queryByText('← 戻る')).not.toBeInTheDocument();
  });

  it('shows a fetch-error message on a non-404 failure and never exposes the raw userId in the breadcrumb', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockRejectedValue(new Error('boom'));
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

    const route = parseRoute('#/u/usr_1');
    renderWithAuth(
      <BreadcrumbProvider>
        <Breadcrumb route={route} />
        <UserPage userId="usr_1" />
      </BreadcrumbProvider>
    );
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
    expect(screen.queryByText('usr_1')).not.toBeInTheDocument();
    // load-error 状態でも自前の戻るボタンを描画しない。
    expect(screen.queryByText('← 戻る')).not.toBeInTheDocument();
  });

  it('registers the display name as the breadcrumb tail once the profile loads', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Henry',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

    const route = parseRoute('#/u/usr_1');
    renderWithAuth(
      <BreadcrumbProvider>
        <Breadcrumb route={route} />
        <UserPage userId="usr_1" />
      </BreadcrumbProvider>
    );
    await screen.findByText('Henry');
    // ヘッダー本文とパンくず末尾の両方に表示名「Henry」が現れる。
    expect(screen.getAllByText('Henry').length).toBeGreaterThanOrEqual(2);
  });

  it('fetches the detail via getPublic on card click and renders PublicItemDetail without an author link', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Ivy',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({
      items: [{ publicId: 'n1', title: 'Epic Adventure', ownerName: 'Nora', publishedAt: PUBLISHED_AT }],
      total: 1,
      hasMore: false,
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
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'novels') {
        return {
          items: [{ publicId: 'n1', title: 'Epic Adventure', ownerName: 'Nora', publishedAt: PUBLISHED_AT }],
          total: 1,
          hasMore: false,
        };
      }
      return EMPTY_PAGE;
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
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

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

  it('ignores a stale detail response after returning to the list and opening a different item', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Kate',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({
      items: [
        { publicId: 'a1', title: 'Item A', ownerName: 'Kate', publishedAt: PUBLISHED_AT },
        { publicId: 'b1', title: 'Item B', ownerName: 'Kate', publishedAt: PUBLISHED_AT },
      ],
      total: 2,
      hasMore: false,
    });
    let resolveA;
    vi.spyOn(shareClient, 'getPublic').mockImplementation(async (type, publicId) => {
      if (publicId === 'a1') {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return { publicId: 'b1', title: 'Item B', ownerName: 'Kate', publishedAt: PUBLISHED_AT, raw: 'B本文' };
    });

    renderWithAuth(<UserPage userId="usr_1" />);
    await screen.findByText('Item A');

    // Aを開く(未解決のまま)。
    fireEvent.click(screen.getByText('Item A'));
    await waitFor(() => expect(shareClient.getPublic).toHaveBeenCalledWith('novels', 'a1'));

    // 一覧に戻り、Bを開く(こちらは即解決)。タブは変わらないので PublicItemList は再マウントされず、一覧はそのまま。
    fireEvent.click(screen.getByText('← 一覧に戻る'));
    fireEvent.click(screen.getByText('Item B'));
    await waitFor(() => expect(shareClient.getPublic).toHaveBeenCalledWith('novels', 'b1'));
    await screen.findByText('B本文');

    // Aの遅れたレスポンスが後から解決しても、Bの表示を上書きしない。
    await act(async () => {
      resolveA({ publicId: 'a1', title: 'Item A', ownerName: 'Kate', publishedAt: PUBLISHED_AT, raw: 'A本文' });
      await Promise.resolve();
    });

    expect(screen.queryByText('A本文')).not.toBeInTheDocument();
    expect(screen.getByText('B本文')).toBeInTheDocument();
  });
});
