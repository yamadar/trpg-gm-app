# キャラシート常設パネル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play画面にPCシート・goal/bonds・成長ポイント・既知フラグ(入手情報)を表示するパネルを追加し、広い画面では右端に常設、狭い画面ではヘッダーの「PC」トグルでドロワー表示する。

**Architecture:** matchMediaベースの `useMediaQuery` フックで docked/drawer を切り替え、presentationalな `CharacterPanel` がセッションを読み取り表示する。Playは開閉状態とbackdrop、ドッキング時の本文オフセットのみ管理。読み取り専用で新規API・データモデル変更なし。

**Tech Stack:** React 18 + vitest + @testing-library/react。既存のインラインstyle+`theme.js`方式。新規依存なし。

## Global Constraints

- ドッキングのブレークポイント: `(min-width: 1024px)`。パネル幅: 320px。
- matchMedia非対応環境(jsdomテスト・SSR)は `docked=false`(トグル+ドロワー)に倒す。
- パネルは**読み取り専用**(入力・保存・API呼び出しをしない)。
- 表示: 成長点ラベルは `session.ruleset?.growthUnit || '経験値'`、xpは `session.state.xp || 0`。flags空は「まだなし」、pc.raw無しは「(PC設定なし)」。
- UI文言・コメントは日本語。新規npm依存禁止。コミット末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- テスト: 個別 `npx vitest run <path>`、全体 `npm test`。

## ファイル構成

- Create: `src/hooks/useMediaQuery.js`(+test), `src/components/play/CharacterPanel.jsx`(+test)
- Modify: `src/screens/Play.jsx`(+test), `docs/05-ui-ux.md`, `docs/08-feature-ideas.md`

---

### Task 1: useMediaQuery フック

**Files:**
- Create: `src/hooks/useMediaQuery.js`
- Create: `src/hooks/useMediaQuery.test.js`

**Interfaces:**
- Produces: `useMediaQuery(query: string) -> boolean`。Task 3 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`src/hooks/useMediaQuery.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery.js';

afterEach(() => {
  delete window.matchMedia;
});

function mockMatchMedia(initialMatches) {
  let handler;
  const mql = {
    matches: initialMatches,
    addEventListener: (_e, h) => {
      handler = h;
    },
    removeEventListener: vi.fn(),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return {
    fire: (matches) => {
      mql.matches = matches;
      act(() => handler({ matches }));
    },
    mql,
  };
}

describe('useMediaQuery', () => {
  it('returns false when matchMedia is unavailable', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(false);
  });
  it('returns the initial matches value', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(true);
  });
  it('updates when the media query change event fires', () => {
    const ctrl = mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(false);
    ctrl.fire(true);
    expect(result.current).toBe(true);
  });
  it('removes its listener on unmount', () => {
    const ctrl = mockMatchMedia(true);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    unmount();
    expect(ctrl.mql.removeEventListener).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/hooks/useMediaQuery.test.js`
Expected: FAIL — モジュールなし

- [ ] **Step 3: 実装**

`src/hooks/useMediaQuery.js`:

```js
import { useEffect, useState } from 'react';

// メディアクエリの一致状態を購読する。matchMedia非対応環境(SSR/テスト)ではfalse。
export function useMediaQuery(query) {
  const getMatch = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [matches, setMatches] = useState(getMatch);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
```

- [ ] **Step 4: テスト確認 → Commit**

Run: `npx vitest run src/hooks/useMediaQuery.test.js` → PASS

```bash
git add src/hooks/useMediaQuery.js src/hooks/useMediaQuery.test.js
git commit -m "feat(ui): メディアクエリ購読フックuseMediaQueryを追加"
```

---

### Task 2: CharacterPanel コンポーネント

**Files:**
- Create: `src/components/play/CharacterPanel.jsx`
- Create: `src/components/play/CharacterPanel.test.jsx`

**Interfaces:**
- Produces: `<CharacterPanel session docked onClose />`。`docked` false時のみ「×」閉じるボタンを表示し `onClose` を呼ぶ。Task 3 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/play/CharacterPanel.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CharacterPanel from './CharacterPanel.jsx';

function makeSession(overrides = {}) {
  return {
    ruleset: { growthUnit: 'CP' },
    pc: { raw: 'PC名: カイ\n能力: 弓', goal: '村を守る', bonds: '村長は恩人' },
    state: { xp: 7, flags: { 鍵入手: true, 村人の信頼: 3 } },
    ...overrides,
  };
}

