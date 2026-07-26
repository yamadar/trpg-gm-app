import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import Play from './Play.jsx';
import * as sessionSyncClient from '../api/sessionSyncClient.js';
import * as storage from '../storage/index.js';
import * as sceneImageClient from '../api/sceneImageClient.js';
import * as endingClient from '../api/endingClient.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';
import { FOCUS_HEADER_HEIGHT } from '../components/nav/FocusHeader.jsx';

// 既定 imageGen:false。getConfig をモックすることで、既存テストで挿絵UIが描画されず、
// かつ getConfig が global.fetch を呼ばないため既存の fetch 呼び出し回数アサーションが不変。
vi.mock('../api/sceneImageClient.js', () => ({
  getConfig: vi.fn().mockResolvedValue({ imageGen: false }),
  generateSceneImage: vi.fn(),
  sceneImageUrl: (sessionId, imageId) => `/api/sessions/${sessionId}/images/${imageId}`,
}));

function makeSession(overrides = {}) {
  return {
    id: 's1',
    title: 'テストセッション',
    world: { raw: '', summary: '' },
    scenario: { raw: '' },
    rulesetId: 'simple',
    pc: { raw: '' },
    state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], turn_count: 0 },
    log: [],
    updatedAt: 0,
    ...overrides,
  };
}

// Playはsessionをpropで受け取るcontrolled componentなので、setSessionをモック関数の
// ままにするとPlayが更新後のsessionを再描画できない。App.jsxと同様に親側でstateを
// 持つ小さなハーネスを用意し、実際の再レンダリングを再現する。
function Harness({ initialSession }) {
  const [session, setSession] = useState(initialSession);
  return <Play session={session} setSession={setSession} />;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              narrative: '物語が始まった。',
              state_update: { xp_gained: 5 },
              choices: ['進む'],
            }),
          },
        ],
      }),
    })
  );
  // sessionSyncClient.putSessionToServer also calls the global fetch mock above; stub it
  // out by default so it doesn't inflate fetch-call-count assertions in unrelated tests.
  // The dedicated sync test below overrides this with its own mockRejectedValue.
  vi.spyOn(sessionSyncClient, 'putSessionToServer').mockResolvedValue({});
  // 挿絵クライアントのモックはテスト間で呼び出し履歴が残るため毎回リセットし、既定を復元する。
  sceneImageClient.getConfig.mockReset().mockResolvedValue({ imageGen: false });
  sceneImageClient.generateSceneImage.mockReset();
});

