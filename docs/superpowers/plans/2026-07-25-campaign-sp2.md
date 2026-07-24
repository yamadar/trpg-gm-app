# キャンペーン(連作シナリオ)SP2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SP1のキャンペーン基盤に、Libraryの管理タブ(一覧・章閲覧・改名・削除)とHomeのキャンペーン単位グルーピングを追加する。

**Architecture:** バックエンドはDELETEを1本追加(`deleteCampaign` + `DELETE`ルート + クライアント)。管理タブ `CampaignTab` は既存 `ScenarioTab` と同型でLibraryのWorld選択ドロップダウンを流用。HomeはcampaignId付きセッションの登場worldIdごとに `listCampaigns` を呼びタイトルを解決してグループ表示する。

**Tech Stack:** Node/Express + vitest + supertest、React 18。新規依存なし。

## Global Constraints

- Campaignメタ: `{ id, worldId, title, carriedPc: { raw, xp }, chapters: [{ sessionId, title, endedAt }], createdAt, updatedAt }`。dataStoreのみ。
- 章は**閲覧のみ**(章タイトル・終了日時の読み取り専用)。管理タブに新規作成UIは持たない(campaignはHomeの「次の章へ」から生成)。
- 削除はcampaignメタのみ。**メンバーセッションの `campaignId` は不変**。dangling `campaignId` はHomeで非グループ表示にフォールバック。
- DELETEは冪等(未存在でも204)。クライアントの `deleteCampaign` は204を扱うため生 `fetch`(`res.json()` しない)。
- 改名は新API不要。既存 `putCampaign` に現行 `carriedPc`/`chapters` を渡し `title` のみ差し替え。
- UI文言・コメントは日本語。新規依存禁止。
- コミット末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。テスト: 個別 `npx vitest run <path>`、全体 `npm test`。

## ファイル構成

- Modify: `server/storage/campaignLibrary.js`(+test), `server/routes/campaigns.js`(+test), `src/api/campaignClient.js`(+test), `src/screens/Library.jsx`, `src/screens/Home.jsx`(+test), docs
- Create: `src/screens/library/CampaignTab.jsx`(+test)

---

### Task 1: campaignLibrary.deleteCampaign

**Files:**
- Modify: `server/storage/campaignLibrary.js`
- Test: `server/storage/campaignLibrary.test.js`(追記)

**Interfaces:**
- Consumes: `campaignMetaKey`(既存)、`dataStore.delete(key)`(既存、ENOENT握り潰し)。
- Produces: `deleteCampaign(dataStore, userId, worldId, id) -> Promise<void>`。Task 2 が使用。

- [ ] **Step 1: 失敗するテストを追記**

`server/storage/campaignLibrary.test.js` の import に `deleteCampaign` を追加:

```js
import { saveCampaign, getCampaign, listCampaigns, deleteCampaign } from './campaignLibrary.js';
```

