import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import Home, { sanitizeFilename, collectJobEvents, collectUnreadIds } from './Home.jsx';
import * as sessionSyncClient from '../api/sessionSyncClient.js';
import * as shareClient from '../api/shareClient.js';
import * as sessionApi from '../api/session.js';
import * as campaignClient from '../api/campaignClient.js';
import * as storage from '../storage/index.js';
import * as endingClient from '../api/endingClient.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';
import { AuthContext } from '../auth/AuthContext.jsx';

function rerenderWithAuth(rerender, ui, user) {
  rerender(
    <AuthContext.Provider value={{ user, loading: false, refresh: async () => {}, logout: async () => {} }}>
      {ui}
    </AuthContext.Provider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('Home', () => {
  it('shows the storage warning when storage is unavailable', () => {
    renderWithAuth(<Home sessions={[]} storageOk={false} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText(/保存機能\(IndexedDB\)が使えていない/)).toBeInTheDocument();
  });

  it('does not show the warning when storage is available', () => {
    renderWithAuth(<Home sessions={[]} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.queryByText(/保存機能\(IndexedDB\)が使えていない/)).not.toBeInTheDocument();
  });

  it('lists resumable sessions with scene and last line', () => {
    const sessions = [
      {
        id: 's1',
        title: 'セッションA',
        updatedAt: 1,
        state: { current_scene: '森', turn_count: 3 },
        log: [{ role: 'gm', text: '森の奥から物音がした。' }],
      },
    ];
    renderWithAuth(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText('セッションA')).toBeInTheDocument();
    expect(screen.getByText(/シーン:/)).toBeInTheDocument();
    expect(screen.getByText(/森の奥から物音がした。/)).toBeInTheDocument();
  });

  it('shows a placeholder last line when the session has no log yet', () => {
    const sessions = [{ id: 's1', title: 'セッションB', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText('(まだ進行なし)')).toBeInTheDocument();
  });

  it('calls onOpenLibrary when the library button is clicked', () => {
    const onOpenLibrary = vi.fn();
    renderWithAuth(<Home sessions={[]} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={onOpenLibrary} onOpenGallery={vi.fn()} />);
    fireEvent.click(screen.getByText('素材ライブラリ'));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });

  it('shows the public gallery button and calls onOpenGallery when clicked, even when logged out', () => {
    const onOpenGallery = vi.fn();
    renderWithAuth(
      <Home sessions={[]} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} onOpenGallery={onOpenGallery} />,
      { user: null }
    );
    const button = screen.getByText('公開ギャラリー');
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onOpenGallery).toHaveBeenCalledTimes(1);
  });

  it('挿絵のあるセッションにのみ「挿絵付き」ボタンを表示する(小説が既にある場合)', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, hasNovel: true, stale: false },
      s2: { status: 'done', error: null, hasNovel: true, stale: false },
    });
    const sessions = [
      {
        id: 's1',
        title: '挿絵あり',
        updatedAt: 2,
        state: {},
        log: [{ role: 'gm', text: 'x', image: { imageId: 'img_a' } }],
      },
      { id: 's2', title: '挿絵なし', updatedAt: 1, state: {}, log: [{ role: 'gm', text: 'y' }] },
    ];
    renderWithAuth(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(await screen.findAllByText('挿絵付きでDL')).toHaveLength(1);
  });

  it('warns that the tail may be missing when the novel was truncated', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, hasNovel: true, stale: false, truncated: true },
      s2: { status: 'done', error: null, hasNovel: true, stale: false, truncated: false },
    });
    const sessions = [
      { id: 's1', title: '打ち切りあり', updatedAt: 2, state: {}, log: [] },
      { id: 's2', title: '打ち切りなし', updatedAt: 1, state: {}, log: [] },
    ];
    renderWithAuth(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    // 警告は打ち切られたセッションにだけ出る。
    expect(await screen.findAllByText(/末尾が欠けている可能性があります/)).toHaveLength(1);
  });

  it('shows an error message when novelization fails', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({});
    vi.spyOn(sessionSyncClient, 'novelizeSession').mockRejectedValue(new Error('upstream down'));
    const sessions = [{ id: 's1', title: 'セッションA', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    fireEvent.click(await screen.findByText('小説化する'));

    await waitFor(() => expect(screen.getByText(/小説化に失敗した/)).toBeInTheDocument());
  });

  it('sanitizes filesystem-unsafe and dot-only titles', () => {
    expect(sanitizeFilename('a/b:c')).toBe('a_b_c');
    expect(sanitizeFilename('..')).toBe('session');
    expect(sanitizeFilename('')).toBe('session');
    expect(sanitizeFilename('普通のタイトル')).toBe('普通のタイトル');
  });

  it('keeps each session novelize button independent (concurrent guard is per-session)', async () => {
    // 単一のnovelizingId状態だと、s1がpending中にs2を開始すると
    // novelizingIdが'id2'に書き換わり、s1のボタンが「小説化中…」から
    // 「小説化」に戻って再度クリック可能になってしまう(古いバグ)。
    // このテストはその回帰を検出できるよう、両方を同時にpendingにして検証する。
    const resolvers = {};
    vi.spyOn(sessionSyncClient, 'novelizeSession').mockImplementation(
      (id) =>
        new Promise((resolve) => {
          resolvers[id] = resolve;
        })
    );
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({ text: '本文', stale: false });
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:x'), revokeObjectURL: vi.fn() });

    const sessions = [
      { id: 's1', title: 'A', updatedAt: 2, state: {}, log: [] },
      { id: 's2', title: 'B', updatedAt: 1, state: {}, log: [] },
    ];
    renderWithAuth(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    // s1の小説化を開始(pendingのまま)
    fireEvent.click(screen.getAllByText('小説化する')[0]);
    await waitFor(() => expect(screen.getAllByText('小説化中…').length).toBe(1));
    expect(screen.getAllByText('小説化する').length).toBe(1); // s2はまだ「小説化」のまま

    // s1がまだpendingの間にs2の小説化も開始
    fireEvent.click(screen.getAllByText('小説化する')[0]);
    await waitFor(() => expect(screen.getAllByText('小説化中…').length).toBe(2));
    // 単一のnovelizingIdガードでは、s2を開始した瞬間にs1が「小説化」へ
    // 戻ってしまうため、この時点で両方が同時に「小説化中…」にはならない。
    expect(screen.queryAllByText('小説化する').length).toBe(0);

    // 後始末: 両方のpendingなpromiseを解決してunhandled rejectionを防ぐ
    await act(async () => {
      resolvers.s1({ ok: true });
      resolvers.s2({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.restoreAllMocks();
  });

  it('disables new play and novelize when logged out', () => {
    const sessions = [{ id: 's1', title: 'セッションA', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(
      <Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />,
      { user: null }
    );
    expect(screen.getByText('+ 新規プレイ')).toBeDisabled();
    expect(screen.getByText('小説化する')).toBeDisabled();
    expect(screen.getByText(/ログインが必要/)).toBeInTheDocument();
    // ライブラリと続きから再開は許可されたまま
    expect(screen.getByText('素材ライブラリ')).not.toBeDisabled();
  });

  describe('小説の公開/公開解除', () => {
    it('shows a 公開中 badge for a published session and a 小説を公開 button for an unpublished one', async () => {
      vi.spyOn(shareClient, 'publishedNovels').mockResolvedValue({ s1: 'pub-s1' });
      const sessions = [
        { id: 's1', title: 'セッションA', updatedAt: 2, state: {}, log: [] },
        { id: 's2', title: 'セッションB', updatedAt: 1, state: {}, log: [] },
      ];
      renderWithAuth(
        <Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );

      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      expect(screen.getByText('公開解除')).toBeInTheDocument();
      expect(screen.getByText('小説を公開')).toBeInTheDocument();
    });

    it('clicking 小説を公開 calls publishNovel with the session id and flips to the badge, without navigating into the session', async () => {
      vi.spyOn(shareClient, 'publishedNovels').mockResolvedValue({});
      const publishSpy = vi.spyOn(shareClient, 'publishNovel').mockResolvedValue({ publicId: 'pub-s1' });
      const sessions = [{ id: 's1', title: 'セッションA', updatedAt: 1, state: {}, log: [] }];
      const onContinue = vi.fn();
      renderWithAuth(
        <Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={onContinue} onOpenLibrary={vi.fn()} />
      );

      await waitFor(() => expect(shareClient.publishedNovels).toHaveBeenCalled());
      fireEvent.click(screen.getByText('小説を公開'));

      await waitFor(() => expect(publishSpy).toHaveBeenCalledWith('s1'));
      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      expect(screen.queryByText('小説を公開')).not.toBeInTheDocument();
      expect(onContinue).not.toHaveBeenCalled();
    });

    it('shows a guidance message when publishing fails with 409 (novel not generated yet)', async () => {
      vi.spyOn(shareClient, 'publishedNovels').mockResolvedValue({});
      vi.spyOn(shareClient, 'publishNovel').mockRejectedValue(
        Object.assign(new Error('novelize first'), { status: 409 })
      );
      const sessions = [{ id: 's1', title: 'セッションA', updatedAt: 1, state: {}, log: [] }];
      renderWithAuth(
        <Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );

      await waitFor(() => expect(shareClient.publishedNovels).toHaveBeenCalled());
      fireEvent.click(screen.getByText('小説を公開'));

      await waitFor(() => expect(screen.getByText('先に小説化してください')).toBeInTheDocument());
    });

    it('clicking 公開解除 calls unpublishNovel and removes the badge', async () => {
      vi.spyOn(shareClient, 'publishedNovels').mockResolvedValue({ s1: 'pub-s1' });
      const unpublishSpy = vi.spyOn(shareClient, 'unpublishNovel').mockResolvedValue();
      const sessions = [{ id: 's1', title: 'セッションA', updatedAt: 1, state: {}, log: [] }];
      renderWithAuth(
        <Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );

      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      fireEvent.click(screen.getByText('公開解除'));

      await waitFor(() => expect(unpublishSpy).toHaveBeenCalledWith('s1'));
      await waitFor(() => expect(screen.queryByText('公開中')).not.toBeInTheDocument());
      expect(screen.getByText('小説を公開')).toBeInTheDocument();
    });

    it('hides the publish controls when logged out', () => {
      const publishedSpy = vi.spyOn(shareClient, 'publishedNovels');
      const sessions = [{ id: 's1', title: 'セッションA', updatedAt: 1, state: {}, log: [] }];
      renderWithAuth(
        <Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />,
        { user: null }
      );

      expect(screen.queryByText('小説を公開')).not.toBeInTheDocument();
      expect(screen.queryByText('公開中')).not.toBeInTheDocument();
      expect(screen.queryByText('公開解除')).not.toBeInTheDocument();
      expect(publishedSpy).not.toHaveBeenCalled();
    });
  });

  describe('次の章へ(キャンペーン)', () => {
    it('worldIdの無いセッションには「次の章へ」を出さない', () => {
      const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [{ role: 'gm', text: 'x' }] }];
      renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
      expect(screen.queryByText('次の章へ')).not.toBeInTheDocument();
    });

    it('worldIdありで「次の章へ」を押すと引き継ぎPCを生成しCampaignを保存してonNextChapterを呼ぶ', async () => {
      vi.spyOn(sessionApi, 'advanceCampaignPc').mockResolvedValue({ pcRaw: '成長版シート', xp: 7 });
      const putCampaignSpy = vi.spyOn(campaignClient, 'putCampaign').mockResolvedValue({ id: 'cp_x' });
      vi.spyOn(sessionSyncClient, 'putSessionToServer').mockResolvedValue({});
      const onNextChapter = vi.fn();
      const sessions = [
        {
          id: 's1',
          title: 'A',
          updatedAt: 1,
          worldId: 'w1',
          world: { raw: 'r', summary: 'sum' },
          rulesetId: 'simple',
          moods: [],
          pc: { raw: '元' },
          state: { xp: 7, flags: {}, recent_log: [] },
          log: [{ role: 'gm', text: 'x' }],
        },
      ];
      renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} onNextChapter={onNextChapter} />
      );
      fireEvent.click(screen.getByText('次の章へ'));
      await waitFor(() => expect(putCampaignSpy).toHaveBeenCalled());
      await waitFor(() => expect(onNextChapter).toHaveBeenCalled());
      const ctx = onNextChapter.mock.calls[0][0];
      expect(ctx.worldId).toBe('w1');
      expect(ctx.pcRaw).toBe('成長版シート');
      expect(ctx.xp).toBe(7);
      expect(ctx.campaignId).toBeTruthy();
    });

    it('既にcampaignIdを持つセッションで「次の章へ」を押しても、そのcampaignIdを保ったままendedAtを刻んで保存する', async () => {
      vi.spyOn(sessionApi, 'advanceCampaignPc').mockResolvedValue({ pcRaw: '更新シート', xp: 9 });
      vi.spyOn(campaignClient, 'getCampaign').mockResolvedValue({
        id: 'cp1',
        worldId: 'w1',
        title: '既存キャンペーン',
        carriedPc: null,
        chapters: [{ sessionId: 's0', title: '第一章', endedAt: 1 }],
      });
      const putCampaignSpy = vi.spyOn(campaignClient, 'putCampaign').mockResolvedValue({});
      vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([]);
      const putSessionSpy = vi.spyOn(sessionSyncClient, 'putSessionToServer').mockResolvedValue({});
      const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
      const onNextChapter = vi.fn();
      const sessions = [
        {
          id: 's1',
          title: '第二章',
          updatedAt: 1,
          worldId: 'w1',
          campaignId: 'cp1',
          world: { raw: 'r', summary: 'sum' },
          rulesetId: 'simple',
          moods: [],
          pc: { raw: '元' },
          state: { xp: 9, flags: {}, recent_log: [] },
          log: [{ role: 'gm', text: 'x' }],
        },
      ];
      renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} onNextChapter={onNextChapter} />
      );
      fireEvent.click(screen.getByText('次の章へ'));

      await waitFor(() => expect(putCampaignSpy).toHaveBeenCalled());
      await waitFor(() => expect(saveSpy).toHaveBeenCalled());
      const saved = saveSpy.mock.calls.at(-1)[0];
      expect(saved.campaignId).toBe('cp1'); // 既存のcampaignIdが新規採番で上書きされない
      expect(typeof saved.endedAt).toBe('number');

      await waitFor(() => expect(putSessionSpy).toHaveBeenCalled());
      await waitFor(() => expect(onNextChapter).toHaveBeenCalled());
      expect(onNextChapter.mock.calls[0][0].campaignId).toBe('cp1');
    });
  });

  describe('キャンペーングルーピング', () => {
    it('同一campaignIdのセッションをキャンペーン見出しの下にまとめる', async () => {
      vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([
        { id: 'cp1', title: '影の連鎖', chapters: [{}, {}] },
      ]);
      const sessions = [
        { id: 's1', title: '第一章', updatedAt: 1, worldId: 'w1', campaignId: 'cp1', state: {}, log: [{ role: 'gm', text: 'a' }] },
        { id: 's2', title: '第二章', updatedAt: 2, worldId: 'w1', campaignId: 'cp1', state: {}, log: [{ role: 'gm', text: 'b' }] },
        { id: 's3', title: '単発', updatedAt: 3, state: {}, log: [{ role: 'gm', text: 'c' }] },
      ];
      renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
      expect(await screen.findByText(/影の連鎖/)).toBeInTheDocument();
      await waitFor(() => expect(campaignClient.listCampaigns).toHaveBeenCalledWith('w1'));
      expect(screen.getByText('第一章')).toBeInTheDocument();
      expect(screen.getByText('第二章')).toBeInTheDocument();
      expect(screen.getByText('単発')).toBeInTheDocument();
    });

    it('解決できないcampaignId(dangling)は非グループ表示にフォールバックする', async () => {
      vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([]); // cp_goneは見つからない
      const sessions = [
        { id: 's1', title: '孤児セッション', updatedAt: 1, worldId: 'w1', campaignId: 'cp_gone', state: {}, log: [{ role: 'gm', text: 'a' }] },
      ];
      renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
      expect(await screen.findByText('続きから再開')).toBeInTheDocument();
      expect(screen.getByText('孤児セッション')).toBeInTheDocument();
    });
  });

  it('shows a 完結 badge for a session that has ended', () => {
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, endedAt: 123, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText('完結')).toBeInTheDocument();
  });

  it('does not show a 完結 badge for a session still in progress', () => {
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.queryByText('完結')).not.toBeInTheDocument();
  });

  it('shows an 挿絵あり badge when the session log carries images', () => {
    const sessions = [
      { id: 's1', title: 'A', updatedAt: 1, state: {}, log: [{ role: 'gm', text: 'g', image: { imageId: 'img_a' } }] },
    ];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText('挿絵あり')).toBeInTheDocument();
  });

  it('renders 公開中 as a badge rather than a button', async () => {
    vi.spyOn(shareClient, 'publishedNovels').mockResolvedValue({ s1: 'pub_1' });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    const badge = await screen.findByText('公開中');
    expect(badge.tagName).toBe('SPAN');
  });

  it('shows 小説化中… and disables the button while the server reports a running job', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'running', error: null, hasNovel: false, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    const button = await screen.findByText('小説化中…');
    expect(button).toBeDisabled();
    expect(screen.queryByText('小説化する')).not.toBeInTheDocument();
  });

  it('shows the waiting block with the elapsed time while a job is running', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'running', error: null, elapsedMs: 84000, hasNovel: false, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('1:24 経過 ・ 目安 2〜5分')).toBeInTheDocument();
    expect(
      screen.getByText('長い記録ほど時間がかかります。このまま他の画面に移っても生成は続きます。')
    ).toBeInTheDocument();
  });

  it('advances the elapsed time every second between polls', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'running', error: null, elapsedMs: 84000, hasNovel: false, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('1:24 経過 ・ 目安 2〜5分')).toBeInTheDocument();

      // ポーリング(5秒)を待たずに数字が進むこと。止まって見えないための肝。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.getByText('1:26 経過 ・ 目安 2〜5分')).toBeInTheDocument();
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('stops the one-second interval once no job is running', async () => {
    const listSpy = vi.spyOn(sessionSyncClient, 'listNovelJobs');
    listSpy.mockResolvedValueOnce({
      s1: { status: 'running', error: null, elapsedMs: 1000, hasNovel: false, stale: false },
    });
    listSpy.mockResolvedValueOnce({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.queryByText(/経過/)).not.toBeInTheDocument();
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('re-polls via the scheduled 5s timer and reflects a running → done transition without user action', async () => {
    const listSpy = vi.spyOn(sessionSyncClient, 'listNovelJobs');
    listSpy.mockResolvedValueOnce({ s1: { status: 'running', error: null, hasNovel: false, stale: false } });
    listSpy.mockResolvedValueOnce({ s1: { status: 'done', error: null, hasNovel: true, stale: false } });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      // マウント時の初回取得(実タイマーではないPromiseチェーン)を流す。
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('小説化中…')).toBeInTheDocument();
      expect(listSpy).toHaveBeenCalledTimes(1);

      // 5秒後にスケジュールされた再ポーリング(setTimeout経由)を進める。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(listSpy).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('小説化中…')).not.toBeInTheDocument();
      expect(screen.getByText('小説を再生成')).toBeInTheDocument();
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('keeps retrying on the 5s timer after a poll rejects while a job is running (regression: a single failed poll must not leave 小説化中… stuck forever)', async () => {
    const listSpy = vi.spyOn(sessionSyncClient, 'listNovelJobs');
    listSpy.mockResolvedValueOnce({ s1: { status: 'running', error: null, hasNovel: false, stale: false } });
    listSpy.mockRejectedValueOnce(new Error('network blip'));
    listSpy.mockResolvedValueOnce({ s1: { status: 'done', error: null, hasNovel: true, stale: false } });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('小説化中…')).toBeInTheDocument();

      // 1回目の再ポーリングが通信断で失敗する。旧実装ではここでポーリングの
      // 再帰チェーンが完全に止まり、「小説化中…」のまま固まっていた。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(listSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByText('小説化中…')).toBeInTheDocument(); // まだ固まっていない(エラー表示にもならない)

      // 失敗後もさらに5秒後に自動で再試行され、doneへ到達する。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(listSpy).toHaveBeenCalledTimes(3);
      expect(screen.getByText('小説を再生成')).toBeInTheDocument();
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('does not show the completion block for novels that were already done on first load', async () => {
    // 過去に生成済みの全セッションに「できました」が並ばないこと。
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説をDL')).toBeInTheDocument();
    expect(screen.queryByText('小説ができました')).not.toBeInTheDocument();
  });

  it('announces an unread completion on mount and marks it seen', async () => {
    const seenSpy = vi.spyOn(sessionSyncClient, 'markNovelSeen').mockResolvedValue({ ok: true });
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false, unread: true },
    });
    const sessions = [{ id: 's1', title: '黄昏の塔の契約', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説ができました')).toBeInTheDocument();
    expect(screen.getByText('「黄昏の塔の契約」の小説ができました')).toBeInTheDocument();
    await waitFor(() => expect(seenSpy).toHaveBeenCalledWith('s1'));
  });

  it('does not announce a completion that is already read', async () => {
    const seenSpy = vi.spyOn(sessionSyncClient, 'markNovelSeen').mockResolvedValue({ ok: true });
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false, unread: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説をDL')).toBeInTheDocument();
    expect(screen.queryByText('小説ができました')).not.toBeInTheDocument();
    expect(seenSpy).not.toHaveBeenCalled();
  });

  it('does not announce an unread completion for a session unknown to this client (a second device)', async () => {
    // /novel-jobsはアカウント全体のセッションを返すが、sessionsはローカル(IndexedDB)
    // 由来でこのクライアントが把握している範囲でしかない。別端末で小説化した直後に
    // この端末を開くと、該当セッションがsessionsに無いままunread:trueだけが届く。
    // ここで通知してしまうとタイトルが解決できず空欄のトーストが出るうえ、
    // markNovelSeenでフラグを消費し、本来の端末が通知を受け取れなくなる(finding 1)。
    const seenSpy = vi.spyOn(sessionSyncClient, 'markNovelSeen').mockResolvedValue({ ok: true });
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      other_device_session: { status: 'done', error: null, hasNovel: true, stale: false, unread: true },
    });
    const sessions = [{ id: 's1', title: 'このクライアントのセッション', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説化する')).toBeInTheDocument();
    expect(screen.queryByText(/の小説ができました/)).not.toBeInTheDocument();
    expect(seenSpy).not.toHaveBeenCalled();
  });

  it('does not announce a stale unread flag on a job that is still running', async () => {
    // 既読化POSTが往路の最中に再生成が始まった場合、サーバーは古いunread:trueを
    // running中に返すことがある(finding 1)。running中は完了扱いしてはならない。
    const seenSpy = vi.spyOn(sessionSyncClient, 'markNovelSeen').mockResolvedValue({ ok: true });
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'running', error: null, elapsedMs: 1000, hasNovel: true, stale: false, unread: true },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説を執筆しています')).toBeInTheDocument();
    expect(screen.queryByText('小説ができました')).not.toBeInTheDocument();
    expect(seenSpy).not.toHaveBeenCalled();
  });

  it('announces an unread completion only once even if a later poll still reports it unread', async () => {
    // 既読化POSTがサーバーに届く前に次のポーリングが返る競合。s1がrunningなので
    // ポーリングが継続し、s2のunreadが2回観測される。
    // POSTを意図的に解決させないことで、2回目のポーリングが本当に往路の最中に
    // 到着する状況を作る(resolvedValueだとthen内の処理が5秒tickのはるか前に
    // 終わってしまい、この競合を再現できない)。
    const seenSpy = vi.spyOn(sessionSyncClient, 'markNovelSeen').mockImplementation(() => new Promise(() => {}));
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'running', error: null, elapsedMs: 1000, hasNovel: false, stale: false, unread: false },
      s2: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false, unread: true },
    });
    const sessions = [
      { id: 's1', title: 'A', updatedAt: 2, state: {}, log: [] },
      { id: 's2', title: 'B', updatedAt: 1, state: {}, log: [] },
    ];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.getAllByText('「B」の小説ができました')).toHaveLength(1);
      expect(seenSpy).toHaveBeenCalledTimes(1);
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('announces a re-generated novel again once the server confirms the earlier acknowledgement was read', async () => {
    // announcedRef はマウント全体の抑止ではなく、サーバーが unread を降ろす
    // (=既読化が届いた)までの一時的な抑止でしかない。再生成でunreadが
    // 再びtrueになったら、もう一度通知されなければならない(finding 1の回帰防止)。
    const seenSpy = vi.spyOn(sessionSyncClient, 'markNovelSeen').mockResolvedValue({ ok: true });
    const novelizeSpy = vi.spyOn(sessionSyncClient, 'novelizeSession').mockResolvedValue({ status: 'running' });
    const listSpy = vi.spyOn(sessionSyncClient, 'listNovelJobs');
    listSpy.mockResolvedValueOnce({
      s1: { status: 'done', error: null, hasNovel: true, stale: false, unread: true },
    });
    // 既読化が反映され、サーバーはもうunreadを立てていない(このポーリングで抑止が解ける)。
    listSpy.mockResolvedValueOnce({
      s1: { status: 'running', error: null, hasNovel: true, stale: false, unread: false },
    });
    // 再生成が完了し、サーバーが再びunreadを立てた。
    listSpy.mockResolvedValueOnce({
      s1: { status: 'done', error: null, hasNovel: true, stale: false, unread: true },
    });
    const sessions = [{ id: 's1', title: '黄昏の塔の契約', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getAllByText('「黄昏の塔の契約」の小説ができました')).toHaveLength(1);
      expect(seenSpy).toHaveBeenCalledTimes(1);

      // 再生成を押す: 楽観的更新→novelizeSession→ポーリング再始動(2回目のlistNovelJobs)。
      await act(async () => {
        fireEvent.click(screen.getByText('小説を再生成'));
        for (let i = 0; i < 5; i++) await Promise.resolve();
      });
      expect(novelizeSpy).toHaveBeenCalledWith('s1');
      expect(listSpy).toHaveBeenCalledTimes(2);

      // 実行中なので5秒後に自動で再ポーリングされ、3回目のlistNovelJobsが完了を返す。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(listSpy).toHaveBeenCalledTimes(3);

      expect(screen.getAllByText('「黄昏の塔の契約」の小説ができました')).toHaveLength(2);
      expect(seenSpy).toHaveBeenCalledTimes(2);
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('keeps the notification visible when marking it seen fails', async () => {
    // 既読化に失敗してもユーザーには何も見せない(対処できることではない)。
    // サーバーのフラグが残るので次にHomeを開いたときに再通知される。
    vi.spyOn(sessionSyncClient, 'markNovelSeen').mockRejectedValue(new Error('offline'));
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false, unread: true },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説ができました')).toBeInTheDocument();
    expect(screen.queryByText(/失敗/)).not.toBeInTheDocument();
  });

  it('shows a toast but no completion block on a running → error transition', async () => {
    const listSpy = vi.spyOn(sessionSyncClient, 'listNovelJobs');
    listSpy.mockResolvedValueOnce({
      s1: { status: 'running', error: null, elapsedMs: 1000, hasNovel: false, stale: false },
    });
    listSpy.mockResolvedValue({
      s1: { status: 'error', error: '時間内に完了しませんでした。', elapsedMs: null, hasNovel: false, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.getByText('「A」の小説化に失敗しました')).toBeInTheDocument();
      expect(screen.queryByText('小説ができました')).not.toBeInTheDocument();
      // 正規表現で引くと祖先要素にも一致して「複数見つかった」で落ちるため、完全一致で引く。
      expect(screen.getByText('小説化に失敗した: 時間内に完了しませんでした。')).toBeInTheDocument();
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('clears the completion block and toast on logout (the DL button DONE_NOTE points to unmounts along with the job)', async () => {
    vi.spyOn(sessionSyncClient, 'markNovelSeen').mockResolvedValue({ ok: true });
    const listSpy = vi.spyOn(sessionSyncClient, 'listNovelJobs');
    listSpy.mockResolvedValueOnce({
      s1: { status: 'running', error: null, elapsedMs: 1000, hasNovel: false, stale: false },
    });
    listSpy.mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false, unread: true },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.getByText('小説ができました')).toBeInTheDocument();
      expect(screen.getByText('「A」の小説ができました')).toBeInTheDocument();

      await act(async () => {
        rerenderWithAuth(
          view.rerender,
          <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />,
          null
        );
        await Promise.resolve();
      });

      // ログアウトでDLボタンごと消えるので、完了ブロックとトーストも残してはいけない。
      expect(screen.queryByText('小説ができました')).not.toBeInTheDocument();
      expect(screen.queryByText('「A」の小説ができました')).not.toBeInTheDocument();
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('clears the completion block once the novel is downloaded', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({ text: '本文' });
    vi.spyOn(sessionSyncClient, 'markNovelSeen').mockResolvedValue({ ok: true });
    const listSpy = vi.spyOn(sessionSyncClient, 'listNovelJobs');
    listSpy.mockResolvedValueOnce({
      s1: { status: 'running', error: null, elapsedMs: 1000, hasNovel: false, stale: false },
    });
    listSpy.mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false, unread: true },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.getByText('小説ができました')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByText('小説をDL'));
        await Promise.resolve();
      });

      expect(screen.queryByText('小説ができました')).not.toBeInTheDocument();
    } finally {
      view?.unmount();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('offers download buttons when the server reports a finished novel', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, hasNovel: true, stale: false },
    });
    const sessions = [
      { id: 's1', title: 'A', updatedAt: 1, state: {}, log: [{ role: 'gm', text: 'g', image: { imageId: 'img_a' } }] },
    ];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説をDL')).toBeInTheDocument();
    expect(screen.getByText('挿絵付きでDL')).toBeInTheDocument();
    expect(screen.getByText('小説を再生成')).toBeInTheDocument();
  });

  it('hides the illustrated download until a novel exists', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'idle', error: null, hasNovel: false, stale: false },
    });
    const sessions = [
      { id: 's1', title: 'A', updatedAt: 1, state: {}, log: [{ role: 'gm', text: 'g', image: { imageId: 'img_a' } }] },
    ];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説化する')).toBeInTheDocument();
    expect(screen.queryByText('挿絵付きでDL')).not.toBeInTheDocument();
  });

  it('shows the failure message and a retry button when the job errored', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'error', error: 'サーバーの再起動により中断されました。', hasNovel: false, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText(/サーバーの再起動により中断されました。/)).toBeInTheDocument();
    expect(screen.getByText('小説化を再試行')).toBeInTheDocument();
  });

  it('warns that a finished novel may be out of date when the job reports stale', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, hasNovel: true, stale: true },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText(/最新のログを反映していない可能性があります/)).toBeInTheDocument();
  });

  it('marks the session as running immediately after 小説化する is pressed, without downloading', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({});
    const novelizeSpy = vi.spyOn(sessionSyncClient, 'novelizeSession').mockResolvedValue({ status: 'running' });
    const getNovelSpy = vi.spyOn(sessionSyncClient, 'getNovel');
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    const onContinue = vi.fn();
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={onContinue} onOpenLibrary={vi.fn()} />);

    fireEvent.click(await screen.findByText('小説化する'));

    await waitFor(() => expect(novelizeSpy).toHaveBeenCalledWith('s1'));
    expect(await screen.findByText('小説化中…')).toBeInTheDocument();
    expect(getNovelSpy).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled(); // カードへ潜り込まない
  });

  it('downloads the novel when 小説をDL is pressed', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, hasNovel: true, stale: false },
    });
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({ text: '小説本文', stale: false });
    const createObjectURLSpy = vi.fn().mockReturnValue('blob:mock-url');
    vi.stubGlobal('URL', { ...URL, createObjectURL: createObjectURLSpy, revokeObjectURL: vi.fn() });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    fireEvent.click(await screen.findByText('小説をDL'));

    await waitFor(() => expect(sessionSyncClient.getNovel).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(createObjectURLSpy).toHaveBeenCalled());
  });

  it('marks the session as ended when the campaign advances to the next chapter', async () => {
    vi.spyOn(sessionApi, 'advanceCampaignPc').mockResolvedValue({ pcRaw: '更新シート', xp: 7 });
    vi.spyOn(campaignClient, 'getCampaign').mockResolvedValue(null);
    vi.spyOn(campaignClient, 'putCampaign').mockResolvedValue({});
    vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([]);
    vi.spyOn(sessionSyncClient, 'putSessionToServer').mockResolvedValue({});
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, worldId: 'w1', state: {}, log: [] }];
    renderWithAuth(
      <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} onNextChapter={vi.fn()} />
    );

    fireEvent.click(await screen.findByText('次の章へ'));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    expect(typeof saveSpy.mock.calls.at(-1)[0].endedAt).toBe('number');
  });

  it('navigates to the ending gallery', async () => {
    renderWithAuth(<Home sessions={[]} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} onOpenGallery={vi.fn()} />);
    fireEvent.click(screen.getByText('エンディング図鑑'));
    expect(window.location.hash).toBe('#/endings');
    window.location.hash = '';
  });

  it('shows the recorded ending title on a finished session', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([{ sessionId: 's1', endingTitle: '灰は星を数えない' }]);
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, endedAt: 500, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(await screen.findByText(/灰は星を数えない/)).toBeInTheDocument();
    expect(screen.queryByText('エンディングを記録する')).not.toBeInTheDocument();
  });

  it('offers to record an ending for a finished session that has none', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    const recordSpy = vi.spyOn(endingClient, 'recordEnding').mockResolvedValue({ sessionId: 's1', endingTitle: '後から付けた題' });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, endedAt: 500, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    fireEvent.click(await screen.findByText('エンディングを記録する'));

    await waitFor(() => expect(recordSpy).toHaveBeenCalledWith('s1', expect.objectContaining({ total: 0 })));
    expect(await screen.findByText(/後から付けた題/)).toBeInTheDocument();
  });

  it('does not offer to record an ending for a session still in progress', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    await screen.findByText('小説化する');
    expect(screen.queryByText('エンディングを記録する')).not.toBeInTheDocument();
  });

  it('does not show 記録する for an ended session while listEndings is still pending (would burn an AI credit re-naming an already-recorded ending)', async () => {
    // listEndingsが解決するまでendingMapは空なので、ガード無しでは既に記録済みの
    // セッションにも「エンディングを記録する」が一瞬出てしまう。この間にクリックされると
    // AI命名が再実行され、改名済みのタイトルを上書きし利用枠を1消費してしまう(finding 1)。
    let resolveList;
    vi.spyOn(endingClient, 'listEndings').mockReturnValue(
      new Promise((res) => {
        resolveList = res;
      })
    );
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, endedAt: 500, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    // 取得が終わるまでは「完結」バッジは出ていても記録ボタンは出さない。
    await screen.findByText('完結');
    expect(screen.queryByText('エンディングを記録する')).not.toBeInTheDocument();

    await act(async () => {
      resolveList([]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText('エンディングを記録する')).toBeInTheDocument();
  });
});

