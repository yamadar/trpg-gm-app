# Play画面 演出強化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play画面にダイスロール演出・タイプライター表示(tension_level連動)・雰囲気(moods)連動テーマを追加する。

**Architecture:** spec は [2026-07-24-play-presentation-design.md](../specs/2026-07-24-play-presentation-design.md)。演出は全てクライアント側のCSS/タイマーで実現し、外部依存は追加しない。`window.matchMedia` が使えない環境(jsdomテスト・古いブラウザ)と `prefers-reduced-motion: reduce` では**アニメーション無効=従来どおり即時表示**に倒す(`motionAllowed()`)。これにより既存テストは無変更で通り、アニメーション自体のテストだけ `matchMedia` をモックして行う。`tension_level` はGM応答スキーマに追加しstateへ保存、タイプ速度に反映する。

**Tech Stack:** React 18(インラインstyle+`theme.js`)、vitest + @testing-library/react(jsdom, fake timers)。新規依存なし。

## Global Constraints

- UI文言・コード内コメントは日本語(既存スタイルに合わせる)
- スタイルは `src/theme.js` の COLORS/フォント定数+インラインstyle方式を踏襲(CSSファイル追加はkeyframes注入のみ)
- テスト実行: 全体 `npm test` / 個別 `npx vitest run <path>`
- 新規npm依存の追加禁止
- セーブデータ互換: 旧セッション(`tension_level`/`moods`無し)がそのまま動くこと
- コミットメッセージは既存の `feat(ui):` / `fix:` 等の日本語スタイル

---

### Task 1: `motionAllowed()` ユーティリティ

**Files:**
- Modify: `src/theme.js`(末尾に追加)
- Test: `src/theme.test.jsx`(既存ファイルに追記)

**Interfaces:**
- Produces: `motionAllowed(): boolean` — アニメーションを再生してよい環境なら true。`window.matchMedia` が無い環境(jsdom等)や `prefers-reduced-motion: reduce` では false。Task 2, 6 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`src/theme.test.jsx` に追記:

```jsx
import { motionAllowed } from './theme.js';

describe('motionAllowed', () => {
  afterEach(() => {
    delete window.matchMedia;
  });

  it('matchMediaが無い環境(jsdom)ではfalse=静的表示に倒す', () => {
    expect(motionAllowed()).toBe(false);
  });

  it('reduced-motion指定が無ければtrue', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    expect(motionAllowed()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('prefers-reduced-motion: reduce ならfalse', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    expect(motionAllowed()).toBe(false);
  });
});
```

(既存importに `vi`, `afterEach` が無ければ `vitest` から追加インポートする)

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/theme.test.jsx`
Expected: FAIL — `motionAllowed is not a function`

- [ ] **Step 3: 実装**

`src/theme.js` 末尾に追加:

```js
// アニメーション可否。matchMediaが使えない環境(テスト等)やreduced-motion設定時は
// falseを返し、呼び出し側は従来どおりの即時表示(静的表示)に倒す。
export function motionAllowed() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/theme.test.jsx`
Expected: PASS(既存テスト含む)

- [ ] **Step 5: Commit**

```bash
git add src/theme.js src/theme.test.jsx
git commit -m "feat(ui): motionAllowed()追加(reduced-motion/非対応環境で演出を無効化)"
```

---

### Task 2: Stamp のダイスロール3段階演出

**Files:**
- Modify: `src/components/ui/Stamp.jsx`(全面書き換え)
- Create: `src/components/ui/Stamp.test.jsx`

**Interfaces:**
- Consumes: `motionAllowed()`(Task 1)
- Produces: `<Stamp roll animate />` — `roll` は従来どおり `{check_label, roll, success_percent, success, degree}`。`animate=true` かつ `motionAllowed()` のとき「数字回転(800ms)→出目停止(250ms)→スタンプ押印」の演出。それ以外は従来どおり即時表示。表示テキスト(`check_label | 出目/成功率 | 会心/成功/失敗/大失敗`)は最終状態で従来と同一。Task 3(Play)が `animate` を渡す。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/ui/Stamp.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Stamp from './Stamp.jsx';

afterEach(() => {
  delete window.matchMedia;
  vi.useRealTimers();
});

describe('Stamp', () => {
  const roll = { check_label: '崖を登る', roll: 12, success_percent: 70, success: true, degree: 'success' };

  it('rollが無ければ何も描画しない', () => {
    const { container } = render(<Stamp roll={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('animate無し(または非対応環境)では従来どおり即時に全要素を表示する', () => {
    render(<Stamp roll={roll} animate />); // jsdomはmatchMedia無し→静的表示
    expect(screen.getByText('崖を登る')).toBeInTheDocument();
    expect(screen.getByText('12/70')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
  });

  it.each([
    ['critical', '会心'],
    ['success', '成功'],
    ['fail', '失敗'],
    ['fumble', '大失敗'],
  ])('degree=%s のラベルは%s', (degree, label) => {
    render(<Stamp roll={{ ...roll, success: degree === 'critical' || degree === 'success', degree }} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('animate時は回転中→出目停止→押印の順に進む', () => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }); // motion許可
    render(<Stamp roll={roll} animate />);
    // 回転中: 結果ラベルはまだ出ない
    expect(screen.queryByText('成功')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(800)); // 出目停止
    expect(screen.getByText('12/70')).toBeInTheDocument();
    expect(screen.queryByText('成功')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(250)); // 押印
    expect(screen.getByText('成功')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/ui/Stamp.test.jsx`
