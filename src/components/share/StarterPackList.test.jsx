import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import StarterPackList from './StarterPackList.jsx';
import * as starterClient from '../../api/starterClient.js';
import { renderWithAuth } from '../../test/renderWithAuth.jsx';

// 未settleのPromiseをテストから任意のタイミングでresolve/rejectするためのヘルパー。
// 「フェッチが完了した後の状態」を確実に観測するために使う(初回同期レンダーの
// 見せかけの一致でwaitForが即通過してしまうのを避ける)。
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
    renderWithAuth(<StarterPackList onImported={vi.fn()} />);

    expect(await screen.findByText('アーカム 1920s')).toBeInTheDocument();
    expect(screen.getByText(/禁書と魔女裁判/)).toBeInTheDocument();
    expect(screen.getByText('ホラー')).toBeInTheDocument();
    expect(screen.getByText('CoC7e風')).toBeInTheDocument();
    expect(screen.getByText(/ラヴクラフト作品に基づく/)).toBeInTheDocument();
    expect(screen.getByText('アルデン辺境領')).toBeInTheDocument();
    expect(screen.getByText('丘の上の写真館')).toBeInTheDocument();
  });

  // 未シードの環境でもHome/Galleryが壊れないよう、「無い」は親ではなくここで吸収する
  it('renders nothing once the manifest resolves as empty', async () => {
    const { promise, resolve } = deferred();
    vi.spyOn(starterClient, 'listStarters').mockReturnValue(promise);
    const { container } = renderWithAuth(<StarterPackList onImported={vi.fn()} />);

    expect(starterClient.listStarters).toHaveBeenCalled();

    await act(async () => {
      resolve({ packs: [], seededAt: null });
      await promise;
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing and shows no error text when the manifest fetch fails', async () => {
    const { promise, reject } = deferred();
    vi.spyOn(starterClient, 'listStarters').mockReturnValue(promise);
    const { container } = renderWithAuth(<StarterPackList onImported={vi.fn()} />);

    expect(starterClient.listStarters).toHaveBeenCalled();

    await act(async () => {
      reject(new Error('offline'));
      await promise.catch(() => {});
    });

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/失敗/)).not.toBeInTheDocument();
    expect(screen.queryByText(/offline/)).not.toBeInTheDocument();
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
    renderWithAuth(<StarterPackList onImported={onImported} />);

    fireEvent.click((await screen.findAllByText('この冒険を始める'))[0]);

    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(starterClient.importStarterPack).toHaveBeenCalledWith('arkham-1920s');
    expect(onImported).toHaveBeenCalledWith({
      world: { id: 'arkham-1920s', title: 'アーカム 1920s', moods: ['ホラー'], raw: '# 世界' },
      scenario: { id: 'photo-studio', worldId: 'arkham-1920s', title: '丘の上の写真館', recommendedRuleset: 'coc7e', moods: ['ホラー'], raw: '# シナリオ' },
      rulesetId: 'coc7e',
    });
  });

  // 取り込みが完了した時点で素材はサーバー側に出来上がっている。一覧が既に外れていても
  // 結果を親へ渡さないと、「素材だけ増えて画面はどこへも行かない」状態になる。
  it('still hands the caller the starterContext when the list unmounts mid-import', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
    const pending = deferred();
    vi.spyOn(starterClient, 'importStarterPack').mockReturnValue(pending.promise);
    const onImported = vi.fn();
    const { unmount } = renderWithAuth(<StarterPackList onImported={onImported} />);

    fireEvent.click((await screen.findAllByText('この冒険を始める'))[0]);
    unmount();

    await act(async () => {
      pending.resolve({
        world: { id: 'arkham-1920s', title: 'アーカム 1920s', moods: [], raw: '# 世界' },
        scenario: { id: 'photo-studio', worldId: 'arkham-1920s', title: '丘の上の写真館', recommendedRuleset: 'coc7e', moods: [], raw: '# シナリオ' },
        pcs: [],
        npcs: [],
      });
      await pending.promise;
    });

    expect(onImported).toHaveBeenCalledWith(
      expect.objectContaining({ rulesetId: 'coc7e', world: expect.objectContaining({ id: 'arkham-1920s' }) })
    );
  });

  it('shows the error on the failing card and leaves the other card usable', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
    vi.spyOn(starterClient, 'importStarterPack').mockRejectedValue(new Error('boom'));
    renderWithAuth(<StarterPackList onImported={vi.fn()} />);

    const buttons = await screen.findAllByText('この冒険を始める');
    fireEvent.click(buttons[0]);

    expect(await screen.findByText(/取り込みに失敗した/)).toBeInTheDocument();
    expect(screen.getAllByText('この冒険を始める')[1].closest('button')).not.toBeDisabled();
  });

  // 公開ギャラリーはログイン無しで閲覧できる設計なので、ログアウト状態では
  // 認証必須のインポートAPIを叩く前にボタン自体を消して案内文にする
  // (PublicItemDetailの「ログインが必要です」と同じ扱い)
  //
  // 案内文は一覧の先頭に1回だけ。以前はカードごとに出しており、スクリーンリーダーで
  // 同じ文がパックの数だけ読み上げられていた。
  it('hides the start button and shows a single login prompt when logged out', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
    renderWithAuth(<StarterPackList onImported={vi.fn()} />, { user: null });

    expect(await screen.findByText('アーカム 1920s')).toBeInTheDocument();
    expect(screen.queryByText('この冒険を始める')).not.toBeInTheDocument();
    expect(screen.getAllByText(/ログインが必要/)).toHaveLength(1);
  });

  it('keeps a card disabled while its import is pending, even after a second import starts', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
    const first = deferred();
    const second = deferred();
    vi.spyOn(starterClient, 'importStarterPack')
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderWithAuth(<StarterPackList onImported={vi.fn()} />);

    const buttons = await screen.findAllByText('この冒険を始める');
    fireEvent.click(buttons[0]);
    expect(buttons[0].closest('button')).toBeDisabled();

    fireEvent.click(buttons[1]);
    expect(buttons[1].closest('button')).toBeDisabled();

    // 2枚目のインポートが開始しても、1枚目のインポートはまだ進行中なので無効のまま
    expect(buttons[0].closest('button')).toBeDisabled();

    await act(async () => {
      first.resolve({ world: {}, scenario: {} });
      second.resolve({ world: {}, scenario: {} });
      await Promise.all([first.promise, second.promise]);
    });
  });
});
