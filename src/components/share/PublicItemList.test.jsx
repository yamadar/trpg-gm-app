import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import PublicItemList from './PublicItemList.jsx';
import * as shareClient from '../../api/shareClient.js';
import { AuthContext } from '../../auth/AuthContext.jsx';
import { renderWithAuth } from '../../test/renderWithAuth.jsx';

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
const DATE_RE = new RegExp(EXPECTED_DATE.replace(/\//g, '\\/'));

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PublicItemList', () => {
  it('performs the initial fetch with default params, renders items with author link + date, and wires card/author clicks', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue({
      items: [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', ownerId: 'u1', publishedAt: PUBLISHED_AT }],
      total: 1,
      hasMore: false,
    });
    const onOpenDetail = vi.fn();
    const onAuthorClick = vi.fn();
    renderWithAuth(<PublicItemList type="worlds" onOpenDetail={onOpenDetail} onAuthorClick={onAuthorClick} />);

    await waitFor(() =>
      expect(listSpy).toHaveBeenCalledWith('worlds', {
        q: '',
        moods: [],
        ruleset: '',
        ownerId: undefined,
        limit: 20,
        offset: 0,
      })
    );
    expect(screen.getByText('World A')).toBeInTheDocument();
    expect(screen.getByText(DATE_RE)).toBeInTheDocument();

    const alice = screen.getByText('Alice');
    expect(alice.tagName).toBe('BUTTON');
    fireEvent.click(alice);
    expect(onAuthorClick).toHaveBeenCalledWith('u1');
    expect(onOpenDetail).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('World A'));
    expect(onOpenDetail).toHaveBeenCalledWith('p1');
  });

  it('passes ownerId through to listPublic when provided', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });
    renderWithAuth(<PublicItemList type="novels" ownerId="usr_1" onOpenDetail={vi.fn()} />);
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
  });

  it('renders the meta line as plain text (no button) when onAuthorClick is absent', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({
      items: [{ publicId: 'n1', title: 'Epic Adventure', ownerName: 'Henry', publishedAt: PUBLISHED_AT }],
      total: 1,
      hasMore: false,
    });
    renderWithAuth(<PublicItemList type="novels" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Epic Adventure')).toBeInTheDocument());
    expect(screen.getByText(`Henry ・ ${EXPECTED_DATE}`)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Henry' })).not.toBeInTheDocument();
  });

  it('shows a kind badge on character cards', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({
      items: [{ publicId: 'c1', title: 'Dragon Lord', ownerName: 'Frank', publishedAt: PUBLISHED_AT, kind: 'npc' }],
      total: 1,
      hasMore: false,
    });
    renderWithAuth(<PublicItemList type="characters" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dragon Lord')).toBeInTheDocument());
    expect(screen.getByText('NPC')).toBeInTheDocument();
  });

  it('shows the recommended ruleset on scenario cards when present', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({
      items: [
        { publicId: 's1', title: 'Dragon Quest', ownerName: 'Grace', publishedAt: PUBLISHED_AT, recommendedRuleset: 'coc7e' },
      ],
      total: 1,
      hasMore: false,
    });
    renderWithAuth(<PublicItemList type="scenarios" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Dragon Quest')).toBeInTheDocument());
    expect(screen.getByText(/coc7e/)).toBeInTheDocument();
  });

  it('shows a loading indicator while the initial list is in flight', async () => {
    let resolveList;
    vi.spyOn(shareClient, 'listPublic').mockImplementation(
      () => new Promise((resolve) => { resolveList = resolve; })
    );
    renderWithAuth(<PublicItemList type="novels" onOpenDetail={vi.fn()} />);
    expect(screen.getByText('読み込み中…')).toBeInTheDocument();

    await act(async () => {
      resolveList({ items: [], total: 0, hasMore: false });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByText('読み込み中…')).not.toBeInTheDocument());
  });

  it('shows a fetch-error message when listPublic fails', async () => {
    vi.spyOn(shareClient, 'listPublic').mockRejectedValue(new Error('boom'));
    renderWithAuth(<PublicItemList type="novels" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });

  it('debounces the search input 300ms before refetching with q (offset reset to 0)', async () => {
    vi.useFakeTimers();
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });
    renderWithAuth(<PublicItemList type="novels" onOpenDetail={vi.fn()} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(listSpy).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByPlaceholderText('タイトル・作者名で検索'), { target: { value: 'dragon' } });
    expect(listSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(299);
      await Promise.resolve();
    });
    expect(listSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(listSpy).toHaveBeenLastCalledWith('novels', {
      q: 'dragon',
      moods: [],
      ruleset: '',
      ownerId: undefined,
      limit: 20,
      offset: 0,
    });
  });

  it('refetches with moods and resets offset to 0 when a mood chip is toggled', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });
    renderWithAuth(<PublicItemList type="worlds" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('ホラー'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    expect(listSpy).toHaveBeenLastCalledWith('worlds', {
      q: '',
      moods: ['ホラー'],
      ruleset: '',
      ownerId: undefined,
      limit: 20,
      offset: 0,
    });

    fireEvent.click(screen.getByText('冒険'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(3));
    expect(listSpy).toHaveBeenLastCalledWith(
      'worlds',
      expect.objectContaining({ moods: ['ホラー', '冒険'], offset: 0 })
    );
  });

  it('refetches with ruleset and resets offset to 0 when the ruleset dropdown changes', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });
    renderWithAuth(<PublicItemList type="scenarios" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'coc7e' } });
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    expect(listSpy).toHaveBeenLastCalledWith('scenarios', {
      q: '',
      moods: [],
      ruleset: 'coc7e',
      ownerId: undefined,
      limit: 20,
      offset: 0,
    });
  });

  it('refetches from offset 0 when the type prop changes, even without remounting', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });
    const { rerender } = renderWithAuth(<PublicItemList type="novels" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    rerenderWithAuth(rerender, <PublicItemList type="worlds" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(2));
    expect(listSpy).toHaveBeenLastCalledWith('worlds', expect.objectContaining({ offset: 0 }));
  });

  it('"もっと見る" fetches offset 20 and appends items (does not replace)', async () => {
    const page1 = {
      items: [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }],
      total: 2,
      hasMore: true,
    };
    const page2 = {
      items: [{ publicId: 'p2', title: 'World B', ownerName: 'Bob', publishedAt: PUBLISHED_AT }],
      total: 2,
      hasMore: false,
    };
    const listSpy = vi.spyOn(shareClient, 'listPublic')
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    renderWithAuth(<PublicItemList type="worlds" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('World A')).toBeInTheDocument());

    fireEvent.click(screen.getByText('もっと見る'));
    await waitFor(() => expect(screen.getByText('World B')).toBeInTheDocument());

    expect(listSpy).toHaveBeenLastCalledWith('worlds', expect.objectContaining({ offset: 20 }));
    expect(screen.getByText('World A')).toBeInTheDocument();
    expect(screen.queryByText('もっと見る')).not.toBeInTheDocument();
  });

  it('replaces items (does not append) when a filter changes after a "もっと見る" append', async () => {
    const page1 = {
      items: [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }],
      total: 2,
      hasMore: true,
    };
    const page2 = {
      items: [{ publicId: 'p2', title: 'World B', ownerName: 'Bob', publishedAt: PUBLISHED_AT }],
      total: 2,
      hasMore: false,
    };
    const page3 = {
      items: [{ publicId: 'p3', title: 'World C', ownerName: 'Cara', publishedAt: PUBLISHED_AT }],
      total: 1,
      hasMore: false,
    };
    vi.spyOn(shareClient, 'listPublic')
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
      .mockResolvedValueOnce(page3);
    renderWithAuth(<PublicItemList type="worlds" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('World A')).toBeInTheDocument());

    fireEvent.click(screen.getByText('もっと見る'));
    await waitFor(() => expect(screen.getByText('World B')).toBeInTheDocument());

    fireEvent.click(screen.getByText('ホラー'));
    await waitFor(() => expect(screen.getByText('World C')).toBeInTheDocument());

    expect(screen.queryByText('World A')).not.toBeInTheDocument();
    expect(screen.queryByText('World B')).not.toBeInTheDocument();
  });

  it('hides the "もっと見る" button when hasMore is false', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({
      items: [{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT }],
      total: 1,
      hasMore: false,
    });
    renderWithAuth(<PublicItemList type="worlds" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('World A')).toBeInTheDocument());
    expect(screen.queryByText('もっと見る')).not.toBeInTheDocument();
  });

  it('shows the no-filters empty state when there are no items and no filters are active', async () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });
    renderWithAuth(<PublicItemList type="novels" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('まだ公開されたものがありません')).toBeInTheDocument());
    expect(screen.queryByText('条件をクリア')).not.toBeInTheDocument();
  });

  it('shows the filtered empty state with a clear button, and clearing resets filters and refetches', async () => {
    const listSpy = vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });
    renderWithAuth(<PublicItemList type="worlds" onOpenDetail={vi.fn()} />);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('ホラー'));
    await waitFor(() => expect(screen.getByText('条件に合う公開物がありません')).toBeInTheDocument());
    expect(screen.getByText('条件をクリア')).toBeInTheDocument();

    fireEvent.click(screen.getByText('条件をクリア'));
    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith('worlds', {
        q: '',
        moods: [],
        ruleset: '',
        ownerId: undefined,
        limit: 20,
        offset: 0,
      })
    );
    await waitFor(() => expect(screen.getByText('まだ公開されたものがありません')).toBeInTheDocument());
  });

  it('shows mood chips only for worlds/scenarios, not for novels/characters', () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });
    const { rerender } = renderWithAuth(<PublicItemList type="novels" onOpenDetail={vi.fn()} />);
    expect(screen.queryByText('ホラー')).not.toBeInTheDocument();

    rerenderWithAuth(rerender, <PublicItemList type="characters" onOpenDetail={vi.fn()} />);
    expect(screen.queryByText('ホラー')).not.toBeInTheDocument();

    rerenderWithAuth(rerender, <PublicItemList type="worlds" onOpenDetail={vi.fn()} />);
    expect(screen.getByText('ホラー')).toBeInTheDocument();

    rerenderWithAuth(rerender, <PublicItemList type="scenarios" onOpenDetail={vi.fn()} />);
    expect(screen.getByText('ホラー')).toBeInTheDocument();
  });

  it('shows the ruleset dropdown only for scenarios', () => {
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });
    const { rerender } = renderWithAuth(<PublicItemList type="worlds" onOpenDetail={vi.fn()} />);
    expect(screen.queryByText('すべて')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    rerenderWithAuth(rerender, <PublicItemList type="scenarios" onOpenDetail={vi.fn()} />);
    expect(screen.getByText('すべて')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('ignores a stale response from an earlier request once a newer one resolves first', async () => {
    let callCount = 0;
    let resolveFirst;
    vi.spyOn(shareClient, 'listPublic').mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({
        items: [{ publicId: 'p2', title: 'Second', ownerName: 'Bob', publishedAt: PUBLISHED_AT }],
        total: 1,
        hasMore: false,
      });
    });

    renderWithAuth(<PublicItemList type="worlds" onOpenDetail={vi.fn()} />);
    // 1st request (novels initial) left unresolved; mood toggle triggers a 2nd request that resolves immediately.
    fireEvent.click(screen.getByText('ホラー'));
    await waitFor(() => expect(screen.getByText('Second')).toBeInTheDocument());

    await act(async () => {
      resolveFirst({
        items: [{ publicId: 'p1', title: 'Stale First', ownerName: 'Alice', publishedAt: PUBLISHED_AT }],
        total: 1,
        hasMore: false,
      });
      await Promise.resolve();
    });

    expect(screen.queryByText('Stale First')).not.toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });
});