`describe('campaignLibrary', ...)` の最後(`returns null for a missing campaign` の後）に追記:

```js
  it('deletes a campaign so it is no longer retrievable', async () => {
    await saveCampaign(dataStore, 'u', { id: 'cp1', worldId: 'w1', title: 'A', carriedPc: { raw: 'x', xp: 0 }, chapters: [] });
    await deleteCampaign(dataStore, 'u', 'w1', 'cp1');
    expect(await getCampaign(dataStore, 'u', 'w1', 'cp1')).toBeNull();
  });
  it('does not throw when deleting a missing campaign', async () => {
    await expect(deleteCampaign(dataStore, 'u', 'w1', 'nope')).resolves.toBeUndefined();
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/storage/campaignLibrary.test.js`
Expected: FAIL — `deleteCampaign` is not a function

- [ ] **Step 3: 実装**

`server/storage/campaignLibrary.js` の import に `campaignMetaKey` が既にある前提で、ファイル末尾に追加:

```js
export async function deleteCampaign(dataStore, userId, worldId, id) {
  await dataStore.delete(campaignMetaKey(userId, worldId, id));
}
```

- [ ] **Step 4: テスト確認 → Commit**

Run: `npx vitest run server/storage/campaignLibrary.test.js` → PASS

```bash
git add server/storage/campaignLibrary.js server/storage/campaignLibrary.test.js
git commit -m "feat(server): campaignLibraryにdeleteCampaignを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: DELETE campaigns ルート

**Files:**
- Modify: `server/routes/campaigns.js`
- Test: `server/routes/campaigns.test.js`(追記)

**Interfaces:**
- Consumes: `deleteCampaign`(Task 1)。
- Produces: `DELETE /api/worlds/:worldId/campaigns/:id` → 204(冪等)。

- [ ] **Step 1: 失敗するテストを追記**

`server/routes/campaigns.test.js` の `describe('campaigns routes', ...)` の最後に追記:

```js
  it('deletes a campaign and is idempotent', async () => {
    await request(app).put('/api/worlds/w1/campaigns/cp1').send(body);
    const del = await request(app).delete('/api/worlds/w1/campaigns/cp1');
    expect(del.status).toBe(204);
    expect((await request(app).get('/api/worlds/w1/campaigns/cp1')).status).toBe(404);
    // 未存在でも204(冪等)
    expect((await request(app).delete('/api/worlds/w1/campaigns/cp1')).status).toBe(204);
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/routes/campaigns.test.js`
Expected: FAIL — DELETE が 404(ルート未定義)

- [ ] **Step 3: 実装**

`server/routes/campaigns.js` の import に `deleteCampaign` を追加:

```js
import { saveCampaign, getCampaign, listCampaigns, deleteCampaign } from '../storage/campaignLibrary.js';
```

PUTルートの `return router;` の直前に追加:

```js
  router.delete('/worlds/:worldId/campaigns/:id', asyncHandler(async (req, res) => {
    await deleteCampaign(dataStore, req.userId, req.params.worldId, req.params.id);
    res.status(204).end();
  }));
```

- [ ] **Step 4: テスト確認 → Commit**

Run: `npx vitest run server/routes/campaigns.test.js server/index.test.js` → PASS

```bash
git add server/routes/campaigns.js server/routes/campaigns.test.js
git commit -m "feat(server): campaigns DELETEルートを追加(冪等)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: campaignClient.deleteCampaign

**Files:**
- Modify: `src/api/campaignClient.js`
- Test: `src/api/campaignClient.test.js`(追記)

**Interfaces:**
- Produces: `deleteCampaign(worldId, id) -> Promise<void>`。204(no body)を扱うため生 `fetch` を使い、`!res.ok` 時のみ throw。Task 4/5 が使用。

- [ ] **Step 1: 失敗するテストを追記**

`src/api/campaignClient.test.js` の import に `deleteCampaign` を追加:

```js
import { listCampaigns, getCampaign, putCampaign, deleteCampaign } from './campaignClient.js';
```

`beforeEach` の `mockResolvedValue` を、204(no body)でも動くよう `ok: true` は維持しつつ、`describe` 末尾に追記:

```js
  it('DELETEs a campaign', async () => {
    await deleteCampaign('w1', 'cp1');
    expect(fetch).toHaveBeenCalledWith('/api/worlds/w1/campaigns/cp1', { method: 'DELETE' });
  });
  it('throws when the DELETE response is not ok', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    await expect(deleteCampaign('w1', 'cp1')).rejects.toThrow(/500/);
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/api/campaignClient.test.js`
Expected: FAIL — `deleteCampaign` is not a function

- [ ] **Step 3: 実装**

`src/api/campaignClient.js` の末尾に追加(生 `fetch`。`apiFetch` は使わない):

```js
export async function deleteCampaign(worldId, id) {
  const res = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/campaigns/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: テスト確認 → Commit**

Run: `npx vitest run src/api/campaignClient.test.js` → PASS

```bash
git add src/api/campaignClient.js src/api/campaignClient.test.js
git commit -m "feat(ui): campaignClientにdeleteCampaignを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: CampaignTab(管理タブ)+ Library結線

**Files:**
- Create: `src/screens/library/CampaignTab.jsx`
- Create: `src/screens/library/CampaignTab.test.jsx`
- Modify: `src/screens/Library.jsx`

**Interfaces:**
- Consumes: `listCampaigns`/`getCampaign`/`putCampaign`/`deleteCampaign`(Task 3 + 既存)、`ConfirmModal`(既存)。
- Produces: `<CampaignTab worldId={string|null} />`。Library の `campaign` タブが描画。

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/library/CampaignTab.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignTab from './CampaignTab.jsx';
import * as campaignClient from '../../api/campaignClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const CP = {
  id: 'cp1',
  worldId: 'w1',
  title: '影の連鎖',
  carriedPc: { raw: 'PC名: カイ(熟練)', xp: 12 },
  chapters: [{ sessionId: 's1', title: '第一章', endedAt: 1 }],
};

describe('CampaignTab', () => {
  it('worldId未選択ならプレースホルダを出す', () => {
    render(<CampaignTab worldId={null} />);
    expect(screen.getByText(/先にWorldタブ/)).toBeInTheDocument();
  });

  it('一覧を表示し、選択で章とcarriedPcを読み取り専用表示する', async () => {
    vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([CP]);
    vi.spyOn(campaignClient, 'getCampaign').mockResolvedValue(CP);
    render(<CampaignTab worldId="w1" />);
    fireEvent.click(await screen.findByText('影の連鎖'));
    expect(await screen.findByText(/第一章/)).toBeInTheDocument();
    expect(screen.getByText(/PC名: カイ\(熟練\)/)).toBeInTheDocument();
    expect(screen.getByText('CP: 12')).toBeInTheDocument();
  });

  it('改名保存で既存のcarriedPc/chaptersごとputCampaignを呼ぶ', async () => {
    vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([CP]);
    vi.spyOn(campaignClient, 'getCampaign').mockResolvedValue(CP);
    const putSpy = vi.spyOn(campaignClient, 'putCampaign').mockResolvedValue(CP);
    render(<CampaignTab worldId="w1" />);
    fireEvent.click(await screen.findByText('影の連鎖'));
    const input = await screen.findByDisplayValue('影の連鎖');
    fireEvent.change(input, { target: { value: '光の連鎖' } });
    fireEvent.click(screen.getByText('保存する'));
    await waitFor(() => expect(putSpy).toHaveBeenCalledWith('w1', 'cp1', {
      title: '光の連鎖',
      carriedPc: CP.carriedPc,
      chapters: CP.chapters,
    }));
  });

  it('削除は確認モーダルを経てdeleteCampaignを呼ぶ', async () => {
    vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([CP]);
    vi.spyOn(campaignClient, 'getCampaign').mockResolvedValue(CP);
    const delSpy = vi.spyOn(campaignClient, 'deleteCampaign').mockResolvedValue(undefined);
    render(<CampaignTab worldId="w1" />);
    fireEvent.click(await screen.findByText('影の連鎖'));
    fireEvent.click(await screen.findByText('削除'));
    fireEvent.click(screen.getByText('削除する')); // ConfirmModal
    await waitFor(() => expect(delSpy).toHaveBeenCalledWith('w1', 'cp1'));
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/screens/library/CampaignTab.test.jsx`
Expected: FAIL — モジュールなし

- [ ] **Step 3: 実装(CampaignTab)**

`src/screens/library/CampaignTab.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../../theme.js';
import Card from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Field from '../../components/ui/Field.jsx';
import ConfirmModal from '../../components/library/ConfirmModal.jsx';
import { listCampaigns, getCampaign, putCampaign, deleteCampaign } from '../../api/campaignClient.js';

function fmtDate(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString('ja-JP');
  } catch {
    return '';
  }
}

export default function CampaignTab({ worldId }) {
  const [campaigns, setCampaigns] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loaded, setLoaded] = useState(null); // 選択中campaignの全メタ
  const [editTitle, setEditTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function refresh() {
    if (!worldId) return;
    try {
      setError('');
      setCampaigns(await listCampaigns(worldId));
    } catch (e) {
      setError('一覧取得に失敗した: ' + e.message);
    }
  }

  useEffect(() => {
    setSelectedId(null);
    setLoaded(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    (async () => {
      try {
        const c = await getCampaign(worldId, selectedId);
        if (cancelled) return;
        setLoaded(c);
        setEditTitle(c.title);
      } catch (e) {
        if (!cancelled) setError('取得に失敗した: ' + e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function handleSave() {
    setBusy(true);
    setError('');
    try {
      await putCampaign(worldId, selectedId, {
        title: editTitle,
        carriedPc: loaded.carriedPc,
        chapters: loaded.chapters,
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
      await deleteCampaign(worldId, deleteTarget);
      if (selectedId === deleteTarget) {
        setSelectedId(null);
        setLoaded(null);
      }
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
      <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink, marginBottom: 16 }}>
        Campaign一覧
      </div>

      {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        {campaigns.map((c) => (
          <Card
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            style={{ cursor: 'pointer', borderColor: selectedId === c.id ? COLORS.brass : COLORS.line }}
          >
            <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{c.title}</div>
            <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, marginTop: 2 }}>
              全{(c.chapters || []).length}章 / 更新 {fmtDate(c.updatedAt)}
            </div>
          </Card>
        ))}
        {campaigns.length === 0 && (
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
            まだキャンペーンが無い。セッションを終えて「次の章へ」から作成される。
          </div>
        )}
      </div>

      {selectedId && loaded && (
        <Card>
          <Field label="タイトル">
            <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} style={inputStyle} />
          </Field>

          <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, margin: '12px 0 6px' }}>章</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            {(loaded.chapters || []).map((ch, i) => (
              <div key={ch.sessionId || i} style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
                第{i + 1}章: {ch.title}
                <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}> {fmtDate(ch.endedAt)}</span>
              </div>
            ))}
            {(loaded.chapters || []).length === 0 && (
              <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>章がまだない。</div>
            )}
          </div>

          <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginBottom: 6 }}>
            引き継ぎPC
          </div>
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginBottom: 6 }}>
            CP: {loaded.carriedPc?.xp ?? 0}
          </div>
          <pre
            style={{
              fontFamily: F_BODY,
              fontSize: 13,
              color: COLORS.inkSoft,
              whiteSpace: 'pre-wrap',
              background: COLORS.card,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 4,
              padding: '8px 10px',
              margin: '0 0 12px',
            }}
          >
            {loaded.carriedPc?.raw || '(PC情報なし)'}
          </pre>

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
        message={`キャンペーン「${loaded?.title ?? deleteTarget}」を削除する。よいか?`}
        confirmDisabled={busy}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
```

注意: carriedPc の xp ラベルはテストが `CP: 12` を期待する。`ScenarioTab` 同様、ラベルは固定文字列 `CP` を用いる(ここではキャンペーンの成長点を汎用的に `CP` 表記)。

- [ ] **Step 4: テスト確認**

Run: `npx vitest run src/screens/library/CampaignTab.test.jsx` → PASS

- [ ] **Step 5: 実装(Library結線)**

`src/screens/Library.jsx`:

1. import追加:

```jsx
import CampaignTab from './library/CampaignTab.jsx';
```

2. `TABS` に追加:

```jsx
const TABS = [
  { key: 'world', label: 'World' },
  { key: 'character', label: 'Character' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'ruleset', label: 'Ruleset' },
];
```

3. World選択ドロップダウンの表示条件を拡張:

```jsx
          {(tab === 'character' || tab === 'scenario' || tab === 'campaign') && (
```

4. `{tab === 'ruleset' && <RulesetTab />}` の直前に追加:

```jsx
          {tab === 'campaign' && <CampaignTab worldId={selectedWorldId} />}
```

- [ ] **Step 6: テスト確認 → Commit**

Run: `npx vitest run src/screens/library/CampaignTab.test.jsx src/screens/Library.test.jsx` → PASS
(注: `Library.test.jsx` が無ければ `CampaignTab.test.jsx` のみでよい)

```bash
git add src/screens/library/CampaignTab.jsx src/screens/library/CampaignTab.test.jsx src/screens/Library.jsx
git commit -m "feat(ui): Campaign管理タブ(一覧・章閲覧・改名・削除)を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Homeキャンペーングルーピング

**Files:**
- Modify: `src/screens/Home.jsx`
- Test: `src/screens/Home.test.jsx`(追記)

**Interfaces:**
- Consumes: `listCampaigns`(Task 3 と同ファイルの既存export)。
- Produces: なし(表示のみ)。

- [ ] **Step 1: 失敗するテストを追記**

`src/screens/Home.test.jsx` の `describe('Home', ...)` 内に追記(`campaignClient` は既にimport済み):

```jsx
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
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: 追記分FAIL(`影の連鎖` の見出しが出ない)

- [ ] **Step 3: 実装(Home)**

`src/screens/Home.jsx`:

1. import に `listCampaigns` を追加(既存の campaignClient import 行を差し替え):

```jsx
import { getCampaign, putCampaign, listCampaigns } from '../api/campaignClient.js';
```

2. state追加(`const [advancing, setAdvancing] = useState({});` の下):

```jsx
  const [campaignMap, setCampaignMap] = useState({}); // campaignId -> { title, chapterCount }
```

3. campaignタイトル解決の useEffect を追加(既存の publishedNovels useEffect の下):

```jsx
  useEffect(() => {
    const worldIds = [...new Set(sessions.filter((s) => s.campaignId && s.worldId).map((s) => s.worldId))];
    if (!user || worldIds.length === 0) {
      setCampaignMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      const map = {};
      await Promise.all(
        worldIds.map(async (wid) => {
          try {
            const list = await listCampaigns(wid);
            for (const c of list) {
              map[c.id] = { title: c.title, chapterCount: (c.chapters || []).length };
            }
          } catch {
            // 1つのWorldの取得に失敗しても他は表示する(該当campaignは非グループへフォールバック)
          }
        })
      );
      if (!cancelled) setCampaignMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessions, user]);
```

4. セッションカードのJSXを関数へ抽出。`return (` の直前に、カード本体(現在 `{sessions.map((s) => (` の中で返している `<Card ...>...</Card>`)をそのまま返す関数を定義:

```jsx
  function renderSessionCard(s) {
    return (
      <Card key={s.id} style={{ cursor: 'pointer' }} onClick={() => onContinue(s.id)}>
        {/* 既存のカード内部JSXをそのまま移設 */}
      </Card>
    );
  }
```

(既存 `{sessions.map((s) => ( <Card ...> ... </Card> ))}` の `<Card>` ブロックを丸ごとこの関数の return に移す。移設後、`key={s.id}` は関数側に残す。)

5. グルーピング計算を `return (` 直前に追加:

```jsx
  const grouped = [];
  const standalone = [];
  const groupsById = {};
  for (const s of sessions) {
    const meta = s.campaignId ? campaignMap[s.campaignId] : null;
    if (meta) {
      if (!groupsById[s.campaignId]) {
        groupsById[s.campaignId] = {
          campaignId: s.campaignId,
          title: meta.title,
          chapterCount: meta.chapterCount,
          items: [],
          latest: 0,
        };
        grouped.push(groupsById[s.campaignId]);
      }
      const g = groupsById[s.campaignId];
      g.items.push(s);
      g.latest = Math.max(g.latest, s.updatedAt || 0);
    } else {
      standalone.push(s);
    }
  }
  grouped.sort((a, b) => b.latest - a.latest);
  grouped.forEach((g) => g.items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
```

6. 描画部を差し替え。現在の `{sessions.length > 0 && ( <> <div>続きから再開</div> <div>{sessions.map(...)}</div> </> )}` を以下に置換:

```jsx
      {grouped.map((g) => (
        <div key={g.campaignId} style={{ marginBottom: 28 }}>
          <div
            style={{
              fontFamily: F_DISPLAY,
              fontSize: 14,
              color: COLORS.brassDark,
              marginBottom: 10,
              letterSpacing: 0.5,
            }}
          >
            {g.title}
            <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}> 全{g.chapterCount}章</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {g.items.map(renderSessionCard)}
          </div>
        </div>
      ))}

      {standalone.length > 0 && (
        <>
          <div
            style={{
              fontFamily: F_DISPLAY,
              fontSize: 13,
              color: COLORS.brassDark,
              marginBottom: 12,
              letterSpacing: 0.5,
            }}
          >
            続きから再開
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {standalone.map(renderSessionCard)}
          </div>
        </>
      )}
```

- [ ] **Step 4: テスト確認**

Run: `npx vitest run src/screens/Home.test.jsx` → PASS(既存含む)

- [ ] **Step 5: Commit**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "feat(ui): Homeセッションをキャンペーン単位でグルーピング

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: ドキュメント更新 + 全体テスト

**Files:**
- Modify: `docs/02-data-model.md`, `docs/05-ui-ux.md`, `docs/08-feature-ideas.md`

- [ ] **Step 1: docs更新**

- `docs/02-data-model.md` 3.5節(Campaign): SP2で管理タブ(一覧・章閲覧・改名・削除、DELETE `campaignMetaKey`)とHomeのキャンペーングルーピングを実装済み(2026-07-25)と追記。削除はcampaignメタのみでセッションは不変、dangling `campaignId` は非グループ表示にフォールバックする旨を1文で明記。
- `docs/05-ui-ux.md`:
  - 素材ライブラリ節: Campaignタブ(World選択下で一覧・選択→章閲覧・引き継ぎPC閲覧・改名・削除。新規作成はHomeからでありタブにはUIなし)を追記。
  - ホーム画面節: campaignId付きセッションはキャンペーンのタイトル見出し(全N章)配下にグループ表示、それ以外は「続きから再開」一覧に出る旨を追記。
- `docs/08-feature-ideas.md` 2章キャンペーン項: 「SP2(管理タブ+Homeグルーピング)実装済み(2026-07-25)。章からの再開・クロスWorld・構造化インベントリ・次章自動提案はSP3以降」を追記。

- [ ] **Step 2: 全体テスト**

Run: `npm test`
Expected: 全suite PASS

- [ ] **Step 3: Commit**

```bash
git add docs/02-data-model.md docs/05-ui-ux.md docs/08-feature-ideas.md
git commit -m "docs: キャンペーンSP2を実装済みとして反映

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
