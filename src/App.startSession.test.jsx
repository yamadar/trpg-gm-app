import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from './App.jsx';
import * as storage from './storage/index.js';

// ウィザードを最後まで動かす代わりに Setup を差し替え、onStart(=App の handleStart)だけを叩く。
// これはファイル単位で効くため、実物の Setup を必要とするテストと同居できない。
// App.test.jsx から独立させているのはそのため。
const NEW_SESSION = {
  id: 'sess_new',
  title: '始まったばかりの冒険',
  world: { raw: '', summary: '' },
  scenario: { raw: '' },
  rulesetId: 'simple',
  moods: [],
  pc: { raw: '' },
  state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], turn_count: 0 },
  log: [],
  updatedAt: 0,
};

vi.mock('./screens/Setup.jsx', () => ({
  default: ({ onStart }) => (
    <button type="button" onClick={() => onStart(NEW_SESSION)}>
      ウィザードを完了する
    </button>
  ),
}));

afterEach(() => {
  window.location.hash = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('App: 新規セッション開始', () => {
  it('keeps the freshly created session when the wizard hands off to #/play/:id', async () => {
    // handleStart は setSession してから navigate({name:'play'}) する。この遷移で
    // 「プレイ画面から離れたらセッションを捨てる」後始末が走ってはいけない。
    // 守っているのは routeKey の effect にある prev.name === 'play' ガード1つだけで、
    // これを「ルートが play でなくなったら」等に単純化すると新規開始が壊れる。
    vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    // 捨てられた場合にストレージ読み直しが救ってしまうと欠落が見えなくなるので、
    // 読み直しても復元できない状態にしておく。
    const getSpy = vi.spyOn(storage, 'getSession').mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ user: { id: 'usr_test', displayName: 'テスト' } }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );

    window.location.hash = '#/setup';
    render(<App />);

    fireEvent.click(await screen.findByText('ウィザードを完了する'));

    await waitFor(() => expect(window.location.hash).toBe('#/play/sess_new'));

    // 作りたてのセッションがそのままプレイ画面へ渡ること。
    expect(await screen.findByText('始まったばかりの冒険')).toBeInTheDocument();
    // 捨てられていれば読み込みプレースホルダのまま、あるいはホームへ落ちる。
    expect(screen.queryByText('読み込み中…')).not.toBeInTheDocument();
    expect(screen.queryByText('セッションが見つかりません')).not.toBeInTheDocument();
    // メモリ上に残っているのだから、ストレージを読み直す必要はない。
    expect(getSpy).not.toHaveBeenCalled();
  });
});
