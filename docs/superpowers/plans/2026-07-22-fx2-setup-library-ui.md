# 監査修正 FX2: Setup/ライブラリUI整合性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Setupウィザードと素材ライブラリ画面の状態リーク・並行操作・URLエンコード・削除二重発火・エラー可視化の不具合を修正する。

**Architecture:** 6タスク。API clientのエンコード(Task 1)、ConfirmModal無効化(Task 2)、refresh/Libraryエラー処理(Task 3)、WorldTabキャンセルガード(Task 4)、Homeダウンロード/並行(Task 5)、makeId+Setup整合(Task 6)。各タスクはほぼ独立。

**Tech Stack:** React 18 + Vite、Vitest + @testing-library/react

## Global Constraints

- `"type": "module"`(ESM)。`require()`は使わない。
- パスセグメントに使うユーザー由来の値は`encodeURIComponent`でエンコードする。
- 削除・小説化・保存等の非同期処理中は対象ボタンを無効化する(二重発火防止)。
- エラー表示は`COLORS.stamp`色、成功時にクリアする。
- 既存の単純idを使うテストは`encodeURIComponent`後も不変(`encodeURIComponent('w1')==='w1'`)。
- 各タスクの最後は該当ファイルのみをステージしてコミットする。

---

## Task 1: API clientのURLエンコード

**Files:**
- Modify: `src/api/worldLibraryClient.js`, `src/api/worldLibraryClient.test.js`
- Modify: `src/api/characterLibraryClient.js`, `src/api/characterLibraryClient.test.js`
- Modify: `src/api/scenarioLibraryClient.js`, `src/api/scenarioLibraryClient.test.js`
- Modify: `src/api/rulesetLibraryClient.js`, `src/api/rulesetLibraryClient.test.js`
- Modify: `src/api/sessionSyncClient.js`, `src/api/sessionSyncClient.test.js`

**Interfaces:** シグネチャ不変。URL構築のみ変更。

- [ ] **Step 1: 各clientテストにエンコード検証を1件ずつ追記(失敗する状態)**

`src/api/worldLibraryClient.test.js`末尾に追記:
```js
describe('URL encoding', () => {
  it('encodes special characters in the world id for getWorld', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await getWorld('a/b#c');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/a%2Fb%23c', expect.objectContaining({ method: 'GET' }));
  });
});
```

`src/api/characterLibraryClient.test.js`末尾に追記:
```js
describe('URL encoding', () => {
  it('encodes worldId/kind/name segments for getCharacter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await getCharacter('w#1', 'pc', 'a/b');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w%231/characters/pc/a%2Fb',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
```

`src/api/scenarioLibraryClient.test.js`末尾に追記:
```js
describe('URL encoding', () => {
  it('encodes worldId/id segments for getScenario', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await getScenario('w#1', 's/2');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w%231/scenarios/s%2F2',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
```

`src/api/rulesetLibraryClient.test.js`末尾に追記:
```js
describe('URL encoding', () => {
  it('encodes special characters in the ruleset id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await getRuleset('a/b');
    expect(fetchMock).toHaveBeenCalledWith('/api/rulesets/a%2Fb', expect.objectContaining({ method: 'GET' }));
  });
});
```

`src/api/sessionSyncClient.test.js`末尾に追記:
```js
describe('URL encoding', () => {
  it('encodes the session id for novelizeSession', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await novelizeSession('s/1');
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s%2F1/novelize', expect.objectContaining({ method: 'POST' }));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/worldLibraryClient.test.js src/api/characterLibraryClient.test.js src/api/scenarioLibraryClient.test.js src/api/rulesetLibraryClient.test.js src/api/sessionSyncClient.test.js`
Expected: FAIL(未エンコード)

- [ ] **Step 3: 各clientのURL補間を`encodeURIComponent`でラップする**