Expected: FAIL(animate演出のテストで「成功」が最初から表示されている等)

- [ ] **Step 3: 実装**

`src/components/ui/Stamp.jsx` を以下に書き換え:

```jsx
import { useEffect, useState } from 'react';
import { COLORS, F_MONO, motionAllowed } from '../../theme.js';

// degree別の演出色。文字と枠を揃え、criticalのみ真鍮系で強調する。
const DEGREE_COLORS = {
  critical: { fg: COLORS.brassDark, border: COLORS.brass },
  success: { fg: COLORS.stamp, border: COLORS.stamp },
  fail: { fg: COLORS.stamp, border: COLORS.line },
  fumble: { fg: COLORS.stampDark, border: COLORS.stampDark },
};

const KEYFRAMES_ID = 'trpg-stamp-anim';
const KEYFRAMES = `
@keyframes trpg-stamp-in {
  0% { transform: scale(1.8) rotate(-10deg); opacity: 0; }
  60% { transform: scale(0.95) rotate(-2deg); opacity: 1; }
  100% { transform: scale(1) rotate(-3deg); opacity: 0.9; }
}
@keyframes trpg-stamp-shake {
  0%, 100% { transform: translateX(0) rotate(-3deg); }
  25% { transform: translateX(-2px) rotate(-4deg); }
  75% { transform: translateX(2px) rotate(-2deg); }
}`;

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

// phase: rolling(数字回転) -> settled(出目停止) -> stamped(押印=最終表示)
export default function Stamp({ roll, animate = false }) {
  const animating = animate && motionAllowed();
  const [phase, setPhase] = useState(animating ? 'rolling' : 'stamped');
  const [shownRoll, setShownRoll] = useState(roll ? roll.roll : 0);

  useEffect(() => {
    if (phase !== 'rolling' || !roll) return;
    ensureKeyframes();
    const spin = setInterval(() => setShownRoll(Math.floor(Math.random() * 100) + 1), 50);
    const settle = setTimeout(() => {
      clearInterval(spin);
      setShownRoll(roll.roll);
      setPhase('settled');
    }, 800);
    return () => {
      clearInterval(spin);
      clearTimeout(settle);
    };
  }, [phase, roll]);

  useEffect(() => {
    if (phase !== 'settled') return;
    const t = setTimeout(() => setPhase('stamped'), 250);
    return () => clearTimeout(t);
  }, [phase]);

  if (!roll) return null;

  const label =
    roll.degree === 'critical'
      ? '会心'
      : roll.degree === 'fumble'
      ? '大失敗'
      : roll.success
      ? '成功'
      : '失敗';
  const colors = DEGREE_COLORS[roll.degree] || DEGREE_COLORS.success;
  const stamped = phase === 'stamped';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        transform: 'rotate(-3deg)',
        border: `2px solid ${stamped ? colors.border : COLORS.line}`,
        color: stamped ? colors.fg : COLORS.faint,
        borderRadius: 4,
        padding: '4px 10px',
        fontFamily: F_MONO,
        fontWeight: 600,
        fontSize: 12,
        letterSpacing: 1,
        marginBottom: 8,
        opacity: 0.9,
      }}
    >
      <span>{roll.check_label}</span>
      <span style={{ opacity: 0.6 }}>|</span>
      <span>
        {phase === 'rolling' ? shownRoll : roll.roll}/{roll.success_percent}
      </span>
      <span style={{ opacity: 0.6 }}>|</span>
      {stamped ? (
        <span
          style={{
            display: 'inline-block',
            animation: animating
              ? `trpg-stamp-in 0.25s ease-out${roll.degree === 'fumble' ? ', trpg-stamp-shake 0.3s ease-in-out 0.25s' : ''}`
              : undefined,
          }}
        >
          {label}
        </span>
      ) : (
        <span style={{ opacity: 0.5 }}>…</span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/components/ui/Stamp.test.jsx src/screens/Play.test.jsx`
