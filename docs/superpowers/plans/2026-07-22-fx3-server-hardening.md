# 監査修正 FX3: サーバー堅牢化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サーバー側のパストラバーサル・deleteWorld孤児化・reimport残留・上流タイムアウト・novel鮮度/切り詰め・入力検証・エラーステータス・アトミック書き込みを修正する。

**Architecture:** 7タスク。パラメータ検証(Task 1)、deleteWorldカスケード(Task 2)、reimport prune(Task 3=クライアント)、上流タイムアウト(Task 4)、novel鮮度+切り詰め拒否+Home表示(Task 5)、入力検証+エラーステータス+プロキシ緩和(Task 6)、アトミック書き込み(Task 7)。

**Tech Stack:** Express 4 + Node ESM、Vitest + supertest。

## Global Constraints

- `"type": "module"`(ESM)。`require()`は使わない。
- テスト注入の`fetchImpl`は`options.signal`を無視するため、タイムアウト付与は既存テストに無影響。
- 既存テストは最終ファイル内容/レスポンス形状のみ検証する箇所が多い。novel GETの形状変更(`{text}`→`{text, stale}`)に伴い既存sessionsテストを更新する。
- パラメータ検証は`router.param`で宣言し、各ハンドラは変更しない。
- 各タスクの最後は該当ファイルのみをステージしてコミットする。

---

## Task 1: パラメータ検証(パストラバーサル対策)

**Files:**
- Create: `server/routes/validateId.js`, `server/routes/validateId.test.js`
- Modify: `server/routes/worlds.js`, `server/routes/characters.js`, `server/routes/scenarios.js`, `server/routes/rulesets.js`, `server/routes/worldContent.js`, `server/routes/sessions.js`
- Modify: `server/routes/worlds.test.js`(1件のトラバーサル拒否テスト追加。他ルートのテストは任意)

**Interfaces:** `HttpError`/`isValidId`/`idParamGuard`/`kindParamGuard`をexport。

- [ ] **Step 1: `server/routes/validateId.test.js`を書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isValidId, HttpError } from './validateId.js';

describe('isValidId', () => {
  it('accepts normal slug ids', () => {
    expect(isValidId('waterdeep')).toBe(true);
    expect(isValidId('a-b_1')).toBe(true);
  });
  it('rejects traversal and separators', () => {
    expect(isValidId('..')).toBe(false);
    expect(isValidId('../x')).toBe(false);
    expect(isValidId('a/b')).toBe(false);
    expect(isValidId('a\\b')).toBe(false);
    expect(isValidId('.hidden')).toBe(false);
  });
  it('rejects empty, non-string, control chars, and over-long', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(123)).toBe(false);
    expect(isValidId('a b')).toBe(false);
    expect(isValidId('a'.repeat(129))).toBe(false);
  });
});

