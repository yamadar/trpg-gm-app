# 技術的積み残しの解消 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レビューで記録された4件の技術的積み残し(Buttonのdisabled属性、Worldのregion/category一覧、goal/bonds注入配線、カスタムRulesetの実プレイ利用)を解消する。

**Architecture:** 5タスクに分割する。Task 1(Button)・Task 2(worldLibraryClient追加)は独立。Task 3(WorldTab.jsx)はTask 2に依存。Task 4(prompts.js)は独立。Task 5(Setup.jsx)はTask 4に依存(`session.ruleset`/`session.pc.goal`/`bonds`をbuildSystemPromptが読めるようにするため)。

**Tech Stack:** React 18 + Vite、Vitest + @testing-library/react、Express(既存のまま)

## Global Constraints

- `"type": "module"`(ESM)。`require()`は使わない。
- `buildSystemPrompt`は`session.ruleset`・`session.pc.goal`/`bonds`のいずれも「存在すれば使う、無ければ現行の挙動にフォールバック」という設計にし、既存のIndexedDB永続化セッション(これらのフィールドを持たない)との後方互換性を壊さない。
- goal/bonds注入は、PCが素材ライブラリに紐づいている場合(既存PC選択、または新規作成でライブラリ保存成功時)のみ有効にする。ライブラリ紐づきが無い場合は`session.pc.goal`/`bonds`を`undefined`のままにし、余分なAI呼び出しを増やさない。
- カスタムRuleset一覧の取得・goal/bonds抽出はいずれも失敗しても非致命的に扱い、`console.error`するだけでセッション開始自体は妨げない。
- Region/categoryのタイトル永続化は行わない(データモデル変更が必要なため対象外)。既存Worldの一覧はid(スラグ)をそのままラベルとして表示する。
- 各タスクの最後は該当ファイルのみをステージしてコミットする。

---

## Task 1: src/components/ui/Button.jsx のdisabled属性修正

**Files:**
- Modify: `src/components/ui/Button.jsx`
- Modify: `src/components/ui/Button.test.jsx`

**Interfaces:**
- 既存の`Button({ children, onClick, disabled, variant, style })`のインターフェースは変更しない。ネイティブの`disabled`属性を追加するのみ。

- [ ] **Step 1: `src/components/ui/Button.test.jsx`にテストを追記(失敗する状態)**

既存の2テストの後に追記:
```jsx
  it('sets the native disabled attribute when disabled', () => {
    render(<Button disabled>Go</Button>);
    expect(screen.getByText('Go')).toBeDisabled();
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/ui/Button.test.jsx`
Expected: FAIL(ネイティブ`disabled`属性が付与されていない)

- [ ] **Step 3: `src/components/ui/Button.jsx`を修正**

`<button>`要素の`onClick`propの後に`disabled={disabled}`を追加する。修正後の`<button>`部分:
```jsx
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = 'scale(0.97)';
      }}
      onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {children}
    </button>
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/components/ui/Button.test.jsx`
Expected: PASS(3 tests)

- [ ] **Step 5: 全体テストを実行(回帰確認)**

Run: `npx vitest run`
Expected: 全テストPASS(`Button`を使う既存コンポーネントの`disabled`ボタンのクリックテストは、既に`onClick`無効化ベースで書かれているため影響を受けないはずだが、念のため確認する)

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Button.jsx src/components/ui/Button.test.jsx
git commit -m "fix(frontend): forward disabled prop to the native button element"
```

---

## Task 2: src/api/worldLibraryClient.js に region/category 取得系関数を追加

**Files:**
- Modify: `src/api/worldLibraryClient.js`
- Modify: `src/api/worldLibraryClient.test.js`

**Interfaces:**
- Produces: `listRegions(worldId)` → `Promise<string[]>`、`getRegion(worldId, region)` → `Promise<{id, raw}>`、`listCategories(worldId)` → `Promise<string[]>`、`getCategory(worldId, category)` → `Promise<{id, raw}>`。Task 3の`WorldTab.jsx`が消費する。対応するサーバールートは`server/routes/worldContent.js`に実装済み(`GET /worlds/:worldId/regions`、`GET /worlds/:worldId/regions/:region`、`GET /worlds/:worldId/categories`、`GET /worlds/:worldId/categories/:category`)。

- [ ] **Step 1: `src/api/worldLibraryClient.test.js`にテストを追記(失敗する状態)**

ファイル冒頭のimportに4関数を追加:
```js
import {
  putWorld,
  putWorldSource,
  getWorldSource,
  putRegion,
  putCategory,
  getWorld,
  listWorlds,
  deleteWorld,
  listRegions,
  getRegion,
  listCategories,
  getCategory,
} from './worldLibraryClient.js';
```

ファイル末尾に追記:
```js
describe('listRegions', () => {
  it('GETs the region id list for a world', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ['waterdeep', 'sword-coast'] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listRegions('w1');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1/regions', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual(['waterdeep', 'sword-coast']);
  });
});

