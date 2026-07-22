# 監査修正 FX1: フロントエンド堅牢性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** LLM応答の無検証によるセッション破損・エラーバウンダリ不在・saveSession失敗の握り潰し・dice.jsのファンブル/NaN・IME送信・入力消失を修正する。

**Architecture:** 新規の純粋関数`src/api/turnResult.js`(LLM応答正規化)と`src/components/ErrorBoundary.jsx`を追加し、`src/engine/dice.js`を修正、`src/screens/Play.jsx`をこれらに接続する。

**Tech Stack:** React 18 + Vite、Vitest + @testing-library/react

## Global Constraints

- `"type": "module"`(ESM)。`require()`は使わない。
- LLM不正出力は「黙って矯正・旧値保持」方針(数値クランプ・非数値無視・不正型は旧値保持)。ターン自体は失敗扱いにしない。
- 既存セッション(`state.xp`/`state.turn_count`/`session.ruleset`が無い旧形式)との後方互換を壊さない(`Number.isFinite(...) ? ... : 0`等でフォールバック)。
- `saveSession`失敗・サーバー同期失敗はゲーム進行をブロックしない(警告表示・`console.error`のみ)。
- 各タスクの最後は該当ファイルのみをステージしてコミットする。

---

## Task 1: src/api/turnResult.js(LLM応答正規化)

**Files:**
- Create: `src/api/turnResult.js`
- Create: `src/api/turnResult.test.js`

**Interfaces:**
- Produces: `normalizeTurnResult(result)` → `{ narrative: string, choices: string[], stateUpdate: { current_scene: string|null, flags: object|null, history_summary: string|null, xpGain: number } }`。Task 4の`Play.jsx`が消費する。

- [ ] **Step 1: `src/api/turnResult.test.js`を書く(失敗する状態)**

```js
import { describe, it, expect } from 'vitest';
import { normalizeTurnResult } from './turnResult.js';

describe('normalizeTurnResult', () => {
  it('passes through a well-formed result', () => {
    const out = normalizeTurnResult({
      narrative: '物語',
      choices: ['A', 'B'],
      state_update: { current_scene: '森', flags: { met: true }, history_summary: '要約', xp_gained: 5 },
    });
    expect(out.narrative).toBe('物語');
    expect(out.choices).toEqual(['A', 'B']);
    expect(out.stateUpdate).toEqual({ current_scene: '森', flags: { met: true }, history_summary: '要約', xpGain: 5 });
  });

  it('replaces a non-string narrative with a safe placeholder', () => {
    expect(normalizeTurnResult({ narrative: { bad: 1 } }).narrative).toBe('(描写を取得できませんでした)');
    expect(normalizeTurnResult({}).narrative).toBe('(描写を取得できませんでした)');
  });

  it('keeps only string choices and defaults to an empty array', () => {
    expect(normalizeTurnResult({ choices: ['ok', 3, null, 'yes'] }).choices).toEqual(['ok', 'yes']);
    expect(normalizeTurnResult({ choices: 'notarray' }).choices).toEqual([]);
    expect(normalizeTurnResult({}).choices).toEqual([]);
  });

  it('returns null for an invalid current_scene so the caller keeps the previous one', () => {
    expect(normalizeTurnResult({ state_update: { current_scene: '' } }).stateUpdate.current_scene).toBeNull();
    expect(normalizeTurnResult({ state_update: { current_scene: { x: 1 } } }).stateUpdate.current_scene).toBeNull();
    expect(normalizeTurnResult({ state_update: { current_scene: '港' } }).stateUpdate.current_scene).toBe('港');
  });

  it('returns null for non-plain-object flags', () => {
    expect(normalizeTurnResult({ state_update: { flags: 'x' } }).stateUpdate.flags).toBeNull();
    expect(normalizeTurnResult({ state_update: { flags: [1, 2] } }).stateUpdate.flags).toBeNull();
    expect(normalizeTurnResult({ state_update: { flags: { a: 1 } } }).stateUpdate.flags).toEqual({ a: 1 });
  });

  it('returns null for a non-string history_summary', () => {
    expect(normalizeTurnResult({ state_update: { history_summary: { x: 1 } } }).stateUpdate.history_summary).toBeNull();
    expect(normalizeTurnResult({ state_update: { history_summary: 'ok' } }).stateUpdate.history_summary).toBe('ok');
  });

  it('coerces xp_gained to a finite non-negative number', () => {
    expect(normalizeTurnResult({ state_update: { xp_gained: '5' } }).stateUpdate.xpGain).toBe(5);
    expect(normalizeTurnResult({ state_update: { xp_gained: -10 } }).stateUpdate.xpGain).toBe(0);
    expect(normalizeTurnResult({ state_update: { xp_gained: 'abc' } }).stateUpdate.xpGain).toBe(0);
    expect(normalizeTurnResult({ state_update: {} }).stateUpdate.xpGain).toBe(0);
    expect(normalizeTurnResult({}).stateUpdate.xpGain).toBe(0);
  });

  it('never throws on a null or non-object result', () => {
    expect(() => normalizeTurnResult(null)).not.toThrow();
    expect(normalizeTurnResult(null).narrative).toBe('(描写を取得できませんでした)');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/turnResult.test.js`