describe('HttpError', () => {
  it('carries a status', () => {
    const e = new HttpError(400, 'bad');
    expect(e.status).toBe(400);
    expect(e.message).toBe('bad');
    expect(e instanceof Error).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/routes/validateId.test.js`
Expected: FAIL

- [ ] **Step 3: `server/routes/validateId.js`を実装**

```js
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function isValidId(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > 128) return false;
  if (value.includes('..')) return false;
  if (value.startsWith('.')) return false;
  // allowlist: 英数字とドット・アンダースコア・ハイフンのみ許可(スラッシュ・空白・制御文字・#等を拒否)。makeId/slugifyの出力とsess_...idはこの集合に収まる。
  if (!/^[A-Za-z0-9._-]+$/.test(value)) return false;
  return true;
}

export function idParamGuard(req, res, next, value) {
  if (!isValidId(value)) {
    res.status(400).json({ error: 'invalid path parameter' });
    return;
  }
  next();
}

export function kindParamGuard(req, res, next, value) {
  if (value !== 'pc' && value !== 'npc') {
    res.status(400).json({ error: 'invalid kind' });
    return;
  }
  next();
}
```

- [ ] **Step 4: 各ルーターで`router.param`を宣言**

各`createXxxRouter`の`const router = Router();`直後に、そのルーターが使うパラメータの`router.param`を追加する。importに`import { idParamGuard, kindParamGuard } from './validateId.js';`を追加。

- `worlds.js`(`:id`): `router.param('id', idParamGuard);`
- `worldContent.js`(`:worldId`, `:region`, `:category`): `router.param('worldId', idParamGuard); router.param('region', idParamGuard); router.param('category', idParamGuard);`
- `characters.js`(`:worldId`, `:kind`, `:name`): `router.param('worldId', idParamGuard); router.param('kind', kindParamGuard); router.param('name', idParamGuard);`
- `scenarios.js`(`:worldId`, `:id`): `router.param('worldId', idParamGuard); router.param('id', idParamGuard);`
- `rulesets.js`(`:id`): `router.param('id', idParamGuard);`
- `sessions.js`(`:id`): `router.param('id', idParamGuard);`

- [ ] **Step 5: `server/routes/worlds.test.js`にトラバーサル拒否テストを追記**

```js
  it('rejects a traversal id with 400', async () => {
    const res = await request(app).get('/api/worlds/..%2F..%2Fescape');
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 6: テスト確認 + 全体テスト**

Run: `npx vitest run server/routes/validateId.test.js server/routes/worlds.test.js && npx vitest run`
Expected: 全PASS

- [ ] **Step 7: Commit**

```bash
git add server/routes/validateId.js server/routes/validateId.test.js server/routes/worlds.js server/routes/characters.js server/routes/scenarios.js server/routes/rulesets.js server/routes/worldContent.js server/routes/sessions.js server/routes/worlds.test.js
git commit -m "fix(server): reject path-traversal params at every router via router.param guards"
```

---

## Task 2: deleteWorldのカスケード削除

**Files:**
- Modify: `server/storage/textStore.js`, `server/storage/textStore.test.js`
- Modify: `server/storage/worldLibrary.js`, `server/storage/worldLibrary.test.js`

**Interfaces:** `textStore.deleteDir(prefix)`追加。`deleteWorld`が子コンテンツも消す。

- [ ] **Step 1: `textStore.test.js`と`worldLibrary.test.js`にテスト追記(失敗する状態)**

`server/storage/textStore.test.js`に追記:
```js
  it('deleteDir removes an entire directory subtree', async () => {
    await store.write('worlds/w1/regions/a.md', 'A');
    await store.write('worlds/w1/categories/b.md', 'B');
    await store.deleteDir('worlds/w1');
    expect(await store.list('worlds/w1/regions')).toEqual([]);
    expect(await store.list('worlds/w1/categories')).toEqual([]);
  });

  it('deleteDir is a no-op for a missing directory', async () => {
    await expect(store.deleteDir('worlds/missing')).resolves.toBeUndefined();
  });
```
(注: `textStore.test.js`の既存の`store`変数名/生成方法に合わせること。異なれば整合させる。)

`server/storage/worldLibrary.test.js`に追記:
```js
  it('deleteWorld also removes region/category/scenario sub-content', async () => {
    await saveWorld(dataStore, textStore, { id: 'w1', title: 'W', raw: '本文' });
    await textStore.write('worlds/w1/regions/harbor.md', '港');
    await textStore.write('worlds/w1/categories/magic.md', '魔法');
    await deleteWorld(dataStore, textStore, 'w1');
    expect(await getWorld(dataStore, textStore, 'w1')).toBeNull();
    expect(await textStore.list('worlds/w1/regions')).toEqual([]);
    expect(await textStore.list('worlds/w1/categories')).toEqual([]);
  });
```
(注: `worldLibrary.test.js`が`dataStore`のみでなく`textStore`も生成しているか確認し、無ければ`createFsTextStore`を同じ`dir`で生成する。既存の`saveWorld`テストが`textStore`を使うため既にあるはず。)

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/storage/textStore.test.js server/storage/worldLibrary.test.js`
Expected: FAIL

- [ ] **Step 3: `textStore.js`に`deleteDir`を追加**

`return { ... }`内、`delete`の後に追加:
```js
    async deleteDir(prefix) {
      await fs.rm(fullPath(prefix), { recursive: true, force: true });
    },
```

- [ ] **Step 4: `worldLibrary.js`の`deleteWorld`を修正**

```js
export async function deleteWorld(dataStore, textStore, id) {
  await dataStore.delete(worldMetaKey(id));
  await textStore.deleteDir(`worlds/${id}`);
}
```
(`worldDocPath`単体deleteは`deleteDir`が包含するため不要。`worldDocPath`のimportが他で未使用なら削除。)

- [ ] **Step 5: テスト確認 + 全体テスト**

Run: `npx vitest run server/storage/textStore.test.js server/storage/worldLibrary.test.js && npx vitest run`
Expected: 全PASS

- [ ] **Step 6: Commit**

```bash
git add server/storage/textStore.js server/storage/textStore.test.js server/storage/worldLibrary.js server/storage/worldLibrary.test.js
git commit -m "fix(server): cascade-delete a world's region/category/scenario/character content"
```

---

## Task 3: reimport残留のprune(クライアント)

**Files:**
- Modify: `src/api/worldLibraryClient.js`, `src/api/worldLibraryClient.test.js`
- Modify: `src/api/worldImport.js`, `src/api/worldImport.test.js`

**Interfaces:** `deleteRegion(worldId, region)`/`deleteCategory(worldId, category)`をworldLibraryClientに追加。`reimportWorld`がprune。

- [ ] **Step 1: テスト追記(失敗する状態)**

`src/api/worldLibraryClient.test.js`に追記:
```js
describe('deleteRegion / deleteCategory', () => {
  it('DELETEs a region (encoded) and does not parse a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteRegion('w1', 'harbor')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1/regions/harbor', expect.objectContaining({ method: 'DELETE' }));
  });
  it('DELETEs a category', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await deleteCategory('w1', 'magic');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1/categories/magic', expect.objectContaining({ method: 'DELETE' }));
  });
});
```
(冒頭importに`deleteRegion, deleteCategory`を追加)

`src/api/worldImport.test.js`の`reimportWorld`テスト群に追記:
```js
  it('prunes regions/categories that are absent from the new split', async () => {
    vi.spyOn(worldLibraryClient, 'getWorldSource').mockResolvedValue({ raw: '原文' });
    vi.spyOn(worldSplit, 'splitWorld').mockResolvedValue({
      world: '目次',
      regions: [{ id: 'harbor', title: '港', content: 'x' }],
      categories: [],
    });
    vi.spyOn(worldLibraryClient, 'listRegions').mockResolvedValue(['harbor', 'old-region']);
    vi.spyOn(worldLibraryClient, 'listCategories').mockResolvedValue(['old-cat']);
    vi.spyOn(worldLibraryClient, 'putWorld').mockResolvedValue({});
    vi.spyOn(worldLibraryClient, 'putRegion').mockResolvedValue({});
    vi.spyOn(worldLibraryClient, 'putCategory').mockResolvedValue({});
    const delRegion = vi.spyOn(worldLibraryClient, 'deleteRegion').mockResolvedValue();
    const delCategory = vi.spyOn(worldLibraryClient, 'deleteCategory').mockResolvedValue();

    await reimportWorld('w1', 'W', undefined);

    expect(delRegion).toHaveBeenCalledWith('w1', 'old-region');
    expect(delRegion).not.toHaveBeenCalledWith('w1', 'harbor');
    expect(delCategory).toHaveBeenCalledWith('w1', 'old-cat');
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/api/worldLibraryClient.test.js src/api/worldImport.test.js`
Expected: FAIL

- [ ] **Step 3: `worldLibraryClient.js`に`deleteRegion`/`deleteCategory`を追加**

```js
export async function deleteRegion(worldId, region) {
  const res = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/regions/${encodeURIComponent(region)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}

export async function deleteCategory(worldId, category) {
  const res = await fetch(`/api/worlds/${encodeURIComponent(worldId)}/categories/${encodeURIComponent(category)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: `worldImport.js`の`reimportWorld`でprune**

現在の`worldImport.js`(参考):
```js
import { splitWorld } from './worldSplit.js';
import { putWorld, putWorldSource, getWorldSource, putRegion, putCategory } from './worldLibraryClient.js';

async function saveSplitResult(worldId, title, split) {
  await putWorld(worldId, { title, raw: split.world });
  await Promise.all(split.regions.map((r) => putRegion(worldId, r.id, r.content)));
  await Promise.all(split.categories.map((c) => putCategory(worldId, c.id, c.content)));
}

export async function importWorld(worldId, title, rawText) {
  const split = await splitWorld(rawText);
  await putWorldSource(worldId, rawText);
  await saveSplitResult(worldId, title, split);
  return split;
}

export async function reimportWorld(worldId, title, adjustmentRequest) {
  const source = await getWorldSource(worldId);
  const split = await splitWorld(source.raw, adjustmentRequest);
  await saveSplitResult(worldId, title, split);
  return split;
}
```

importに`listRegions, listCategories, deleteRegion, deleteCategory`を追加し、`reimportWorld`を次に置き換える:
```js
export async function reimportWorld(worldId, title, adjustmentRequest) {
  const source = await getWorldSource(worldId);
  const split = await splitWorld(source.raw, adjustmentRequest);

  const newRegionIds = new Set(split.regions.map((r) => r.id));
  const newCategoryIds = new Set(split.categories.map((c) => c.id));
  const [existingRegions, existingCategories] = await Promise.all([listRegions(worldId), listCategories(worldId)]);
  await Promise.all(existingRegions.filter((id) => !newRegionIds.has(id)).map((id) => deleteRegion(worldId, id)));
  await Promise.all(
    existingCategories.filter((id) => !newCategoryIds.has(id)).map((id) => deleteCategory(worldId, id))
  );

  await saveSplitResult(worldId, title, split);
  return split;
}
```

- [ ] **Step 5: テスト確認 + 全体テスト**

Run: `npx vitest run src/api/worldLibraryClient.test.js src/api/worldImport.test.js && npx vitest run`
Expected: 全PASS

- [ ] **Step 6: Commit**

```bash
git add src/api/worldLibraryClient.js src/api/worldLibraryClient.test.js src/api/worldImport.js src/api/worldImport.test.js
git commit -m "fix(frontend): prune removed regions/categories on world reimport"
```

---

## Task 4: 上流Anthropic呼び出しのタイムアウト

**Files:**
- Modify: `server/routes/messages.js`, `server/routes/messages.test.js`
- Modify: `server/routes/sessions.js`

**Interfaces:** 不変。`fetch`/`fetchImpl`呼び出しに`signal`追加。

- [ ] **Step 1: `messages.test.js`にタイムアウト時502のテストを追記(失敗する状態)**

```js
  it('returns 502 when the upstream fetch is aborted (timeout)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const app = express();
    app.use(express.json());
    app.use('/api', createMessagesRouter({ apiKey: 'k', fetchImpl }));
    const res = await request(app).post('/api/messages').send({ model: 'x', messages: [] });
    expect(res.status).toBe(502);
  });
```
(注: `messages.test.js`の既存のapp生成/import形に合わせること。既存が別方式なら整合させる。)

- [ ] **Step 2: 失敗を確認(既存の`messages.js`は上流fetch throwで502を返すはずだが、`AbortError`経路とsignal付与を確認するテスト。既に502ならこのテストはRED→GREENの確認用に、signal付与実装後も通ること)**

Run: `npx vitest run server/routes/messages.test.js`
Expected: 既存の`try/catch`で502になるなら緑。ならない場合はREDを確認。

- [ ] **Step 3: `messages.js`にタイムアウトsignalを追加**

`createMessagesRouter`冒頭に定数追加:
```js
const MESSAGES_TIMEOUT_MS = 120000;
```
`fetchImpl('https://api.anthropic.com/v1/messages', {...})`のoptionsに`signal: AbortSignal.timeout(MESSAGES_TIMEOUT_MS),`を追加する。既存の`try/catch`が`AbortError`も捕捉し502を返すことを確認する(現状`catch (e) { res.status(502)... }`)。

- [ ] **Step 4: `sessions.js`のnovelize上流呼び出しにタイムアウト + try/catch(502)を追加**

`NOVELIZE_TIMEOUT_MS = 120000`定数を追加(ファイル上部)。novelizeハンドラ内の`const upstream = await fetchImpl(...)`を`try/catch`で包み、`options`に`signal: AbortSignal.timeout(NOVELIZE_TIMEOUT_MS)`を追加し、catchで`res.status(502).json({ error: 'upstream request failed: ' + e.message }); return;`する。

- [ ] **Step 5: テスト確認 + 全体テスト**

Run: `npx vitest run server/routes/messages.test.js server/routes/sessions.test.js && npx vitest run`
Expected: 全PASS

- [ ] **Step 6: Commit**

```bash
git add server/routes/messages.js server/routes/messages.test.js server/routes/sessions.js
git commit -m "fix(server): add timeouts to upstream Anthropic calls, return 502 on abort"
```

---

## Task 5: novel鮮度検出 + 切り詰め/空拒否 + Home表示

**Files:**
- Modify: `server/storage/paths.js`
- Modify: `server/routes/sessions.js`, `server/routes/sessions.test.js`
- Modify: `src/api/sessionSyncClient.js`(getNovelの戻り形状は不変—`{text, stale}`を素通し), `src/screens/Home.jsx`, `src/screens/Home.test.jsx`

**Interfaces:** `paths.sessionNovelMetaKey`追加。`GET .../novel`が`{text, stale}`を返す。

- [ ] **Step 1: `sessions.test.js`を更新(失敗する状態)**

既存の「generates and stores a novelization ... retrievable via GET」テストのGETアサーションを`{ text: '小説化された本文。', stale: false }`に変更する。加えて追記:
```js
  it('marks the novel stale after the session advances past the novelized turn', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '小説' }], stop_reason: 'end_turn' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 3 } });
    await request(app).post('/api/sessions/s1/novelize');
    // セッションが進行(turn_count 3 → 5)
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 5 } });
    const res = await request(app).get('/api/sessions/s1/novel');
    expect(res.body.stale).toBe(true);
  });

  it('rejects a truncated (max_tokens) novelization without saving', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '途中' }], stop_reason: 'max_tokens' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(502);
    const get = await request(app).get('/api/sessions/s1/novel');
    expect(get.status).toBe(404); // 保存されていない
  });

  it('rejects an empty novelization without saving', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [], stop_reason: 'end_turn' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(502);
  });