describe('getRegion', () => {
  it('GETs a single region', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'waterdeep', raw: '地域詳細' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getRegion('w1', 'waterdeep');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/regions/waterdeep',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual({ id: 'waterdeep', raw: '地域詳細' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRegion('w1', 'missing')).rejects.toThrow('API error 404: not found');
  });
});

describe('listCategories', () => {
  it('GETs the category id list for a world', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ['magic-system'] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listCategories('w1');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1/categories', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual(['magic-system']);
  });
});

describe('getCategory', () => {
  it('GETs a single category', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'magic-system', raw: 'カテゴリ詳細' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getCategory('w1', 'magic-system');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/categories/magic-system',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual({ id: 'magic-system', raw: 'カテゴリ詳細' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getCategory('w1', 'missing')).rejects.toThrow('API error 404: not found');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/worldLibraryClient.test.js`
Expected: FAIL(4関数が存在しない)

- [ ] **Step 3: `src/api/worldLibraryClient.js`に4関数を追加**

ファイル末尾に追記:
```js
export async function listRegions(worldId) {
  return apiFetch(`/api/worlds/${worldId}/regions`, { method: 'GET' });
}

export async function getRegion(worldId, region) {
  return apiFetch(`/api/worlds/${worldId}/regions/${region}`, { method: 'GET' });
}

export async function listCategories(worldId) {
  return apiFetch(`/api/worlds/${worldId}/categories`, { method: 'GET' });
}

export async function getCategory(worldId, category) {
  return apiFetch(`/api/worlds/${worldId}/categories/${category}`, { method: 'GET' });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/worldLibraryClient.test.js`
Expected: PASS(既存12テスト + 新規6テスト = 18テスト)

- [ ] **Step 5: Commit**

```bash
git add src/api/worldLibraryClient.js src/api/worldLibraryClient.test.js
git commit -m "feat(frontend): add region/category read functions to world client"
```

---

## Task 3: src/screens/library/WorldTab.jsx — region/category一覧の表示

**Files:**
- Modify: `src/screens/library/WorldTab.jsx`
- Modify: `src/screens/library/WorldTab.test.jsx`

**Interfaces:**
- Consumes: `listRegions`/`getRegion`/`listCategories`/`getCategory`(Task 2)
- 既存の`WorldTab({ worlds, selectedWorldId, onSelectWorld, onWorldsChanged })`のインターフェースは変更しない。内部の`splitResult`stateを`regions`/`categories`という統一state(`[{id, title, content}]`、`content`は未取得なら`null`)に置き換える。

- [ ] **Step 1: `src/screens/library/WorldTab.test.jsx`を更新(失敗する状態)**

ファイル全体を次の内容に置き換える(既存6テストに2テストを追加、`beforeEach`に`listRegions`/`listCategories`のデフォルトモックを追加):

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WorldTab from './WorldTab.jsx';
import * as worldLibraryClient from '../../api/worldLibraryClient.js';
import * as worldImport from '../../api/worldImport.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(worldLibraryClient, 'listRegions').mockResolvedValue([]);
  vi.spyOn(worldLibraryClient, 'listCategories').mockResolvedValue([]);
});

describe('WorldTab', () => {
  it('renders the world list', () => {
    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'World A', updatedAt: 1 }]}
        selectedWorldId={null}
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn()}
      />
    );
    expect(screen.getByText('World A')).toBeInTheDocument();
  });

  it('creates a new world via importWorld and notifies the parent', async () => {
    const importSpy = vi
      .spyOn(worldImport, 'importWorld')
      .mockResolvedValue({ world: '目次', regions: [], categories: [] });
    const onWorldsChanged = vi.fn().mockResolvedValue();
    const onSelectWorld = vi.fn();

    render(
      <WorldTab worlds={[]} selectedWorldId={null} onSelectWorld={onSelectWorld} onWorldsChanged={onWorldsChanged} />
    );

    fireEvent.click(screen.getByText('+ 新規World'));
    fireEvent.change(screen.getByPlaceholderText('例: waterdeep-campaign'), { target: { value: 'w1' } });
    fireEvent.change(screen.getByPlaceholderText('World名'), { target: { value: 'Waterdeep' } });
    fireEvent.change(screen.getByPlaceholderText('世界観の資料を貼る'), { target: { value: '長い原文' } });
    fireEvent.click(screen.getByText('作成する'));

    await waitFor(() => expect(importSpy).toHaveBeenCalledWith('w1', 'Waterdeep', '長い原文'));
    expect(onWorldsChanged).toHaveBeenCalled();
    expect(onSelectWorld).toHaveBeenCalledWith('w1');
  });

  it('loads and shows the selected world for editing, with region/category breakdown after a reimport', async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '原文' });
    const putWorldSourceSpy = vi.spyOn(worldLibraryClient, 'putWorldSource').mockResolvedValue({});
    const reimportSpy = vi.spyOn(worldImport, 'reimportWorld').mockResolvedValue({
      world: '目次',
      regions: [{ id: 'harbor', title: '港', content: '港の詳細' }],
      categories: [],
    });

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('保存して再分割'));

    await waitFor(() => expect(reimportSpy).toHaveBeenCalledWith('w1', 'Waterdeep', undefined));
    await waitFor(() => expect(screen.getByText('港')).toBeInTheDocument());
    expect(putWorldSourceSpy).not.toHaveBeenCalled();
  });

  it('persists edited raw text via putWorldSource before reimporting when editRaw was changed', async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '原文' });
    const putWorldSourceSpy = vi.spyOn(worldLibraryClient, 'putWorldSource').mockResolvedValue({});
    const reimportSpy = vi.spyOn(worldImport, 'reimportWorld').mockResolvedValue({
      world: '目次',
      regions: [],
      categories: [],
    });

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('原文'), { target: { value: '編集後の本文' } });
    fireEvent.click(screen.getByText('保存して再分割'));

    await waitFor(() => expect(putWorldSourceSpy).toHaveBeenCalledWith('w1', '編集後の本文'));
    await waitFor(() => expect(reimportSpy).toHaveBeenCalledWith('w1', 'Waterdeep', undefined));

    const putOrder = putWorldSourceSpy.mock.invocationCallOrder[0];
    const reimportOrder = reimportSpy.mock.invocationCallOrder[0];
    expect(putOrder).toBeLessThan(reimportOrder);
  });

  it('deletes a world after confirmation', async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '原文' });
    const deleteSpy = vi.spyOn(worldLibraryClient, 'deleteWorld').mockResolvedValue();
    const onWorldsChanged = vi.fn().mockResolvedValue();

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={onWorldsChanged}
      />
    );

    await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('削除'));
    expect(screen.getByText(/を削除する。よいか?/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('削除する'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('w1'));
    expect(onWorldsChanged).toHaveBeenCalled();
  });

  it('ignores a stale getWorld response when the selected world changes before it resolves', async () => {
    let resolveA;
    const promiseA = new Promise((resolve) => {
      resolveA = resolve;
    });
    const getWorldSpy = vi.spyOn(worldLibraryClient, 'getWorld').mockImplementation((id) => {
      if (id === 'w1') return promiseA;
      if (id === 'w2') return Promise.resolve({ id: 'w2', title: 'Neverwinter', raw: '原文2' });
      return Promise.reject(new Error('unexpected id: ' + id));
    });

    const worlds = [
      { id: 'w1', title: 'Waterdeep', updatedAt: 1 },
      { id: 'w2', title: 'Neverwinter', updatedAt: 2 },
    ];

    const { rerender } = render(
      <WorldTab
        worlds={worlds}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(getWorldSpy).toHaveBeenCalledWith('w1'));

    rerender(
      <WorldTab
        worlds={worlds}
        selectedWorldId="w2"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(getWorldSpy).toHaveBeenCalledWith('w2'));
    await waitFor(() => expect(screen.getByDisplayValue('Neverwinter')).toBeInTheDocument());

    await act(async () => {
      resolveA({ id: 'w1', title: 'Waterdeep', raw: '原文' });
      await promiseA;
    });

    expect(screen.getByDisplayValue('Neverwinter')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Waterdeep')).not.toBeInTheDocument();
  });

  it('shows the region/category id list for a pre-existing world without a fresh split', async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '原文' });
    worldLibraryClient.listRegions.mockResolvedValue(['harbor']);
    worldLibraryClient.listCategories.mockResolvedValue(['magic-system']);

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('harbor')).toBeInTheDocument());
    expect(screen.getByText('magic-system')).toBeInTheDocument();
  });

  it("lazily fetches a region's content via getRegion when editing one sourced from the id-only list", async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '原文' });
    worldLibraryClient.listRegions.mockResolvedValue(['harbor']);
    const getRegionSpy = vi.spyOn(worldLibraryClient, 'getRegion').mockResolvedValue({ id: 'harbor', raw: '港の詳細本文' });

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(screen.getByText('harbor')).toBeInTheDocument());
    fireEvent.click(screen.getByText('編集'));

    await waitFor(() => expect(getRegionSpy).toHaveBeenCalledWith('w1', 'harbor'));
    await waitFor(() => expect(screen.getByDisplayValue('港の詳細本文')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/library/WorldTab.test.jsx`
Expected: FAIL(id一覧表示・遅延取得が実装されていない)

- [ ] **Step 3: `src/screens/library/WorldTab.jsx`を書き換える**

ファイル全体を次の内容に置き換える:

```jsx
import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import {
  getWorld,
  deleteWorld,
  putRegion,
  putCategory,
  putWorldSource,
  listRegions,
  getRegion,
  listCategories,
  getCategory,
} from '../../api/worldLibraryClient.js';
import { importWorld, reimportWorld } from '../../api/worldImport.js';

export default function WorldTab({ worlds, selectedWorldId, onSelectWorld, onWorldsChanged }) {
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newRaw, setNewRaw] = useState('');

  const [detail, setDetail] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editRaw, setEditRaw] = useState('');
  const [adjustmentRequest, setAdjustmentRequest] = useState('');
  const [regions, setRegions] = useState([]); // [{id, title, content}] content may be null until fetched
  const [categories, setCategories] = useState([]);
  const [editingRegionId, setEditingRegionId] = useState(null);
  const [regionDraft, setRegionDraft] = useState('');
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [categoryDraft, setCategoryDraft] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    if (!selectedWorldId) {
      setDetail(null);
      return;
    }
    setRegions([]);
    setCategories([]);
    setError('');
    let cancelled = false;
    (async () => {
      try {
        const world = await getWorld(selectedWorldId);
        if (cancelled) return;
        setDetail(world);
        setEditTitle(world.title);
        setEditRaw(world.raw);
        const [regionIds, categoryIds] = await Promise.all([
          listRegions(selectedWorldId),
          listCategories(selectedWorldId),
        ]);
        if (cancelled) return;
        setRegions(regionIds.map((id) => ({ id, title: id, content: null })));
        setCategories(categoryIds.map((id) => ({ id, title: id, content: null })));
      } catch (e) {
        if (!cancelled) setError('World取得に失敗した: ' + e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedWorldId]);

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      const split = await importWorld(newId, newTitle, newRaw);
      setRegions(split.regions.map((r) => ({ id: r.id, title: r.title, content: r.content })));
      setCategories(split.categories.map((c) => ({ id: c.id, title: c.title, content: c.content })));
      setCreating(false);
      const createdId = newId;
      setNewId('');
      setNewTitle('');
      setNewRaw('');
      await onWorldsChanged();
      onSelectWorld(createdId);
    } catch (e) {
      setError('World作成に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReimport() {
    setBusy(true);
    setError('');
    try {
      if (editRaw !== detail.raw) {
        await putWorldSource(selectedWorldId, editRaw);
      }
      const split = await reimportWorld(selectedWorldId, editTitle, adjustmentRequest || undefined);
      setRegions(split.regions.map((r) => ({ id: r.id, title: r.title, content: r.content })));
      setCategories(split.categories.map((c) => ({ id: c.id, title: c.title, content: c.content })));
      setAdjustmentRequest('');
      await onWorldsChanged();
      const world = await getWorld(selectedWorldId);
      setDetail(world);
      setEditTitle(world.title);
      setEditRaw(world.raw);
    } catch (e) {
      setError('World更新に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function startEditingRegion(region) {
    setEditingRegionId(region.id);
    if (region.content !== null) {
      setRegionDraft(region.content);
      return;
    }
    try {
      const full = await getRegion(selectedWorldId, region.id);
      setRegionDraft(full.raw);
    } catch (e) {
      setError('地域の取得に失敗した: ' + e.message);
    }
  }

  async function startEditingCategory(category) {
    setEditingCategoryId(category.id);
    if (category.content !== null) {
      setCategoryDraft(category.content);
      return;
    }
    try {
      const full = await getCategory(selectedWorldId, category.id);
      setCategoryDraft(full.raw);
    } catch (e) {
      setError('カテゴリの取得に失敗した: ' + e.message);
    }
  }

  async function handleSaveRegion(regionId) {
    setBusy(true);
    setError('');
    try {
      await putRegion(selectedWorldId, regionId, regionDraft);
      setRegions((prev) => prev.map((r) => (r.id === regionId ? { ...r, content: regionDraft } : r)));
      setEditingRegionId(null);
    } catch (e) {
      setError('地域の保存に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCategory(categoryId) {
    setBusy(true);
    setError('');
    try {
      await putCategory(selectedWorldId, categoryId, categoryDraft);
      setCategories((prev) => prev.map((c) => (c.id === categoryId ? { ...c, content: categoryDraft } : c)));
      setEditingCategoryId(null);
    } catch (e) {
      setError('カテゴリの保存に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError('');
    try {
      await deleteWorld(deleteTarget);
      const deletedId = deleteTarget;
      setDeleteTarget(null);
      if (selectedWorldId === deletedId) {
        onSelectWorld(null);
        setDetail(null);
      }
      await onWorldsChanged();
    } catch (e) {
      setError('World削除に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>World一覧</div>
        <Button
          variant="primary"
          onClick={() => {
            setCreating(true);
            onSelectWorld(null);
          }}
        >
          + 新規World
        </Button>
      </div>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {worlds.map((w) => (
          <Card
            key={w.id}
            onClick={() => {
              setCreating(false);
              onSelectWorld(w.id);
            }}
            style={{ cursor: 'pointer', borderColor: selectedWorldId === w.id ? COLORS.brass : COLORS.line }}
          >
            <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{w.title}</div>
          </Card>
        ))}
        {worlds.length === 0 && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>Worldがまだ無い。</div>
        )}
      </div>

      {creating && (
        <Card>
          <Field label="識別子(id)" hint="内部で使う一意なキー(英数字推奨)。本文中の名称とは別。">
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="例: waterdeep-campaign"
              style={inputStyle}
            />
          </Field>
          <Field label="タイトル">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="World名"
              style={inputStyle}
            />
          </Field>
          <Field label="本文" hint="長文なら自動でregion/categoryに分割される。">
            <textarea
              value={newRaw}
              onChange={(e) => setNewRaw(e.target.value)}
              rows={10}
              placeholder="世界観の資料を貼る"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <Button variant="brass" onClick={handleCreate} disabled={busy || !newId || !newTitle}>
            {busy ? '作成中…' : '作成する'}
          </Button>
        </Card>
      )}

      {!creating && detail && (
        <Card>
          <Field label="タイトル">
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="本文">
            <textarea
              value={editRaw}
              onChange={(e) => setEditRaw(e.target.value)}
              rows={10}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <Field label="再分割の修正依頼" hint="任意。空欄でも再分割できる。">
            <input value={adjustmentRequest} onChange={(e) => setAdjustmentRequest(e.target.value)} style={inputStyle} />
          </Field>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Button variant="brass" onClick={handleReimport} disabled={busy}>
              {busy ? '更新中…' : '保存して再分割'}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteTarget(detail.id)} disabled={busy}>
              削除
            </Button>
          </div>

          <div>
            <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.brassDark, marginBottom: 8 }}>
              地域(region)
            </div>
            {regions.map((r) => (
              <Card key={r.id} style={{ marginBottom: 8 }}>
                <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 6 }}>
                  {r.title}
                </div>
                {editingRegionId === r.id ? (
                  <>
                    <textarea
                      value={regionDraft}
                      onChange={(e) => setRegionDraft(e.target.value)}
                      rows={6}
                      style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY, marginBottom: 8 }}
                    />
                    <Button variant="brass" onClick={() => handleSaveRegion(r.id)} disabled={busy}>
                      保存
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => startEditingRegion(r)}>
                    編集
                  </Button>
                )}
              </Card>
            ))}
            {regions.length === 0 && (
              <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.faint, marginBottom: 8 }}>
                地域は無い。
              </div>
            )}

            <div
              style={{
                fontFamily: F_DISPLAY,
                fontSize: 13,
                color: COLORS.brassDark,
                marginBottom: 8,
                marginTop: 12,
              }}
            >
              カテゴリ(category)
            </div>
            {categories.map((c) => (
              <Card key={c.id} style={{ marginBottom: 8 }}>
                <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 6 }}>
                  {c.title}
                </div>
                {editingCategoryId === c.id ? (
                  <>
                    <textarea
                      value={categoryDraft}
                      onChange={(e) => setCategoryDraft(e.target.value)}
                      rows={6}
                      style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY, marginBottom: 8 }}
                    />
                    <Button variant="brass" onClick={() => handleSaveCategory(c.id)} disabled={busy}>
                      保存
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => startEditingCategory(c)}>
                    編集
                  </Button>
                )}
              </Card>
            ))}
            {categories.length === 0 && (
              <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.faint }}>
                カテゴリは無い。
              </div>
            )}
          </div>
        </Card>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        message={`World「${deleteTarget}」を削除する。よいか?`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/library/WorldTab.test.jsx`
Expected: PASS(8 tests)

- [ ] **Step 5: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS(`Library.test.jsx`はfetchを直接stubしているため`WorldTab`内部の`listRegions`/`listCategories`呼び出しも空配列を返すfetchモックで解決され、影響を受けない)

- [ ] **Step 6: Commit**

```bash
git add src/screens/library/WorldTab.jsx src/screens/library/WorldTab.test.jsx
git commit -m "feat(frontend): show region/category id list for pre-existing worlds"
```

---

## Task 4: src/api/prompts.js — session.ruleset・goal/bonds注入

**Files:**
- Modify: `src/api/prompts.js`
- Modify: `src/api/prompts.test.js`

**Interfaces:**
- Produces: `buildSystemPrompt(session)`は、`session.ruleset`(`{id,label,desc,hint}`)があればそれを使い、無ければ既存の`RULESETS.find(session.rulesetId)`にフォールバックする。`session.pc.goal`/`session.pc.bonds`があれば「# PCの目標・因縁(抽出済み)」節を追加する。Task 5の`Setup.jsx`がこれらのフィールドを持つ`session`を渡すようになる。

- [ ] **Step 1: `src/api/prompts.test.js`にテストを追記(失敗する状態)**

`describe('buildSystemPrompt', ...)`ブロック内の既存4テストの後に追記:
```js
  it('uses session.ruleset when present, without falling back to the static RULESETS lookup', () => {
    const prompt = buildSystemPrompt(
      makeSession({
        rulesetId: 'unknown-static-id',
        ruleset: { id: 'homebrew', label: '自作ルール', desc: '独自ルール', hint: '独自の演出ヒント' },
      })
    );
    expect(prompt).toContain('ルール性向: 自作ルール');
    expect(prompt).toContain('独自の演出ヒント');
  });

  it('adds a goal/bonds section when present on session.pc', () => {
    const prompt = buildSystemPrompt(
      makeSession({ pc: { raw: 'PC名: アリス', goal: '真相を暴く', bonds: '姉との再会' } })
    );
    expect(prompt).toContain('# PCの目標・因縁(抽出済み)');
    expect(prompt).toContain('goal: 真相を暴く');
    expect(prompt).toContain('bonds: 姉との再会');
  });

  it('omits the goal/bonds section when absent on session.pc', () => {
    const prompt = buildSystemPrompt(makeSession({ pc: { raw: 'PC名: アリス' } }));
    expect(prompt).not.toContain('PCの目標・因縁');
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/prompts.test.js`
Expected: FAIL(`session.ruleset`・goal/bonds節が未実装)

- [ ] **Step 3: `src/api/prompts.js`の`buildSystemPrompt`を修正**

`export function buildSystemPrompt(session) {`から関数末尾までを次に置き換える:

```js
export function buildSystemPrompt(session) {
  const rs = session.ruleset || RULESETS.find((r) => r.id === session.rulesetId) || RULESETS[0];
  const flags = session.state.flags || {};
  const flagsText =
    Object.entries(flags)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || '(なし)';
  const recentLog =
    (session.state.recent_log || [])
      .map((l) => `${l.role === 'player' ? 'PL' : 'GM'}: ${l.text}`)
      .join('\n') || '(まだなし)';
  const pcGoalBondsSection =
    session.pc.goal || session.pc.bonds
      ? `\n# PCの目標・因縁(抽出済み)\ngoal: ${session.pc.goal || '(未設定)'}\nbonds: ${session.pc.bonds || '(未設定)'}\n`
      : '';

  return `あなたはTRPGのGM。以下の設定に従い物語を進行する。プレイヤーが楽しめるよう、緊迫感や盛り上がりの演出を大事にすること。

# 世界観
${session.world.summary}

# シナリオ
${session.scenario.raw}
上記のうち「GM専用情報」節は、物語内で自然に明かされた場合を除き、プレイヤーへの出力に絶対含めないこと。

# PC設定
${session.pc.raw}
${pcGoalBondsSection}
# ルール性向: ${rs.label}
${rs.hint || '特別な演出指定なし。'}
判定が必要な場面ではroll_checkツールを呼び出すこと。success_percentはPCの能力・状況・難易度から自分で判断して設定し、結果そのものは自分で決めないこと(ロール結果は別途渡される)。

# 現在の状況
シーン: ${session.state.current_scene}
既知フラグ: ${flagsText}
物語要約: ${session.state.history_summary || '(まだなし)'}

# 直近のログ
${recentLog}

# 演出方針
緊迫した場面は短文を畳み掛け、平穏な場面は五感描写を増やしゆったり進行する。可能な範囲でPCのgoal/bondsや世界観の特徴を絡めること。

# 出力形式(厳守)
説明文やコードブロック記号を一切付けず、次のJSONのみを出力すること:
{"narrative": "地の文(150〜250字程度)", "state_update": {"current_scene": "更新後のシーン名", "flags": {"追加/更新分のみ": true}, "history_summary": "更新後の物語要約(300字程度)"}, "choices": ["選択肢1", "選択肢2", "選択肢3"]}
choices は自由記述を促したい場面では空配列 [] でよい。flags は新規/更新分のみでよい(既存分は保持される)。`;
}
```

(変更点: `rs`の解決に`session.ruleset ||`を先頭追加。`pcGoalBondsSection`変数を新設し、`# PC設定`の本文直後に挿入。それ以外の文言・構造は無変更。)

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/prompts.test.js`
Expected: PASS(既存4テスト + 新規3テスト = 7テスト)

- [ ] **Step 5: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS(`session.test.js`・`Play.test.jsx`が使うテスト用sessionは`ruleset`/`pc.goal`/`pc.bonds`を持たないため、フォールバック経路が使われ既存挙動のまま通るはず)

- [ ] **Step 6: Commit**

```bash
git add src/api/prompts.js src/api/prompts.test.js
git commit -m "feat(frontend): resolve session.ruleset and inject parsed PC goal/bonds into the GM prompt"
```

---

## Task 5: src/screens/Setup.jsx — カスタムRuleset統合・goal/bonds解決

**Files:**
- Modify: `src/screens/Setup.jsx`
- Modify: `src/screens/Setup.test.jsx`

**Interfaces:**
- Consumes: `listRulesets`(`src/api/rulesetLibraryClient.js`、既存)、`getOrParseCharacter`(`src/api/characterSheetCache.js`、既存)、Task 4で拡張された`buildSystemPrompt`が読む`session.ruleset`/`session.pc.goal`/`session.pc.bonds`
- Produces: `onStart(session)`に渡す`session`が、`ruleset`(`{id,label,desc,hint}`)と`pc.goal`/`pc.bonds`(ライブラリ紐づきがある場合のみ)を追加で含むようになる。既存の`rulesetId`・`pc.raw`は変更しない。

- [ ] **Step 1: `src/screens/Setup.test.jsx`を更新(失敗する状態)**

ファイル冒頭のimportに2行追加:
```js
import * as rulesetLibraryClient from '../api/rulesetLibraryClient.js';
import * as characterSheetCache from '../api/characterSheetCache.js';
```

`beforeEach`に1行追加(既存の`listWorlds`/`listCharacters`のデフォルトモックの後):
```js
  vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([]);
```

既存の`"carries the selected Scenario's recommendedRuleset through as the default Ruleset on session start"`テストの末尾(`expect(session.scenario.raw).toBe('シナリオ本文');`の直後)に2行追加:
```js
    expect(session.ruleset.id).toBe('coc7e');
    expect(session.ruleset.label).toBe('CoC7e風');
```

`describe('Setup', ...)`ブロックの末尾(最後のテストの後)に3テストを追記:
```jsx
  it('lists custom Rulesets from the library and embeds the resolved ruleset into the session', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([
      { id: 'homebrew', label: '自作ルール', desc: '独自ルール', hint: '独自の演出ヒント', updatedAt: 1 },
    ]);
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('自作ルール')).toBeInTheDocument());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('自作ルール'));
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.rulesetId).toBe('homebrew');
    expect(session.ruleset).toEqual({
      id: 'homebrew',
      label: '自作ルール',
      desc: '独自ルール',
      hint: '独自の演出ヒント',
    });
  });

  it("embeds the selected PC's parsed goal/bonds into the session when the PC is library-linked", async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    characterLibraryClient.listCharacters.mockResolvedValue([
      { id: 'w1/pc/alice', worldId: 'w1', kind: 'pc', name: 'alice', revealed: null },
    ]);
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw: 'PC名: アリス',
      revealed: null,
      name: 'alice',
    });
    vi.spyOn(characterSheetCache, 'getOrParseCharacter').mockResolvedValue({
      goal: '真相を暴く',
      bonds: '姉との再会',
    });
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
    fireEvent.click(screen.getByText('alice'));
    await waitFor(() => expect(characterLibraryClient.getCharacter).toHaveBeenCalledWith('w1', 'pc', 'alice'));

    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(characterSheetCache.getOrParseCharacter).toHaveBeenCalledWith('w1', 'pc', 'alice');
    const session = onStart.mock.calls[0][0];
    expect(session.pc.goal).toBe('真相を暴く');
    expect(session.pc.bonds).toBe('姉との再会');
  });

  it('does not attempt to resolve goal/bonds when the PC has no library link', async () => {
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const getOrParseSpy = vi.spyOn(characterSheetCache, 'getOrParseCharacter');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('次へ')); // World(skip) -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(getOrParseSpy).not.toHaveBeenCalled();
    const session = onStart.mock.calls[0][0];
    expect(session.pc.goal).toBeUndefined();
    expect(session.pc.bonds).toBeUndefined();
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: FAIL(カスタムRuleset統合・goal/bonds解決が未実装)

- [ ] **Step 3: `src/screens/Setup.jsx`を修正**

**3a. importに2行追加**(`import { slugify } from '../utils/slugify.js';`の後):
```js
import { listRulesets } from '../api/rulesetLibraryClient.js';
import { getOrParseCharacter } from '../api/characterSheetCache.js';
```

**3b. `rulesetId`stateの直後に1行追加**:
```js
  const [rulesetId, setRulesetId] = useState('simple');
  const [customRulesets, setCustomRulesets] = useState([]);
```

**3c. `worldId`の直後に`allRulesets`を追加**:
```js
  const worldId = worldMode === 'existing' ? selectedWorld?.id ?? null : null;
  const allRulesets = [...RULESETS, ...customRulesets];
```

**3d. `listWorlds`のuseEffectの直後にRuleset一覧取得effectを追加**:
```js
  useEffect(() => {
    listWorlds()
      .then(setExistingWorlds)
      .catch((e) => setError('World一覧の取得に失敗した: ' + e.message));
  }, []);

  useEffect(() => {
    listRulesets()
      .then(setCustomRulesets)
      .catch((e) => setError('カスタムRuleset一覧の取得に失敗した: ' + e.message));
  }, []);
```

**3e. recommendedRuleset連動useEffectを`allRulesets`基準に変更**。現在:
```js
  useEffect(() => {
    if (selectedScenario?.recommendedRuleset && RULESETS.some((r) => r.id === selectedScenario.recommendedRuleset)) {
      setRulesetId(selectedScenario.recommendedRuleset);
    }
  }, [selectedScenario]);
```
を次に置き換える:
```js
  useEffect(() => {
    if (selectedScenario?.recommendedRuleset && allRulesets.some((r) => r.id === selectedScenario.recommendedRuleset)) {
      setRulesetId(selectedScenario.recommendedRuleset);
    }
  }, [selectedScenario, allRulesets]);
```

**3f. `handleStart`内のPCブロックとsession構築を書き換える**。現在:
```js
      let pc;
      if (pcMode === 'existing' && selectedPC) {
        pc = selectedPC.raw;
      } else {
        pc = pcRaw || '(自由記述なし)';
        if (resolvedWorldId && pcRaw) {
          const pcId = makeId('pc');
          await trySaveToLibrary(() => putCharacter(resolvedWorldId, 'pc', pcId, { raw: pcRaw, revealed: undefined }));
        }
      }

      const session = {
        id: 'sess_' + Date.now(),
        title: title || 'セッション ' + new Date().toLocaleDateString('ja-JP'),
        world: { raw: worldRawForSession, summary: worldSummary },
        scenario: { raw: scenario },
        rulesetId,
        pc: { raw: pc },
        state: {
          current_scene: '冒頭',
          flags: {},
          history_summary: '',
          recent_log: [],
          turn_count: 0,
        },
        log: [],
        updatedAt: Date.now(),
      };
      onStart(session);
```
を次に置き換える:
```js
      let pc;
      let pcGoal;
      let pcBonds;
      let pcLibraryName = null;

      if (pcMode === 'existing' && selectedPC) {
        pc = selectedPC.raw;
        pcLibraryName = selectedPC.name;
      } else {
        pc = pcRaw || '(自由記述なし)';
        if (resolvedWorldId && pcRaw) {
          const pcId = makeId('pc');
          let pcSaved = false;
          await trySaveToLibrary(async () => {
            await putCharacter(resolvedWorldId, 'pc', pcId, { raw: pcRaw, revealed: undefined });
            pcSaved = true;
          });
          if (pcSaved) {
            pcLibraryName = pcId;
          }
        }
      }

      if (resolvedWorldId && pcLibraryName) {
        try {
          const parsed = await getOrParseCharacter(resolvedWorldId, 'pc', pcLibraryName);
          pcGoal = parsed.goal;
          pcBonds = parsed.bonds;
        } catch (e) {
          console.error('goal/bonds parse failed', e);
        }
      }

      const resolvedRuleset = allRulesets.find((r) => r.id === rulesetId) || RULESETS[0];

      const session = {
        id: 'sess_' + Date.now(),
        title: title || 'セッション ' + new Date().toLocaleDateString('ja-JP'),
        world: { raw: worldRawForSession, summary: worldSummary },
        scenario: { raw: scenario },
        rulesetId,
        ruleset: {
          id: resolvedRuleset.id,
          label: resolvedRuleset.label,
          desc: resolvedRuleset.desc,
          hint: resolvedRuleset.hint,
        },
        pc: { raw: pc, goal: pcGoal, bonds: pcBonds },
        state: {
          current_scene: '冒頭',
          flags: {},
          history_summary: '',
          recent_log: [],
          turn_count: 0,
        },
        log: [],
        updatedAt: Date.now(),
      };
      onStart(session);
```

**3g. Rulesetステップ(`step === 2`)のJSXで`RULESETS.map`を`allRulesets.map`に変更**。現在:
```jsx
        {step === 2 && (
          <Field label="ルール性向" hint="判定は成功率%に統一して実行する(どのルールでも公平に判定できる)。ここでの選択は主に演出の色付けに使う。">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {RULESETS.map((r) => (
```
の`{RULESETS.map((r) => (`を`{allRulesets.map((r) => (`に変更する(それ以外は無変更)。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: PASS(既存7テスト + 新規3テスト = 10テスト)

- [ ] **Step 5: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 6: ビルドを確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 7: Commit**

```bash
git add src/screens/Setup.jsx src/screens/Setup.test.jsx
git commit -m "feat(frontend): let Setup pick custom Rulesets and resolve PC goal/bonds for play"
```

---

## Self-Review Notes

- **Spec coverage**: spec docの3.1(Button)→Task 1、3.2(region/category一覧)→Task 2+3、3.3(goal/bonds注入)→Task 4+5、3.4(カスタムRuleset)→Task 4+5、いずれもタスクでカバーされている。
- **Placeholder scan**: 「TBD」等の記述なし。
- **Type consistency**: `session.ruleset`の形状(`{id,label,desc,hint}`)はTask 4(`buildSystemPrompt`が読む)とTask 5(`Setup.jsx`が書く)で一致。`session.pc.goal`/`session.pc.bonds`も同様。`WorldTab.jsx`の`regions`/`categories`の要素形状(`{id,title,content}`)はTask 3内の全関数(`handleCreate`/`handleReimport`/`startEditingRegion`/`handleSaveRegion`等)で一貫している。
- **既存パターンとの一貫性**: goal/bonds解決の失敗は`console.error`のみで非致命的に扱う(既存の`trySaveToLibrary`と同じ設計思想)。Rulesetの結合リスト(`allRulesets`)は既存の`RULESETS.map`パターンをそのまま流用する形にし、UIコンポーネントの新規追加はしていない。
- **後方互換性**: `buildSystemPrompt`は`session.ruleset`/`session.pc.goal`/`bonds`のいずれも「存在すれば使う」設計のため、Task 4完了後もTask 5未完了の間(あるいは既存のIndexedDB永続化セッション)は現行の`RULESETS.find(session.rulesetId)`フォールバックで問題なく動作する。
- **非スコープの遵守**: region/categoryのタイトル永続化、NPCへのgoal/bonds拡張、静的/カスタムidの衝突対策は、どのタスクにも含まれていない。
