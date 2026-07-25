import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import EndingGallery from './EndingGallery.jsx';
import * as endingClient from '../api/endingClient.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';
import { CATALOG } from '../engine/achievementCatalog.js';

const SIMPLE_STATS = {
  total: 4,
  successes: 2,
  successRate: 0.5,
  byDegree: { fumble: 1, fail: 1, success: 1, critical: 1 },
  degrees: ['fumble', 'fail', 'success', 'critical'],
  resources: {},
};

const COC_STATS = {
  total: 6,
  successes: 4,
  successRate: 4 / 6,
  byDegree: { fumble: 0, fail: 2, success: 2, hard: 1, extreme: 1, critical: 0 },
  degrees: ['fumble', 'fail', 'success', 'hard', 'extreme', 'critical'],
  resources: { san: { label: '正気度', value: 12, max: 99 } },
};

function ending(overrides = {}) {
  return {
    sessionId: 's1',
    sessionTitle: '星降りの夜に',
    endingTitle: '灰は星を数えない',
    summary: '彼女は坑道を出た。',
    // night-owl(0-4時)・dawn(5-7時)のどちらにもかからない時刻にする(タイムゾーンに依存させないため)。
    endedAt: new Date(2026, 0, 1, 12).getTime(),
    worldId: null,
    moods: ['ホラー'],
    stats: SIMPLE_STATS,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('EndingGallery', () => {
  it('shows an empty state when nothing has been recorded', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    expect(await screen.findByText(/まだエンディングの記録がありません/)).toBeInTheDocument();
  });

  it('lists recorded endings with their title, session and summary', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    expect(await screen.findByText('灰は星を数えない')).toBeInTheDocument();
    expect(screen.getByText(/星降りの夜に/)).toBeInTheDocument();
    expect(screen.getByText('彼女は坑道を出た。')).toBeInTheDocument();
    expect(screen.getByText('ホラー')).toBeInTheDocument();
  });

  it('shows ruleset-specific statistics only for the ruleset that has them', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([
      ending({ sessionId: 'a', endingTitle: '簡易の結末', stats: SIMPLE_STATS }),
      ending({ sessionId: 'b', endingTitle: 'CoCの結末', stats: COC_STATS }),
    ]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    await screen.findByText('CoCの結末');
    expect(screen.getByText(/ハード成功 1/)).toBeInTheDocument();
    expect(screen.getByText(/正気度 12\/99/)).toBeInTheDocument();
  });

  it('summarises the achievements instead of listing the whole catalogue', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    // このフィクスチャ(雰囲気ホラー・判定4回)1件では first-ending / mood-horror / short-story の3件が立つ。
    expect(await screen.findByText(`3 / ${CATALOG.length}`)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '実績の取得状況' })).toBeInTheDocument();
    // 直近の獲得だけを出すので、未取得の実績は図鑑には並ばない
    expect(screen.getByText('初めての結末')).toBeInTheDocument();
    expect(screen.queryByText('五十の結末')).toBeNull();
  });

  it('shows at most three recently earned achievements, newest first', async () => {
    const many = [1, 2, 3].map((i) =>
      ending({ sessionId: `s${i}`, endedAt: new Date(2026, 6, i, 9).getTime(), worldId: 'w1' })
    );
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue(many);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    const tiles = await screen.findAllByTestId('achievement-tile');
    expect(tiles.length).toBe(3);
    const dates = tiles.map((t) => t.textContent.match(/\d{4}-\d{2}-\d{2}/)[0]);
    expect([...dates]).toEqual([...dates].sort().reverse());
  });

  it('says so when nothing has been earned yet', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    expect(await screen.findByText(/まだ実績がありません/)).toBeInTheDocument();
  });

  it('links to the full achievement list', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /すべて見る/ }));
    expect(window.location.hash).toBe('#/achievements');
  });

  it('renames an ending', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    const renameSpy = vi
      .spyOn(endingClient, 'renameEnding')
      .mockResolvedValue(ending({ endingTitle: '新しい題' }));
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('改名'));
    fireEvent.change(screen.getByDisplayValue('灰は星を数えない'), { target: { value: '新しい題' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(renameSpy).toHaveBeenCalledWith('s1', '新しい題'));
    expect(await screen.findByText('新しい題')).toBeInTheDocument();
  });

  it('cancels a rename without calling the API', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    const renameSpy = vi.spyOn(endingClient, 'renameEnding');
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('改名'));
    fireEvent.click(screen.getByText('取消'));

    expect(renameSpy).not.toHaveBeenCalled();
    expect(screen.getByText('灰は星を数えない')).toBeInTheDocument();
  });

  it('deletes an ending after confirmation', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    const deleteSpy = vi.spyOn(endingClient, 'deleteEnding').mockResolvedValue(undefined);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('削除'));
    fireEvent.click(screen.getByText('削除する'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.queryByText('灰は星を数えない')).not.toBeInTheDocument());
  });

  it('closes the confirm modal on delete failure so the error message is readable (not hidden behind the overlay)', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    vi.spyOn(endingClient, 'deleteEnding').mockRejectedValue(new Error('boom'));
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('削除'));
    fireEvent.click(screen.getByText('削除する'));

    await waitFor(() => expect(screen.getByText(/削除に失敗した/)).toBeInTheDocument());
    // モーダルが閉じていること(キャンセルボタンが消えている)を確認する。
    expect(screen.queryByText('キャンセル')).not.toBeInTheDocument();
    // セッション自体は残る(削除に失敗しているため)。
    expect(screen.getByText('灰は星を数えない')).toBeInTheDocument();
  });

  it('shows an error when loading fails', async () => {
    vi.spyOn(endingClient, 'listEndings').mockRejectedValue(new Error('boom'));
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });

  it('asks for login when logged out', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />, { user: null });
    expect(await screen.findByText(/ログインが必要です/)).toBeInTheDocument();
  });

  it('closes the gallery', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    const onClose = vi.fn();
    renderWithAuth(<EndingGallery onClose={onClose} />);
    fireEvent.click(await screen.findByText('ホームへ'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

afterEach(() => {
  // ハッシュを残すと他のテストへ漏れる
  window.history.replaceState(null, '', window.location.pathname);
});