Expected: PASS(Play既存テストも壊れない)

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Stamp.jsx src/components/ui/Stamp.test.jsx
git commit -m "feat(ui): ダイス判定スタンプに回転→停止→押印の3段階演出を追加"
```

---

### Task 3: Play が新規エントリのみ Stamp を animate させる

**Files:**
- Modify: `src/screens/Play.jsx`
- Test: `src/screens/Play.test.jsx`(追記)

**Interfaces:**
- Consumes: `<Stamp roll animate />`(Task 2)
- Produces: Play内部の `initialLogLenRef`(マウント時のlog長)。「index >= マウント時log長」のエントリだけが新着=演出対象。Task 6 のタイプライターも同じ基準を使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Play.test.jsx` に追記(describe内):

```jsx
  it('再開時の既存ログのロールは演出無しで即時表示される(判定中「…」を出さない)', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }); // motion許可環境でも
    const session = makeSession({
      log: [{ role: 'gm', text: '既存のログ', roll: { check_label: '探索', roll: 30, success_percent: 60, success: true, degree: 'success' } }],
    });
    renderWithAuth(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText('成功')).toBeInTheDocument();
    delete window.matchMedia;
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: 現時点ではPlayが `animate` を渡していないため、このテストは**通ってしまう**。先にStep 3の実装(animateを渡す)を入れると通り続けることを確認する回帰ピンである。実装後にPASSを確認する。

- [ ] **Step 3: 実装**

`src/screens/Play.jsx`:

1. 冒頭(`hasStartedRef` の隣)に追加:

```jsx
  // マウント時点のログ長。これ以降に追加されたエントリだけを演出対象にする
  // (セッション再開時に履歴全体が演出され直すのを防ぐ)。
  const initialLogLenRef = useRef(session.log.length);
```

2. `<Stamp roll={entry.roll} />` を以下に変更:

```jsx
              <Stamp roll={entry.roll} animate={i >= initialLogLenRef.current} />
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS(既存テスト含む全件)

- [ ] **Step 5: Commit**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "feat(ui): Playで新着ターンのロールのみダイス演出を有効化"
```

---

### Task 4: normalizeTurnResult に tension_level を追加

**Files:**
- Modify: `src/api/turnResult.js`
- Test: `src/api/turnResult.test.js`(追記)

**Interfaces:**
- Produces: `normalizeTurnResult(result).stateUpdate.tension_level` — `'low'|'medium'|'high'` または `null`(不正・欠落時。呼び出し側が前値を保持する)。Task 5, 6 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`src/api/turnResult.test.js` に追記(describe内):

```js
  it('tension_levelは既知の値のみ通し、不正・欠落はnull(前値保持)にする', () => {
    expect(normalizeTurnResult({ state_update: { tension_level: 'high' } }).stateUpdate.tension_level).toBe('high');
    expect(normalizeTurnResult({ state_update: { tension_level: 'low' } }).stateUpdate.tension_level).toBe('low');
    expect(normalizeTurnResult({ state_update: { tension_level: 'medium' } }).stateUpdate.tension_level).toBe('medium');
    expect(normalizeTurnResult({ state_update: { tension_level: '爆発' } }).stateUpdate.tension_level).toBeNull();
    expect(normalizeTurnResult({ state_update: {} }).stateUpdate.tension_level).toBeNull();
    expect(normalizeTurnResult({}).stateUpdate.tension_level).toBeNull();
  });