describe('collectJobEvents', () => {
  const titleOf = (id) => ({ s1: 'A', s2: 'B' })[id] ?? '';

  it('reports an error transition', () => {
    const prev = { s1: { status: 'running' } };
    const next = { s1: { status: 'error', error: 'boom' } };
    expect(collectJobEvents(prev, next, titleOf)).toEqual([{ id: 's1', kind: 'error', title: 'A' }]);
  });

  it('no longer reports done transitions (completion is driven by the server unread flag)', () => {
    // 遷移とunreadの両方が反応すると同じ完了で二重に通知が出るため、
    // 完了はunreadに一本化した。
    const prev = { s1: { status: 'running' } };
    const next = { s1: { status: 'done' } };
    expect(collectJobEvents(prev, next, titleOf)).toEqual([]);
  });

  it('ignores a job that was not running before', () => {
    expect(collectJobEvents({}, { s1: { status: 'error' } }, titleOf)).toEqual([]);
  });

  it('ignores a job that is still running', () => {
    expect(collectJobEvents({ s1: { status: 'running' } }, { s1: { status: 'running' } }, titleOf)).toEqual([]);
  });

  it('reports an error transition for each of multiple sessions finishing in one poll', () => {
    const prev = { s1: { status: 'running' }, s2: { status: 'running' } };
    const next = { s1: { status: 'error', error: 'boom' }, s2: { status: 'error', error: 'bang' } };
    expect(collectJobEvents(prev, next, titleOf)).toEqual([
      { id: 's1', kind: 'error', title: 'A' },
      { id: 's2', kind: 'error', title: 'B' },
    ]);
  });
});