各ファイルで、パスセグメントに使う変数(`id`/`worldId`/`kind`/`name`/`region`/`category`/`session.id`)を`encodeURIComponent(...)`で包む。例(`scenarioLibraryClient.js`):
```js
export async function getScenario(worldId, id) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios/${encodeURIComponent(id)}`, { method: 'GET' });
}
export async function putScenario(worldId, id, { title, raw, recommendedRuleset }) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, raw, recommendedRuleset }),
  });
}
export async function listScenarios(worldId) {
  return apiFetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios`, { method: 'GET' });
}
export async function deleteScenario(worldId, id) {
  const res = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/scenarios/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
```
`worldLibraryClient.js`は`id`/`worldId`/`region`/`category`、`characterLibraryClient.js`は`worldId`/`kind`/`name`、`rulesetLibraryClient.js`は`id`、`sessionSyncClient.js`は`session.id`(`putSessionToServer`)/`id`(`novelizeSession`/`getNovel`)を同様にエンコードする。**bodyの`JSON.stringify`は変更しない**(URLセグメントのみ対象)。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/worldLibraryClient.test.js src/api/characterLibraryClient.test.js src/api/scenarioLibraryClient.test.js src/api/rulesetLibraryClient.test.js src/api/sessionSyncClient.test.js`
Expected: 全PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/worldLibraryClient.js src/api/worldLibraryClient.test.js src/api/characterLibraryClient.js src/api/characterLibraryClient.test.js src/api/scenarioLibraryClient.js src/api/scenarioLibraryClient.test.js src/api/rulesetLibraryClient.js src/api/rulesetLibraryClient.test.js src/api/sessionSyncClient.js src/api/sessionSyncClient.test.js
git commit -m "fix(frontend): encode user-supplied ids in all API client URLs"
```

---

## Task 2: ConfirmModalの削除ボタン無効化

**Files:**
- Modify: `src/components/library/ConfirmModal.jsx`, `src/components/library/ConfirmModal.test.jsx`
- Modify: `src/screens/library/WorldTab.jsx`, `src/screens/library/CharacterTab.jsx`, `src/screens/library/ScenarioTab.jsx`, `src/screens/library/RulesetTab.jsx`

**Interfaces:** `ConfirmModal`に任意prop`confirmDisabled`追加。

- [ ] **Step 1: `ConfirmModal.test.jsx`にテストを追記(失敗する状態)**

```jsx
  it('disables the confirm button when confirmDisabled is true', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmModal open={true} message="削除しますか?" confirmDisabled onConfirm={onConfirm} onCancel={vi.fn()} />
    );
    const btn = screen.getByText('削除する');
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onConfirm).not.toHaveBeenCalled();
  });
```
(既存テストで`fireEvent`が未importなら冒頭importに追加すること)

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/library/ConfirmModal.test.jsx`
Expected: FAIL(`confirmDisabled`未対応)

- [ ] **Step 3: `ConfirmModal.jsx`を修正**

シグネチャに`confirmDisabled`を追加し、削除ボタンに渡す:
```jsx
export default function ConfirmModal({ open, message, confirmDisabled, onConfirm, onCancel }) {
```
```jsx
          <Button variant="brass" onClick={onConfirm} disabled={confirmDisabled}>
            削除する
          </Button>
```

- [ ] **Step 4: 各タブの`<ConfirmModal>`に`confirmDisabled={busy}`を追加**

`WorldTab.jsx`/`CharacterTab.jsx`/`ScenarioTab.jsx`/`RulesetTab.jsx`のそれぞれの`<ConfirmModal open={... }`に`confirmDisabled={busy}`propを追加する(既存の`open`/`message`/`onConfirm`/`onCancel`はそのまま)。

- [ ] **Step 5: テストが通ることを確認 + 全体テスト**

Run: `npx vitest run src/components/library/ConfirmModal.test.jsx && npx vitest run`
Expected: 全PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/library/ConfirmModal.jsx src/components/library/ConfirmModal.test.jsx src/screens/library/WorldTab.jsx src/screens/library/CharacterTab.jsx src/screens/library/ScenarioTab.jsx src/screens/library/RulesetTab.jsx
git commit -m "fix(frontend): disable ConfirmModal delete button while a delete is in flight"
```

---

## Task 3: refresh/Library.refreshWorldsのエラー処理

**Files:**
- Modify: `src/screens/library/CharacterTab.jsx`, `src/screens/library/ScenarioTab.jsx`, `src/screens/library/RulesetTab.jsx`
- Modify: `src/screens/Library.jsx`, `src/screens/Library.test.jsx`

**Interfaces:** `Library`にエラー表示state追加。

- [ ] **Step 1: `Library.test.jsx`にテストを追記(失敗する状態)**

`describe('Library', ...)`内に追記:
```jsx
  it('shows an error banner when listWorlds fails on mount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }));
    render(<Library onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/World一覧の取得に失敗した/)).toBeInTheDocument());
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Library.test.jsx`
Expected: FAIL(エラー表示未実装、`refreshWorlds`が例外を握らずunhandled)

- [ ] **Step 3: `Library.jsx`の`refreshWorlds`をtry/catch化しエラー表示を追加**

`selectedWorldId` stateの直後に:
```js
  const [worldsError, setWorldsError] = useState('');
```
(`useState`のimportは既にある)

`refreshWorlds`を次に置き換える:
```js
  const refreshWorlds = useCallback(async () => {
    try {
      setWorlds(await listWorlds());
      setWorldsError('');
    } catch (e) {
      setWorldsError('World一覧の取得に失敗した: ' + e.message);
    }
  }, []);
```

「素材ライブラリ」見出しのある`div`の直後(タブ行の前)にエラー表示を追加:
```jsx
      {worldsError && (
        <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{worldsError}</div>
      )}
```
(`COLORS`は既にimport済み)

- [ ] **Step 4: Character/Scenario/Rulesetタブの`refresh`で成功時にエラーをクリア**

各タブの`refresh`関数(`async function refresh() { ... }`)の`try`ブロック先頭で`setError('')`を呼ぶ。例(`ScenarioTab.jsx`):
```js
  async function refresh() {
    if (!worldId) return;
    try {
      setError('');
      setScenarios(await listScenarios(worldId));
    } catch (e) {
      setError('一覧取得に失敗した: ' + e.message);
    }
  }
```
`CharacterTab.jsx`(`setCharacters(await listCharacters(worldId, kind))`の前に`setError('')`)、`RulesetTab.jsx`(`setRulesets(await listRulesets())`の前に`setError('')`)も同様。

- [ ] **Step 5: テストが通ることを確認 + 全体テスト**

Run: `npx vitest run src/screens/Library.test.jsx && npx vitest run`
Expected: 全PASS

- [ ] **Step 6: Commit**

```bash
git add src/screens/Library.jsx src/screens/Library.test.jsx src/screens/library/CharacterTab.jsx src/screens/library/ScenarioTab.jsx src/screens/library/RulesetTab.jsx
git commit -m "fix(frontend): surface Library world-list errors and clear stale tab errors on refresh"
```

---

## Task 4: WorldTabのWorld切替リセット + キャンセルガード

**Files:**
- Modify: `src/screens/library/WorldTab.jsx`, `src/screens/library/WorldTab.test.jsx`

**Interfaces:** インターフェース不変。内部にキャンセルガード追加。

- [ ] **Step 1: `WorldTab.test.jsx`にテストを追記(失敗する状態)**

`describe('WorldTab', ...)`内に追記(既存のモック方式=名前空間spyに合わせる):
```jsx
  it('does not apply a late getRegion result after the world was switched', async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockImplementation((id) =>
      Promise.resolve({ id, title: id === 'w1' ? 'Waterdeep' : 'Neverwinter', raw: '原文' })
    );
    worldLibraryClient.listRegions.mockImplementation((id) => Promise.resolve(id === 'w1' ? ['harbor'] : []));
    worldLibraryClient.listCategories.mockResolvedValue([]);
    let resolveRegion;
    vi.spyOn(worldLibraryClient, 'getRegion').mockReturnValue(
      new Promise((r) => {
        resolveRegion = r;
      })
    );

    const worlds = [
      { id: 'w1', title: 'Waterdeep', updatedAt: 1 },
      { id: 'w2', title: 'Neverwinter', updatedAt: 2 },
    ];
    const { rerender } = render(
      <WorldTab worlds={worlds} selectedWorldId="w1" onSelectWorld={vi.fn()} onWorldsChanged={vi.fn().mockResolvedValue()} />
    );
    await waitFor(() => expect(screen.getByText('harbor')).toBeInTheDocument());
    fireEvent.click(screen.getByText('編集'));
    // まだgetRegionは未解決。この間にWorldを切り替える。
    rerender(
      <WorldTab worlds={worlds} selectedWorldId="w2" onSelectWorld={vi.fn()} onWorldsChanged={vi.fn().mockResolvedValue()} />
    );
    await waitFor(() => expect(screen.getByDisplayValue('Neverwinter')).toBeInTheDocument());
    // 遅れてw1のregionが解決しても、編集テキストエリアには反映されない。
    await act(async () => {
      resolveRegion({ id: 'harbor', raw: 'w1の港の本文(stale)' });
    });
    expect(screen.queryByDisplayValue('w1の港の本文(stale)')).not.toBeInTheDocument();
  });
```
(`act`が未importなら`@testing-library/react`のimportに追加。`beforeEach`で`listRegions`/`listCategories`が既定モックされている前提—既存のWorldTab.test.jsxの`beforeEach`を確認して整合させること。)

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/library/WorldTab.test.jsx`
Expected: FAIL(遅延getRegionが反映されてしまう)

- [ ] **Step 3: `WorldTab.jsx`にworldEpochガードとリセットを追加**

importに`useRef`を追加(既にあれば不要):
```js
import { useState, useEffect, useRef } from 'react';
```

state群の近くにepoch refを追加:
```js
  const worldEpochRef = useRef(0);
```

`[selectedWorldId]`のeffect(`getWorld`/`listRegions`/`listCategories`を呼ぶもの)の冒頭で、epochを進め編集状態もリセットする。effect先頭(`if (!selectedWorldId) {...}`の後、`setRegions([])`等の並び)に追加:
```js
    worldEpochRef.current += 1;
    setEditingRegionId(null);
    setRegionDraft('');
    setEditingCategoryId(null);
    setCategoryDraft('');
```
(既存の`setRegions([])`/`setCategories([])`/`setError('')`はそのまま残す)

`startEditingRegion`を次に置き換える:
```js
  async function startEditingRegion(region) {
    setEditingRegionId(region.id);
    if (region.content !== null) {
      setRegionDraft(region.content);
      return;
    }
    const epoch = worldEpochRef.current;
    try {
      const full = await getRegion(selectedWorldId, region.id);
      if (worldEpochRef.current !== epoch) return;
      setRegionDraft(full.raw);
    } catch (e) {
      if (worldEpochRef.current === epoch) setError('地域の取得に失敗した: ' + e.message);
    }
  }
```

`startEditingCategory`も同様に:
```js
  async function startEditingCategory(category) {
    setEditingCategoryId(category.id);
    if (category.content !== null) {
      setCategoryDraft(category.content);
      return;
    }
    const epoch = worldEpochRef.current;
    try {
      const full = await getCategory(selectedWorldId, category.id);
      if (worldEpochRef.current !== epoch) return;
      setCategoryDraft(full.raw);
    } catch (e) {
      if (worldEpochRef.current === epoch) setError('カテゴリの取得に失敗した: ' + e.message);
    }
  }
```

- [ ] **Step 4: テストが通ることを確認 + 全体テスト**

Run: `npx vitest run src/screens/library/WorldTab.test.jsx && npx vitest run`
Expected: 全PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/library/WorldTab.jsx src/screens/library/WorldTab.test.jsx
git commit -m "fix(frontend): reset WorldTab edit state and guard late region/category fetches on world switch"
```

---

## Task 5: Homeの並行小説化 + ダウンロード堅牢化

**Files:**
- Modify: `src/screens/Home.jsx`, `src/screens/Home.test.jsx`

**Interfaces:** インターフェース不変。

- [ ] **Step 1: `Home.test.jsx`にテストを追記(失敗する状態)**

`sanitizeFilename`は`Home.jsx`から名前付きexportし、脆いDOMモックを避けて直接ユニットテストする。ファイル冒頭のimportを`import Home, { sanitizeFilename } from './Home.jsx';`に変更する。`describe('Home', ...)`内に追記:
```jsx
  it('sanitizes filesystem-unsafe and dot-only titles', () => {
    expect(sanitizeFilename('a/b:c')).toBe('a_b_c');
    expect(sanitizeFilename('..')).toBe('session');
    expect(sanitizeFilename('')).toBe('session');
    expect(sanitizeFilename('普通のタイトル')).toBe('普通のタイトル');
  });

  it('keeps each session novelize button independent (concurrent guard is per-session)', async () => {
    let resolveA;
    vi.spyOn(sessionSyncClient, 'novelizeSession').mockImplementation((id) =>
      id === 's1'
        ? new Promise((r) => {
            resolveA = r;
          })
        : Promise.resolve({ ok: true })
    );
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({ text: '本文' });
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:x'), revokeObjectURL: vi.fn() });

    const sessions = [
      { id: 's1', title: 'A', updatedAt: 2, state: {}, log: [] },
      { id: 's2', title: 'B', updatedAt: 1, state: {}, log: [] },
    ];
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    const buttons = screen.getAllByText('小説化');
    fireEvent.click(buttons[0]); // s1の小説化を開始(pendingのまま)
    await waitFor(() => expect(screen.getByText('小説化中…')).toBeInTheDocument());
    // s1が「小説化中…」になっても、s2のボタンは独立して「小説化」のまま(単一ガードではない)
    expect(screen.getAllByText('小説化').length).toBe(1);
    if (resolveA) resolveA({ ok: true });
    vi.restoreAllMocks();
  });
```
(注: `Home`のデフォルトimportと`sanitizeFilename`の名前付きimportを1行で併記すること。既存の`import Home from './Home.jsx';`を上記に置き換える。)

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: FAIL

- [ ] **Step 3: `Home.jsx`を修正**

`novelizingId`(単一state)を複数対応に変更する。現在:
```js
  const [novelizingId, setNovelizingId] = useState(null);
  const [novelizeError, setNovelizeError] = useState({});
```
を次に置き換える:
```js
  const [novelizing, setNovelizing] = useState({});
  const [novelizeError, setNovelizeError] = useState({});
```

`sanitizeFilename`を名前付きexportにし、ドットのみ/空のフォールバックを追加:
```js
export function sanitizeFilename(title) {
  const cleaned = (title || 'session').replace(/[\\/:*?"<>|]/g, '_');
  const trimmed = cleaned.replace(/^\.+/, '').trim();
  return trimmed.length > 0 ? cleaned : 'session';
}
```
(注: `".."`→`replace(/[\\/:*?"<>|]/g,'_')`はドットを消さないので`".."`のまま→`replace(/^\.+/,'')`で`''`→フォールバック`'session'`。`"a/b"`→`"a_b"`は先頭ドット無しなので`"a_b"`のまま。)

`handleNovelize`を次に置き換える:
```js
  async function handleNovelize(e, session) {
    e.stopPropagation();
    setNovelizing((prev) => ({ ...prev, [session.id]: true }));
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      await novelizeSession(session.id);
      const { text } = await getNovel(session.id);
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(session.title)}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: '小説化に失敗した: ' + err.message }));
    } finally {
      setNovelizing((prev) => {
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
    }
  }
```

小説化ボタンの`disabled`/ラベルを`novelizing[s.id]`に変更:
```jsx
                    <Button
                      variant="ghost"
                      onClick={(e) => handleNovelize(e, s)}
                      disabled={!!novelizing[s.id]}
                      style={{ fontSize: 11, padding: '4px 8px' }}
                    >
                      {novelizing[s.id] ? '小説化中…' : '小説化'}
                    </Button>
```

- [ ] **Step 4: テストが通ることを確認 + 全体テスト**

Run: `npx vitest run src/screens/Home.test.jsx && npx vitest run`
Expected: 全PASS

- [ ] **Step 5: Commit**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "fix(frontend): per-session novelize guard, DOM-attached download anchor, dot-only filename fallback"
```

---

## Task 6: makeIdユーティリティ + Setupの状態リーク/中断/エラー可視化

**Files:**
- Create: `src/utils/makeId.js`, `src/utils/makeId.test.js`
- Modify: `src/screens/Setup.jsx`, `src/screens/Setup.test.jsx`

**Interfaces:**
- Produces: `makeId(base)` → `string`(`slugify(base) + '-' + Date.now() + '-' + <4桁base36乱数>`)。

- [ ] **Step 1: `src/utils/makeId.test.js`を書く(失敗する状態)**

```js
import { describe, it, expect } from 'vitest';
import { makeId } from './makeId.js';

describe('makeId', () => {
  it('starts with the slugified base and includes a timestamp and random suffix', () => {
    const id = makeId('Test World');
    expect(id).toMatch(/^testworld-\d+-[a-z0-9]{4}$/);
  });

  it('produces distinct ids for rapid successive calls (random component)', () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeId('x')));
    expect(ids.size).toBe(50);
  });

  it('falls back to untitled for a non-ascii base', () => {
    expect(makeId('日本語').startsWith('untitled-')).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/makeId.test.js`
Expected: FAIL

- [ ] **Step 3: `src/utils/makeId.js`を実装**

```js
import { slugify } from './slugify.js';

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

export function makeId(base) {
  return `${slugify(base || 'untitled')}-${Date.now()}-${randomSuffix()}`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/utils/makeId.test.js`
Expected: PASS(3 tests)

- [ ] **Step 5: `src/screens/Setup.test.jsx`にテストを追記(失敗する状態)**

`describe('Setup', ...)`内に追記:
```jsx
  it('clears a previously selected Scenario when the World changes', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([
      { id: 'w1', title: 'World1', updatedAt: 1 },
      { id: 'w2', title: 'World2', updatedAt: 2 },
    ]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockImplementation((id) =>
      Promise.resolve({ id, title: id === 'w1' ? 'World1' : 'World2', raw: '要約' })
    );
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockImplementation((wid) =>
      Promise.resolve(wid === 'w1' ? [{ id: 'sc1', worldId: 'w1', title: 'シナリオ1', recommendedRuleset: null }] : [])
    );
    vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
      id: 'sc1',
      title: 'シナリオ1',
      raw: 'w1のシナリオ',
      recommendedRuleset: null,
    });
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成シナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('World1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('World1'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalledWith('w1'));
    fireEvent.click(screen.getByText('次へ')); // Scenario
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('シナリオ1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('シナリオ1'));
    await waitFor(() => expect(scenarioLibraryClient.getScenario).toHaveBeenCalled());

    // Worldステップに戻り、別のWorldへ切り替える
    fireEvent.click(screen.getByText('戻る'));
    fireEvent.click(screen.getByText('World2'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalledWith('w2'));

    // 確認まで進めて開始 → World Aのシナリオは残っていない(生成側へ落ちる)
    fireEvent.click(screen.getByText('次へ')); // Scenario
    fireEvent.click(screen.getByText('次へ')); // Ruleset
    fireEvent.click(screen.getByText('次へ')); // PC
    fireEvent.click(screen.getByText('次へ')); // 確認
    fireEvent.click(screen.getByText('ゲーム開始'));
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.scenario.raw).not.toBe('w1のシナリオ');
  });
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: FAIL(selectedScenarioが残りW2でW1のシナリオが使われる)

- [ ] **Step 7: `src/screens/Setup.jsx`を修正**

**7a. `makeId`のローカル定義を共通ユーティリティに差し替える。** ファイル冒頭の`import { slugify } from '../utils/slugify.js';`を`import { makeId } from '../utils/makeId.js';`に置き換え、ローカルの
```js
function makeId(base) {
  return slugify(base || 'untitled') + '-' + Date.now();
}
```
を削除する。(`slugify`が他で使われていなければimportも削除。使われていれば残す。)

**7b. `worldId`のeffectで`selectedScenario`/`selectedPC`をクリアする。** `listScenarios`を呼ぶeffectと`listCharacters`を呼ぶeffectのそれぞれに、一覧セットに加えて選択クリアを追加する:
```js
  useEffect(() => {
    setSelectedScenario(null);
    if (!worldId) {
      setExistingScenarios([]);
      return;
    }
    listScenarios(worldId)
      .then(setExistingScenarios)
      .catch((e) => setError('Scenario一覧の取得に失敗した: ' + e.message));
  }, [worldId]);

  useEffect(() => {
    setSelectedPC(null);
    if (!worldId) {
      setExistingPCs([]);
      return;
    }
    listCharacters(worldId, 'pc')
      .then(setExistingPCs)
      .catch((e) => setError('PC一覧の取得に失敗した: ' + e.message));
  }, [worldId]);
```

**7c. `handleStart`のworldModeスキップ分岐を常に空扱いにする。** 現在:
```js
      } else {
        worldRawForSession = worldRaw;
        worldSummary = worldRaw.length > 1500 ? await summarizeWorld(worldRaw) : worldRaw || '(特に指定なし)';
      }
```
を次に置き換える:
```js
      } else {
        worldRawForSession = '';
        worldSummary = '(特に指定なし)';
      }
```

**7d. シナリオAI生成に既存PC選択の本文を渡す。** `handleStart`のシナリオ生成呼び出し前に`pcForGen`を定義し、両方の`generateScenario`呼び出しで使う。`scenarioMode === 'generate'`分岐と、`paste`が空でfallback生成する分岐の両方:
```js
      const pcForGen = pcMode === 'existing' && selectedPC ? selectedPC.raw : pcRaw;
```
を`let scenario;`の直前に置き、`generateScenario(genre, pcRaw, worldSummary)`→`generateScenario(genre, pcForGen, worldSummary)`、`generateScenario('自由なジャンルで', pcRaw, worldSummary)`→`generateScenario('自由なジャンルで', pcForGen, worldSummary)`に変更する。

**7e. 戻る/やめるボタンを`busy`中は無効化する。** ナビゲーションの`<Button variant="ghost" onClick={step === 0 ? onCancel : () => setStep(step - 1)}>`に`disabled={busy}`を追加する。

**7f. エラー表示を常時表示にする。** `step === 4`ブロック内の
```jsx
            {error && (
              <div style={{ color: COLORS.stamp, fontSize: 13, marginTop: 12 }}>{error}</div>
            )}
            {libraryWarning && (
              <div style={{ color: COLORS.stamp, fontSize: 12, marginTop: 8 }}>{libraryWarning}</div>
            )}
```
を削除し、`</Card>`の直後(ナビゲーションボタンの`<div>`の前)に移動する:
```jsx
      </Card>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginTop: 12 }}>{error}</div>}
      {libraryWarning && <div style={{ color: COLORS.stamp, fontSize: 12, marginTop: 8 }}>{libraryWarning}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
```

**7g. 確認ステップのworldMode==='skip'ヒントを削除する。** `{worldMode === 'skip' && worldRaw.length > 1500 && ' 世界観は長いため開始時に自動で要約する。'}`の行を削除する(skipは常に空になったため)。

**7h. session idにランダム成分を追加する。** `id: 'sess_' + Date.now(),`を`id: 'sess_' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),`に変更する。

- [ ] **Step 8: テストが通ることを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: PASS(既存 + 新規)

- [ ] **Step 9: 全体テスト + ビルド**

Run: `npx vitest run && npm run build`
Expected: 全PASS + ビルド成功

- [ ] **Step 10: Commit**

```bash
git add src/utils/makeId.js src/utils/makeId.test.js src/screens/Setup.jsx src/screens/Setup.test.jsx
git commit -m "fix(frontend): clear stale Setup selections, honor cancel during start, surface errors, randomize ids"
```

---

## Self-Review Notes

- **Spec coverage**: spec §3.1(encode)→Task 1、§3.2(ConfirmModal)→Task 2、§3.3(refresh/Library)→Task 3、§3.4(WorldTab)→Task 4、§3.5(Home)→Task 5、§3.6(Setup/makeId)→Task 6。
- **Placeholder scan**: 「TBD」なし。
- **後方互換**: encodeは単純idで不変。ConfirmModalの`confirmDisabled`は任意propで既存呼び出しに無影響。
- **既存パターン**: WorldTabのepochガードは既存の`cancelled`フラグ/tokenパターンと同趣旨。Setupの選択クリアは既存の一覧リセットと同じeffect内。
- **非スコープ遵守**: サーバー/ドキュメント/追加インテグレーションテストには触れない。Home小説化ボタンの`stopPropagation`は既存を維持。
