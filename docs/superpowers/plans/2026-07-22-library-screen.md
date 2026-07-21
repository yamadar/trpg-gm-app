# 素材ライブラリ サブプロジェクト4b: 素材ライブラリ画面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** World/Character(PC・NPC)/Scenario/Rulesetをタブ分けして閲覧・編集・削除・新規作成できる「素材ライブラリ」画面を実装し、Home画面から遷移できるようにする。

**Architecture:** `src/screens/Library.jsx`がタブ状態と、Character/Scenarioタブが共有するWorldセレクタ状態を持つコンテナ。実際の一覧・編集UIは`src/screens/library/`配下の4つのタブコンポーネント(WorldTab/CharacterTab/ScenarioTab/RulesetTab)に分割する。削除確認は`src/components/library/ConfirmModal.jsx`を共通利用する。全て既存の`src/api/*Client.js`(4a・L1-3・W4-6で実装済み)のみを使い、新規サーバーAPIは追加しない。

**Tech Stack:** React 18 + Vite、Vitest + @testing-library/react(既存のまま)

## Global Constraints

- `"type": "module"`(ESM)。`require()`は使わない。
- UIは既存の`src/components/ui/Card.jsx`・`Button.jsx`・`Field.jsx`と`src/theme.js`(`COLORS`/`F_DISPLAY`/`F_BODY`/`F_MONO`/`inputStyle`)を使い、`Setup.jsx`/`Home.jsx`と同じインラインスタイル規約に合わせる。
- 既存の`Stamp`コンポーネント(`src/components/ui/Stamp.jsx`)はダイス結果専用の固定レイアウトのため、NPCのrevealedバッジには転用しない。各タブ内にインラインの`span`で実装する。
- 保存/削除などの非同期処理中は対象ボタンを`disabled`にする(`busy`state)。エラーは`COLORS.stamp`色のテキストで表示する(`Setup.jsx`のエラー表示と同じパターン)。
- 削除操作は全タブで`ConfirmModal`(Task 2で作成)を共通利用する。
- 識別子(id/name)入力欄には「内部で使う一意なキー(英数字推奨)。本文中の名称とは別」という趣旨のヒントを`Field`の`hint`propで付ける。
- 新規サーバーAPIエンドポイントは追加しない。`src/api/worldLibraryClient.js`に不足していた`getWorld`/`listWorlds`/`deleteWorld`(Task 1)のみクライアント関数を追加する(対応するサーバールートは`server/routes/worlds.js`に既に実装済み)。
- テストで各API clientモジュールをモックする際は、モジュール名前空間ごとインポートして`vi.spyOn(moduleNamespace, 'fnName')`を使う(`src/api/worldImport.test.js`で確立済みのパターン。ESMは同一モジュール内呼び出しをモックできないため、別ファイルの関数はこの方法で差し替える)。
- 各タスクの最後は該当ファイルのみをステージしてコミットする。

---

## Task 1: src/api/worldLibraryClient.js に getWorld/listWorlds/deleteWorld を追加

**Files:**
- Modify: `src/api/worldLibraryClient.js`
- Modify: `src/api/worldLibraryClient.test.js`

**Interfaces:**
- Produces: `getWorld(id)` → `Promise<{id, title, raw, updatedAt}>`、`listWorlds()` → `Promise<Array<{id, title, updatedAt}>>`、`deleteWorld(id)` → `Promise<void>`。後続タスクの`WorldTab.jsx`・`Library.jsx`が消費する。

- [ ] **Step 1: 既存の`src/api/worldLibraryClient.test.js`のimport文を更新し、新しいテストを追記する**

ファイル冒頭のimportを次のように変更:
```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  putWorld,
  putWorldSource,
  getWorldSource,
  putRegion,
  putCategory,
  getWorld,
  listWorlds,
  deleteWorld,
} from './worldLibraryClient.js';
```

ファイル末尾に追記:
```js
describe('getWorld', () => {
  it('GETs a world', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'w1', title: 'A', raw: 'x', updatedAt: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getWorld('w1');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual({ id: 'w1', title: 'A', raw: 'x', updatedAt: 1 });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getWorld('missing')).rejects.toThrow('API error 404: not found');
  });
});

describe('listWorlds', () => {
  it('GETs the full world list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'w1', title: 'A' }] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listWorlds();
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual([{ id: 'w1', title: 'A' }]);
  });
});

describe('deleteWorld', () => {
  it('DELETEs a world and does not attempt to parse a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteWorld('w1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteWorld('w1')).rejects.toThrow('API error 500: boom');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/worldLibraryClient.test.js`
Expected: FAIL(`getWorld`/`listWorlds`/`deleteWorld`が存在しない)

- [ ] **Step 3: `src/api/worldLibraryClient.js`に3関数を追加**

ファイル末尾に追記:
```js
export async function getWorld(id) {
  return apiFetch(`/api/worlds/${id}`, { method: 'GET' });
}

export async function listWorlds() {
  return apiFetch('/api/worlds', { method: 'GET' });
}

export async function deleteWorld(id) {
  const res = await fetch(`/api/worlds/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/worldLibraryClient.test.js`
Expected: PASS(既存6テスト + 新規6テスト = 12テスト)

- [ ] **Step 5: Commit**

```bash
git add src/api/worldLibraryClient.js src/api/worldLibraryClient.test.js
git commit -m "feat(frontend): add getWorld/listWorlds/deleteWorld to world client"
```

---

## Task 2: src/components/library/ConfirmModal.jsx

**Files:**
- Create: `src/components/library/ConfirmModal.jsx`
- Create: `src/components/library/ConfirmModal.test.jsx`

**Interfaces:**
- Consumes: `src/components/ui/Card.jsx`、`src/components/ui/Button.jsx`、`src/theme.js`の`COLORS`/`F_BODY`
- Produces: `<ConfirmModal open={boolean} message={string} onConfirm={fn} onCancel={fn} />`。Task 3〜6の各タブコンポーネントが削除確認に使う。

- [ ] **Step 1: `src/components/library/ConfirmModal.test.jsx`を書く(失敗する状態)**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmModal from './ConfirmModal.jsx';

describe('ConfirmModal', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmModal open={false} message="削除しますか?" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText('削除しますか?')).not.toBeInTheDocument();
  });

  it('shows the message and calls onConfirm when confirmed', () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal open={true} message="本当に削除しますか?" onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByText('本当に削除しますか?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('削除する'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancelled', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal open={true} message="本当に削除しますか?" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('キャンセル'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/library/ConfirmModal.test.jsx`