```
(既存の「generates and stores」テストの`fetchImpl`が`stop_reason`を返していない場合、`stop_reason: 'end_turn'`を含めるよう更新する。含めないと新実装で切り詰め扱いにはならないが、`stop_reason`未定義は切り詰めではないため通る—実装で`=== 'max_tokens'`のみ拒否する。)

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/routes/sessions.test.js`
Expected: FAIL

- [ ] **Step 3: `paths.js`に`sessionNovelMetaKey`を追加**

`sessionNovelDocPath`の直後に:
```js
export function sessionNovelMetaKey(sessionId) {
  return `sessions/${sessionId}/novel`;
}
```

- [ ] **Step 4: `sessions.js`のnovelize/GETを修正**

importに`sessionNovelMetaKey`を追加。novelizeハンドラで、`const data = await upstream.json();`の後を次に置き換える:
```js
    const data = await upstream.json();
    if (data.stop_reason === 'max_tokens') {
      res.status(502).json({ error: 'novelization was truncated (max_tokens); not saved' });
      return;
    }
    const text = extractText(data.content);
    if (!text) {
      res.status(502).json({ error: 'novelization produced empty output; not saved' });
      return;
    }
    await textStore.write(sessionNovelDocPath(req.params.id), text);
    await dataStore.set(sessionNovelMetaKey(req.params.id), {
      turnCount: session.state?.turn_count ?? null,
      updatedAt: Date.now(),
    });
    res.json({ ok: true });
```

