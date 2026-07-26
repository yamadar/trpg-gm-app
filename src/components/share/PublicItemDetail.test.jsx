import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import PublicItemDetail, { publicMetaLine } from './PublicItemDetail.jsx';
import * as shareClient from '../../api/shareClient.js';
import * as worldLibraryClient from '../../api/worldLibraryClient.js';
import { renderWithAuth } from '../../test/renderWithAuth.jsx';

const PUBLISHED_AT = 1700000000000;
const EXPECTED_DATE = new Date(PUBLISHED_AT).toLocaleDateString('ja-JP');

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('publicMetaLine', () => {
  it('formats owner name and localized published date', () => {
    const line = publicMetaLine({ ownerName: 'Alice', publishedAt: PUBLISHED_AT });
    expect(line).toBe(`Alice ・ ${EXPECTED_DATE}`);
  });
});

describe('PublicItemDetail', () => {
  it('renders the item body text', () => {
    renderWithAuth(
      <PublicItemDetail
        type="worlds"
        item={{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT, raw: 'メイン本文', regions: [], categories: [] }}
      />
    );
    expect(screen.getByText('World A')).toBeInTheDocument();
    expect(screen.getByText('メイン本文')).toBeInTheDocument();
  });

  it('shows region/category headings and entries for worlds', () => {
    renderWithAuth(
      <PublicItemDetail
        type="worlds"
        item={{
          publicId: 'p1',
          title: 'World A',
          ownerName: 'Alice',
          publishedAt: PUBLISHED_AT,
          raw: 'メイン本文',
          regions: [{ name: 'North', raw: '北の地域' }],
          categories: [{ name: 'Lore', raw: '伝承の中身' }],
        }}
      />
    );
    expect(screen.getByText('地域(region)')).toBeInTheDocument();
    expect(screen.getByText('North')).toBeInTheDocument();
    expect(screen.getByText('北の地域')).toBeInTheDocument();
    expect(screen.getByText('カテゴリ(category)')).toBeInTheDocument();
    expect(screen.getByText('Lore')).toBeInTheDocument();
    expect(screen.getByText('伝承の中身')).toBeInTheDocument();
  });

  it('shows a login prompt instead of the add button when logged out', () => {
    renderWithAuth(
      <PublicItemDetail
        type="worlds"
        item={{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT, raw: 'メイン本文', regions: [], categories: [] }}
      />,
      { user: null }
    );
    expect(screen.getByText(/ログインが必要/)).toBeInTheDocument();
    expect(screen.queryByText('ライブラリに追加')).not.toBeInTheDocument();
  });

  it('imports a world directly and shows a success message', async () => {
    const importSpy = vi.spyOn(shareClient, 'importWorld').mockResolvedValue({ id: 'w-new' });
    renderWithAuth(
      <PublicItemDetail
        type="worlds"
        item={{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT, raw: 'メイン本文', regions: [], categories: [] }}
      />
    );
    fireEvent.click(screen.getByText('ライブラリに追加'));
    await waitFor(() => expect(importSpy).toHaveBeenCalledWith('p1', { duplicate: false }));
    await waitFor(() => expect(screen.getByText('ライブラリに追加しました')).toBeInTheDocument());
  });

  it('opens a target-world picker for characters and imports into the chosen world', async () => {
    vi.spyOn(worldLibraryClient, 'listWorlds').mockResolvedValue([
      { id: 'w1', title: 'World One' },
      { id: 'w2', title: 'World Two' },
    ]);
    const importCharacterSpy = vi.spyOn(shareClient, 'importCharacter').mockResolvedValue({ name: 'Dragon Lord' });
    renderWithAuth(
      <PublicItemDetail
        type="characters"
        item={{ publicId: 'c1', title: 'Dragon Lord', ownerName: 'Frank', publishedAt: PUBLISHED_AT, kind: 'npc', raw: '## Dragon' }}
      />
    );
    fireEvent.click(screen.getByText('ライブラリに追加'));
    expect(await screen.findByText('World One')).toBeInTheDocument();
    expect(screen.getByText('World Two')).toBeInTheDocument();

    fireEvent.click(screen.getByText('World Two'));
    await waitFor(() => expect(importCharacterSpy).toHaveBeenCalledWith('c1', 'w2', { duplicate: false }));
    await waitFor(() => expect(screen.getByText('ライブラリに追加しました')).toBeInTheDocument());
  });

  // 取り込み済みのものをもう一度押したとき。黙って複製すると、押した回数だけ
  // ライブラリに同じ素材が積み上がるので、別のものとして取り込むかを本人に決めさせる。
  it('asks before making a second copy of an already imported world', async () => {
    const alreadyImported = Object.assign(new Error('API error 409'), {
      status: 409,
      body: { error: 'already_imported', existing: { id: 'untitled', title: 'World A' } },
    });
    const importSpy = vi
      .spyOn(shareClient, 'importWorld')
      .mockRejectedValueOnce(alreadyImported)
      .mockResolvedValueOnce({ id: 'untitled-2' });
    renderWithAuth(
      <PublicItemDetail
        type="worlds"
        item={{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT, raw: 'メイン本文', regions: [], categories: [] }}
      />
    );

    fireEvent.click(screen.getByText('ライブラリに追加'));

    expect(
      await screen.findByText('「World A」は取り込み済みですが、もう一度別のWorldとして取り込みますか?')
    ).toBeInTheDocument();
    // 確認中は「失敗した」と誤解させるエラー表示を出さない
    expect(screen.queryByText(/API error/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取り込む' }));

    await waitFor(() => expect(importSpy).toHaveBeenLastCalledWith('p1', { duplicate: true }));
    expect(await screen.findByText('ライブラリに追加しました')).toBeInTheDocument();
    expect(screen.queryByText(/もう一度別のWorldとして/)).not.toBeInTheDocument();
  });

  it('leaves the library untouched when the duplicate is declined', async () => {
    const importSpy = vi.spyOn(shareClient, 'importWorld').mockRejectedValue(
      Object.assign(new Error('API error 409'), {
        status: 409,
        body: { error: 'already_imported', existing: { id: 'untitled', title: 'World A' } },
      })
    );
    renderWithAuth(
      <PublicItemDetail
        type="worlds"
        item={{ publicId: 'p1', title: 'World A', ownerName: 'Alice', publishedAt: PUBLISHED_AT, raw: 'メイン本文', regions: [], categories: [] }}
      />
    );

    fireEvent.click(screen.getByText('ライブラリに追加'));
    await screen.findByText(/もう一度別のWorldとして/);
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    await waitFor(() => expect(screen.queryByText(/もう一度別のWorldとして/)).not.toBeInTheDocument());
    expect(importSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('ライブラリに追加しました')).not.toBeInTheDocument();
  });

  // 取り込み先Worldごとの判定なので、確認をキャンセルしたらピッカーへ戻れなければならない。
  it('keeps the target-world picker behind the duplicate confirmation for characters', async () => {
    vi.spyOn(worldLibraryClient, 'listWorlds').mockResolvedValue([
      { id: 'w1', title: 'World One' },
      { id: 'w2', title: 'World Two' },
    ]);
    const importSpy = vi
      .spyOn(shareClient, 'importCharacter')
      .mockRejectedValueOnce(
        Object.assign(new Error('API error 409'), {
          status: 409,
          body: { error: 'already_imported', existing: { name: 'dragon-lord' } },
        })
      )
      .mockResolvedValueOnce({ name: 'dragon-lord-2' });
    renderWithAuth(
      <PublicItemDetail
        type="characters"
        item={{ publicId: 'c1', title: 'Dragon Lord', ownerName: 'Frank', publishedAt: PUBLISHED_AT, kind: 'npc', raw: '## Dragon' }}
      />
    );

    fireEvent.click(screen.getByText('ライブラリに追加'));
    fireEvent.click(await screen.findByText('World Two'));

    expect(
      await screen.findByText('「Dragon Lord」は取り込み済みですが、もう一度別のCharacterとして取り込みますか?')
    ).toBeInTheDocument();
    // ピッカーは残っている(別のWorldを選び直せる)
    expect(screen.getByText('追加先のWorldを選択')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取り込む' }));

    // 複製は「同じ取り込み先World」へ行く。宛先を取り違えると別のWorldに増える。
    await waitFor(() => expect(importSpy).toHaveBeenLastCalledWith('c1', 'w2', { duplicate: true }));
    expect(await screen.findByText('ライブラリに追加しました')).toBeInTheDocument();
  });

  it('does not show an add button on novels', () => {
    renderWithAuth(
      <PublicItemDetail
        type="novels"
        item={{ publicId: 'n1', title: 'Epic Adventure', ownerName: 'Henry', publishedAt: PUBLISHED_AT, raw: '物語本文' }}
      />
    );
    expect(screen.getByText('物語本文')).toBeInTheDocument();
    expect(screen.queryByText('ライブラリに追加')).not.toBeInTheDocument();
    expect(screen.queryByText(/ログインが必要/)).not.toBeInTheDocument();
  });

  it('renders the author name as a plain text when onAuthorClick is absent', () => {
    renderWithAuth(
      <PublicItemDetail
        type="worlds"
        item={{ publicId: 'p1', title: 'World A', ownerName: 'Alice', ownerId: 'u1', publishedAt: PUBLISHED_AT, raw: 'メイン本文', regions: [], categories: [] }}
      />
    );
    const alice = screen.getByText('Alice');
    expect(alice.tagName).not.toBe('BUTTON');
  });

  it('renders the author name as a clickable button calling onAuthorClick(item.ownerId) when provided', () => {
    const onAuthorClick = vi.fn();
    renderWithAuth(
      <PublicItemDetail
        type="worlds"
        item={{ publicId: 'p1', title: 'World A', ownerName: 'Alice', ownerId: 'u1', publishedAt: PUBLISHED_AT, raw: 'メイン本文', regions: [], categories: [] }}
        onAuthorClick={onAuthorClick}
      />
    );
    const alice = screen.getByText('Alice');
    expect(alice.tagName).toBe('BUTTON');
    fireEvent.click(alice);
    expect(onAuthorClick).toHaveBeenCalledWith('u1');
  });
});