Expected: FAIL(`turnResult.js`が存在しない)

- [ ] **Step 3: `src/api/turnResult.js`を実装**

```js
const NARRATIVE_FALLBACK = '(描写を取得できませんでした)';

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function normalizeTurnResult(result) {
  const r = isPlainObject(result) ? result : {};
  const su = isPlainObject(r.state_update) ? r.state_update : {};

  const narrative = typeof r.narrative === 'string' ? r.narrative : NARRATIVE_FALLBACK;
  const choices = Array.isArray(r.choices) ? r.choices.filter((c) => typeof c === 'string') : [];

  const current_scene =
    typeof su.current_scene === 'string' && su.current_scene.length > 0 ? su.current_scene : null;
  const flags = isPlainObject(su.flags) ? su.flags : null;
  const history_summary = typeof su.history_summary === 'string' ? su.history_summary : null;

  const rawXp = Number(su.xp_gained);
  const xpGain = Number.isFinite(rawXp) ? Math.max(0, rawXp) : 0;

  return { narrative, choices, stateUpdate: { current_scene, flags, history_summary, xpGain } };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/turnResult.test.js`
Expected: PASS(8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/turnResult.js src/api/turnResult.test.js
git commit -m "feat(frontend): add normalizeTurnResult to sanitize untrusted GM responses"
```

---

## Task 2: src/engine/dice.js のファンブル/NaN修正

**Files:**
- Modify: `src/engine/dice.js`
- Modify: `src/engine/dice.test.js`

**Interfaces:**
- `evaluateRoll(successPercent)` → `{ roll, success_percent, success, degree }`。シグネチャ不変。

- [ ] **Step 1: `src/engine/dice.test.js`にテストを追記(失敗する状態)**

`describe('evaluateRoll', ...)`ブロックの末尾に追記:
```js
  it('does not label a successful roll as a fumble at high success percents', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.96); // roll = 97
    const result = evaluateRoll(100); // clamped to 99, so 97 <= 99 → success
    expect(result.success).toBe(true);
    expect(result.degree).toBe('success');
  });

  it('labels a failing high roll as a fumble', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.96); // roll = 97
    const result = evaluateRoll(50);
    expect(result.success).toBe(false);
    expect(result.degree).toBe('fumble');
  });

  it('falls back to a neutral 50 when successPercent is not a finite number', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.49); // roll = 50
    const result = evaluateRoll(undefined);
    expect(result.success_percent).toBe(50);
    expect(result.success).toBe(true);
    expect(Number.isNaN(result.success_percent)).toBe(false);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/engine/dice.test.js`
Expected: FAIL(高成功率で成功が`fumble`になる / `undefined`で`NaN`)

- [ ] **Step 3: `src/engine/dice.js`の`evaluateRoll`を修正**

`evaluateRoll`関数全体を次に置き換える:
```js
export function evaluateRoll(successPercent) {
  const raw = Number(successPercent);
  const p = Number.isFinite(raw) ? Math.max(1, Math.min(99, Math.round(raw))) : 50;
  const roll = rollD100();
  const success = roll <= p;
  let degree;
  if (success) {
    degree = roll <= Math.max(1, Math.round(p * 0.05)) ? 'critical' : 'success';
  } else {
    degree = roll >= 96 ? 'fumble' : 'fail';
  }
  return { roll, success_percent: p, success, degree };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/engine/dice.test.js`
Expected: PASS(既存 + 新規3)

- [ ] **Step 5: Commit**

```bash
git add src/engine/dice.js src/engine/dice.test.js
git commit -m "fix(engine): make fumble exclusive of success and guard non-numeric success_percent"
```

---

## Task 3: src/components/ErrorBoundary.jsx とmain.jsxへの組み込み

**Files:**
- Create: `src/components/ErrorBoundary.jsx`
- Create: `src/components/ErrorBoundary.test.jsx`
- Modify: `src/main.jsx`

**Interfaces:**
- Produces: `<ErrorBoundary>{children}</ErrorBoundary>`。描画中の例外を捕捉しフォールバックを表示、正常時は`children`をそのまま描画する。

- [ ] **Step 1: `src/components/ErrorBoundary.test.jsx`を書く(失敗する状態)**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary.jsx';

function Boom() {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>正常な内容</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('正常な内容')).toBeInTheDocument();
  });

  it('renders a fallback when a child throws during render', () => {
    // Reactは捕捉したエラーをconsole.errorに出すため、テスト出力を汚さないよう抑止する。
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/表示中に問題が発生しました/)).toBeInTheDocument();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/ErrorBoundary.test.jsx`
Expected: FAIL(`ErrorBoundary.jsx`が存在しない)

- [ ] **Step 3: `src/components/ErrorBoundary.jsx`を実装**

```jsx
import { Component } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught an error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ maxWidth: 480, margin: '80px auto', padding: '0 20px', textAlign: 'center' }}>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 20, color: COLORS.ink, marginBottom: 12 }}>
            表示中に問題が発生しました
          </div>
          <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.inkSoft, marginBottom: 20 }}>
            予期しないエラーで画面を表示できなかった。ページを再読み込みしてください。
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              fontFamily: F_MONO,
              fontSize: 13,
              padding: '10px 16px',
              borderRadius: 4,
              border: 'none',
              cursor: 'pointer',
              background: COLORS.brass,
              color: COLORS.paper,
            }}
          >
            再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/components/ErrorBoundary.test.jsx`
Expected: PASS(2 tests)

- [ ] **Step 5: `src/main.jsx`で`<App/>`をラップ**

`src/main.jsx`全体を次に置き換える:
```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
```

- [ ] **Step 6: 全体テストを実行(回帰確認)**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 7: Commit**

```bash
git add src/components/ErrorBoundary.jsx src/components/ErrorBoundary.test.jsx src/main.jsx
git commit -m "feat(frontend): add ErrorBoundary and wrap the app to prevent white-screen crashes"
```

---

## Task 4: src/screens/Play.jsx の統合(正規化・IME・入力保持・保存警告)

**Files:**
- Modify: `src/screens/Play.jsx`
- Modify: `src/screens/Play.test.jsx`

**Interfaces:**
- Consumes: `normalizeTurnResult`(Task 1)
- 既存の`Play({ session, setSession, onExit })`インターフェースは不変。

- [ ] **Step 1: `src/screens/Play.test.jsx`にテストを追記(失敗する状態)**

`src/screens/Play.test.jsx`は既に`import * as sessionSyncClient from '../api/sessionSyncClient.js';`を持つ。加えてファイル冒頭のimportに`storage`名前空間を1行追加する(saveSession失敗テスト用):
```jsx
import * as storage from '../storage/index.js';
```

`describe('Play', ...)`ブロックの末尾に追記:
```jsx
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
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
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
    render(<Harness initialSession={makeSession({ state: { current_scene: '元のシーン', flags: {}, history_summary: '', recent_log: [], turn_count: 0, xp: 0 } })} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('進行')).toBeInTheDocument());
    expect(screen.getByText('シーン: 元のシーン')).toBeInTheDocument();
  });

  it('shows a save warning when saveSession fails but keeps playing', async () => {
    // spyOnは既定で元実装を呼ぶが、mockResolvedValueOnceで開始ターンの1回だけfalseを返させ、
    // 以降は元実装に戻るため後続テストへ副作用が漏れない(このテストファイルにafterEachのリセットは無い)。
    vi.spyOn(storage, 'saveSession').mockResolvedValueOnce(false);
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/セッションの保存に失敗した/)).toBeInTheDocument());
  });
```

> 注: Play.jsxは`import { saveSession } from '../storage/index.js'`で名前付きインポートしており、ESMのライブ束縛のため`vi.spyOn(storage, 'saveSession')`で差し替え可能(本リポジトリの他テストと同じ手法)。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: FAIL(xp文字列連結 / current_scene保持 / 保存警告が未実装)

- [ ] **Step 3: `src/screens/Play.jsx`を修正**

importに1行追加(`import { saveSession } from '../storage/index.js';`の後):
```js
import { normalizeTurnResult } from '../api/turnResult.js';
```

`error` stateの直後に保存警告用stateを追加:
```js
  const [error, setError] = useState('');
  const [saveWarning, setSaveWarning] = useState('');
```

`runTurn`のtry本体(`const { result, roll } = await takeTurn(...)`以降、`setBusy(false)`のfinallyまで)を次に置き換える:
```js
      try {
        const { result, roll } = await takeTurn(session, playerText);
        const norm = normalizeTurnResult(result);

        const newFlags = norm.stateUpdate.flags
          ? { ...session.state.flags, ...norm.stateUpdate.flags }
          : session.state.flags;
        const newXp = (Number.isFinite(session.state.xp) ? session.state.xp : 0) + norm.stateUpdate.xpGain;
        const newLog = [...session.log];
        if (displayText) newLog.push({ role: 'player', text: displayText });
        newLog.push({ role: 'gm', text: norm.narrative, choices: norm.choices, roll });

        const recent = [...(session.state.recent_log || [])];
        if (displayText) recent.push({ role: 'player', text: displayText });
        recent.push({ role: 'gm', text: norm.narrative });
        while (recent.length > 12) recent.shift(); // 簡易履歴管理。Phase2で要約圧縮に置き換え予定

        const updated = {
          ...session,
          state: {
            ...session.state,
            current_scene: norm.stateUpdate.current_scene ?? session.state.current_scene,
            flags: newFlags,
            history_summary: norm.stateUpdate.history_summary ?? session.state.history_summary,
            recent_log: recent,
            turn_count: (Number.isFinite(session.state.turn_count) ? session.state.turn_count : 0) + 1,
            xp: newXp,
          },
          log: newLog,
          updatedAt: Date.now(),
        };
        setSession(updated);
        const saved = await saveSession(updated);
        if (!saved) {
          setSaveWarning(
            'セッションの保存に失敗した。ブラウザの保存領域を確認してください(このターンは保存されていない可能性があります)。'
          );
        } else {
          setSaveWarning('');
        }
        putSessionToServer(updated).catch((e) => console.error('session server sync failed', e));
        return true;
      } catch (e) {
        console.error(e);
        setError('GM応答の取得に失敗した: ' + e.message);
        return false;
      } finally {
        setBusy(false);
      }
```

`submitFree`を次に置き換える:
```js
  async function submitFree() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    const ok = await runTurn(text, text);
    if (!ok) setInput(text);
  }
```

入力欄の`onKeyDown`を次に置き換える(IMEガード):
```jsx
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitFree();
            }}
```

エラー表示`{error && ...}`の直後に保存警告表示を追加:
```jsx
        {error && <div style={{ color: COLORS.stamp, fontSize: 13 }}>{error}</div>}
        {saveWarning && <div style={{ color: COLORS.stamp, fontSize: 12 }}>{saveWarning}</div>}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS(既存 + 新規3)

- [ ] **Step 5: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 6: ビルドを確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 7: Commit**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "fix(frontend): normalize GM responses, guard IME Enter, preserve input, surface save failures"
```

---

## Self-Review Notes

- **Spec coverage**: spec §3.1(normalizeTurnResult)→Task 1、§3.4(dice)→Task 2、§3.3(ErrorBoundary)→Task 3、§3.2(Play統合: 正規化・IME・入力保持・保存警告)→Task 4。
- **Placeholder scan**: 「TBD」等なし。
- **Type consistency**: `normalizeTurnResult`の戻り値形状(`{narrative, choices, stateUpdate:{current_scene, flags, history_summary, xpGain}}`)はTask 1で定義しTask 4で消費、フィールド名一貫。
- **後方互換**: `Number.isFinite(session.state.xp) ? ... : 0`と`turn_count`同様のガードで旧形式セッションの`NaN`を防ぐ。
- **非スコープ遵守**: Setup/ライブラリ/サーバー/ドキュメントには触れない。