GETハンドラを次に置き換える:
```js
  router.get('/sessions/:id/novel', asyncHandler(async (req, res) => {
    const text = await textStore.read(sessionNovelDocPath(req.params.id));
    if (text === null) {
      res.status(404).json({ error: 'novel not found' });
      return;
    }
    const meta = await dataStore.get(sessionNovelMetaKey(req.params.id));
    const session = await dataStore.get(sessionKey(req.params.id));
    const currentTurn = session?.state?.turn_count ?? null;
    const stale = meta && meta.turnCount != null && currentTurn != null ? meta.turnCount !== currentTurn : false;
    res.json({ text, stale });
  }));
```

- [ ] **Step 5: `Home.jsx`でstale時に注意書きを表示**

`handleNovelize`の`const { text } = await getNovel(session.id);`を`const { text, stale } = await getNovel(session.id);`に変更し、ダウンロード後に:
```js
      if (stale) {
        setNovelizeError((prev) => ({
          ...prev,
          [session.id]: 'ダウンロードした小説は最新のログを反映していない可能性があります。',
        }));
      }
```
を追加する(エラー表示欄を流用。`novelizeError`は既にカード内に表示される)。

- [ ] **Step 6: `Home.test.jsx`のgetNovelモックを`{text, stale}`形状に更新**