describe('Play', () => {
  it('requests an opening scene when the log is empty and renders the narrative', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('進む')).toBeInTheDocument();
  });

  it('does not request an opening scene when the log already has entries', async () => {
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} />);
    expect(screen.getByText('既存のログ')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fires the opening turn exactly once under React.StrictMode double-invocation', async () => {
    renderWithAuth(
      <React.StrictMode>
        <Harness initialSession={makeSession()} />
      </React.StrictMode>
    );
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('accumulates xp_gained into session.state.xp and displays it with the growthUnit label', async () => {
    const session = makeSession({ ruleset: { id: 'gurps', label: 'GURPS風', desc: '', hint: '', growthUnit: 'CP' } });
    renderWithAuth(<Harness initialSession={session} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('CP: 5')).toBeInTheDocument();
  });

  it('defaults the growth label to "経験値" when session.ruleset is absent', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('経験値: 5')).toBeInTheDocument();
  });

  it('syncs the updated session to the server after a turn, without blocking on failure', async () => {
    const putSpy = vi.spyOn(sessionSyncClient, 'putSessionToServer').mockRejectedValue(new Error('offline'));
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    // 同期失敗してもUIはエラー表示しない(ゲーム進行は止めない)
    expect(screen.queryByText(/GM応答の取得に失敗した/)).not.toBeInTheDocument();
  });

  it('does not corrupt state.xp when the model returns a string xp_gained', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ narrative: '進行', state_update: { xp_gained: '5' }, choices: [] }),
          },
        ],
      }),
    });
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('進行')).toBeInTheDocument());
    // "05"のような文字列連結ではなく数値の5であること
    expect(screen.getByText('経験値: 5')).toBeInTheDocument();
  });

  it('keeps the previous scene when the model returns an invalid current_scene', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ narrative: '進行', state_update: { current_scene: '' }, choices: [] }),
          },
        ],
      }),
    });
    renderWithAuth(<Harness initialSession={makeSession({ state: { current_scene: '元のシーン', flags: {}, history_summary: '', recent_log: [], turn_count: 0, xp: 0 } })} />);
    await waitFor(() => expect(screen.getByText('進行')).toBeInTheDocument());
    expect(screen.getByText('シーン: 元のシーン')).toBeInTheDocument();
  });

  it('shows a save warning when saveSession fails but keeps playing', async () => {
    // spyOnは既定で元実装を呼ぶが、mockResolvedValueOnceで開始ターンの1回だけfalseを返させ、
    // 以降は元実装に戻るため後続テストへ副作用が漏れない(このテストファイルにafterEachのリセットは無い)。
    vi.spyOn(storage, 'saveSession').mockResolvedValueOnce(false);
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText(/セッションの保存に失敗した/)).toBeInTheDocument());
  });

  it('logs the player utterance and fetches a new GM turn when free input is submitted', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    // 開始ターンのsaveSession完了までbusy=trueのため、入力が有効化される(busy解除)まで待つ
    await waitFor(() =>
      expect(screen.getByPlaceholderText('PCの行動を自由に書く…')).not.toBeDisabled()
    );
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '森へ進む' } });
    fireEvent.click(screen.getByText('送る'));
    await waitFor(() => expect(screen.getByText('森へ進む')).toBeInTheDocument());
    // 開始ターン + 送信ターンで計2回
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // 送信時に入力欄はクリアされる
    expect(box.value).toBe('');
  });

  it('advances a turn when a choice button is clicked', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByPlaceholderText('PCの行動を自由に書く…')).not.toBeDisabled()
    );
    fireEvent.click(screen.getByText('進む')); // GM応答の選択肢ボタン
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('submits on Enter when IME composition is not active', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    // 開始ターンのsaveSession完了までbusy=trueのため、入力が有効化される(busy解除)まで待つ
    await waitFor(() =>
      expect(screen.getByPlaceholderText('PCの行動を自由に書く…')).not.toBeDisabled()
    );
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '扉を開ける' } });
    fireEvent.keyDown(box, { key: 'Enter' }); // isComposing未指定=false相当
    await waitFor(() => expect(screen.getByText('扉を開ける')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not submit on Enter while IME composition is active', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    // 開始ターンのsaveSession完了までbusy=trueのため、入力が有効化される(busy解除)まで待つ
    await waitFor(() =>
      expect(screen.getByPlaceholderText('PCの行動を自由に書く…')).not.toBeDisabled()
    );
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '変換中' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true }); // IME変換確定のEnter
    // 送信されない: fetchは開始ターンの1回のまま、入力は保持
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(box.value).toBe('変換中');
  });

  it('shows an error and restores the submitted input when the model returns unparseable output', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    // 次のターンだけJSONを含まないテキストを返す(parseJsonLooseが投げる)
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'ここにJSONは無い' }] }),
    });
    // 開始ターンのsaveSession完了までbusy=trueのため、入力が有効化される(busy解除)まで待つ
    await waitFor(() =>
      expect(screen.getByPlaceholderText('PCの行動を自由に書く…')).not.toBeDisabled()
    );
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '罠を調べる' } });
    fireEvent.click(screen.getByText('送る'));
    await waitFor(() => expect(screen.getByText(/GM応答の取得に失敗した/)).toBeInTheDocument());
    // busy解除後、送信した入力が入力欄へ復元される
    expect(box.value).toBe('罠を調べる');
  });

  it('persists the session via saveSession after a turn (regression pin)', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession'); // 既定は本実装を呼ぶ(fake-indexeddb)
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
  });

  it('GM応答のtension_levelをsession.stateへ保存する', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ narrative: '進行', state_update: { tension_level: 'high' }, choices: [] }),
          },
        ],
      }),
    });
    const saveSpy = vi.spyOn(storage, 'saveSession');
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('進行')).toBeInTheDocument());
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const saved = saveSpy.mock.calls.at(-1)[0];
    expect(saved.state.tension_level).toBe('high');
  });

  it('再開時の既存ログのロールは演出無しで即時表示される(判定中「…」を出さない)', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }); // motion許可環境でも
    const session = makeSession({
      log: [
        {
          role: 'gm',
          text: '既存のログ',
          roll: { check_label: '探索', roll: 30, success_percent: 60, success: true, degree: 'success' },
        },
      ],
    });
    renderWithAuth(<Play session={session} setSession={vi.fn()} />);
    expect(screen.getByText('成功')).toBeInTheDocument();
    delete window.matchMedia;
  });

  it('motion許可環境では地の文がタイプ表示され、完了後にchoicesが表示される', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }); // motion許可
    try {
      renderWithAuth(<Harness initialSession={makeSession()} />);
      // タイプ完了後に全文とchoicesが表示される(リアルタイマーで進行を待つ)
      await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument(), { timeout: 3000 });
      await waitFor(() => expect(screen.getByText('進む')).toBeInTheDocument(), { timeout: 3000 });
    } finally {
      delete window.matchMedia;
    }
  });

  it('session.moodsに応じてPlay画面の背景色が変わる(無ければ既定と同じにならない)', () => {
    const horror = renderWithAuth(
      <Play
        session={makeSession({ moods: ['ホラー'], log: [{ role: 'gm', text: '既存のログ' }] })}
        setSession={vi.fn()}
      />
    );
    // 先頭は集中モードのFocusHeader(全幅・COLORS.card固定)なので、
    // ムードで色が変わるのはその次の本文カラム。
    const moodColumn = (r) => r.container.firstChild.nextSibling;
    const horrorBg = moodColumn(horror).style.background;
    expect(horrorBg).toBeTruthy();
    const plain = renderWithAuth(
      <Play
        session={makeSession({ log: [{ role: 'gm', text: '別のログ' }] })}
        setSession={vi.fn()}
      />
    );
    expect(horrorBg).not.toBe(moodColumn(plain).style.background);
  });

  it('imageGenが有効なら未生成GMエントリに「この場面を描く」ボタンを出す', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
  });

  it('imageGenが無効なら挿絵ボタンを出さない', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: false });
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} />);
    await waitFor(() => expect(sceneImageClient.getConfig).toHaveBeenCalled());
    expect(screen.queryByText('この場面を描く')).not.toBeInTheDocument();
  });

  it('ボタン押下で画像を生成し、entry.imageとして表示する', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    sceneImageClient.generateSceneImage.mockResolvedValueOnce({ imageId: 'img_1', newAppearances: [] });
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Harness initialSession={session} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
    fireEvent.click(screen.getByText('この場面を描く'));
    await waitFor(() => {
      expect(document.querySelector('img[src*="img_1"]')).toBeTruthy();
    });
  });

  it('既にimageを持つエントリは画像を表示しボタンを出さない', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: 'ログ', image: { imageId: 'img_9' } }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('img[src*="img_9"]')).toBeTruthy());
    expect(screen.queryByText('この場面を描く')).not.toBeInTheDocument();
  });

  it('生成失敗時はエラーを表示しimageIdを保存しない', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    sceneImageClient.generateSceneImage.mockRejectedValueOnce(new Error('boom'));
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: 'ログ' }] });
    renderWithAuth(<Harness initialSession={session} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
    fireEvent.click(screen.getByText('この場面を描く'));
    await waitFor(() => expect(screen.getByText(/挿絵の生成に失敗/)).toBeInTheDocument());
    expect(document.querySelector('img')).toBeFalsy();
  });

  it('autoIllustrate ON かつシーン変化ターンで新GMエントリの生成を自動発火する', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    sceneImageClient.generateSceneImage.mockResolvedValue({ imageId: 'img_a', newAppearances: [] });
    const session = makeSession({ id: 's1', autoIllustrate: true, log: [{ role: 'gm', text: '最初の場面' }] });
    renderWithAuth(<Harness initialSession={session} />);
    await waitFor(() => expect(sceneImageClient.getConfig).toHaveBeenCalled());
    // 送信ターンのGM応答: シーンを「冒頭」から「森」へ変える
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ narrative: '森へ入った', state_update: { current_scene: '森' }, choices: [] }) }],
      }),
    });
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '森へ' } });
    fireEvent.click(screen.getByText('送る'));
    await waitFor(() => expect(screen.getByText('森へ入った')).toBeInTheDocument());
    await waitFor(() => expect(sceneImageClient.generateSceneImage).toHaveBeenCalledWith('s1', expect.any(Number)));
  });

  it('自動トグルの切り替えをsessionへ保存する', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    const saveSpy = vi.spyOn(storage, 'saveSession');
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: 'ログ' }] });
    renderWithAuth(<Harness initialSession={session} />);
    await waitFor(() => expect(screen.getByLabelText('挿絵を自動生成')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('挿絵を自動生成'));
    await waitFor(() => {
      const lastCall = saveSpy.mock.calls.at(-1);
      expect(lastCall?.[0]?.autoIllustrate).toBe(true);
    });
  });

  it('生成結果のnewAppearancesのimageIdをレジストリへ保持して保存する', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    sceneImageClient.generateSceneImage.mockResolvedValueOnce({
      imageId: 'img_1',
      newAppearances: [{ name: '村長', description: '白髪の老人', imageId: 'img_port1' }],
    });
    const saveSpy = vi.spyOn(storage, 'saveSession');
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: 'ログ' }] });
    renderWithAuth(<Harness initialSession={session} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
    fireEvent.click(screen.getByText('この場面を描く'));
    await waitFor(() => {
      const saved = saveSpy.mock.calls.at(-1)?.[0];
      expect(saved?.appearances?.['村長']).toEqual({ name: '村長', description: '白髪の老人', imageId: 'img_port1' });
    });
  });

  it('挿絵生成中にターンが進んでも、画像適用でターンを巻き戻さない', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    let resolveImg;
    sceneImageClient.generateSceneImage.mockReturnValueOnce(
      new Promise((res) => {
        resolveImg = res;
      })
    );
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: '最初の場面' }] });
    renderWithAuth(<Harness initialSession={session} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
    // 挿絵生成を開始(未解決のまま保留)
    fireEvent.click(screen.getByText('この場面を描く'));
    // 生成中にターンを進める(新しいGMエントリを追加)
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ narrative: '新しい場面', state_update: {}, choices: [] }) }],
      }),
    });
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '前進' } });
    fireEvent.click(screen.getByText('送る'));
    await waitFor(() => expect(screen.getByText('新しい場面')).toBeInTheDocument());
    // 画像生成を完了させる
    await act(async () => {
      resolveImg({ imageId: 'img_1', newAppearances: [] });
    });
    // 進んだターン(新しい場面)が残り、かつ最初の場面に画像が付く
    await waitFor(() => expect(document.querySelector('img[src*="img_1"]')).toBeTruthy());
    expect(screen.getByText('新しい場面')).toBeInTheDocument();
  });

  it('非ドッキング時は「PC」トグルでパネルの開閉ができる', async () => {
    const session = makeSession({ pc: { raw: 'PC名: テスト猟師' }, log: [{ role: 'gm', text: 'ログ' }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} />);
    // 既定(matchMedia無し=非ドッキング)はパネル非表示
    expect(screen.queryByText('PC名: テスト猟師')).not.toBeInTheDocument();
    // 「PC」トグルで開く
    fireEvent.click(screen.getByText('PC'));
    expect(screen.getByText('PC名: テスト猟師')).toBeInTheDocument();
    // 閉じるボタンで閉じる
    fireEvent.click(screen.getByLabelText('パネルを閉じる'));
    expect(screen.queryByText('PC名: テスト猟師')).not.toBeInTheDocument();
  });

  it('refuses to run a turn when logged out', async () => {
    // logが空だと初回自動ターンが走ってしまうため、既存ログを持つセッションを使う
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Harness initialSession={session} />, { user: null });
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '森へ進む' } });
    fireEvent.click(screen.getByText('送る'));
    await waitFor(() =>
      expect(screen.getByText('プレイの進行にはログインが必要です。右上からログインしてください。')).toBeInTheDocument()
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('focus header and context bar', () => {
  it('shows the session title exactly once', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getAllByText('テストセッション').length).toBeGreaterThan(0));
    expect(screen.getAllByText('テストセッション')).toHaveLength(1);
  });

  it('falls back to "プレイ中" when the session has no title', async () => {
    renderWithAuth(<Harness initialSession={makeSession({ title: '' })} />);
    expect(await screen.findByText('プレイ中')).toBeInTheDocument();
  });

  it('keeps the context bar pinned directly beneath the focus header', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} />);
    const scene = await screen.findByText(/^シーン:/);
    const bar = scene.closest('div[style*="sticky"]');
    expect(bar).not.toBeNull();
    expect(bar.style.top).toBe(`${FOCUS_HEADER_HEIGHT}px`);
  });

  it('renders the focus header full-bleed, outside the centred content column', async () => {
    // 集中モードのヘッダーは Setup とも回遊モードのシェルヘッダーとも同じく全幅。
    // 本文カラムの中に入れるとこの画面だけ帯が途中で途切れ、
    // 「画面ごとに上部が変わる」という元の不満に逆戻りする。
    const { container } = renderWithAuth(<Harness initialSession={makeSession()} />);
    const header = await screen.findByText('テストセッション');
    const headerBar = header.closest('div[style*="sticky"]');
    expect(headerBar).toBe(container.firstChild);
    expect(headerBar.style.maxWidth).toBe('');
    // 本文カラムだけが 720px に絞られる。
    expect(container.firstChild.nextSibling.style.maxWidth).toBe('720px');
  });
});

