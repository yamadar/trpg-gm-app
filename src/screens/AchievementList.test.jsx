import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import AchievementList from './AchievementList.jsx';
import * as endingClient from '../api/endingClient.js';
import { CATALOG } from '../engine/achievementCatalog.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';

const STATS = {
  total: 4,
  successes: 2,
  successRate: 0.5,
  byDegree: { fumble: 1, fail: 1, success: 1, critical: 1 },
  degrees: ['fumble', 'fail', 'success', 'critical'],
  resources: {},
};

function ending(overrides = {}) {
  return {
    sessionId: 's1',
    sessionTitle: '星降りの夜に',
    endingTitle: '灰は星を数えない',
    endedAt: new Date(2026, 6, 12, 9).getTime(),
    worldId: null,
    campaignId: null,
    formula: 'simple',
    moods: ['ホラー'],
    stats: STATS,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('AchievementList', () => {
  it('lists the whole catalogue', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    expect(await screen.findByText('初めての結末')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('未取得').length).toBeGreaterThan(0));
    expect(screen.getByText('五十の結末')).toBeInTheDocument();
    expect(screen.getByText('三日連続')).toBeInTheDocument();
  });

  it('shows how many are earned out of the catalogue', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    // ending()の1件は「初めての結末」「ホラーの結末」「短編」の3つを満たす
    // (moods:['ホラー']、判定4回で1〜10回の範囲内)。他の見出し数字と被らない値で厳密に確認する。
    expect(await screen.findByText(`3 / ${CATALOG.length}`)).toBeInTheDocument();
  });

  it('filters down to the earned achievements', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /取得済み/ }));
    expect(screen.getByText('初めての結末')).toBeInTheDocument();
    expect(screen.queryByText('五十の結末')).toBeNull();
  });

  it('filters down to the unearned achievements', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /^未取得/ }));
    expect(screen.queryByText('初めての結末')).toBeNull();
    expect(screen.getByText('五十の結末')).toBeInTheDocument();
  });

  it('drops the other sections when a category is chosen', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '軌跡' }));
    expect(screen.getByText('三日連続')).toBeInTheDocument();
    expect(screen.queryByText('初めての結末')).toBeNull();
  });

  it('keeps the segment counts on the whole catalogue while a category is chosen', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '軌跡' }));
    // 絞り込むたびに数字が動くと「全体でいくつか」が読めなくなる
    // (ending()の1件で「初めての結末」「ホラーの結末」「短編」の3つが取得済みになる)
    expect(screen.getByRole('button', { name: '取得済み 3' })).toBeInTheDocument();
  });

  it('tells the visitor to sign in when signed out', async () => {
    const listEndings = vi.spyOn(endingClient, 'listEndings');
    renderWithAuth(<AchievementList onClose={vi.fn()} />, { user: null });
    expect(await screen.findByText(/ログインが必要です/)).toBeInTheDocument();
    expect(listEndings).not.toHaveBeenCalled();
  });
});