```

注意: 既存テスト `passes through a well-formed result` は `stateUpdate` を `toEqual` で丸ごと比較しているため、期待値に `tension_level: null` を追加する必要がある(state_updateにtension_levelを含めない入力のまま)。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/turnResult.test.js`
Expected: FAIL — `stateUpdate.tension_level` が `undefined`

- [ ] **Step 3: 実装**

`src/api/turnResult.js` の `normalizeTurnResult` に追加:

```js
const TENSION_LEVELS = ['low', 'medium', 'high'];
```

(ファイル冒頭、`NARRATIVE_FALLBACK` の隣)

関数内、`rawXp` の手前あたりに:

```js
  const tension_level = TENSION_LEVELS.includes(su.tension_level) ? su.tension_level : null;
```

return文を変更:

```js
  return {
    narrative,
    choices,
    stateUpdate: { current_scene, flags, history_summary, xpGain, tension_level },
  };
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/turnResult.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/turnResult.js src/api/turnResult.test.js
git commit -m "feat: GM応答のtension_levelを正規化(不正値はnullで前値保持)"
```

---

### Task 5: プロンプト/スキーマに tension_level を追加し、Play が state に保存する

**Files:**
- Modify: `src/api/prompts.js`
- Modify: `src/screens/Play.jsx`
- Test: `src/api/prompts.test.js`, `src/screens/Play.test.jsx`(追記)

**Interfaces:**
- Consumes: `normalizeTurnResult` の `stateUpdate.tension_level`(Task 4)
- Produces: `TURN_OUTPUT_FORMAT.schema.properties.state_update` に `tension_level`(enum low/medium/high, required)。`session.state.tension_level`('low'|'medium'|'high'、旧セッションはundefined→medium扱い)。Task 6 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`src/api/prompts.test.js` に追記:

```js
  it('TURN_OUTPUT_FORMATのstate_updateにtension_level(enum, required)がある', () => {
    const su = TURN_OUTPUT_FORMAT.schema.properties.state_update;
    expect(su.properties.tension_level.enum).toEqual(['low', 'medium', 'high']);
    expect(su.required).toContain('tension_level');
  });

  it('システムプロンプトにtension_levelの出力指示が含まれる', () => {
    const text = buildSystemBlocks(makeSession())[0].text;
    expect(text).toContain('tension_level');
  });

  it('毎ターンのユーザーコンテンツに現在のテンションが含まれる(未設定はmedium)', () => {
    const s = makeSession();
    expect(buildTurnUserContent(s, '進む')).toContain('テンション: medium');
    s.state.tension_level = 'high';
    expect(buildTurnUserContent(s, '進む')).toContain('テンション: high');
  });
```

(`makeSession` はファイル内の既存ヘルパーを使う。無ければ既存テストのセッション生成方法に合わせる)

`src/screens/Play.test.jsx` に追記:

```jsx
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/prompts.test.js src/screens/Play.test.jsx`
Expected: FAIL(スキーマにtension_level無し / saved.state.tension_levelがundefined)

- [ ] **Step 3: 実装**

`src/api/prompts.js`:

1. `TURN_OUTPUT_FORMAT` の `state_update.required` を
   `['current_scene', 'flags', 'history_summary', 'xp_gained', 'tension_level']` に変更。
2. `state_update.properties` に追加:

```js
          tension_level: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: '現在の場面の緊張度。緊迫・戦闘・危機=high、通常=medium、平穏・休息=low',
          },
```

3. `buildSystemBlocks` の「# 出力フィールドの書き方」に1行追加(`xp_gained` の行の後):

```
- state_update.tension_level: 現在の場面の緊張度を毎ターン更新する。緊迫した場面(戦闘・危機・追跡)=high、平穏な場面(休息・日常会話)=low、それ以外=medium。文体もこれに合わせること(highは短文を畳み掛け、lowは五感描写でゆったり)。
```

4. `buildTurnUserContent` の「# 現在の状況」に1行追加(`シーン:` の次の行):

```
テンション: ${session.state.tension_level || 'medium'}
```

`src/screens/Play.jsx` の `runTurn` 内、`updated` の `state` に追加(`xp: newXp,` の後):

```js
            tension_level: norm.stateUpdate.tension_level ?? session.state.tension_level ?? 'medium',
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/prompts.test.js src/screens/Play.test.jsx src/api/session.test.js src/api/integration.test.js`
Expected: PASS(structured outputs スキーマ変更でsession/integrationテストが影響を受けないことも確認)

- [ ] **Step 5: Commit**

```bash
git add src/api/prompts.js src/screens/Play.jsx src/api/prompts.test.js src/screens/Play.test.jsx
git commit -m "feat: tension_levelをGM応答スキーマ・プロンプト・stateに導入"
```

---

### Task 6: useTypewriter hook とPlayへの組み込み

**Files:**
- Create: `src/hooks/useTypewriter.js`
- Create: `src/hooks/useTypewriter.test.js`
- Modify: `src/screens/Play.jsx`
- Test: `src/screens/Play.test.jsx`(追記)

**Interfaces:**
- Consumes: `motionAllowed()`(Task 1)、`session.state.tension_level`(Task 5)、`initialLogLenRef`(Task 3)
- Produces: `useTypewriter(text, { speedMs, enabled }) => { shown, done, skip }`。Play内部コンポーネント `GmNarrative({ text, animate, speedMs, onDone })`。タイプ中は choices 非表示+入力欄 disabled。

- [ ] **Step 1: hookの失敗するテストを書く**

`src/hooks/useTypewriter.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTypewriter } from './useTypewriter.js';

afterEach(() => vi.useRealTimers());

describe('useTypewriter', () => {
  it('enabled=falseなら最初から全文表示でdone', () => {
    const { result } = renderHook(() => useTypewriter('こんにちは', { enabled: false }));
    expect(result.current.shown).toBe('こんにちは');
    expect(result.current.done).toBe(true);
  });

  it('enabled=trueなら1文字ずつ増え、最後にdoneになる', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypewriter('abc', { speedMs: 10, enabled: true }));
    expect(result.current.shown).toBe('');
    expect(result.current.done).toBe(false);
    act(() => vi.advanceTimersByTime(10));
    expect(result.current.shown).toBe('a');
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.shown).toBe('abc');
    expect(result.current.done).toBe(true);
  });

  it('skip()で残りを即時表示する', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypewriter('abcdef', { speedMs: 10, enabled: true }));
    act(() => vi.advanceTimersByTime(10));
    expect(result.current.done).toBe(false);
    act(() => result.current.skip());
    expect(result.current.shown).toBe('abcdef');
    expect(result.current.done).toBe(true);
  });

  it('空文字は即done', () => {
    const { result } = renderHook(() => useTypewriter('', { enabled: true }));
    expect(result.current.done).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/hooks/useTypewriter.test.js`
Expected: FAIL — モジュールが存在しない

- [ ] **Step 3: hookを実装**

`src/hooks/useTypewriter.js`:

```js
import { useEffect, useState } from 'react';

// テキストを一文字ずつ表示するためのhook。enabled=falseなら即時に全文表示。
// テキストは1エントリにつき不変である前提(Playのログエントリは追記のみ)。
export function useTypewriter(text, { speedMs = 25, enabled = true } = {}) {
  const [count, setCount] = useState(enabled ? 0 : text.length);
  const done = count >= text.length;

  useEffect(() => {
    if (!enabled || done) return;
    const t = setInterval(() => setCount((c) => Math.min(c + 1, text.length)), speedMs);
    return () => clearInterval(t);
  }, [enabled, done, speedMs, text]);

  return { shown: text.slice(0, count), done, skip: () => setCount(text.length) };
}
```