Expected: FAIL(`ConfirmModal.jsx`が存在しない)

- [ ] **Step 3: `src/components/library/ConfirmModal.jsx`を実装**

```jsx
import { COLORS, F_BODY } from '../../theme.js';
import Card from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';

export default function ConfirmModal({ open, message, onConfirm, onCancel }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(31,42,56,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <Card style={{ maxWidth: 360, width: '90%' }}>
        <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.ink, marginBottom: 20 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
          <Button variant="brass" onClick={onConfirm}>
            削除する
          </Button>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/components/library/ConfirmModal.test.jsx`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/library/ConfirmModal.jsx src/components/library/ConfirmModal.test.jsx
git commit -m "feat(frontend): add shared ConfirmModal for library deletions"
```

---

## Task 3: src/screens/library/WorldTab.jsx

**Files:**
- Create: `src/screens/library/WorldTab.jsx`
- Create: `src/screens/library/WorldTab.test.jsx`

**Interfaces:**
- Consumes: `getWorld`/`deleteWorld`/`putRegion`/`putCategory`(`src/api/worldLibraryClient.js`、Task 1)、`importWorld`/`reimportWorld`(`src/api/worldImport.js`、既存)、`ConfirmModal`(Task 2)
- Produces: `<WorldTab worlds={Array<{id,title,updatedAt}>} selectedWorldId={string|null} onSelectWorld={fn} onWorldsChanged={async fn} />`。Task 7の`Library.jsx`が使う。

- [ ] **Step 1: `src/screens/library/WorldTab.test.jsx`を書く(失敗する状態)**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorldTab from './WorldTab.jsx';
import * as worldLibraryClient from '../../api/worldLibraryClient.js';
import * as worldImport from '../../api/worldImport.js';

beforeEach(() => {
  vi.restoreAllMocks();
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
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/library/WorldTab.test.jsx`
Expected: FAIL(`WorldTab.jsx`が存在しない)

- [ ] **Step 3: `src/screens/library/WorldTab.jsx`を実装**

```jsx
import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import { getWorld, deleteWorld, putRegion, putCategory } from '../../api/worldLibraryClient.js';
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
  const [splitResult, setSplitResult] = useState(null);
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
    setSplitResult(null);
    setError('');
    (async () => {
      try {
        const world = await getWorld(selectedWorldId);
        setDetail(world);
        setEditTitle(world.title);
        setEditRaw(world.raw);
      } catch (e) {
        setError('World取得に失敗した: ' + e.message);
      }
    })();
  }, [selectedWorldId]);

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      const split = await importWorld(newId, newTitle, newRaw);
      setSplitResult(split);
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
      const split = await reimportWorld(selectedWorldId, editTitle, adjustmentRequest || undefined);
      setSplitResult(split);
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

  async function handleSaveRegion(regionId) {
    setBusy(true);
    setError('');
    try {
      await putRegion(selectedWorldId, regionId, regionDraft);
      setSplitResult((prev) => ({
        ...prev,
        regions: prev.regions.map((r) => (r.id === regionId ? { ...r, content: regionDraft } : r)),
      }));
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
      setSplitResult((prev) => ({
        ...prev,
        categories: prev.categories.map((c) => (c.id === categoryId ? { ...c, content: categoryDraft } : c)),
      }));
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

          {splitResult && (
            <div>
              <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.brassDark, marginBottom: 8 }}>
                地域(region)
              </div>
              {splitResult.regions.map((r) => (
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
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingRegionId(r.id);
                        setRegionDraft(r.content);
                      }}
                    >
                      編集
                    </Button>
                  )}
                </Card>
              ))}

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
              {splitResult.categories.map((c) => (
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
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setEditingCategoryId(c.id);
                        setCategoryDraft(c.content);
                      }}
                    >
                      編集
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          )}
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
Expected: PASS(4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/library/WorldTab.jsx src/screens/library/WorldTab.test.jsx
git commit -m "feat(frontend): add WorldTab to library screen"
```

---

## Task 4: src/screens/library/CharacterTab.jsx

**Files:**
- Create: `src/screens/library/CharacterTab.jsx`
- Create: `src/screens/library/CharacterTab.test.jsx`

**Interfaces:**
- Consumes: `getCharacter`/`putCharacter`/`listCharacters`/`deleteCharacter`(`src/api/characterLibraryClient.js`、既存)、`ConfirmModal`(Task 2)
- Produces: `<CharacterTab worldId={string|null} />`。Task 7の`Library.jsx`が使う。