describe('resource side effects', () => {
  it('saves the reduced SAN into state.resources after a sanity check', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'tool_use',
              id: 'tool_1',
              name: 'roll_check',
              input: { check_label: '正気度チェック', success_percent: 50, check_kind: 'sanity' },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ narrative: '恐怖に震えた。', state_update: {}, choices: [] }),
            },
          ],
        }),
      });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.79); // roll=80 fail -> 1d6=2 -> -2
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);

    const session = makeSession({
      ruleset: { id: 'coc7e', label: 'CoC7e風', formula: 'coc7e', growthUnit: '経験値' },
      state: {
        current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], turn_count: 0,
        resources: { san: { value: 60, max: 99 } },
      },
    });
    renderWithAuth(<Harness initialSession={session} />);
    await waitFor(() => expect(screen.getByText('恐怖に震えた。')).toBeInTheDocument());

    const saved = saveSpy.mock.calls.at(-1)[0];
    expect(saved.state.resources.san).toEqual({ value: 58, max: 99 });
    randomSpy.mockRestore();
  });

  it('does not add a resources key for sessions without resources', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    const saved = saveSpy.mock.calls.at(-1)[0];
    expect('resources' in saved.state).toBe(false);
  });

  it('exits to home through the focus header', async () => {
    renderWithAuth(<Play session={makeSession()} setSession={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'ホーム' }));
    expect(window.location.hash).toBe('#/');
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('shows a 完結 badge in the header for a finished session', async () => {
    renderWithAuth(<Harness initialSession={makeSession({ endedAt: 123 })} />);
    expect(await screen.findByText('完結')).toBeInTheDocument();
  });

  it('does not show a 完結 badge for a session still in progress', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} />);
    await screen.findByText('テストセッション');
    expect(screen.queryByText('完結')).not.toBeInTheDocument();
  });

  it('offers to finish the story when the GM reports the ending was reached', async () => {
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。' }],
    });
    renderWithAuth(<Harness initialSession={session} />);

    expect(await screen.findByText(/結末に辿り着いた/)).toBeInTheDocument();
    expect(screen.getByText('この物語を終える')).toBeInTheDocument();
    expect(screen.getByText('まだ続ける')).toBeInTheDocument();
  });

  it('does not offer to finish when the GM has not reported an ending', async () => {
    const session = makeSession({ log: [{ role: 'gm', text: '道は続く。' }] });
    renderWithAuth(<Harness initialSession={session} />);
    await screen.findByText('道は続く。');
    expect(screen.queryByText('この物語を終える')).not.toBeInTheDocument();
  });

  it('stamps endedAt and shows the 完結 badge when the player finishes the story', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。' }],
    });
    renderWithAuth(<Harness initialSession={session} />);

    fireEvent.click(await screen.findByText('この物語を終える'));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const saved = saveSpy.mock.calls.at(-1)[0];
    expect(typeof saved.endedAt).toBe('number');
    expect(await screen.findByText('完結')).toBeInTheDocument();
    expect(screen.queryByText('この物語を終える')).not.toBeInTheDocument();
  });

  it('clears the ending flag when the player chooses to keep playing', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。' }],
    });
    renderWithAuth(<Harness initialSession={session} />);

    fireEvent.click(await screen.findByText('まだ続ける'));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const saved = saveSpy.mock.calls.at(-1)[0];
    expect(saved.state.ending_reached).toBe(false);
    expect(saved.endedAt).toBeUndefined();
    expect(screen.queryByText('この物語を終える')).not.toBeInTheDocument();
  });

  it('disables the ending-card buttons while a turn is in flight', async () => {
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。', choices: ['続ける'] }],
    });
    renderWithAuth(<Harness initialSession={session} />);
    await screen.findByText('この物語を終える');

    // 選択肢ボタンを押してターン進行中(busy=true)にし、エンディングカードのボタンも
    // 他の操作系と同様にガードされていることを確認する。
    fireEvent.click(screen.getByText('続ける'));
    expect(screen.getByText('この物語を終える')).toBeDisabled();
    expect(screen.getByText('まだ続ける')).toBeDisabled();

    // ターン完了まで待ち、後続テストへ未処理の非同期処理を持ち越さない。
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });

  it('shows a save warning when saveSession fails while finishing the story', async () => {
    vi.spyOn(storage, 'saveSession').mockResolvedValue(false);
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。' }],
    });
    renderWithAuth(<Harness initialSession={session} />);

    fireEvent.click(await screen.findByText('この物語を終える'));

    await waitFor(() => expect(screen.getByText(/セッションの保存に失敗した/)).toBeInTheDocument());
  });

  it('shows a save warning when saveSession fails while choosing to keep playing', async () => {
    vi.spyOn(storage, 'saveSession').mockResolvedValue(false);
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。' }],
    });
    renderWithAuth(<Harness initialSession={session} />);

    fireEvent.click(await screen.findByText('まだ続ける'));

    await waitFor(() => expect(screen.getByText(/セッションの保存に失敗した/)).toBeInTheDocument());
  });

  it('clears an existing save warning once finishing the story saves successfully', async () => {
    // 開始ターンの応答自体がending_reached:trueを返すようにし、開始ターンの保存失敗で
    // 警告を出しつつエンディングカードも表示された状態を作る。
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ narrative: '物語は終わった。', state_update: { ending_reached: true }, choices: [] }),
          },
        ],
      }),
    });
    const saveSpy = vi
      .spyOn(storage, 'saveSession')
      .mockResolvedValueOnce(false) // 開始ターンは失敗させ、警告を出す
      .mockResolvedValue(true); // 「この物語を終える」は成功させる
    renderWithAuth(<Harness initialSession={makeSession()} />);

    await waitFor(() => expect(screen.getByText(/セッションの保存に失敗した/)).toBeInTheDocument());
    fireEvent.click(await screen.findByText('この物語を終える'));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/セッションの保存に失敗した/)).not.toBeInTheDocument();
  });

  it('サーバー同期の完了を待ってからrecordEndingを呼ぶ(順序保証)', async () => {
    vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    let resolvePut;
    const putSpy = vi.spyOn(sessionSyncClient, 'putSessionToServer').mockReturnValue(
      new Promise((res) => {
        resolvePut = res;
      })
    );
    const recordSpy = vi.spyOn(endingClient, 'recordEnding').mockResolvedValue({
      sessionId: 's1',
      endingTitle: '完結の題',
      summary: '',
      stats: null,
    });
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。' }],
    });
    renderWithAuth(<Harness initialSession={session} />);

    fireEvent.click(await screen.findByText('この物語を終える'));

    // サーバー同期(putSessionToServer)が解決するまでは、recordEndingを呼んではいけない。
    // サーバー側のエンディング記録はストア済みセッションのendedAtを読むため、
    // 先にPUTが届いていないと「session has not ended」で400になり得る。
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(recordSpy).not.toHaveBeenCalled();

    await act(async () => {
      resolvePut({});
    });
    await waitFor(() => expect(recordSpy).toHaveBeenCalledWith('s1', expect.any(Object)));
  });

  it('records the ending after the player finishes the story', async () => {
    vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    const recordSpy = vi.spyOn(endingClient, 'recordEnding').mockResolvedValue({
      sessionId: 's1',
      endingTitle: '灰は星を数えない',
      summary: '彼女は坑道を出た。',
      stats: { total: 1, successes: 1, successRate: 1, byDegree: { fumble: 0, fail: 0, success: 1, critical: 0 }, degrees: ['fumble', 'fail', 'success', 'critical'], resources: {} },
    });
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。', roll: { degree: 'success', success: true } }],
    });
    renderWithAuth(<Harness initialSession={session} />);

    fireEvent.click(await screen.findByText('この物語を終える'));

    await waitFor(() => expect(recordSpy).toHaveBeenCalledWith('s1', expect.objectContaining({ total: 1 })));
    expect(await screen.findByText('灰は星を数えない')).toBeInTheDocument();
    expect(screen.getByText('彼女は坑道を出た。')).toBeInTheDocument();
  });

  it('keeps the session finished and offers a retry when recording fails', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    const recordSpy = vi.spyOn(endingClient, 'recordEnding').mockRejectedValue(new Error('boom'));
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。' }],
    });
    renderWithAuth(<Harness initialSession={session} />);

    fireEvent.click(await screen.findByText('この物語を終える'));

    expect(await screen.findByText(/エンディングの記録に失敗した/)).toBeInTheDocument();
    expect(typeof saveSpy.mock.calls.at(-1)[0].endedAt).toBe('number'); // 完結自体は取り消さない
    expect(screen.getByText('完結')).toBeInTheDocument();

    recordSpy.mockResolvedValue({ sessionId: 's1', endingTitle: '再試行の題', summary: '', stats: null });
    fireEvent.click(screen.getByText('エンディングを記録する'));
    expect(await screen.findByText('再試行の題')).toBeInTheDocument();
  });
});
