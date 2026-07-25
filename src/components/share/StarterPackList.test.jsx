import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StarterPackList from './StarterPackList.jsx';
import * as starterClient from '../../api/starterClient.js';

const PACKS = [
  {
    packId: 'arkham-1920s',
    title: 'アーカム 1920s',
    tagline: '禁書と魔女裁判の記憶が残る港町。',
    source: 'H.P.ラヴクラフト作品に基づく',
    moods: ['ホラー', 'ミステリー'],
    recommendedRuleset: 'coc7e',
    scenarioTitle: '丘の上の写真館',
  },
  {
    packId: 'alden-frontier',
    title: 'アルデン辺境領',
    tagline: '街道の途切れた先に古代帝国が沈んでいる。',
    source: null,
    moods: ['ファンタジー', '冒険'],
    recommendedRuleset: 'dnd5e',
    scenarioTitle: '涸れた井戸の底',
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('StarterPackList', () => {
  it('renders a card per pack with tagline, moods, ruleset label and source', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
    render(<StarterPackList onImported={vi.fn()} />);

    expect(await screen.findByText('アーカム 1920s')).toBeInTheDocument();
    expect(screen.getByText(/禁書と魔女裁判/)).toBeInTheDocument();
    expect(screen.getByText('ホラー')).toBeInTheDocument();
    expect(screen.getByText('CoC7e風')).toBeInTheDocument();
    expect(screen.getByText(/ラヴクラフト作品に基づく/)).toBeInTheDocument();
    expect(screen.getByText('アルデン辺境領')).toBeInTheDocument();
    expect(screen.getByText('丘の上の写真館')).toBeInTheDocument();
  });

  // 未シードの環境でもHome/Galleryが壊れないよう、「無い」は親ではなくここで吸収する
  it('renders nothing when the manifest is empty', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: [], seededAt: null });
    const { container } = render(<StarterPackList onImported={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders nothing when the manifest cannot be fetched', async () => {
    vi.spyOn(starterClient, 'listStarters').mockRejectedValue(new Error('offline'));
    const { container } = render(<StarterPackList onImported={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('imports the pack and hands the caller a starterContext', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
    vi.spyOn(starterClient, 'importStarterPack').mockResolvedValue({
      world: { id: 'arkham-1920s', title: 'アーカム 1920s', moods: ['ホラー'], raw: '# 世界' },
      scenario: { id: 'photo-studio', worldId: 'arkham-1920s', title: '丘の上の写真館', recommendedRuleset: 'coc7e', moods: ['ホラー'], raw: '# シナリオ' },
      pcs: [{ name: 'howard-kane' }, { name: 'mabel-thorne' }],
      npcs: [],
    });
    const onImported = vi.fn();
    render(<StarterPackList onImported={onImported} />);

    fireEvent.click((await screen.findAllByText('この冒険を始める'))[0]);

    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(starterClient.importStarterPack).toHaveBeenCalledWith('arkham-1920s');
    expect(onImported).toHaveBeenCalledWith({
      world: { id: 'arkham-1920s', title: 'アーカム 1920s', moods: ['ホラー'], raw: '# 世界' },
      scenario: { id: 'photo-studio', worldId: 'arkham-1920s', title: '丘の上の写真館', recommendedRuleset: 'coc7e', moods: ['ホラー'], raw: '# シナリオ' },
      rulesetId: 'coc7e',
    });
  });

  it('shows the error on the failing card and leaves the other card usable', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
    vi.spyOn(starterClient, 'importStarterPack').mockRejectedValue(new Error('boom'));
    render(<StarterPackList onImported={vi.fn()} />);

    const buttons = await screen.findAllByText('この冒険を始める');
    fireEvent.click(buttons[0]);

    expect(await screen.findByText(/取り込みに失敗した/)).toBeInTheDocument();
    expect(screen.getAllByText('この冒険を始める')[1].closest('button')).not.toBeDisabled();
  });
});