- [ ] **Step 1: `src/screens/library/CharacterTab.test.jsx`を書く(失敗する状態)**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CharacterTab from './CharacterTab.jsx';
import * as characterLibraryClient from '../../api/characterLibraryClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('CharacterTab', () => {
  it('shows guidance when no world is selected', () => {
    render(<CharacterTab worldId={null} />);
    expect(screen.getByText('先にWorldタブでWorldを作成・選択してください。')).toBeInTheDocument();
  });

  it('lists PC characters for the selected world', async () => {
    vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([
      { id: 'w1/pc/alice', worldId: 'w1', kind: 'pc', name: 'alice', revealed: null },
    ]);
    render(<CharacterTab worldId="w1" />);
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
    expect(characterLibraryClient.listCharacters).toHaveBeenCalledWith('w1', 'pc');
  });

  it('shows the revealed badge for NPCs and switches list on kind toggle', async () => {
    const listSpy = vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([
      { id: 'w1/npc/villain', worldId: 'w1', kind: 'npc', name: 'villain', revealed: true },
    ]);
    render(<CharacterTab worldId="w1" />);
    fireEvent.click(screen.getByText('NPC'));
    await waitFor(() => expect(listSpy).toHaveBeenCalledWith('w1', 'npc'));
    expect(screen.getByText('villain')).toBeInTheDocument();
    expect(screen.getByText('開示済み')).toBeInTheDocument();
  });

  it('creates a new PC via putCharacter', async () => {
    vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([]);
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacter').mockResolvedValue({});
    render(<CharacterTab worldId="w1" />);
    await waitFor(() => expect(characterLibraryClient.listCharacters).toHaveBeenCalled());

    fireEvent.click(screen.getByText('+ 新規Character'));
    fireEvent.change(screen.getByPlaceholderText('例: alice'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByPlaceholderText('PC/NPCシートの本文'), { target: { value: 'goal: ...' } });
    fireEvent.click(screen.getByText('作成する'));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('w1', 'pc', 'alice', { raw: 'goal: ...', revealed: undefined })
    );
  });

  it('deletes a character after confirmation', async () => {
    vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([
      { id: 'w1/pc/alice', worldId: 'w1', kind: 'pc', name: 'alice', revealed: null },
    ]);
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({ raw: '本文', revealed: null });
    const deleteSpy = vi.spyOn(characterLibraryClient, 'deleteCharacter').mockResolvedValue();

    render(<CharacterTab worldId="w1" />);
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
    fireEvent.click(screen.getByText('alice'));
    await waitFor(() => expect(screen.getByText('削除')).toBeInTheDocument());
    fireEvent.click(screen.getByText('削除'));
    fireEvent.click(screen.getByText('削除する'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('w1', 'pc', 'alice'));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/library/CharacterTab.test.jsx`
Expected: FAIL(`CharacterTab.jsx`が存在しない)

- [ ] **Step 3: `src/screens/library/CharacterTab.jsx`を実装**

```jsx
import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import { getCharacter, putCharacter, listCharacters, deleteCharacter } from '../../api/characterLibraryClient.js';

export default function CharacterTab({ worldId }) {
  const [kind, setKind] = useState('pc');
  const [characters, setCharacters] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRaw, setNewRaw] = useState('');
  const [newRevealed, setNewRevealed] = useState(false);

  const [selectedName, setSelectedName] = useState(null);
  const [editRaw, setEditRaw] = useState('');
  const [editRevealed, setEditRevealed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function refresh() {
    if (!worldId) return;
    try {
      setCharacters(await listCharacters(worldId, kind));
    } catch (e) {
      setError('一覧取得に失敗した: ' + e.message);
    }
  }

  useEffect(() => {
    setSelectedName(null);
    setCreating(false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, kind]);

  useEffect(() => {
    if (!selectedName) return;
    (async () => {
      try {
        const c = await getCharacter(worldId, kind, selectedName);
        setEditRaw(c.raw);
        setEditRevealed(!!c.revealed);
      } catch (e) {
        setError('取得に失敗した: ' + e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedName]);

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      await putCharacter(worldId, kind, newName, {
        raw: newRaw,
        revealed: kind === 'npc' ? newRevealed : undefined,
      });
      setNewName('');
      setNewRaw('');
      setNewRevealed(false);
      setCreating(false);
      await refresh();
    } catch (e) {
      setError('作成に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setError('');
    try {
      await putCharacter(worldId, kind, selectedName, {
        raw: editRaw,
        revealed: kind === 'npc' ? editRevealed : undefined,
      });
      await refresh();
    } catch (e) {
      setError('保存に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError('');
    try {
      await deleteCharacter(worldId, kind, deleteTarget);
      if (selectedName === deleteTarget) setSelectedName(null);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError('削除に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!worldId) {
    return (
      <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
        先にWorldタブでWorldを作成・選択してください。
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Button variant={kind === 'pc' ? 'primary' : 'ghost'} onClick={() => setKind('pc')}>
          PC
        </Button>
        <Button variant={kind === 'npc' ? 'primary' : 'ghost'} onClick={() => setKind('npc')}>
          NPC
        </Button>
        <div style={{ flex: 1 }} />
        <Button
          variant="primary"
          onClick={() => {
            setCreating(true);
            setSelectedName(null);
          }}
        >
          + 新規Character
        </Button>
      </div>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {characters.map((c) => (
          <Card
            key={c.name}
            onClick={() => {
              setCreating(false);
              setSelectedName(c.name);
            }}
            style={{ cursor: 'pointer', borderColor: selectedName === c.name ? COLORS.brass : COLORS.line }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{c.name}</div>
              {kind === 'npc' && (
                <span
                  style={{ fontFamily: F_DISPLAY, fontSize: 11, color: c.revealed ? COLORS.brassDark : COLORS.faint }}
                >
                  {c.revealed ? '開示済み' : '未開示'}
                </span>
              )}
            </div>
          </Card>
        ))}
        {characters.length === 0 && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>まだ登録が無い。</div>
        )}
      </div>

      {creating && (
        <Card>
          <Field label="識別子(name)" hint="内部で使う一意なキー(英数字推奨)。本文中の名称とは別。">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例: alice" style={inputStyle} />
          </Field>
          <Field label="本文" hint="自由記述。goal/bondsを書いておくとよい。">
            <textarea
              value={newRaw}
              onChange={(e) => setNewRaw(e.target.value)}
              rows={8}
              placeholder="PC/NPCシートの本文"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          {kind === 'npc' && (
            <Field label="開示状態">
              <label style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
                <input type="checkbox" checked={newRevealed} onChange={(e) => setNewRevealed(e.target.checked)} />{' '}
                revealed(物語中で開示済み)
              </label>
            </Field>
          )}
          <Button variant="brass" onClick={handleCreate} disabled={busy || !newName}>
            {busy ? '作成中…' : '作成する'}
          </Button>
        </Card>
      )}

      {!creating && selectedName && (
        <Card>
          <Field label="本文">
            <textarea
              value={editRaw}
              onChange={(e) => setEditRaw(e.target.value)}
              rows={8}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          {kind === 'npc' && (
            <Field label="開示状態">
              <label style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
                <input type="checkbox" checked={editRevealed} onChange={(e) => setEditRevealed(e.target.checked)} />{' '}
                revealed(物語中で開示済み)
              </label>
            </Field>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="brass" onClick={handleSave} disabled={busy}>
              {busy ? '保存中…' : '保存する'}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteTarget(selectedName)} disabled={busy}>
              削除
            </Button>
          </div>
        </Card>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        message={`Character「${deleteTarget}」を削除する。よいか?`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/library/CharacterTab.test.jsx`
Expected: PASS(5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/library/CharacterTab.jsx src/screens/library/CharacterTab.test.jsx
git commit -m "feat(frontend): add CharacterTab to library screen"
```

---

## Task 5: src/screens/library/ScenarioTab.jsx

**Files:**
- Create: `src/screens/library/ScenarioTab.jsx`
- Create: `src/screens/library/ScenarioTab.test.jsx`

**Interfaces:**
- Consumes: `getScenario`/`putScenario`/`listScenarios`/`deleteScenario`(`src/api/scenarioLibraryClient.js`、Task S1で実装済み)、`ConfirmModal`(Task 2)
- Produces: `<ScenarioTab worldId={string|null} />`。Task 7の`Library.jsx`が使う。

- [ ] **Step 1: `src/screens/library/ScenarioTab.test.jsx`を書く(失敗する状態)**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ScenarioTab from './ScenarioTab.jsx';
import * as scenarioLibraryClient from '../../api/scenarioLibraryClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ScenarioTab', () => {
  it('shows guidance when no world is selected', () => {
    render(<ScenarioTab worldId={null} />);
    expect(screen.getByText('先にWorldタブでWorldを作成・選択してください。')).toBeInTheDocument();
  });

  it('lists scenarios for the selected world with recommendedRuleset', async () => {
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
      { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: 'coc7e' },
    ]);
    render(<ScenarioTab worldId="w1" />);
    await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
    expect(screen.getByText(/coc7e/)).toBeInTheDocument();
  });

  it('creates a new scenario via putScenario', async () => {
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    const putSpy = vi.spyOn(scenarioLibraryClient, 'putScenario').mockResolvedValue({});
    render(<ScenarioTab worldId="w1" />);
    await waitFor(() => expect(scenarioLibraryClient.listScenarios).toHaveBeenCalled());

    fireEvent.click(screen.getByText('+ 新規Scenario'));
    fireEvent.change(screen.getByPlaceholderText('例: missing-heir'), { target: { value: 'sc1' } });
    fireEvent.change(screen.getByPlaceholderText('シナリオタイトル'), { target: { value: '失踪事件' } });
    fireEvent.change(screen.getByPlaceholderText('シナリオ本文'), { target: { value: '## 概要' } });
    fireEvent.change(screen.getByPlaceholderText('例: coc7e'), { target: { value: 'coc7e' } });
    fireEvent.click(screen.getByText('作成する'));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('w1', 'sc1', {
        title: '失踪事件',
        raw: '## 概要',
        recommendedRuleset: 'coc7e',
      })
    );
  });

  it('deletes a scenario after confirmation', async () => {
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
      { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: null },
    ]);
    vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
      title: '失踪事件',
      raw: '## 概要',
      recommendedRuleset: null,
    });
    const deleteSpy = vi.spyOn(scenarioLibraryClient, 'deleteScenario').mockResolvedValue();

    render(<ScenarioTab worldId="w1" />);
    await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
    fireEvent.click(screen.getByText('失踪事件'));
    await waitFor(() => expect(screen.getByText('削除')).toBeInTheDocument());
    fireEvent.click(screen.getByText('削除'));
    fireEvent.click(screen.getByText('削除する'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('w1', 'sc1'));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/library/ScenarioTab.test.jsx`
Expected: FAIL(`ScenarioTab.jsx`が存在しない)

- [ ] **Step 3: `src/screens/library/ScenarioTab.jsx`を実装**

```jsx
import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import { getScenario, putScenario, listScenarios, deleteScenario } from '../../api/scenarioLibraryClient.js';

export default function ScenarioTab({ worldId }) {
  const [scenarios, setScenarios] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newRaw, setNewRaw] = useState('');
  const [newRecommendedRuleset, setNewRecommendedRuleset] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editRaw, setEditRaw] = useState('');
  const [editRecommendedRuleset, setEditRecommendedRuleset] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function refresh() {
    if (!worldId) return;
    try {
      setScenarios(await listScenarios(worldId));
    } catch (e) {
      setError('一覧取得に失敗した: ' + e.message);
    }
  }

  useEffect(() => {
    setSelectedId(null);
    setCreating(false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      try {
        const s = await getScenario(worldId, selectedId);
        setEditTitle(s.title);
        setEditRaw(s.raw);
        setEditRecommendedRuleset(s.recommendedRuleset || '');
      } catch (e) {
        setError('取得に失敗した: ' + e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      await putScenario(worldId, newId, {
        title: newTitle,
        raw: newRaw,
        recommendedRuleset: newRecommendedRuleset || null,
      });
      setNewId('');
      setNewTitle('');
      setNewRaw('');
      setNewRecommendedRuleset('');
      setCreating(false);
      await refresh();
    } catch (e) {
      setError('作成に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setError('');
    try {
      await putScenario(worldId, selectedId, {
        title: editTitle,
        raw: editRaw,
        recommendedRuleset: editRecommendedRuleset || null,
      });
      await refresh();
    } catch (e) {
      setError('保存に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError('');
    try {
      await deleteScenario(worldId, deleteTarget);
      if (selectedId === deleteTarget) setSelectedId(null);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError('削除に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!worldId) {
    return (
      <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
        先にWorldタブでWorldを作成・選択してください。
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>Scenario一覧</div>
        <Button
          variant="primary"
          onClick={() => {
            setCreating(true);
            setSelectedId(null);
          }}
        >
          + 新規Scenario
        </Button>
      </div>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {scenarios.map((s) => (
          <Card
            key={s.id}
            onClick={() => {
              setCreating(false);
              setSelectedId(s.id);
            }}
            style={{ cursor: 'pointer', borderColor: selectedId === s.id ? COLORS.brass : COLORS.line }}
          >
            <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{s.title}</div>
            <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft }}>
              推奨ルール: {s.recommendedRuleset || '未設定'}
            </div>
          </Card>
        ))}
        {scenarios.length === 0 && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>まだ登録が無い。</div>
        )}
      </div>

      {creating && (
        <Card>
          <Field label="識別子(id)" hint="内部で使う一意なキー(英数字推奨)。">
            <input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="例: missing-heir"
              style={inputStyle}
            />
          </Field>
          <Field label="タイトル">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="シナリオタイトル"
              style={inputStyle}
            />
          </Field>
          <Field label="本文">
            <textarea
              value={newRaw}
              onChange={(e) => setNewRaw(e.target.value)}
              rows={8}
              placeholder="シナリオ本文"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <Field label="推奨ルール(recommendedRuleset)" hint="任意。自由テキスト。">
            <input
              value={newRecommendedRuleset}
              onChange={(e) => setNewRecommendedRuleset(e.target.value)}
              placeholder="例: coc7e"
              style={inputStyle}
            />
          </Field>
          <Button variant="brass" onClick={handleCreate} disabled={busy || !newId || !newTitle}>
            {busy ? '作成中…' : '作成する'}
          </Button>
        </Card>
      )}

      {!creating && selectedId && (
        <Card>
          <Field label="タイトル">
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="本文">
            <textarea
              value={editRaw}
              onChange={(e) => setEditRaw(e.target.value)}
              rows={8}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <Field label="推奨ルール(recommendedRuleset)" hint="任意。自由テキスト。">
            <input
              value={editRecommendedRuleset}
              onChange={(e) => setEditRecommendedRuleset(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="brass" onClick={handleSave} disabled={busy}>
              {busy ? '保存中…' : '保存する'}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteTarget(selectedId)} disabled={busy}>
              削除
            </Button>
          </div>
        </Card>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        message={`Scenario「${deleteTarget}」を削除する。よいか?`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/library/ScenarioTab.test.jsx`
Expected: PASS(4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/library/ScenarioTab.jsx src/screens/library/ScenarioTab.test.jsx
git commit -m "feat(frontend): add ScenarioTab to library screen"
```

---

## Task 6: src/screens/library/RulesetTab.jsx

**Files:**
- Create: `src/screens/library/RulesetTab.jsx`
- Create: `src/screens/library/RulesetTab.test.jsx`

**Interfaces:**
- Consumes: `getRuleset`/`putRuleset`/`listRulesets`/`deleteRuleset`(`src/api/rulesetLibraryClient.js`、Task S2で実装済み)、`ConfirmModal`(Task 2)
- Produces: `<RulesetTab />`(propなし、Worldに依存しない)。Task 7の`Library.jsx`が使う。

- [ ] **Step 1: `src/screens/library/RulesetTab.test.jsx`を書く(失敗する状態)**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RulesetTab from './RulesetTab.jsx';
import * as rulesetLibraryClient from '../../api/rulesetLibraryClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('RulesetTab', () => {
  it('lists rulesets on mount', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([
      { id: 'homebrew', label: '自作ルール', desc: '独自ルール', hint: '' },
    ]);
    render(<RulesetTab />);
    await waitFor(() => expect(screen.getByText('自作ルール')).toBeInTheDocument());
  });

  it('creates a new ruleset via putRuleset', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([]);
    const putSpy = vi.spyOn(rulesetLibraryClient, 'putRuleset').mockResolvedValue({});
    render(<RulesetTab />);
    await waitFor(() => expect(rulesetLibraryClient.listRulesets).toHaveBeenCalled());

    fireEvent.click(screen.getByText('+ 新規Ruleset'));
    fireEvent.change(screen.getByPlaceholderText('例: homebrew'), { target: { value: 'homebrew' } });
    fireEvent.change(screen.getByPlaceholderText('ラベル'), { target: { value: '自作ルール' } });
    fireEvent.change(screen.getByPlaceholderText('説明'), { target: { value: '独自ルール' } });
    fireEvent.click(screen.getByText('作成する'));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('homebrew', { label: '自作ルール', desc: '独自ルール', hint: '' })
    );
  });

  it('deletes a ruleset after confirmation', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([
      { id: 'homebrew', label: '自作ルール', desc: '独自ルール', hint: '' },
    ]);
    vi.spyOn(rulesetLibraryClient, 'getRuleset').mockResolvedValue({
      label: '自作ルール',
      desc: '独自ルール',
      hint: '',
    });
    const deleteSpy = vi.spyOn(rulesetLibraryClient, 'deleteRuleset').mockResolvedValue();

    render(<RulesetTab />);
    await waitFor(() => expect(screen.getByText('自作ルール')).toBeInTheDocument());
    fireEvent.click(screen.getByText('自作ルール'));
    await waitFor(() => expect(screen.getByText('削除')).toBeInTheDocument());
    fireEvent.click(screen.getByText('削除'));
    fireEvent.click(screen.getByText('削除する'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('homebrew'));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/library/RulesetTab.test.jsx`
Expected: FAIL(`RulesetTab.jsx`が存在しない)

- [ ] **Step 3: `src/screens/library/RulesetTab.jsx`を実装**

```jsx
import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import { getRuleset, putRuleset, listRulesets, deleteRuleset } from '../../api/rulesetLibraryClient.js';

export default function RulesetTab() {
  const [rulesets, setRulesets] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newHint, setNewHint] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editHint, setEditHint] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function refresh() {
    try {
      setRulesets(await listRulesets());
    } catch (e) {
      setError('一覧取得に失敗した: ' + e.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      try {
        const r = await getRuleset(selectedId);
        setEditLabel(r.label);
        setEditDesc(r.desc);
        setEditHint(r.hint || '');
      } catch (e) {
        setError('取得に失敗した: ' + e.message);
      }
    })();
  }, [selectedId]);

  async function handleCreate() {
    setBusy(true);
    setError('');
    try {
      await putRuleset(newId, { label: newLabel, desc: newDesc, hint: newHint });
      setNewId('');
      setNewLabel('');
      setNewDesc('');
      setNewHint('');
      setCreating(false);
      await refresh();
    } catch (e) {
      setError('作成に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setError('');
    try {
      await putRuleset(selectedId, { label: editLabel, desc: editDesc, hint: editHint });
      await refresh();
    } catch (e) {
      setError('保存に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError('');
    try {
      await deleteRuleset(deleteTarget);
      if (selectedId === deleteTarget) setSelectedId(null);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setError('削除に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>Ruleset一覧</div>
        <Button
          variant="primary"
          onClick={() => {
            setCreating(true);
            setSelectedId(null);
          }}
        >
          + 新規Ruleset
        </Button>
      </div>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {rulesets.map((r) => (
          <Card
            key={r.id}
            onClick={() => {
              setCreating(false);
              setSelectedId(r.id);
            }}
            style={{ cursor: 'pointer', borderColor: selectedId === r.id ? COLORS.brass : COLORS.line }}
          >
            <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{r.label}</div>
            <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft }}>{r.desc}</div>
          </Card>
        ))}
        {rulesets.length === 0 && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>まだ登録が無い。</div>
        )}
      </div>

      {creating && (
        <Card>
          <Field label="識別子(id)" hint="内部で使う一意なキー(英数字推奨)。">
            <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="例: homebrew" style={inputStyle} />
          </Field>
          <Field label="ラベル">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="ラベル" style={inputStyle} />
          </Field>
          <Field label="説明(desc)">
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="説明" style={inputStyle} />
          </Field>
          <Field label="演出ヒント(hint)" hint="任意。GMの演出指示に使われる。">
            <textarea
              value={newHint}
              onChange={(e) => setNewHint(e.target.value)}
              rows={4}
              placeholder="演出ヒント(任意)"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <Button variant="brass" onClick={handleCreate} disabled={busy || !newId || !newLabel}>
            {busy ? '作成中…' : '作成する'}
          </Button>
        </Card>
      )}

      {!creating && selectedId && (
        <Card>
          <Field label="ラベル">
            <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="説明(desc)">
            <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} style={inputStyle} />
          </Field>
          <Field label="演出ヒント(hint)">
            <textarea
              value={editHint}
              onChange={(e) => setEditHint(e.target.value)}
              rows={4}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="brass" onClick={handleSave} disabled={busy}>
              {busy ? '保存中…' : '保存する'}
            </Button>
            <Button variant="ghost" onClick={() => setDeleteTarget(selectedId)} disabled={busy}>
              削除
            </Button>
          </div>
        </Card>
      )}

      <ConfirmModal
        open={deleteTarget !== null}
        message={`Ruleset「${deleteTarget}」を削除する。よいか?`}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/library/RulesetTab.test.jsx`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/library/RulesetTab.jsx src/screens/library/RulesetTab.test.jsx
git commit -m "feat(frontend): add RulesetTab to library screen"
```

---

## Task 7: src/screens/Library.jsx

**Files:**
- Create: `src/screens/Library.jsx`
- Create: `src/screens/Library.test.jsx`

**Interfaces:**
- Consumes: `listWorlds`(`src/api/worldLibraryClient.js`、Task 1)、`WorldTab`(Task 3)、`CharacterTab`(Task 4)、`ScenarioTab`(Task 5)、`RulesetTab`(Task 6)
- Produces: `<Library onClose={fn} />`。Task 8で`App.jsx`が使う。

- [ ] **Step 1: `src/screens/Library.test.jsx`を書く(失敗する状態)**

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Library from './Library.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(worlds = []) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => worlds }));
}

describe('Library', () => {
  it('shows the World tab by default', async () => {
    stubFetch([]);
    render(<Library onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('World一覧')).toBeInTheDocument());
  });

  it('shows a world-selector dropdown only on the Character/Scenario tabs', async () => {
    stubFetch([{ id: 'w1', title: 'World A', updatedAt: 1 }]);
    render(<Library onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('World一覧')).toBeInTheDocument());
    expect(screen.queryByText('World: 選択してください')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Character'));
    await waitFor(() => expect(screen.getByText('World: 選択してください')).toBeInTheDocument());
  });

  it('shows guidance in the Character tab when no world is selected', async () => {
    stubFetch([]);
    render(<Library onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Character'));
    await waitFor(() =>
      expect(screen.getByText('先にWorldタブでWorldを作成・選択してください。')).toBeInTheDocument()
    );
  });

  it('calls onClose when the close button is clicked', async () => {
    stubFetch([]);
    const onClose = vi.fn();
    render(<Library onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('World一覧')).toBeInTheDocument());
    fireEvent.click(screen.getByText('閉じる'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Library.test.jsx`
Expected: FAIL(`Library.jsx`が存在しない)

- [ ] **Step 3: `src/screens/Library.jsx`を実装**

```jsx
import { useState, useEffect, useCallback } from 'react';
import { COLORS, F_DISPLAY, F_MONO } from '../theme.js';
import Button from '../components/ui/Button.jsx';
import WorldTab from './library/WorldTab.jsx';
import CharacterTab from './library/CharacterTab.jsx';
import ScenarioTab from './library/ScenarioTab.jsx';
import RulesetTab from './library/RulesetTab.jsx';
import { listWorlds } from '../api/worldLibraryClient.js';

const TABS = [
  { key: 'world', label: 'World' },
  { key: 'character', label: 'Character' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'ruleset', label: 'Ruleset' },
];

export default function Library({ onClose }) {
  const [tab, setTab] = useState('world');
  const [worlds, setWorlds] = useState([]);
  const [selectedWorldId, setSelectedWorldId] = useState(null);

  const refreshWorlds = useCallback(async () => {
    setWorlds(await listWorlds());
  }, []);

  useEffect(() => {
    refreshWorlds();
  }, [refreshWorlds]);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 22, color: COLORS.ink }}>素材ライブラリ</div>
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, fontFamily: F_MONO, fontSize: 12 }}>
        {TABS.map((t) => (
          <div
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '6px 14px',
              borderRadius: 3,
              cursor: 'pointer',
              background: tab === t.key ? COLORS.ink : 'transparent',
              color: tab === t.key ? COLORS.paper : COLORS.faint,
              border: `1px solid ${tab === t.key ? COLORS.ink : COLORS.line}`,
            }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {(tab === 'character' || tab === 'scenario') && (
        <div style={{ marginBottom: 16 }}>
          <select
            value={selectedWorldId || ''}
            onChange={(e) => setSelectedWorldId(e.target.value || null)}
            style={{
              fontFamily: F_MONO,
              fontSize: 13,
              padding: '8px 10px',
              border: `1px solid ${COLORS.line}`,
              borderRadius: 4,
              background: COLORS.card,
              color: COLORS.inkSoft,
            }}
          >
            <option value="">World: 選択してください</option>
            {worlds.map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {tab === 'world' && (
        <WorldTab
          worlds={worlds}
          selectedWorldId={selectedWorldId}
          onSelectWorld={setSelectedWorldId}
          onWorldsChanged={refreshWorlds}
        />
      )}
      {tab === 'character' && <CharacterTab worldId={selectedWorldId} />}
      {tab === 'scenario' && <ScenarioTab worldId={selectedWorldId} />}
      {tab === 'ruleset' && <RulesetTab />}
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Library.test.jsx`
Expected: PASS(4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/Library.jsx src/screens/Library.test.jsx
git commit -m "feat(frontend): add Library screen container with tabs"
```

---

## Task 8: App.jsx / Home.jsx への導線追加

**Files:**
- Modify: `src/screens/Home.jsx`
- Modify: `src/screens/Home.test.jsx`
- Modify: `src/App.jsx`
- Modify: `src/App.test.jsx`

**Interfaces:**
- Consumes: `Library`(Task 7)
- Produces: `Home`に`onOpenLibrary`prop追加。`App`の`view`stateに`'library'`追加。

- [ ] **Step 1: `src/screens/Home.test.jsx`を更新(失敗する状態)**

既存の4テストの`render(<Home ... />)`呼び出しに`onOpenLibrary={vi.fn()}`を追加し(他のprops同様)、末尾に新規テストを追記する:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Home from './Home.jsx';

describe('Home', () => {
  it('shows the storage warning when storage is unavailable', () => {
    render(<Home sessions={[]} storageOk={false} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText(/保存機能\(IndexedDB\)が使えていない/)).toBeInTheDocument();
  });

  it('does not show the warning when storage is available', () => {
    render(<Home sessions={[]} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
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
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText('セッションA')).toBeInTheDocument();
    expect(screen.getByText(/シーン:/)).toBeInTheDocument();
    expect(screen.getByText(/森の奥から物音がした。/)).toBeInTheDocument();
  });

  it('shows a placeholder last line when the session has no log yet', () => {
    const sessions = [{ id: 's1', title: 'セッションB', updatedAt: 1, state: {}, log: [] }];
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText('(まだ進行なし)')).toBeInTheDocument();
  });

  it('calls onOpenLibrary when the library button is clicked', () => {
    const onOpenLibrary = vi.fn();
    render(<Home sessions={[]} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={onOpenLibrary} />);
    fireEvent.click(screen.getByText('素材ライブラリ'));
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: FAIL(「素材ライブラリ」ボタンが存在しない)

- [ ] **Step 3: `src/screens/Home.jsx`を更新**

関数シグネチャを変更:
```js
export default function Home({ sessions, storageOk, onNew, onContinue, onOpenLibrary }) {
```

次のブロック:
```jsx
      <Button variant="brass" onClick={onNew} style={{ marginBottom: 32 }}>
        + 新規プレイ
      </Button>
```
を次のように置き換える:
```jsx
      <div style={{ display: 'flex', gap: 10, marginBottom: 32 }}>
        <Button variant="brass" onClick={onNew}>
          + 新規プレイ
        </Button>
        <Button variant="ghost" onClick={onOpenLibrary}>
          素材ライブラリ
        </Button>
      </div>
```

- [ ] **Step 4: `Home.test.jsx`が通ることを確認**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: PASS(5 tests)

- [ ] **Step 5: `src/App.test.jsx`に新規テストを追記(失敗する状態)**

ファイル冒頭のimportに`vi`を追加し、テストを追記する:
```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from './App.jsx';

describe('App', () => {
  it('shows the home screen after the initial storage check completes', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());
    expect(screen.getByText('+ 新規プレイ')).toBeInTheDocument();
  });

  it('navigates to the library screen and back', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    fireEvent.click(screen.getByText('素材ライブラリ'));
    await waitFor(() => expect(screen.getByText('素材ライブラリ')).toBeInTheDocument());
    expect(screen.getByText('World一覧')).toBeInTheDocument();

    fireEvent.click(screen.getByText('閉じる'));
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npx vitest run src/App.test.jsx`
Expected: FAIL(`view === 'library'`が存在しない)

- [ ] **Step 7: `src/App.jsx`を更新**

```jsx
import { useState, useEffect } from 'react';
import { useGoogleFonts, COLORS, F_MONO } from './theme.js';
import { listSessions, getSession, saveSession, isStorageAvailable } from './storage/index.js';
import Home from './screens/Home.jsx';
import Setup from './screens/Setup.jsx';
import Play from './screens/Play.jsx';
import Library from './screens/Library.jsx';

export default function App() {
  useGoogleFonts();
  const [view, setView] = useState('home'); // home | setup | library | play
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [loadingHome, setLoadingHome] = useState(true);
  const [storageOk, setStorageOk] = useState(true);

  useEffect(() => {
    (async () => {
      setStorageOk(await isStorageAvailable());
      setSessions(await listSessions());
      setLoadingHome(false);
    })();
  }, []);

  async function handleContinue(id) {
    const s = await getSession(id);
    if (s) {
      setSession(s);
      setView('play');
    }
  }

  async function handleStart(newSession) {
    setSession(newSession);
    await saveSession(newSession);
    setView('play');
  }

  async function handleExit() {
    setSessions(await listSessions());
    setSession(null);
    setView('home');
  }

  return (
    <div
      style={{
        background: COLORS.paper,
        minHeight: '100vh',
        color: COLORS.ink,
      }}
    >
      {view === 'home' &&
        (loadingHome ? (
          <div style={{ padding: 48, fontFamily: F_MONO, color: COLORS.faint }}>読み込み中…</div>
        ) : (
          <Home
            sessions={sessions}
            storageOk={storageOk}
            onNew={() => setView('setup')}
            onContinue={handleContinue}
            onOpenLibrary={() => setView('library')}
          />
        ))}
      {view === 'setup' && <Setup onStart={handleStart} onCancel={() => setView('home')} />}
      {view === 'library' && <Library onClose={() => setView('home')} />}
      {view === 'play' && session && (
        <Play session={session} setSession={setSession} onExit={handleExit} />
      )}
    </div>
  );
}
```

- [ ] **Step 8: `App.test.jsx`が通ることを確認**

Run: `npx vitest run src/App.test.jsx`
Expected: PASS(2 tests)

- [ ] **Step 9: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 10: ビルドを確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 11: Commit**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx src/App.jsx src/App.test.jsx
git commit -m "feat(frontend): wire up library screen navigation from Home"
```

---

## Self-Review Notes

- **Spec coverage**: 設計spec(`docs/superpowers/specs/2026-07-22-library-screen-design.md`)の3節(全体構成)→Task 7、4.1(WorldTab)→Task 3、4.2(CharacterTab)→Task 4、4.3(ScenarioTab)→Task 5、4.4(RulesetTab)→Task 6、5節(ConfirmModal)→Task 2、6節(Home/App導線)→Task 8、に対応。`worldLibraryClient.js`の不足関数(spec 3節の注記)→Task 1。
- **Placeholder scan**: 「TBD」等の記述なし。全ステップに実行可能なコード・コマンドを記載済み。
- **Type consistency**: `WorldTab`の`onWorldsChanged`は`Library.jsx`の`refreshWorlds`(`Promise<void>`)と一致。`CharacterTab`/`ScenarioTab`の`worldId`propは`Library.jsx`の`selectedWorldId`(string|null)と一致。`splitResult`の`{world, regions, categories}`形状は`worldSplit.js`/`worldImport.js`の既存実装・既存テストと一致することを確認済み。
- **既存パターンとの一貫性**: エラー表示・busyボタン無効化パターンは`Setup.jsx`と統一。APIモック手法(`vi.spyOn(moduleNamespace, 'fn')`)は`worldImport.test.js`で確立済みのパターンを踏襲。
- **非スコープの遵守**: Setupウィザード連携・Campaign・goal/bonds一覧表示・新規サーバーAPIの追加は、どのタスクにも含まれていない。