- [ ] **Step 4: hookテストが通ることを確認**

Run: `npx vitest run src/hooks/useTypewriter.test.js`
Expected: PASS

- [ ] **Step 5: Playの失敗するテストを書く**

`src/screens/Play.test.jsx` に追記:

```jsx
  it('motion許可環境では地の文がタイプ表示され、完了までchoicesが出ない', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }); // motion許可
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    // タイプ完了後に全文とchoicesが表示される(リアルタイマーで進行を待つ)
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText('進む')).toBeInTheDocument(), { timeout: 3000 });
    delete window.matchMedia;
  });
```

(注: jsdom既定=matchMedia無しの既存テストは静的表示のまま通る。このテストだけmotionを許可し、タイプ表示経路の完走を確認する)

- [ ] **Step 6: Playへ組み込む**

`src/screens/Play.jsx`:

1. import追加:

```js
import { motionAllowed } from '../theme.js';
import { useTypewriter } from '../hooks/useTypewriter.js';
```

2. テンション別タイプ速度と内部コンポーネントをファイル末尾(Playコンポーネントの外)に追加:

```jsx
// テンション別のタイプ速度(ms/字)。highは畳み掛け、lowはゆったり。
const TYPE_SPEED = { high: 15, medium: 25, low: 35 };

function GmNarrative({ text, animate, speedMs, onDone }) {
  const { shown, done, skip } = useTypewriter(text, { speedMs, enabled: animate });
  useEffect(() => {
    if (done) onDone?.();
  }, [done, onDone]);
  return (
    <div
      onClick={done ? undefined : skip}
      style={{
        fontFamily: F_BODY,
        fontSize: 15,
        lineHeight: 1.8,
        color: COLORS.inkSoft,
        whiteSpace: 'pre-wrap',
        cursor: done ? undefined : 'pointer',
      }}
    >
      {shown}
    </div>
  );
}
```

3. Play本体に状態を追加:

```js
  const [narrating, setNarrating] = useState(false);
  const handleNarrationDone = useCallback(() => setNarrating(false), []);
```

`runTurn` 内、`setSession(updated);` の直前に:

```js
        if (motionAllowed()) setNarrating(true);
```

4. GMログ描画の地の文 `<div style={{fontFamily: F_BODY, ...}}>{entry.text}</div>` を置き換え:

```jsx
              <GmNarrative
                text={entry.text}
                animate={i >= initialLogLenRef.current && i === session.log.length - 1 && narrating}
                speedMs={TYPE_SPEED[session.state.tension_level] ?? TYPE_SPEED.medium}
                onDone={i === session.log.length - 1 ? handleNarrationDone : undefined}
              />
```

5. choices表示条件に `!narrating` を追加:

```jsx
              {i === session.log.length - 1 && !narrating && entry.choices?.length > 0 && (
```

6. 入力欄と送信ボタンのdisabledを `busy || narrating` に変更(送信ボタンは `busy || narrating || !input.trim()`)。`submitFree`/`submitChoice` の先頭ガードにも `narrating` を追加(`if (!input.trim() || busy || narrating) return;` / `if (busy || narrating) return;`)。

注意(自己レビュー観点): `animate` が「narratingがtrueの間だけ」なので、タイプ完了後は `enabled=false` となり全文即時表示に切り替わる(`useTypewriter` は `enabled:false` 初期化時のみ全文になるため、**タイプ完了→done→onDone→narrating=false→enabled=false再マウントではなく同一インスタンスのprops変化**となる点に注意)。`useTypewriter` は `enabled` が途中でfalseに変わっても `count` を保持するため、完了後の再レンダリングで巻き戻らないことをStep 7のテストで確認する。もし `enabled` 変化で不整合が出る場合は、`GmNarrative` に `key={i}` を付けエントリごとに独立させること。

