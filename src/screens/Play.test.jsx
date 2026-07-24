import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import Play from './Play.jsx';
import * as sessionSyncClient from '../api/sessionSyncClient.js';
import * as storage from '../storage/index.js';
import * as sceneImageClient from '../api/sceneImageClient.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';

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
function Harness({ initialSession, onExit }) {
  const [session, setSession] = useState(initialSession);
  return <Play session={session} setSession={setSession} onExit={onExit} />;
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
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('進む')).toBeInTheDocument();
  });

  it('does not request an opening scene when the log already has entries', async () => {
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText('既存のログ')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fires the opening turn exactly once under React.StrictMode double-invocation', async () => {
    renderWithAuth(
      <React.StrictMode>
        <Harness initialSession={makeSession()} onExit={vi.fn()} />
      </React.StrictMode>
    );
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('accumulates xp_gained into session.state.xp and displays it with the growthUnit label', async () => {
    const session = makeSession({ ruleset: { id: 'gurps', label: 'GURPS風', desc: '', hint: '', growthUnit: 'CP' } });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('CP: 5')).toBeInTheDocument();
  });

  it('defaults the growth label to "経験値" when session.ruleset is absent', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('経験値: 5')).toBeInTheDocument();
  });

  it('syncs the updated session to the server after a turn, without blocking on failure', async () => {
    const putSpy = vi.spyOn(sessionSyncClient, 'putSessionToServer').mockRejectedValue(new Error('offline'));
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
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
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
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
    renderWithAuth(<Harness initialSession={makeSession({ state: { current_scene: '元のシーン', flags: {}, history_summary: '', recent_log: [], turn_count: 0, xp: 0 } })} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('進行')).toBeInTheDocument());
    expect(screen.getByText('シーン: 元のシーン')).toBeInTheDocument();
  });

  it('shows a save warning when saveSession fails but keeps playing', async () => {
    // spyOnは既定で元実装を呼ぶが、mockResolvedValueOnceで開始ターンの1回だけfalseを返させ、
    // 以降は元実装に戻るため後続テストへ副作用が漏れない(このテストファイルにafterEachのリセットは無い)。
    vi.spyOn(storage, 'saveSession').mockResolvedValueOnce(false);
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/セッションの保存に失敗した/)).toBeInTheDocument());
  });

  it('logs the player utterance and fetches a new GM turn when free input is submitted', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
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
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByPlaceholderText('PCの行動を自由に書く…')).not.toBeDisabled()
    );
    fireEvent.click(screen.getByText('進む')); // GM応答の選択肢ボタン
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('submits on Enter when IME composition is not active', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
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
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
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
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
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
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
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
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
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
    renderWithAuth(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText('成功')).toBeInTheDocument();
    delete window.matchMedia;
  });

  it('motion許可環境では地の文がタイプ表示され、完了後にchoicesが表示される', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }); // motion許可
    try {
      renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
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
        onExit={vi.fn()}
      />
    );
    const horrorBg = horror.container.firstChild.style.background;
    expect(horrorBg).toBeTruthy();
    const plain = renderWithAuth(
      <Play
        session={makeSession({ log: [{ role: 'gm', text: '別のログ' }] })}
        setSession={vi.fn()}
        onExit={vi.fn()}
      />
    );
    expect(horrorBg).not.toBe(plain.container.firstChild.style.background);
  });

  it('imageGenが有効なら未生成GMエントリに「この場面を描く」ボタンを出す', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
  });

  it('imageGenが無効なら挿絵ボタンを出さない', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: false });
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    await waitFor(() => expect(sceneImageClient.getConfig).toHaveBeenCalled());
    expect(screen.queryByText('この場面を描く')).not.toBeInTheDocument();
  });

  it('ボタン押下で画像を生成し、entry.imageとして表示する', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    sceneImageClient.generateSceneImage.mockResolvedValueOnce({ imageId: 'img_1', newAppearances: [] });
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
    fireEvent.click(screen.getByText('この場面を描く'));
    await waitFor(() => {
      expect(document.querySelector('img[src*="img_1"]')).toBeTruthy();
    });
  });

  it('既にimageを持つエントリは画像を表示しボタンを出さない', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: 'ログ', image: { imageId: 'img_9' } }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('img[src*="img_9"]')).toBeTruthy());
    expect(screen.queryByText('この場面を描く')).not.toBeInTheDocument();
  });

  it('生成失敗時はエラーを表示しimageIdを保存しない', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    sceneImageClient.generateSceneImage.mockRejectedValueOnce(new Error('boom'));
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: 'ログ' }] });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
    fireEvent.click(screen.getByText('この場面を描く'));
    await waitFor(() => expect(screen.getByText(/挿絵の生成に失敗/)).toBeInTheDocument());
    expect(document.querySelector('img')).toBeFalsy();
  });

  it('autoIllustrate ON かつシーン変化ターンで新GMエントリの生成を自動発火する', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    sceneImageClient.generateSceneImage.mockResolvedValue({ imageId: 'img_a', newAppearances: [] });
    const session = makeSession({ id: 's1', autoIllustrate: true, log: [{ role: 'gm', text: '最初の場面' }] });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
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
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('挿絵を自動生成')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('挿絵を自動生成'));
    await waitFor(() => {
      const lastCall = saveSpy.mock.calls.at(-1);
      expect(lastCall?.[0]?.autoIllustrate).toBe(true);
    });
  });

  it('refuses to run a turn when logged out', async () => {
    // logが空だと初回自動ターンが走ってしまうため、既存ログを持つセッションを使う
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />, { user: null });
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '森へ進む' } });
    fireEvent.click(screen.getByText('送る'));
    await waitFor(() =>
      expect(screen.getByText('プレイの進行にはログインが必要です。右上からログインしてください。')).toBeInTheDocument()
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