既存のnovelize downloadテストの`vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({ text: '...' })`を`.mockResolvedValue({ text: '...', stale: false })`に更新する(全該当箇所)。

- [ ] **Step 7: テスト確認 + 全体テスト + ビルド**

Run: `npx vitest run server/routes/sessions.test.js src/screens/Home.test.jsx && npx vitest run && npm run build`
Expected: 全PASS + ビルド成功

- [ ] **Step 8: Commit**

```bash
git add server/storage/paths.js server/routes/sessions.js server/routes/sessions.test.js src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "fix(server): track novel freshness, reject truncated/empty novelizations, surface stale in UI"
```

---

## Task 6: 入力検証 + エラーステータス尊重 + プロキシ緩和

**Files:**
- Modify: `server/index.js`, `server/index.test.js`
- Modify: `server/routes/worlds.js`, `server/routes/worldContent.js`, `server/routes/characters.js`, `server/routes/scenarios.js`, `server/routes/rulesets.js`, `server/routes/sessions.js`, `server/routes/messages.js`
- Modify: 関連テスト(`server/routes/worlds.test.js`, `server/routes/sessions.test.js`, `server/routes/messages.test.js`)

**Interfaces:** グローバルエラーハンドラが`err.status`を尊重。

- [ ] **Step 1: テスト追記(失敗する状態)**

