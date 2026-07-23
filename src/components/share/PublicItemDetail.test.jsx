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
        onBack={vi.fn()}
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
        onBack={vi.fn()}
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
        onBack={vi.fn()}
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
        onBack={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('ライブラリに追加'));
    await waitFor(() => expect(importSpy).toHaveBeenCalledWith('p1'));
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
        onBack={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText('ライブラリに追加'));
    expect(await screen.findByText('World One')).toBeInTheDocument();
    expect(screen.getByText('World Two')).toBeInTheDocument();

    fireEvent.click(screen.getByText('World Two'));
    await waitFor(() => expect(importCharacterSpy).toHaveBeenCalledWith('c1', 'w2'));
    await waitFor(() => expect(screen.getByText('ライブラリに追加しました')).toBeInTheDocument());
  });

  it('does not show an add button on novels', () => {
    renderWithAuth(
      <PublicItemDetail
        type="novels"
        item={{ publicId: 'n1', title: 'Epic Adventure', ownerName: 'Henry', publishedAt: PUBLISHED_AT, raw: '物語本文' }}
        onBack={vi.fn()}
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
        onBack={vi.fn()}
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
        onBack={vi.fn()}
        onAuthorClick={onAuthorClick}
      />
    );
    const alice = screen.getByText('Alice');
    expect(alice.tagName).toBe('BUTTON');
    fireEvent.click(alice);
    expect(onAuthorClick).toHaveBeenCalledWith('u1');
  });
});
