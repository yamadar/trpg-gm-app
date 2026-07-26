import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Gallery from './Gallery.jsx';
import * as shareClient from '../api/shareClient.js';
import * as worldLibraryClient from '../api/worldLibraryClient.js';
import * as starterClient from '../api/starterClient.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';
import { parseRoute } from '../navigation/routes.js';

const PUBLISHED_AT = 1700000000000;
const EXPECTED_DATE = new Date(PUBLISHED_AT).toLocaleDateString('ja-JP');

const DEFAULT_LIST_PARAMS = { q: '', moods: [], ruleset: '', ownerId: undefined, limit: 20, offset: 0 };
const EMPTY_PAGE = { items: [], total: 0, hasMore: false };

beforeEach(() => {
  vi.restoreAllMocks();
  // 既定タブが「おすすめ」に変わったため、それを明示的に検証しないテストでは
  // 未シード環境と同じ「空」を返し、余計な未モックfetchを起こさないようにする。
  vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: [], seededAt: null });
});

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('Gallery', () => {
  it('drives the tab from the route', async () => {
    renderWithAuth(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={() => {}} />);
    expect(await screen.findByRole('button', { name: '小説' })).toHaveAttribute('aria-current', 'page');
  });

  it('pushes the tab into the URL when a tab is pressed', async () => {
    renderWithAuth(<Gallery route={parseRoute('#/browse/starters')} onStartStarter={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '世界観' }));
    expect(window.location.hash).toBe('#/browse/worlds');
  });

  it('no longer renders a screen-level close button, on the list or on a detail', async () => {
    // 画面ごとの「閉じる」はグローバルナビに置き換わって全廃した。
    // 詳細の「← 一覧に戻る」は画面内の移動なので、これは残るのが正しい。
    // 一覧側だけを見ると詳細の分岐がそもそも描かれず、何も確かめられない。
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    const list = renderWithAuth(
      <Gallery route={parseRoute('#/browse/worlds')} onStartStarter={() => {}} />
    );
    await screen.findByText('まだ公開されたものがありません');
    expect(screen.queryByText('閉じる')).not.toBeInTheDocument();
    list.unmount();

    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'p1',
      title: 'World A',
      ownerName: 'Alice',
      publishedAt: PUBLISHED_AT,
      raw: 'メイン本文',
      regions: [],
      categories: [],
    });
    renderWithAuth(<Gallery route={parseRoute('#/browse/worlds/p1')} onStartStarter={() => {}} />);
    await screen.findByText('メイン本文');
    expect(screen.queryByText('閉じる')).not.toBeInTheDocument();
    expect(screen.getByText('← 一覧に戻る')).toBeInTheDocument();
  });

  it('loads the novels tab given by the route', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    renderWithAuth(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={vi.fn()} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('novels', DEFAULT_LIST_PARAMS));
  });

  it('shows a loading indicator while the list is in flight', async () => {
    let resolveList;
    vi.spyOn(shareClient, 'listPublic').mockImplementation(
      () => new Promise((resolve) => { resolveList = resolve; })
    );
    renderWithAuth(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={vi.fn()} />);
    expect(await screen.findByText('読み込み中…')).toBeInTheDocument();

    await act(async () => {
      resolveList(EMPTY_PAGE);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByText('読み込み中…')).not.toBeInTheDocument());
  });

  it('shows the empty state when a type has no published items', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    renderWithAuth(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('まだ公開されたものがありません')).toBeInTheDocument()
    );
  });

  it('shows a fetch-error message when listPublic fails', async () => {
    vi.spyOn(shareClient, 'listPublic').mockRejectedValue(new Error('boom'));
    renderWithAuth(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });

  it('renders cards for the tab given by the route', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'worlds') {
        return {
          items: [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }],
          total: 1,
          hasMore: false,
        };
      }
      return EMPTY_PAGE;
    });
    renderWithAuth(<Gallery route={parseRoute('#/browse/worlds')} onStartStarter={vi.fn()} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('worlds', DEFAULT_LIST_PARAMS));
    expect(screen.getByText('World A')).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(EXPECTED_DATE.replace(/\//g, '\\/')))).toBeInTheDocument();
  });

  it('shows a kind badge on character cards', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'characters') {
        return {
          items: [{ publicId: 'c1', title: 'Dragon Lord', ownerName: 'Frank', publishedAt: PUBLISHED_AT, kind: 'npc' }],
          total: 1,
          hasMore: false,
        };
      }
      return EMPTY_PAGE;
    });
    renderWithAuth(<Gallery route={parseRoute('#/browse/characters')} onStartStarter={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dragon Lord')).toBeInTheDocument());
    expect(screen.getByText('NPC')).toBeInTheDocument();
  });

  it('shows the recommended ruleset on scenario cards when present', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'scenarios') {
        return {
          items: [
            {
              publicId: 's1',
              title: 'Dragon Quest',
              ownerName: 'Grace',
              publishedAt: PUBLISHED_AT,
              recommendedRuleset: 'pathfinder2e',
            },
          ],
          total: 1,
          hasMore: false,
        };
      }
      return EMPTY_PAGE;
    });
    renderWithAuth(<Gallery route={parseRoute('#/browse/scenarios')} onStartStarter={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dragon Quest')).toBeInTheDocument());
    expect(screen.getByText(/pathfinder2e/)).toBeInTheDocument();
  });

  it('pushes the publicId into the URL when a card is opened', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({
      items: [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }],
      total: 1,
      hasMore: false,
    });
    renderWithAuth(<Gallery route={parseRoute('#/browse/worlds')} onStartStarter={vi.fn()} />);
    await screen.findByText('World A');

    fireEvent.click(screen.getByText('World A'));
    expect(window.location.hash).toBe('#/browse/worlds/p1');
  });

  it('shows detail with body text, and worlds also show region/category headings', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'p1',
      title: 'World A',
      ownerName: 'Alice',
      publishedAt: PUBLISHED_AT,
      raw: 'メイン本文',
      regions: [{ name: 'North', raw: '北の地域' }],
      categories: [{ name: 'Lore', raw: '伝承の中身' }],
    });
    renderWithAuth(<Gallery route={parseRoute('#/browse/worlds/p1')} onStartStarter={vi.fn()} />);

    await waitFor(() => expect(shareClient.getPublic).toHaveBeenCalledWith('worlds', 'p1'));
    expect(await screen.findByText('メイン本文')).toBeInTheDocument();
    expect(screen.getByText('North')).toBeInTheDocument();
    expect(screen.getByText('北の地域')).toBeInTheDocument();
    expect(screen.getByText('Lore')).toBeInTheDocument();
    expect(screen.getByText('伝承の中身')).toBeInTheDocument();
  });

  it('returns to the list URL when the detail back button is used', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'p1',
      title: 'World A',
      ownerName: 'Alice',
      publishedAt: PUBLISHED_AT,
      raw: 'メイン本文',
      regions: [],
      categories: [],
    });
    renderWithAuth(<Gallery route={parseRoute('#/browse/worlds/p1')} onStartStarter={vi.fn()} />);
    await screen.findByText('メイン本文');

    fireEvent.click(screen.getByText('← 一覧に戻る'));
    expect(window.location.hash).toBe('#/browse/worlds');
  });

  it('does not show an add button or add prompt on the novels tab', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'n1',
      title: 'Epic Adventure',
      ownerName: 'Henry',
      publishedAt: PUBLISHED_AT,
      raw: '物語本文',
    });
    renderWithAuth(<Gallery route={parseRoute('#/browse/novels/n1')} onStartStarter={vi.fn()} />);
    await screen.findByText('物語本文');

    expect(screen.queryByText('ライブラリに追加')).not.toBeInTheDocument();
    expect(screen.queryByText(/ログインが必要/)).not.toBeInTheDocument();
  });

  it('shows a login prompt instead of the add button when logged out', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'p1',
      title: 'World A',
      ownerName: 'Alice',
      publishedAt: PUBLISHED_AT,
      raw: 'メイン本文',
      regions: [],
      categories: [],
    });
    renderWithAuth(<Gallery route={parseRoute('#/browse/worlds/p1')} onStartStarter={vi.fn()} />, { user: null });

    await waitFor(() => expect(screen.getByText(/ログインが必要/)).toBeInTheDocument());
    expect(screen.queryByText('ライブラリに追加')).not.toBeInTheDocument();
  });

  it('imports a world directly and shows a success message', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'p1',
      title: 'World A',
      ownerName: 'Alice',
      publishedAt: PUBLISHED_AT,
      raw: 'メイン本文',
      regions: [],
      categories: [],
    });
    const importSpy = vi.spyOn(shareClient, 'importWorld').mockResolvedValue({ id: 'w-new' });

    renderWithAuth(<Gallery route={parseRoute('#/browse/worlds/p1')} onStartStarter={vi.fn()} />);
    await screen.findByText('メイン本文');

    fireEvent.click(screen.getByText('ライブラリに追加'));
    await waitFor(() => expect(importSpy).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.getByText('ライブラリに追加しました')).toBeInTheDocument());
  });

  it('shows the err.message when importing a world fails', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'p1',
      title: 'World A',
      ownerName: 'Alice',
      publishedAt: PUBLISHED_AT,
      raw: 'メイン本文',
      regions: [],
      categories: [],
    });
    vi.spyOn(shareClient, 'importWorld').mockRejectedValue(new Error('世界観の取り込みに失敗'));

    renderWithAuth(<Gallery route={parseRoute('#/browse/worlds/p1')} onStartStarter={vi.fn()} />);
    await screen.findByText('メイン本文');

    fireEvent.click(screen.getByText('ライブラリに追加'));
    await waitFor(() => expect(screen.getByText('世界観の取り込みに失敗')).toBeInTheDocument());
  });

  it('opens a target-world picker for characters and imports into the chosen world', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'c1',
      title: 'Dragon Lord',
      ownerName: 'Frank',
      publishedAt: PUBLISHED_AT,
      kind: 'npc',
      raw: '## Dragon',
    });
    const listWorldsSpy = vi
      .spyOn(worldLibraryClient, 'listWorlds')
      .mockResolvedValue([{ id: 'w1', title: 'World One' }, { id: 'w2', title: 'World Two' }]);
    const importCharacterSpy = vi.spyOn(shareClient, 'importCharacter').mockResolvedValue({ name: 'Dragon Lord' });

    renderWithAuth(<Gallery route={parseRoute('#/browse/characters/c1')} onStartStarter={vi.fn()} />);
    await screen.findByText('## Dragon');

    fireEvent.click(screen.getByText('ライブラリに追加'));
    await waitFor(() => expect(listWorldsSpy).toHaveBeenCalled());
    expect(await screen.findByText('World One')).toBeInTheDocument();
    expect(screen.getByText('World Two')).toBeInTheDocument();

    fireEvent.click(screen.getByText('World Two'));
    await waitFor(() => expect(importCharacterSpy).toHaveBeenCalledWith('c1', 'w2'));
    await waitFor(() => expect(screen.getByText('ライブラリに追加しました')).toBeInTheDocument());
  });

  it('opens a target-world picker for scenarios and imports into the chosen world', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 's1',
      title: 'Dragon Quest',
      ownerName: 'Grace',
      publishedAt: PUBLISHED_AT,
      recommendedRuleset: null,
      raw: '## Quest',
    });
    vi.spyOn(worldLibraryClient, 'listWorlds').mockResolvedValue([{ id: 'w1', title: 'World One' }]);
    const importScenarioSpy = vi.spyOn(shareClient, 'importScenario').mockResolvedValue({ id: 's-new' });

    renderWithAuth(<Gallery route={parseRoute('#/browse/scenarios/s1')} onStartStarter={vi.fn()} />);
    await screen.findByText('## Quest');

    fireEvent.click(screen.getByText('ライブラリに追加'));
    expect(await screen.findByText('World One')).toBeInTheDocument();
    fireEvent.click(screen.getByText('World One'));
    await waitFor(() => expect(importScenarioSpy).toHaveBeenCalledWith('s1', 'w1'));
  });

  it('shows a message in the picker when the user has no worlds yet', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'c1',
      title: 'Dragon Lord',
      ownerName: 'Frank',
      publishedAt: PUBLISHED_AT,
      kind: 'pc',
      raw: '## Dragon',
    });
    vi.spyOn(worldLibraryClient, 'listWorlds').mockResolvedValue([]);

    renderWithAuth(<Gallery route={parseRoute('#/browse/characters/c1')} onStartStarter={vi.fn()} />);
    await screen.findByText('## Dragon');

    fireEvent.click(screen.getByText('ライブラリに追加'));
    await waitFor(() => expect(screen.getByText('先に世界観を作成してください')).toBeInTheDocument());
  });

  it('navigates to the author page when a card author name is clicked, without opening the detail', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'novels') {
        return {
          items: [
            {
              publicId: 'n1',
              title: 'Epic Adventure',
              ownerName: 'Henry',
              ownerId: 'usr_henry',
              publishedAt: PUBLISHED_AT,
            },
          ],
          total: 1,
          hasMore: false,
        };
      }
      return EMPTY_PAGE;
    });
    const getPublicSpy = vi.spyOn(shareClient, 'getPublic');
    renderWithAuth(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={vi.fn()} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('novels', DEFAULT_LIST_PARAMS));
    await screen.findByText('Epic Adventure');

    fireEvent.click(screen.getByText('Henry'));

    expect(window.location.hash).toBe('#/u/usr_henry');
    expect(getPublicSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('← 一覧に戻る')).not.toBeInTheDocument();
    expect(screen.getByText('Epic Adventure')).toBeInTheDocument();
  });

  it('navigates to the author page from the detail view via onAuthorClick', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'p1',
      title: 'World A',
      ownerName: 'Alice',
      ownerId: 'usr_alice',
      publishedAt: PUBLISHED_AT,
      raw: 'メイン本文',
      regions: [],
      categories: [],
    });
    renderWithAuth(<Gallery route={parseRoute('#/browse/worlds/p1')} onStartStarter={vi.fn()} />);
    await screen.findByText('メイン本文');

    const alice = screen.getByText('Alice');
    expect(alice.tagName).toBe('BUTTON');
    fireEvent.click(alice);

    expect(window.location.hash).toBe('#/u/usr_alice');
  });

  it('ignores a stale list response from a previous tab after switching tabs', async () => {
    let resolveStaleNovels;
    vi.spyOn(shareClient, 'listPublic').mockImplementation((type) => {
      if (type === 'novels') {
        return new Promise((resolve) => {
          resolveStaleNovels = resolve;
        });
      }
      if (type === 'worlds') {
        return Promise.resolve({
          items: [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }],
          total: 1,
          hasMore: false,
        });
      }
      return Promise.resolve(EMPTY_PAGE);
    });

    // 小説タブで取得が未解決のまま、親(App)がroute差し替えで世界観タブへ切替えたことを模す
    // (PublicItemListはtabをkeyに再マウントされる)。
    const { rerender } = render(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={vi.fn()} />);
    rerender(<Gallery route={parseRoute('#/browse/worlds')} onStartStarter={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('World A')).toBeInTheDocument());

    // novels の遅れたレスポンスが後から解決しても(アンマウント済みのため)、世界観タブの一覧を上書きしない。
    await act(async () => {
      resolveStaleNovels({
        items: [{ publicId: 'n1', title: 'Stale Novel', ownerName: 'Bob', publishedAt: PUBLISHED_AT }],
        total: 1,
        hasMore: false,
      });
      await Promise.resolve();
    });

    expect(screen.queryByText('Stale Novel')).not.toBeInTheDocument();
    expect(screen.getByText('World A')).toBeInTheDocument();
  });

  it('ignores a stale detail response after returning to the list and opening a different item', async () => {
    let resolveA;
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'novels') {
        return {
          items: [
            { publicId: 'a1', title: 'Item A', ownerName: 'Alice', publishedAt: PUBLISHED_AT },
            { publicId: 'b1', title: 'Item B', ownerName: 'Bob', publishedAt: PUBLISHED_AT },
          ],
          total: 2,
          hasMore: false,
        };
      }
      return EMPTY_PAGE;
    });
    vi.spyOn(shareClient, 'getPublic').mockImplementation(async (type, publicId) => {
      if (publicId === 'a1') {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return { publicId: 'b1', title: 'Item B', ownerName: 'Bob', publishedAt: PUBLISHED_AT, raw: 'B本文' };
    });

    // 一覧 → Aを開く(未解決) → 一覧に戻る → Bを開く、という route の遷移を rerender で模す。
    // タブは変わらないので PublicItemList は再マウントされず、一覧の状態はそのまま。
    const { rerender } = render(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Item A')).toBeInTheDocument());

    rerender(<Gallery route={parseRoute('#/browse/novels/a1')} onStartStarter={vi.fn()} />);
    await waitFor(() => expect(shareClient.getPublic).toHaveBeenCalledWith('novels', 'a1'));

    rerender(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={vi.fn()} />);
    expect(screen.getByText('Item B')).toBeInTheDocument();

    rerender(<Gallery route={parseRoute('#/browse/novels/b1')} onStartStarter={vi.fn()} />);
    await waitFor(() => expect(shareClient.getPublic).toHaveBeenCalledWith('novels', 'b1'));
    await screen.findByText('B本文');

    // Aの遅れたレスポンスが後から解決しても、Bの表示を上書きしない。
    await act(async () => {
      resolveA({ publicId: 'a1', title: 'Item A', ownerName: 'Alice', publishedAt: PUBLISHED_AT, raw: 'A本文' });
      await Promise.resolve();
    });

    expect(screen.queryByText('A本文')).not.toBeInTheDocument();
    expect(screen.getByText('B本文')).toBeInTheDocument();
  });

  it('preserves list search text and results across a detail round trip, without an extra unfiltered refetch', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type, params) => {
      if (type !== 'novels') return EMPTY_PAGE;
      if (params.q === 'dragon') {
        return {
          items: [{ publicId: 'd1', title: 'Dragon Tale', ownerName: 'Dana', publishedAt: PUBLISHED_AT }],
          total: 1,
          hasMore: false,
        };
      }
      return {
        items: [{ publicId: 'n1', title: 'Item A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }],
        total: 1,
        hasMore: false,
      };
    });
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'd1',
      title: 'Dragon Tale',
      ownerName: 'Dana',
      publishedAt: PUBLISHED_AT,
      raw: '龍の物語',
    });

    vi.useFakeTimers();
    try {
      const { rerender } = render(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={vi.fn()} />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(listSpy).toHaveBeenCalledTimes(1);

      const input = screen.getByPlaceholderText('タイトル・作者名で検索');
      fireEvent.change(input, { target: { value: 'dragon' } });
      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });
      expect(listSpy).toHaveBeenCalledTimes(2);
      expect(listSpy).toHaveBeenLastCalledWith('novels', expect.objectContaining({ q: 'dragon', offset: 0 }));
      expect(screen.getByText('Dragon Tale')).toBeInTheDocument();
      vi.useRealTimers(); // waitFor 以降はリアルタイマーに戻す(fake timers下では setInterval ポーリングが進まないため)。

      rerender(<Gallery route={parseRoute('#/browse/novels/d1')} onStartStarter={vi.fn()} />);
      await waitFor(() => expect(shareClient.getPublic).toHaveBeenCalledWith('novels', 'd1'));
      await screen.findByText('龍の物語');

      rerender(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={vi.fn()} />);

      // 検索欄の入力値・検索結果が往復後も保持されている(再マウントで消えていない)。
      expect(screen.getByPlaceholderText('タイトル・作者名で検索').value).toBe('dragon');
      expect(screen.getByText('Dragon Tale')).toBeInTheDocument();
      // 一覧に戻っただけでは新規フェッチ(オフセット0の未絞り込み再取得含む)は発生しない。
      expect(listSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('starters tab', () => {
    // 既定タブが starters であることは parseRoute の担当なので、ここは
    // 「starters ルートを描くとパックのカードが出る」ことだけを見る。
    it('renders pack cards on the starters tab', async () => {
      vi.spyOn(starterClient, 'listStarters').mockResolvedValue({
        packs: [{ packId: 'arkham-1920s', title: 'アーカム 1920s', tagline: '港町。', source: null, moods: ['ホラー'], recommendedRuleset: 'coc7e', scenarioTitle: '丘の上の写真館' }],
        seededAt: 1,
      });
      renderWithAuth(<Gallery route={parseRoute('#/browse/starters')} onStartStarter={vi.fn()} />);
      expect(screen.getByText('おすすめ')).toBeInTheDocument();
      expect(await screen.findByText('アーカム 1920s')).toBeInTheDocument();
    });

    // 三項演算子で分岐しているので普段は自明に真だが、両分岐を同時に描く
    // 崩し方(タブ判定の取り違え)はこれが捕まえる。
    it('does not leak starter pack cards into a non-starters tab', async () => {
      vi.spyOn(starterClient, 'listStarters').mockResolvedValue({
        packs: [{ packId: 'arkham-1920s', title: 'アーカム 1920s', tagline: '港町。', source: null, moods: ['ホラー'], recommendedRuleset: 'coc7e', scenarioTitle: '丘の上の写真館' }],
        seededAt: 1,
      });
      vi.spyOn(shareClient, 'listPublic').mockResolvedValue(EMPTY_PAGE);
      renderWithAuth(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={vi.fn()} />);

      await waitFor(() => expect(screen.getByText('まだ公開されたものがありません')).toBeInTheDocument());
      expect(screen.queryByText('この冒険を始める')).not.toBeInTheDocument();
      expect(screen.queryByText('アーカム 1920s')).not.toBeInTheDocument();
    });
  });
});