`server/routes/worlds.test.js`に追記:
```js
  it('returns 400 when raw is missing on PUT', async () => {
    const res = await request(app).put('/api/worlds/w1').send({ title: 'T' });
    expect(res.status).toBe(400);
  });
```
`server/routes/sessions.test.js`に追記:
```js
  it('returns 400 when the session body is not an object', async () => {
    const res = await request(app).put('/api/sessions/s1').set('Content-Type', 'application/json').send('"a string"');
    expect(res.status).toBe(400);
  });
```
`server/routes/messages.test.js`に追記:
```js
  it('returns 400 when messages is not an array', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createMessagesRouter({ apiKey: 'k', fetchImpl: vi.fn() }));
    const res = await request(app).post('/api/messages').send({ model: 'x' });
    expect(res.status).toBe(400);
  });
```
(各テストファイルの既存app生成に合わせること。`worlds.test.js`はグローバルエラーミドルウェアを持たない可能性がある—その場合、後述のグローバルハンドラは`server/index.test.js`側で検証し、個別ルートテストでは`HttpError`が`asyncHandler`→ルーター単体では500になる。**そのため、個別ルーターにもエラーハンドリングを効かせるには、検証を`res.status(400)`直接返却方式にする方が確実**。下記Step 3で「直接400を返す」方式を採る。)

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/routes/worlds.test.js server/routes/sessions.test.js server/routes/messages.test.js`
Expected: FAIL

- [ ] **Step 3: 各PUTハンドラで必須フィールドを直接400検証する**

`HttpError`+グローバルハンドラ方式は個別ルーターテスト(グローバルミドルウェア無し)で400にならないため、**各ハンドラ内で直接`res.status(400)`を返す**方式にする。例(`worlds.js`のPUT):
```js
  router.put('/worlds/:id', asyncHandler(async (req, res) => {
    if (typeof req.body.raw !== 'string' || typeof req.body.title !== 'string') {
      res.status(400).json({ error: 'title and raw are required' });
      return;
    }
    const world = await saveWorld(dataStore, textStore, { id: req.params.id, title: req.body.title, raw: req.body.raw });
    res.json(world);
  }));