- [ ] **Step 7: 全テストが通ることを確認**

Run: `npx vitest run src/screens/Play.test.jsx src/hooks/useTypewriter.test.js`
Expected: PASS(既存テスト含む)

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useTypewriter.js src/hooks/useTypewriter.test.js src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "feat(ui): GM地の文のタイプライター表示(tension連動速度・クリックでスキップ)"
```

---

### Task 7: moodTheme マッピング

**Files:**
- Modify: `src/theme.js`
- Test: `src/theme.test.jsx`(追記)

**Interfaces:**
- Consumes: `src/constants/moods.js` の `MOODS`(検証用)
- Produces: `moodTheme(moods: string[] | undefined): { paper: string, accent: string }` — 先頭の既知moodの配色。無し/未知のみ/undefinedは既定(`COLORS.paper`/`COLORS.brass`)。Task 8, 9 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`src/theme.test.jsx` に追記:

```jsx
import { moodTheme, COLORS } from './theme.js';
import { MOODS } from './constants/moods.js';

describe('moodTheme', () => {
  it('moods未指定・空・未知のみは既定配色を返す', () => {
    const def = { paper: COLORS.paper, accent: COLORS.brass };
    expect(moodTheme(undefined)).toEqual(def);
    expect(moodTheme([])).toEqual(def);
    expect(moodTheme(['未知のジャンル'])).toEqual(def);
  });

  it('固定8種すべてに配色が定義されている', () => {
    for (const m of MOODS) {
      const t = moodTheme([m]);
      expect(t.paper).toMatch(/^#/);
      expect(t.accent).toMatch(/^#/);
    }
  });

  it('先頭の既知moodを優先する(未知が混ざっても飛ばす)', () => {
    expect(moodTheme(['未知', 'ホラー', '日常'])).toEqual(moodTheme(['ホラー']));
  });

  it('ホラーは既定より暗い紙色になる', () => {
    expect(moodTheme(['ホラー']).paper).not.toBe(COLORS.paper);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/theme.test.jsx`
Expected: FAIL — `moodTheme is not a function`

- [ ] **Step 3: 実装**

`src/theme.js` に追加:

```js
// 雰囲気タグ(moods)ごとの控えめな配色調整。「紙の色味が変わる」程度に留め、
// 文字色(ink/inkSoft)は可読性のため変更しない。キーはsrc/constants/moods.jsのMOODSと対応。
const MOOD_THEMES = {
  ホラー: { paper: '#DAD5CB', accent: '#4A3F45' },
  冒険: { paper: '#EDE0C4', accent: '#9C7A45' },
  ミステリー: { paper: '#DDD9CE', accent: '#3C4656' },
  日常: { paper: '#F2ECDC', accent: '#7A8A5A' },
  SF: { paper: '#DCE0DA', accent: '#33505A' },
  ファンタジー: { paper: '#EFE3C8', accent: '#7C6136' },
  コメディ: { paper: '#F3EAD2', accent: '#B0763B' },
  シリアス: { paper: '#E4DFD2', accent: '#5A5548' },
};

export function moodTheme(moods) {
  const hit = Array.isArray(moods) ? moods.find((m) => MOOD_THEMES[m]) : undefined;
  return hit ? MOOD_THEMES[hit] : { paper: COLORS.paper, accent: COLORS.brass };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/theme.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/theme.js src/theme.test.jsx
git commit -m "feat(ui): 雰囲気タグ別の配色moodTheme()を追加"
```

---

### Task 8: Setup がセッションに moods をコピーする

**Files:**
- Modify: `src/screens/Setup.jsx`
- Test: `src/screens/Setup.test.jsx`(追記)

**Interfaces:**
- Consumes: `listWorlds()`/`listScenarios()` のレスポンス(各itemに `moods: string[]` が含まれる。`server/storage/worldLibrary.js`/`scenarioLibrary.js` 参照)
- Produces: `session.moods: string[]` — World優先、無ければScenario、どちらも無ければ `[]`。Task 9 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Setup.test.jsx` の既存パターン(モックしたlistWorlds等でウィザードを進め `onStart` の引数を検証しているテスト)に合わせて追記する。検証内容:

```jsx
  // 既存Worldを選択して開始した場合、World.moodsがsession.moodsへコピーされる
  // (既存テストのウィザード操作ヘルパーに合わせて実装すること。核心のassertは以下)
  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ moods: ['ホラー', 'ミステリー'] }));
```

さらにWorld未選択(skip)時:

```jsx
  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ moods: [] }));
```

モックする `listWorlds` の返り値のitemに `moods: ['ホラー', 'ミステリー']` を含めること。

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: FAIL — `moods` が `undefined`

- [ ] **Step 3: 実装**

`src/screens/Setup.jsx` のセッション生成オブジェクト(240行付近 `const session = {...}`)に追加(`scenario: { raw: scenario },` の後):

```js
        // 雰囲気タグ: World優先、無ければScenarioから継承(Play画面の配色に使う)
        moods:
          (worldMode === 'existing' && selectedWorld?.moods?.length
            ? selectedWorld.moods
            : scenarioMode === 'existing' && selectedScenario?.moods?.length
            ? selectedScenario.moods
            : []),
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/Setup.jsx src/screens/Setup.test.jsx
git commit -m "feat: セッション作成時にWorld/Scenarioの雰囲気タグをsession.moodsへ継承"
```

---

### Task 9: Play に雰囲気テーマを適用 + ドキュメント更新

**Files:**
- Modify: `src/screens/Play.jsx`
- Modify: `docs/05-ui-ux.md`, `docs/08-feature-ideas.md`
- Test: `src/screens/Play.test.jsx`(追記)

**Interfaces:**
- Consumes: `moodTheme(session.moods)`(Task 7, 8)

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Play.test.jsx` に追記:

```jsx
  it('session.moodsに応じてPlay画面の背景色が変わる(無ければ既定)', () => {
    const session = makeSession({ moods: ['ホラー'], log: [{ role: 'gm', text: '既存のログ' }] });
    const { container } = renderWithAuth(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    expect(container.firstChild.style.background).toBeTruthy();
    // 既定セッション(moods無し)とは背景が異なる
    const plain = renderWithAuth(
      <Play session={makeSession({ log: [{ role: 'gm', text: 'ログ' }] })} setSession={vi.fn()} onExit={vi.fn()} />
    );
    expect(container.firstChild.style.background).not.toBe(plain.container.firstChild.style.background);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: FAIL(背景未設定または同一)

- [ ] **Step 3: 実装**

`src/screens/Play.jsx`:

1. import変更: `import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle, motionAllowed, moodTheme } from '../theme.js';`
2. Play本体の冒頭で:

```js
  const mood = moodTheme(session.moods);
```

3. ルートdivのstyleに `background: mood.paper,` を追加。
4. 下部固定入力バーの `background: COLORS.paper,` を `background: mood.paper,` に変更。
5. ヘッダーのセッションタイトル色 `color: COLORS.ink` はそのまま、シーン表示の下線等は変更しない(控えめ方針)。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS

- [ ] **Step 5: 全体テスト**

Run: `npm test`
Expected: 全suite PASS

- [ ] **Step 6: ドキュメント更新**

- `docs/05-ui-ux.md` 7章: キャラシートパネル以外の記述を更新 — ダイス演出・タイプライター(クリックでスキップ、`prefers-reduced-motion`対応)・moods連動配色を「実装済み」として追記。13.2章: `tension_level`(low/medium/high)を`state_update`とstateに実装済みである旨へ書き換え(「検討可(Phase 2以降)」の記述を更新)。
- `docs/08-feature-ideas.md` 1.2: 冒頭に「**実装済み(2026-07-24)**」を追記。

- [ ] **Step 7: Commit**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx docs/05-ui-ux.md docs/08-feature-ideas.md
git commit -m "feat(ui): Play画面に雰囲気連動テーマを適用しdocsを実装済みに更新"
```
