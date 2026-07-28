import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act, within } from '@testing-library/react';
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

// 画面は route だけを見る。テストからは hash を渡して同じ形で組み立てる。
function renderUser(hash) {
  return renderWithAuth(<UserPage route={parseRoute(hash)} />);
}

function rerenderUser(rerender, hash) {
  rerenderWithAuth(rerender, <UserPage route={parseRoute(hash)} />);
}

const PUBLISHED_AT = 1700000000000;
const EXPECTED_DATE = new Date(PUBLISHED_AT).toLocaleDateString('ja-JP');

const EMPTY_PAGE = { items: [], total: 0, hasMore: false };

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
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

    renderUser('#/u/usr_1');

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

  it('uses the current auth profile across own header, breadcrumb, and published-item author names', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_test',
      displayName: '変更前',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({
      items: [{
        publicId: 'n1',
        title: '冒険記',
        ownerId: 'usr_test',
        ownerName: '変更前',
        publishedAt: PUBLISHED_AT,
      }],
      total: 1,
      hasMore: false,
    });
    const route = parseRoute('#/u/usr_test');

    renderWithAuth(
      <BreadcrumbProvider>
        <Breadcrumb route={route} />
        <UserPage route={route} />
      </BreadcrumbProvider>,
      { user: { id: 'usr_test', displayName: '変更後', avatarUrl: null, bio: '' } }
    );

    await screen.findByText('冒険記');
    expect(screen.getAllByText('変更後').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(new RegExp(`変更後 ・ ${EXPECTED_DATE.replace(/\//g, '\\/')}`))).toBeInTheDocument();
    expect(screen.queryByText('変更前')).not.toBeInTheDocument();
  });

  it('no longer renders its own back buttons', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Xavier',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });

    renderUser('#/u/usr_1');
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

    renderUser('#/u/usr_42');

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

    const { container } = renderUser('#/u/usr_1');
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

    const { container } = renderUser('#/u/usr_1');
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

    const { container } = renderUser('#/u/usr_1');
    await screen.findByText('Dana');
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
  });

  it('drives the tab from the route instead of local state', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Nina',
      avatarUrl: null,
      bio: '',
    });
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

    renderUser('#/u/usr_1/scenarios');

    // リロードしても novels に戻らない。
    await waitFor(() =>
      expect(listSpy).toHaveBeenCalledWith('scenarios', expect.objectContaining({ ownerId: 'usr_1' }))
    );
    expect(screen.getByRole('button', { name: 'シナリオ' })).toHaveAttribute('aria-current', 'page');
  });

  it('pushes the tab into the URL when a tab is pressed', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Owen',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);

    renderUser('#/u/usr_1');
    fireEvent.click(await screen.findByRole('button', { name: '世界観' }));
    expect(window.location.hash).toBe('#/u/usr_1/worlds');
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

    const { rerender } = renderUser('#/u/usr_1');
    expect(await screen.findByText('Novel X')).toBeInTheDocument();
    expect(screen.queryByText('World Y')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('世界観'));
    rerenderUser(rerender, window.location.hash);

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

    renderUser('#/u/usr_1');
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

    renderUser('#/u/usr_1');
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
        <UserPage route={route} />
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
        <UserPage route={route} />
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
        <UserPage route={route} />
      </BreadcrumbProvider>
    );
    await screen.findByText('Henry');
    // ヘッダー本文とパンくず末尾の両方に表示名「Henry」が現れる。
    expect(screen.getAllByText('Henry').length).toBeGreaterThanOrEqual(2);
  });

  it('names the whole trail in the breadcrumb while a detail is open', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Iris',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'w1',
      title: '丘の上の写真館',
      ownerName: 'Iris',
      publishedAt: PUBLISHED_AT,
      raw: '世界観本文',
      regions: [],
      categories: [],
    });

    const route = parseRoute('#/u/usr_1/worlds/w1');
    renderWithAuth(
      <BreadcrumbProvider>
        <Breadcrumb route={route} />
        <UserPage route={route} />
      </BreadcrumbProvider>
    );

    // 詳細を見ている間の現在地はアイテム、上位段にプロフィールとタブが並ぶ。
    await screen.findByText('世界観本文');
    const crumbs = screen.getByRole('navigation', { name: '現在地' });
    await waitFor(() =>
      expect(within(crumbs).getByText('丘の上の写真館')).toHaveAttribute('aria-current', 'page')
    );
    // 狭幅では先頭側の段が display:none で畳まれるため、role ではなくテキストで拾う。
    expect(within(crumbs).getByText('Iris').tagName).toBe('BUTTON');
    expect(within(crumbs).getByText('世界観').tagName).toBe('BUTTON');
  });

  it('opens the detail named by the URL, so a reload or a shared link lands on it', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Ivy',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    const getPublicSpy = vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'n1',
      title: 'Epic Adventure',
      ownerName: 'Nora',
      publishedAt: PUBLISHED_AT,
      raw: '物語本文',
    });

    renderUser('#/u/usr_1/novels/n1');

    await waitFor(() => expect(getPublicSpy).toHaveBeenCalledWith('novels', 'n1'));
    expect(await screen.findByText('物語本文')).toBeInTheDocument();
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

    const { rerender } = renderUser('#/u/usr_1');
    fireEvent.click(await screen.findByText('Epic Adventure'));

    // カードのクリックは URL を進める。戻る/進むでも同じ経路を通る。
    expect(window.location.hash).toBe('#/u/usr_1/novels/n1');
    rerenderUser(rerender, window.location.hash);

    await waitFor(() => expect(getPublicSpy).toHaveBeenCalledWith('novels', 'n1'));
    expect(await screen.findByText('物語本文')).toBeInTheDocument();

    const ownerEl = screen.getByText('Nora');
    expect(ownerEl.tagName).not.toBe('BUTTON');
    // 詳細内の「← 一覧に戻る」はパンくずと重複するため廃止した。
    expect(screen.queryByText('← 一覧に戻る')).not.toBeInTheDocument();

    // 一覧へ戻る導線はパンくず(1つ手前の段)。URL が戻れば一覧に戻る。
    rerenderUser(rerender, '#/u/usr_1');

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

    const { rerender } = renderUser('#/u/usr_1/novels/n1');

    await waitFor(() => expect(getPublicSpy).toHaveBeenCalledWith('novels', 'n1'));
    expect(await screen.findByText('物語本文')).toBeInTheDocument();

    fireEvent.click(screen.getByText('世界観'));
    expect(window.location.hash).toBe('#/u/usr_1/worlds');
    rerenderUser(rerender, window.location.hash);

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

    const { rerender } = renderUser('#/u/usr_A');
    await waitFor(() => expect(profileSpy).toHaveBeenCalledWith('usr_A'));

    rerenderUser(rerender, '#/u/usr_B');
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

    const { rerender } = renderUser('#/u/usr_1');
    await screen.findByText('Item A');

    // Aを開く(未解決のまま)。
    fireEvent.click(screen.getByText('Item A'));
    rerenderUser(rerender, window.location.hash);
    await waitFor(() => expect(shareClient.getPublic).toHaveBeenCalledWith('novels', 'a1'));

    // 一覧に戻り(A の取得は未解決のままなのでパンくず経由)、Bを開く(こちらは即解決)。
    // タブは変わらないので PublicItemList は再マウントされず、一覧はそのまま。
    rerenderUser(rerender, '#/u/usr_1');
    fireEvent.click(screen.getByText('Item B'));
    rerenderUser(rerender, window.location.hash);
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