describe('CharacterPanel', () => {
  it('PCシート本文・goal/bonds・成長点(growthUnitラベル)を表示する', () => {
    render(<CharacterPanel session={makeSession()} docked />);
    expect(screen.getByText(/PC名: カイ/)).toBeInTheDocument();
    expect(screen.getByText(/村を守る/)).toBeInTheDocument();
    expect(screen.getByText(/村長は恩人/)).toBeInTheDocument();
    expect(screen.getByText('CP: 7')).toBeInTheDocument();
  });
  it('既知フラグをkey = valueで一覧表示する', () => {
    render(<CharacterPanel session={makeSession()} docked />);
    expect(screen.getByText('鍵入手 = true')).toBeInTheDocument();
    expect(screen.getByText('村人の信頼 = 3')).toBeInTheDocument();
  });
  it('フラグが空なら「まだなし」を表示する', () => {
    render(<CharacterPanel session={makeSession({ state: { xp: 0, flags: {} } })} docked />);
    expect(screen.getByText('まだなし')).toBeInTheDocument();
  });
  it('pc.rawが無ければプレースホルダを表示する', () => {
    render(<CharacterPanel session={makeSession({ pc: { raw: '' } })} docked />);
    expect(screen.getByText('(PC設定なし)')).toBeInTheDocument();
  });
  it('growthUnit未設定なら「経験値」ラベルになる', () => {
    render(<CharacterPanel session={makeSession({ ruleset: undefined })} docked />);
    expect(screen.getByText('経験値: 7')).toBeInTheDocument();
  });
  it('docked時は閉じるボタンを出さない', () => {
    render(<CharacterPanel session={makeSession()} docked />);
    expect(screen.queryByLabelText('パネルを閉じる')).not.toBeInTheDocument();
  });
  it('docked=false時は閉じるボタンでonCloseを呼ぶ', () => {
    const onClose = vi.fn();
    render(<CharacterPanel session={makeSession()} docked={false} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('パネルを閉じる'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/components/play/CharacterPanel.test.jsx`
Expected: FAIL — モジュールなし

- [ ] **Step 3: 実装**

`src/components/play/CharacterPanel.jsx`:

```jsx
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';

const PANEL_WIDTH = 320;

export default function CharacterPanel({ session, docked, onClose }) {
  const growthUnit = session.ruleset?.growthUnit || '経験値';
  const xp = session.state?.xp || 0;
  const raw = session.pc?.raw?.trim();
  const goal = session.pc?.goal;
  const bonds = session.pc?.bonds;
  const flags = Object.entries(session.state?.flags || {});

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: PANEL_WIDTH,
        maxWidth: '85vw',
        background: COLORS.card,
        borderLeft: `1px solid ${COLORS.line}`,
        boxShadow: docked ? 'none' : '-8px 0 24px rgba(0,0,0,0.2)',
        overflowY: 'auto',
        padding: '20px 18px',
        boxSizing: 'border-box',
        zIndex: 20,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 16, color: COLORS.ink }}>PCシート</div>
        {!docked && (
          <button
            aria-label="パネルを閉じる"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 18, color: COLORS.faint, cursor: 'pointer' }}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginBottom: 12 }}>
        {growthUnit}: {xp}
      </div>

      {goal && (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.brassDark, marginBottom: 4 }}>目標: {goal}</div>
      )}
      {bonds && (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.brassDark, marginBottom: 12 }}>因縁: {bonds}</div>
      )}

      <div
        style={{
          fontFamily: F_BODY,
          fontSize: 13,
          lineHeight: 1.7,
          color: COLORS.inkSoft,
          whiteSpace: 'pre-wrap',
          borderTop: `1px solid ${COLORS.line}`,
          paddingTop: 12,
          marginTop: 8,
        }}
      >
        {raw || '(PC設定なし)'}
      </div>

      <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginTop: 16, marginBottom: 6 }}>
        入手情報
      </div>
      {flags.length === 0 ? (
        <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>まだなし</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {flags.map(([k, v]) => (
            <div key={k} style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.inkSoft }}>
              {k} = {String(v)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: テスト確認 → Commit**

Run: `npx vitest run src/components/play/CharacterPanel.test.jsx` → PASS

```bash
git add src/components/play/CharacterPanel.jsx src/components/play/CharacterPanel.test.jsx
git commit -m "feat(ui): PCシート表示のCharacterPanelを追加"
```

---

### Task 3: Play画面へのパネル統合

**Files:**
- Modify: `src/screens/Play.jsx`
- Test: `src/screens/Play.test.jsx`(追記)

**Interfaces:**
- Consumes: `useMediaQuery`(Task 1)、`CharacterPanel`(Task 2)。

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Play.test.jsx` に追記(既存の `describe('Play', ...)` 内):

```jsx
  it('非ドッキング時は「PC」トグルでパネルの開閉ができる', async () => {
    const session = makeSession({ pc: { raw: 'PC名: テスト猟師' }, log: [{ role: 'gm', text: 'ログ' }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    // 既定(matchMedia無し=非ドッキング)はパネル非表示
    expect(screen.queryByText('PC名: テスト猟師')).not.toBeInTheDocument();
    // 「PC」トグルで開く
    fireEvent.click(screen.getByText('PC'));
    expect(screen.getByText('PC名: テスト猟師')).toBeInTheDocument();
    // 閉じるボタンで閉じる
    fireEvent.click(screen.getByLabelText('パネルを閉じる'));
    expect(screen.queryByText('PC名: テスト猟師')).not.toBeInTheDocument();
  });
```

注意: `makeSession` 既定は `state` に `xp` などを含むが、`flags` 未定義でもCharacterPanelは安全。既存の `makeSession` は `state: { current_scene:'冒頭', flags:{}, ... }` を持つ。

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: 追記分FAIL(「PC」トグルが無い)

- [ ] **Step 3: 実装**

`src/screens/Play.jsx`:

1. import追加:

```jsx
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import CharacterPanel from '../components/play/CharacterPanel.jsx';
```

2. コンポーネント本体、`const mood = moodTheme(session.moods);` の下あたりに:

```jsx
  const docked = useMediaQuery('(min-width: 1024px)');
  const [panelOpen, setPanelOpen] = useState(false);
  const PANEL_W = 320;
```

3. ヘッダーの操作群(`{imageGen && (<label>…</label>)}` の直前、`<div style={{ display: 'flex', alignItems: 'center' }}>` の内側先頭)に「PC」トグルを追加:

```jsx
          {!docked && (
            <Button variant="ghost" onClick={() => setPanelOpen((v) => !v)} style={{ marginRight: 12 }}>
              PC
            </Button>
          )}
```

4. ルート `div` の style に、ドッキング時のみ右オフセットを付ける。既存:

```jsx
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 20px 140px',
        minHeight: '100vh',
        background: mood.paper,
      }}
```

を、`padding` の右を条件付きに:

```jsx
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 20px 140px',
        minHeight: '100vh',
        background: mood.paper,
        ...(docked ? { paddingRight: PANEL_W + 20 } : {}),
      }}
```

5. 下部固定入力バーの外側 `div`(`position:'fixed', bottom:0, left:0, right:0, …`)の `right` を条件付きに:

```jsx
          right: docked ? PANEL_W : 0,
```

6. ルート `div` の閉じタグ直前(`</div>` の最後、returnの最外 `div` 内末尾)にパネル描画を追加:

```jsx
      {docked ? (
        <CharacterPanel session={session} docked />
      ) : (
        panelOpen && (
          <>
            <div
              onClick={() => setPanelOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 19 }}
            />
            <CharacterPanel session={session} docked={false} onClose={() => setPanelOpen(false)} />
          </>
        )
      )}
```

- [ ] **Step 4: テスト確認**

Run: `npx vitest run src/screens/Play.test.jsx` → PASS(既存含む)

- [ ] **Step 5: Commit**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "feat(ui): Play画面にキャラシートパネル(常設/ドロワー)を統合"
```

---

### Task 4: ドキュメント更新 + 全体テスト

**Files:**
- Modify: `docs/05-ui-ux.md`, `docs/08-feature-ideas.md`

- [ ] **Step 1: docs更新**

- `docs/05-ui-ux.md` 7章「キャラシートパネル: **未実装**」の記述を実装済みへ更新: Play画面に、広い画面(`min-width:1024px`)では右端常設・狭い画面ではヘッダー「PC」トグルのドロワーで、PCシート本文・goal/bonds・成長ポイント・既知フラグ(入手情報)を読み取り表示する(`src/components/play/CharacterPanel.jsx`、`src/hooks/useMediaQuery.js`)。HPはデータモデルに無く非対象。編集はライブラリのCharacterタブのまま。
- `docs/08-feature-ideas.md` 1.3: 「実装済み(2026-07-24)」を追記。

- [ ] **Step 2: 全体テスト**

Run: `npm test`
Expected: 全suite PASS

- [ ] **Step 3: Commit**

```bash
git add docs/05-ui-ux.md docs/08-feature-ideas.md
git commit -m "docs: キャラシート常設パネル(1.3)を実装済みとして反映"
```
