import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import Gallery from './Gallery.jsx';
import * as shareClient from '../api/shareClient.js';
import * as worldLibraryClient from '../api/worldLibraryClient.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';

const PUBLISHED_AT = 1700000000000;
const EXPECTED_DATE = new Date(PUBLISHED_AT).toLocaleDateString('ja-JP');

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  window.location.hash = '';
});

describe('Gallery', () => {
  it('loads the novels tab by default', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue([]);
    renderWithAuth(<Gallery onClose={vi.fn()} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('novels'));
  });

  it('shows a loading indicator while the list is in flight', async () => {
    let resolveList;
    vi.spyOn(shareClient, 'listPublic').mockImplementation(
      () => new Promise((resolve) => { resolveList = resolve; })
    );
    renderWithAuth(<Gallery onClose={vi.fn()} />);
    expect(screen.getByText('読み込み中…')).toBeInTheDocument();

    await act(async () => {
      resolveList([]);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByText('読み込み中…')).not.toBeInTheDocument());
  });

  it('shows the empty state when a type has no published items', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue([]);
    renderWithAuth(<Gallery onClose={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('まだ公開されたものがありません')).toBeInTheDocument()
    );
  });

  it('shows a fetch-error message when listPublic fails', async () => {
    vi.spyOn(shareClient, 'listPublic').mockRejectedValue(new Error('boom'));
    renderWithAuth(<Gallery onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });

  it('switches tabs and calls listPublic with the matching type, rendering cards', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'novels') return [];
      if (type === 'worlds') {
        return [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }];
      }
      return [];
    });
    renderWithAuth(<Gallery onClose={vi.fn()} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('novels'));

    fireEvent.click(screen.getByText('世界観'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('worlds'));
    expect(screen.getByText('World A')).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(EXPECTED_DATE.replace(/\//g, '\\/')))).toBeInTheDocument();
  });

  it('shows a kind badge on character cards', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'characters') {
        return [{ publicId: 'c1', title: 'Dragon Lord', ownerName: 'Frank', publishedAt: PUBLISHED_AT, kind: 'npc' }];
      }
      return [];
    });
    renderWithAuth(<Gallery onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('キャラクター'));
    await waitFor(() => expect(screen.getByText('Dragon Lord')).toBeInTheDocument());
    expect(screen.getByText('NPC')).toBeInTheDocument();
  });

  it('shows the recommended ruleset on scenario cards when present', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'scenarios') {
        return [
          {
            publicId: 's1',
            title: 'Dragon Quest',
            ownerName: 'Grace',
            publishedAt: PUBLISHED_AT,
            recommendedRuleset: 'pathfinder2e',
          },
        ];
      }
      return [];
    });
    renderWithAuth(<Gallery onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('シナリオ'));
    await waitFor(() => expect(screen.getByText('Dragon Quest')).toBeInTheDocument());
    expect(screen.getByText(/pathfinder2e/)).toBeInTheDocument();
  });

  it('shows detail with body text, and worlds also show region/category headings; back button returns to list', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'worlds') {
        return [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }];
      }
      return [];
    });
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'p1',
      title: 'World A',
      ownerName: 'Alice',
      publishedAt: PUBLISHED_AT,
      raw: 'メイン本文',
      regions: [{ name: 'North', raw: '北の地域' }],
      categories: [{ name: 'Lore', raw: '伝承の中身' }],
    });
    renderWithAuth(<Gallery onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('世界観'));
    await waitFor(() => expect(screen.getByText('World A')).toBeInTheDocument());

    fireEvent.click(screen.getByText('World A'));
    await waitFor(() => expect(shareClient.getPublic).toHaveBeenCalledWith('worlds', 'p1'));
    expect(await screen.findByText('メイン本文')).toBeInTheDocument();
    expect(screen.getByText('North')).toBeInTheDocument();
    expect(screen.getByText('北の地域')).toBeInTheDocument();
    expect(screen.getByText('Lore')).toBeInTheDocument();
    expect(screen.getByText('伝承の中身')).toBeInTheDocument();

    fireEvent.click(screen.getByText('← 一覧に戻る'));
    await waitFor(() => expect(screen.queryByText('メイン本文')).not.toBeInTheDocument());
    expect(screen.getByText('World A')).toBeInTheDocument();
  });

  it('does not show an add button or add prompt on the novels tab', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'novels') {
        return [{ publicId: 'n1', title: 'Epic Adventure', ownerName: 'Henry', publishedAt: PUBLISHED_AT }];
      }
      return [];
    });
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'n1',
      title: 'Epic Adventure',
      ownerName: 'Henry',
      publishedAt: PUBLISHED_AT,
      raw: '物語本文',
    });
    renderWithAuth(<Gallery onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Epic Adventure')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Epic Adventure'));
    await screen.findByText('物語本文');

    expect(screen.queryByText('ライブラリに追加')).not.toBeInTheDocument();
    expect(screen.queryByText(/ログインが必要/)).not.toBeInTheDocument();
  });

  it('shows a login prompt instead of the add button when logged out', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'worlds') {
        return [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }];
      }
      return [];
    });
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'p1',
      title: 'World A',
      ownerName: 'Alice',
      publishedAt: PUBLISHED_AT,
      raw: 'メイン本文',
      regions: [],
      categories: [],
    });
    renderWithAuth(<Gallery onClose={vi.fn()} />, { user: null });
    fireEvent.click(screen.getByText('世界観'));
    await waitFor(() => expect(screen.getByText('World A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('World A'));

    await waitFor(() => expect(screen.getByText(/ログインが必要/)).toBeInTheDocument());
    expect(screen.queryByText('ライブラリに追加')).not.toBeInTheDocument();
  });

  it('imports a world directly and shows a success message', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'worlds') {
        return [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }];
      }
      return [];
    });
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

    renderWithAuth(<Gallery onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('世界観'));
    await waitFor(() => expect(screen.getByText('World A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('World A'));
    await screen.findByText('メイン本文');

    fireEvent.click(screen.getByText('ライブラリに追加'));
    await waitFor(() => expect(importSpy).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.getByText('ライブラリに追加しました')).toBeInTheDocument());
  });

  it('shows the err.message when importing a world fails', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'worlds') {
        return [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }];
      }
      return [];
    });
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

    renderWithAuth(<Gallery onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('世界観'));
    await waitFor(() => expect(screen.getByText('World A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('World A'));
    await screen.findByText('メイン本文');

    fireEvent.click(screen.getByText('ライブラリに追加'));
    await waitFor(() => expect(screen.getByText('世界観の取り込みに失敗')).toBeInTheDocument());
  });

  it('opens a target-world picker for characters and imports into the chosen world', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'characters') {
        return [{ publicId: 'c1', title: 'Dragon Lord', ownerName: 'Frank', publishedAt: PUBLISHED_AT, kind: 'npc' }];
      }
      return [];
    });
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

    renderWithAuth(<Gallery onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('キャラクター'));
    await waitFor(() => expect(screen.getByText('Dragon Lord')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Dragon Lord'));
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
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'scenarios') {
        return [{ publicId: 's1', title: 'Dragon Quest', ownerName: 'Grace', publishedAt: PUBLISHED_AT, recommendedRuleset: null }];
      }
      return [];
    });
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

    renderWithAuth(<Gallery onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('シナリオ'));
    await waitFor(() => expect(screen.getByText('Dragon Quest')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Dragon Quest'));
    await screen.findByText('## Quest');

    fireEvent.click(screen.getByText('ライブラリに追加'));
    expect(await screen.findByText('World One')).toBeInTheDocument();
    fireEvent.click(screen.getByText('World One'));
    await waitFor(() => expect(importScenarioSpy).toHaveBeenCalledWith('s1', 'w1'));
  });

  it('shows a message in the picker when the user has no worlds yet', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'characters') {
        return [{ publicId: 'c1', title: 'Dragon Lord', ownerName: 'Frank', publishedAt: PUBLISHED_AT, kind: 'pc' }];
      }
      return [];
    });
    vi.spyOn(shareClient, 'getPublic').mockResolvedValue({
      publicId: 'c1',
      title: 'Dragon Lord',
      ownerName: 'Frank',
      publishedAt: PUBLISHED_AT,
      kind: 'pc',
      raw: '## Dragon',
    });
    vi.spyOn(worldLibraryClient, 'listWorlds').mockResolvedValue([]);

    renderWithAuth(<Gallery onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('キャラクター'));
    await waitFor(() => expect(screen.getByText('Dragon Lord')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Dragon Lord'));
    await screen.findByText('## Dragon');

    fireEvent.click(screen.getByText('ライブラリに追加'));
    await waitFor(() => expect(screen.getByText('先に世界観を作成してください')).toBeInTheDocument());
  });

  it('navigates to the author page when a card author name is clicked, without opening the detail', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'novels') {
        return [
          {
            publicId: 'n1',
            title: 'Epic Adventure',
            ownerName: 'Henry',
            ownerId: 'usr_henry',
            publishedAt: PUBLISHED_AT,
          },
        ];
      }
      return [];
    });
    const getPublicSpy = vi.spyOn(shareClient, 'getPublic');
    renderWithAuth(<Gallery onClose={vi.fn()} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('novels'));
    await screen.findByText('Epic Adventure');

    fireEvent.click(screen.getByText('Henry'));

    expect(window.location.hash).toBe('#/u/usr_henry');
    expect(getPublicSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('← 一覧に戻る')).not.toBeInTheDocument();
    expect(screen.getByText('Epic Adventure')).toBeInTheDocument();
  });

  it('navigates to the author page from the detail view via onAuthorClick', async () => {
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'worlds') {
        return [
          { publicId: 'p1', title: 'World A', ownerName: 'Alice', ownerId: 'usr_alice', publishedAt: PUBLISHED_AT },
        ];
      }
      return [];
    });
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
    renderWithAuth(<Gallery onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('世界観'));
    await waitFor(() => expect(screen.getByText('World A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('World A'));
    await screen.findByText('メイン本文');

    const alice = screen.getByText('Alice');
    expect(alice.tagName).toBe('BUTTON');
    fireEvent.click(alice);

    expect(window.location.hash).toBe('#/u/usr_alice');
  });

  it('calls onClose when the close button is clicked', () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue([]);
    const onClose = vi.fn();
    renderWithAuth(<Gallery onClose={onClose} />);
    fireEvent.click(screen.getByText('閉じる'));
    expect(onClose).toHaveBeenCalledTimes(1);
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
        return Promise.resolve([{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }]);
      }
      return Promise.resolve([]);
    });

    renderWithAuth(<Gallery onClose={vi.fn()} />);
    // novels タブの取得が未解決のまま世界観タブへ切替える。
    fireEvent.click(screen.getByText('世界観'));
    await waitFor(() => expect(screen.getByText('World A')).toBeInTheDocument());

    // novels の遅れたレスポンスが後から解決しても、世界観タブの一覧を上書きしない。
    await act(async () => {
      resolveStaleNovels([{ publicId: 'n1', title: 'Stale Novel', ownerName: 'Bob', publishedAt: PUBLISHED_AT }]);
      await Promise.resolve();
    });

    expect(screen.queryByText('Stale Novel')).not.toBeInTheDocument();
    expect(screen.getByText('World A')).toBeInTheDocument();
  });

  it('ignores a stale detail response after returning to the list and opening a different item', async () => {
    let resolveA;
    vi.spyOn(shareClient, 'listPublic').mockImplementation(async (type) => {
      if (type === 'novels') {
        return [
          { publicId: 'a1', title: 'Item A', ownerName: 'Alice', publishedAt: PUBLISHED_AT },
          { publicId: 'b1', title: 'Item B', ownerName: 'Bob', publishedAt: PUBLISHED_AT },
        ];
      }
      return [];
    });
    vi.spyOn(shareClient, 'getPublic').mockImplementation(async (type, publicId) => {
      if (publicId === 'a1') {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return { publicId: 'b1', title: 'Item B', ownerName: 'Bob', publishedAt: PUBLISHED_AT, raw: 'B本文' };
    });

    renderWithAuth(<Gallery onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Item A')).toBeInTheDocument());

    // Aを開く(未解決のまま)。
    fireEvent.click(screen.getByText('Item A'));
    await waitFor(() => expect(shareClient.getPublic).toHaveBeenCalledWith('novels', 'a1'));

    // 一覧に戻り、Bを開く(こちらは即解決)。
    fireEvent.click(screen.getByText('← 一覧に戻る'));
    fireEvent.click(screen.getByText('Item B'));
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
});