describe('collectUnreadIds', () => {
  const known = new Set(['s1', 's2']);

  it('returns ids whose job is flagged unread', () => {
    const jobs = { s1: { status: 'done', unread: true }, s2: { status: 'done', unread: false } };
    expect(collectUnreadIds(jobs, new Set(), known)).toEqual(['s1']);
  });

  it('skips ids already announced in this mount', () => {
    // 既読化POSTの往復中に次のポーリングが返っても二重に通知しないための抑止。
    const jobs = { s1: { status: 'done', unread: true } };
    expect(collectUnreadIds(jobs, new Set(['s1']), known)).toEqual([]);
  });

  it('returns an empty array when nothing is unread', () => {
    expect(collectUnreadIds({ s1: { status: 'running' } }, new Set(), known)).toEqual([]);
  });

  it('returns every unread id at once', () => {
    const jobs = { s1: { status: 'done', unread: true }, s2: { status: 'done', unread: true } };
    expect(collectUnreadIds(jobs, new Set(), known)).toEqual(['s1', 's2']);
  });

  it('ignores a stale unread flag on a job that is still running', () => {
    // 既読化POSTが遅延している間に再生成が始まると、サーバーから
    // running中にunread:trueが返ることがある(finding 1)。doneでなければ無視する。
    const jobs = { s1: { status: 'running', unread: true } };
    expect(collectUnreadIds(jobs, new Set(), known)).toEqual([]);
  });

  it('skips an unread id that is not in the known-id set', () => {
    // /novel-jobsはアカウント全体を返すが、sessions(IndexedDB由来)はこの端末が
    // 把握している範囲でしかない。他端末で生成された未読をここで拾うと、
    // タイトルが解決できず空欄の通知が出るうえ、既読化POSTがそのフラグを
    // 消費してしまい、本来の端末が二度と通知を受け取れなくなる(finding 1)。
    const jobs = { other: { status: 'done', unread: true } };
    expect(collectUnreadIds(jobs, new Set(), known)).toEqual([]);
  });
});