```
同様に:
- `worldContent.js`のsource/region/category PUT: `typeof req.body.raw !== 'string'`なら400。
- `characters.js`のPUT: `typeof req.body.raw !== 'string'`なら400。
- `scenarios.js`のPUT: `typeof req.body.raw !== 'string' || typeof req.body.title !== 'string'`なら400。
- `rulesets.js`のPUT: `typeof req.body.label !== 'string'`なら400。
- `sessions.js`のPUT: `req.body`がプレーンオブジェクト(非null・非配列・typeof object)でなければ400。
```js
  router.put('/sessions/:id', asyncHandler(async (req, res) => {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      res.status(400).json({ error: 'session body must be an object' });
      return;
    }
    const session = { ...req.body, id: req.params.id };
    await dataStore.set(sessionKey(req.params.id), session);
    res.json(session);
  }));
```
- `messages.js`のPOST: `apiKey`チェックの後、`if (!Array.isArray(req.body?.messages)) { res.status(400).json({ error: 'messages must be an array' }); return; }`を追加。加えて`max_tokens`の上限クランプ(比例的緩和): 送信body構築時に`max_tokens: Math.min(Number(req.body.max_tokens) || 1024, 16000)`のように上限を設ける…が、`messages.js`はbody全体を素通しするため、**bodyを改変せず`max_tokens`のみ上限を超える場合に400で拒否する**方が単純: `if (Number(req.body.max_tokens) > 16000) { res.status(400).json({ error: 'max_tokens too large' }); return; }`。

- [ ] **Step 4: `index.js`のグローバルエラーハンドラが`err.status`を尊重するよう変更**

```js
  app.use((err, req, res, next) => {
    console.error(err);
    const status = typeof err.status === 'number' ? err.status : typeof err.statusCode === 'number' ? err.statusCode : 500;
    res.status(status).json({ error: err.message || 'internal server error' });
  });
```

`server/index.test.js`に追記:
```js
  it('preserves a thrown error status via the global handler', async () => {
    // 既知の400経路(不正なsession body)を通し、500ではなく400が返ることを確認
    const res = await request(app).put('/api/sessions/s1').set('Content-Type', 'application/json').send('"x"');
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 5: テスト確認 + 全体テスト**

Run: `npx vitest run server/ && npx vitest run`
Expected: 全PASS

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/index.test.js server/routes/worlds.js server/routes/worldContent.js server/routes/characters.js server/routes/scenarios.js server/routes/rulesets.js server/routes/sessions.js server/routes/messages.js server/routes/worlds.test.js server/routes/sessions.test.js server/routes/messages.test.js
git commit -m "fix(server): validate request bodies (400), respect thrown error status, cap proxy max_tokens"
```

---

## Task 7: アトミック書き込み

**Files:**
- Modify: `server/storage/dataStore.js`, `server/storage/dataStore.test.js`
- Modify: `server/storage/textStore.js`, `server/storage/textStore.test.js`

**Interfaces:** 不変。書き込みが一時ファイル+rename。

- [ ] **Step 1: テスト追記(失敗する状態にはならないが、上書きの整合性を固定)**

`server/storage/dataStore.test.js`に追記:
```js
  it('overwrites cleanly and leaves no .tmp files', async () => {
    await store.set('a/b', { v: 1 });
    await store.set('a/b', { v: 2 });
    expect(await store.get('a/b')).toEqual({ v: 2 });
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const files = await fs.readdir(path.join(dir, 'a'));
    expect(files.some((f) => f.includes('.tmp'))).toBe(false);
  });
```
(`store`/`dir`変数名は既存に合わせる)

- [ ] **Step 2: `dataStore.js`の`set`を一時ファイル+renameに変更**

ファイル上部にモジュールレベルのカウンタを追加:
```js
let tmpCounter = 0;
```
`set`を次に置き換える:
```js
    async set(key, value) {
      const file = fullPath(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${tmpCounter++}`;
      await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf-8');
      await fs.rename(tmp, file);
    },
```
`list`は`.json`のみ拾うため`.tmp-*`は無視される(既存フィルタで安全)。

- [ ] **Step 3: `textStore.js`の`write`を一時ファイル+renameに変更**

同様に`let tmpCounter = 0;`を追加し、`write`を:
```js
    async write(p, content) {
      const file = fullPath(p);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${tmpCounter++}`;
      await fs.writeFile(tmp, content, 'utf-8');
      await fs.rename(tmp, file);
    },
```
`textStore.list`は`.md`拾いではなく全ファイルを`${prefix}/${f}`で返す実装のため、`.tmp-*`が混入しうる。**`list`が`.tmp-`を含むファイルを除外するよう修正する**:
```js
    async list(prefix) {
      const dir = fullPath(prefix);
      try {
        return (await fs.readdir(dir)).filter((f) => !f.includes('.tmp-')).map((f) => `${prefix}/${f}`);
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },
```
(rename直後は.tmpは残らないが、書き込み中の並行listでの混入を防ぐ防御。)

- [ ] **Step 4: テスト確認 + 全体テスト**

Run: `npx vitest run server/storage/ && npx vitest run`
Expected: 全PASS

- [ ] **Step 5: Commit**

```bash
git add server/storage/dataStore.js server/storage/dataStore.test.js server/storage/textStore.js server/storage/textStore.test.js
git commit -m "fix(server): write via temp file + atomic rename to avoid partial writes"
```

---

## Self-Review Notes

- **Spec coverage**: §3.1(検証)→Task 1、§3.2(cascade)→Task 2、§3.3(prune)→Task 3、§3.4(timeout)→Task 4、§3.5(novel鮮度/切り詰め)+§3.8(Home)→Task 5、§3.6(検証/エラー/プロキシ)→Task 6、§3.7(atomic)→Task 7。
- **Placeholder scan**: なし。
- **設計判断の実装反映**: 個別ルーターテストがグローバルミドルウェアを持たない実情から、必須フィールド検証は「各ハンドラで直接400を返す」方式に統一(spec 3.6のHttpError案より確実)。グローバルハンドラのステータス尊重(M4)は別途`sessions`の非オブジェクトbody経路で検証。
- **後方互換**: novel GETの`{text, stale}`化に伴い既存テスト/クライアントを更新。`fetchImpl`はsignalを無視するためtimeoutは無影響。
- **非スコープ遵守**: プロキシ認証本体は実装せず`max_tokens`上限のみ。ドキュメント/追加インテグレーションテストは扱わない。
