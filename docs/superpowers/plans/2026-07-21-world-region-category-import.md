# 素材ライブラリ サブプロジェクト2: World region/category分割・インポートパイプライン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ユーザーが貼った長大な世界観テキストをAIがregion/categoryに自動分割・保存し、修正依頼による再分割もできるパイプラインを実装する。

**Architecture:** サーバー側に`worldContentLibrary.js`(region/category/原文のtextStoreのみのCRUD、dataStoreのメタなし)+ REST API(`server/routes/worldContent.js`)を追加。フロントエンド側に、既存の`callClaude`パターンを踏襲した`splitWorld`(AI分割呼び出し、単一JSON出力を`parseJsonLoose`でパース)と、それを土台にした`importWorld`/`reimportWorld`(分割結果をサーバーへ保存するオーケストレーション)を追加する。UIへの結線は別サブプロジェクト。

**Tech Stack:** Express 4, Vitest, `supertest`(既存の延長。新規依存追加なし)

## Global Constraints

- `"type": "module"`(ESM)。`require()`は使わない。
- region/category/原文(source)はtextStoreのみで管理する(dataStoreのメタ情報を持たない)。一覧は`textStore.list(prefix)`の結果からファイル名を取り出して返す。
- AIの分割結果は1回のレスポンスで`{world, regions:[{id,title,content}], categories:[{id,title,content}]}`というJSON構造として出力させ、既存の`parseJsonLoose`でパースする(`takeTurn`と同じ「単一JSON厳守」パターン)。
- AIが生成する`region`/`category`の`id`は、保存前に英数字・ハイフン以外を除去する簡易スラグ化を行う(有効な文字が残らない場合は`'untitled'`にフォールバック)。
- `splitWorld`(AI分割呼び出し)は`src/api/worldSplit.js`に、`importWorld`/`reimportWorld`(オーケストレーション)は`src/api/worldImport.js`に**別ファイルとして分離する**。理由: 同一ファイル内で定義された関数を`vi.spyOn`でモックしようとしても、ES Modulesの同一モジュール内呼び出しはモックを経由しないため機能しない(この問題は計画時に発見・検証済み)。別ファイルに分離すれば`import * as worldSplit from './worldSplit.js'`という他ファイルへの通常のインポートとして扱え、既存の`session.test.js`と同じパターンで正しくモックできる。
- `importWorld`/`reimportWorld`がサーバーへ保存する際は`src/api/worldLibraryClient.js`(新規、薄いfetchラッパー)経由で行う。直接`fetch`を呼ばない。
- 再分割(`reimportWorld`)時、前回分割で作られたが今回は生成されなかったregion/categoryの自動削除は行わない(既知の簡略化)。
- UIへの結線(Setup.jsx・素材ライブラリ画面からの呼び出し)は本プランのスコープ外。
- テストはVitest。サーバー側は`// @vitest-environment node`。フロントエンド側は`vi.stubGlobal('fetch', ...)`または`vi.spyOn(モジュール, '関数名')`でモックする(既存`session.test.js`/`client.test.js`のパターンを踏襲)。
- 各タスクの最後は該当ファイルのみをステージしてコミットする。

---

## Task 1: paths.js に worldSourceDocPath を追加

**Files:**
- Modify: `server/storage/paths.js`
- Modify: `server/storage/paths.test.js`

**Interfaces:**
- Produces: `worldSourceDocPath(worldId)` → `worlds/${worldId}/source.md`。Task 2が消費する。

- [ ] **Step 1: paths.test.jsの「builds world paths」テストを更新(失敗する状態)**

`describe('storage paths', ...)`内の`it('builds world paths', ...)`を以下に置き換える(importの追加も必要):

```js
import {
  sessionKey,
  worldMetaKey,
  worldDocPath,
  worldSourceDocPath,
  regionDocPath,
  categoryDocPath,
  characterDocPath,
  characterMetaKey,
  scenarioDocPath,
  scenarioMetaKey,
  campaignMetaKey,
  rulesetMetaKey,
} from './paths.js';
```

```js
  it('builds world paths', () => {
    expect(worldMetaKey('waterdeep')).toBe('worlds/waterdeep');
    expect(worldDocPath('waterdeep')).toBe('worlds/waterdeep/world.md');
    expect(worldSourceDocPath('waterdeep')).toBe('worlds/waterdeep/source.md');
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/storage/paths.test.js`
Expected: FAIL(`worldSourceDocPath`が存在しない)

- [ ] **Step 3: paths.jsに worldSourceDocPath を追加**

`worldDocPath`関数の直後に追加する:

```js
export function worldSourceDocPath(worldId) {
  return `worlds/${worldId}/source.md`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/storage/paths.test.js`
Expected: PASS(6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/storage/paths.js server/storage/paths.test.js
git commit -m "feat(server): add worldSourceDocPath for preserving raw world import text"
```

---

## Task 2: server/storage/worldContentLibrary.js(source/region/category CRUD)

**Files:**
- Create: `server/storage/worldContentLibrary.js`
- Create: `server/storage/worldContentLibrary.test.js`

**Interfaces:**
- Consumes: `worldSourceDocPath, regionDocPath, categoryDocPath`(`server/storage/paths.js`, Task 1・既存)
- Produces: `saveWorldSource(textStore, worldId, raw)` → `Promise<void>`。`getWorldSource(textStore, worldId)` → `Promise<string|null>`。`saveRegion(textStore, worldId, region, raw)` → `Promise<void>`。`getRegion(textStore, worldId, region)` → `Promise<string|null>`。`listRegions(textStore, worldId)` → `Promise<string[]>`。`deleteRegion(textStore, worldId, region)` → `Promise<void>`。`saveCategory`/`getCategory`/`listCategories`/`deleteCategory`も同形。Task 3(`routes/worldContent.js`)が消費する。dataStoreは一切使わない。

- [ ] **Step 1: worldContentLibrary.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsTextStore } from './textStore.js';
import {
  saveWorldSource,
  getWorldSource,
  saveRegion,
  getRegion,
  listRegions,
  deleteRegion,
  saveCategory,
  getCategory,
  listCategories,
  deleteCategory,
} from './worldContentLibrary.js';

let dir;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'world-content-library-test-'));
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('World source', () => {
  it('returns null for a missing source', async () => {
    expect(await getWorldSource(textStore, 'w1')).toBeNull();
  });

  it('saves and retrieves the source text', async () => {
    await saveWorldSource(textStore, 'w1', '長大な世界観の原文');
    expect(await getWorldSource(textStore, 'w1')).toBe('長大な世界観の原文');
  });

  it('overwrites the source on save', async () => {
    await saveWorldSource(textStore, 'w1', 'old');
    await saveWorldSource(textStore, 'w1', 'new');
    expect(await getWorldSource(textStore, 'w1')).toBe('new');
  });
});

describe('Region functions', () => {
  it('returns null for a missing region', async () => {
    expect(await getRegion(textStore, 'w1', 'missing')).toBeNull();
  });

  it('saves and retrieves a region', async () => {
    await saveRegion(textStore, 'w1', 'waterdeep', '地域の詳細');
    expect(await getRegion(textStore, 'w1', 'waterdeep')).toBe('地域の詳細');
  });

  it('lists region ids scoped to a world', async () => {
    await saveRegion(textStore, 'w1', 'waterdeep', 'a');
    await saveRegion(textStore, 'w1', 'baldurs-gate', 'b');
    await saveRegion(textStore, 'w2', 'other-world-region', 'c');
    const regions = await listRegions(textStore, 'w1');
    expect(regions.sort()).toEqual(['baldurs-gate', 'waterdeep']);
  });

  it('returns an empty list when a world has no regions', async () => {
    expect(await listRegions(textStore, 'w1')).toEqual([]);
  });

  it('deletes a region', async () => {
    await saveRegion(textStore, 'w1', 'waterdeep', 'a');
    await deleteRegion(textStore, 'w1', 'waterdeep');
    expect(await getRegion(textStore, 'w1', 'waterdeep')).toBeNull();
  });
});

describe('Category functions', () => {
  it('returns null for a missing category', async () => {
    expect(await getCategory(textStore, 'w1', 'missing')).toBeNull();
  });

  it('saves and retrieves a category', async () => {
    await saveCategory(textStore, 'w1', 'magic-system', 'カテゴリの詳細');
    expect(await getCategory(textStore, 'w1', 'magic-system')).toBe('カテゴリの詳細');
  });

  it('lists category ids scoped to a world', async () => {
    await saveCategory(textStore, 'w1', 'magic-system', 'a');
    await saveCategory(textStore, 'w1', 'history', 'b');
    const categories = await listCategories(textStore, 'w1');
    expect(categories.sort()).toEqual(['history', 'magic-system']);
  });

  it('deletes a category', async () => {
    await saveCategory(textStore, 'w1', 'magic-system', 'a');
    await deleteCategory(textStore, 'w1', 'magic-system');
    expect(await getCategory(textStore, 'w1', 'magic-system')).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/storage/worldContentLibrary.test.js`
Expected: FAIL(`worldContentLibrary.js`が存在しない)

- [ ] **Step 3: worldContentLibrary.jsを実装**

```js
import { worldSourceDocPath, regionDocPath, categoryDocPath } from './paths.js';

function slugFromPath(p) {
  return p.split('/').pop().replace(/\.md$/, '');
}

export async function saveWorldSource(textStore, worldId, raw) {
  await textStore.write(worldSourceDocPath(worldId), raw);
}

export async function getWorldSource(textStore, worldId) {
  return await textStore.read(worldSourceDocPath(worldId));
}

export async function saveRegion(textStore, worldId, region, raw) {
  await textStore.write(regionDocPath(worldId, region), raw);
}

export async function getRegion(textStore, worldId, region) {
  return await textStore.read(regionDocPath(worldId, region));
}

export async function listRegions(textStore, worldId) {
  const paths = await textStore.list(`worlds/${worldId}/regions`);
  return paths.map(slugFromPath);
}

export async function deleteRegion(textStore, worldId, region) {
  await textStore.delete(regionDocPath(worldId, region));
}

export async function saveCategory(textStore, worldId, category, raw) {
  await textStore.write(categoryDocPath(worldId, category), raw);
}

export async function getCategory(textStore, worldId, category) {
  return await textStore.read(categoryDocPath(worldId, category));
}

export async function listCategories(textStore, worldId) {
  const paths = await textStore.list(`worlds/${worldId}/categories`);
  return paths.map(slugFromPath);
}

export async function deleteCategory(textStore, worldId, category) {
  await textStore.delete(categoryDocPath(worldId, category));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/storage/worldContentLibrary.test.js`
Expected: PASS(12 tests)

- [ ] **Step 5: Commit**

```bash
git add server/storage/worldContentLibrary.js server/storage/worldContentLibrary.test.js
git commit -m "feat(server): add World source/region/category CRUD functions (textStore only)"
```

---

## Task 3: server/routes/worldContent.js + server/index.js配線

**Files:**
- Create: `server/routes/worldContent.js`
- Create: `server/routes/worldContent.test.js`
- Modify: `server/index.js`
- Modify: `server/index.test.js`

**Interfaces:**
- Consumes: `saveWorldSource, getWorldSource, saveRegion, getRegion, listRegions, deleteRegion, saveCategory, getCategory, listCategories, deleteCategory`(`server/storage/worldContentLibrary.js`, Task 2)
- Produces: `createWorldContentRouter({ textStore })` → Express `Router`(`GET/PUT /worlds/:worldId/source`、`GET /worlds/:worldId/regions`、`GET/PUT/DELETE /worlds/:worldId/regions/:region`、`GET /worlds/:worldId/categories`、`GET/PUT/DELETE /worlds/:worldId/categories/:category`)。dataStoreは受け取らない(textStoreのみ)。

- [ ] **Step 1: worldContent.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createWorldContentRouter } from './worldContent.js';
import { createFsTextStore } from '../storage/textStore.js';

let dir;
let app;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'world-content-route-test-'));
  const textStore = createFsTextStore(dir);
  app = express();
  app.use(express.json());
  app.use('/api', createWorldContentRouter({ textStore }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('world content routes: source', () => {
  it('returns 404 for a missing source', async () => {
    const res = await request(app).get('/api/worlds/w1/source');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves the source', async () => {
    await request(app).put('/api/worlds/w1/source').send({ raw: '原文テキスト' });
    const res = await request(app).get('/api/worlds/w1/source');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ raw: '原文テキスト' });
  });
});

describe('world content routes: regions', () => {
  it('returns 404 for a missing region', async () => {
    const res = await request(app).get('/api/worlds/w1/regions/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a region', async () => {
    await request(app).put('/api/worlds/w1/regions/waterdeep').send({ raw: '地域の詳細' });
    const res = await request(app).get('/api/worlds/w1/regions/waterdeep');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'waterdeep', raw: '地域の詳細' });
  });

  it('lists regions for a world', async () => {
    await request(app).put('/api/worlds/w1/regions/waterdeep').send({ raw: 'a' });
    await request(app).put('/api/worlds/w1/regions/baldurs-gate').send({ raw: 'b' });
    const res = await request(app).get('/api/worlds/w1/regions');
    expect(res.body.sort()).toEqual(['baldurs-gate', 'waterdeep']);
  });

  it('deletes a region', async () => {
    await request(app).put('/api/worlds/w1/regions/waterdeep').send({ raw: 'a' });
    const del = await request(app).delete('/api/worlds/w1/regions/waterdeep');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/worlds/w1/regions/waterdeep');
    expect(get.status).toBe(404);
  });
});

describe('world content routes: categories', () => {
  it('returns 404 for a missing category', async () => {
    const res = await request(app).get('/api/worlds/w1/categories/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a category', async () => {
    await request(app).put('/api/worlds/w1/categories/magic-system').send({ raw: 'カテゴリの詳細' });
    const res = await request(app).get('/api/worlds/w1/categories/magic-system');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'magic-system', raw: 'カテゴリの詳細' });
  });

  it('lists categories for a world', async () => {
    await request(app).put('/api/worlds/w1/categories/magic-system').send({ raw: 'a' });
    await request(app).put('/api/worlds/w1/categories/history').send({ raw: 'b' });
    const res = await request(app).get('/api/worlds/w1/categories');
    expect(res.body.sort()).toEqual(['history', 'magic-system']);
  });

  it('deletes a category', async () => {
    await request(app).put('/api/worlds/w1/categories/magic-system').send({ raw: 'a' });
    const del = await request(app).delete('/api/worlds/w1/categories/magic-system');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/worlds/w1/categories/magic-system');
    expect(get.status).toBe(404);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/routes/worldContent.test.js`
Expected: FAIL(`worldContent.js`が存在しない)

- [ ] **Step 3: worldContent.jsを実装**

全ハンドラを既存の`asyncHandler`(`server/routes/asyncHandler.js`、既存)でラップする(サブプロジェクト1の最終レビューで導入されたパターンに揃える)。

```js
import { Router } from 'express';
import {
  saveWorldSource,
  getWorldSource,
  saveRegion,
  getRegion,
  listRegions,
  deleteRegion,
  saveCategory,
  getCategory,
  listCategories,
  deleteCategory,
} from '../storage/worldContentLibrary.js';
import { asyncHandler } from './asyncHandler.js';

export function createWorldContentRouter({ textStore }) {
  const router = Router();

  router.get('/worlds/:worldId/source', asyncHandler(async (req, res) => {
    const raw = await getWorldSource(textStore, req.params.worldId);
    if (raw === null) {
      res.status(404).json({ error: 'source not found' });
      return;
    }
    res.json({ raw });
  }));

  router.put('/worlds/:worldId/source', asyncHandler(async (req, res) => {
    await saveWorldSource(textStore, req.params.worldId, req.body.raw);
    res.json({ raw: req.body.raw });
  }));

  router.get('/worlds/:worldId/regions', asyncHandler(async (req, res) => {
    res.json(await listRegions(textStore, req.params.worldId));
  }));

  router.get('/worlds/:worldId/regions/:region', asyncHandler(async (req, res) => {
    const raw = await getRegion(textStore, req.params.worldId, req.params.region);
    if (raw === null) {
      res.status(404).json({ error: 'region not found' });
      return;
    }
    res.json({ id: req.params.region, raw });
  }));

  router.put('/worlds/:worldId/regions/:region', asyncHandler(async (req, res) => {
    await saveRegion(textStore, req.params.worldId, req.params.region, req.body.raw);
    res.json({ id: req.params.region, raw: req.body.raw });
  }));

  router.delete('/worlds/:worldId/regions/:region', asyncHandler(async (req, res) => {
    await deleteRegion(textStore, req.params.worldId, req.params.region);
    res.status(204).end();
  }));

  router.get('/worlds/:worldId/categories', asyncHandler(async (req, res) => {
    res.json(await listCategories(textStore, req.params.worldId));
  }));

  router.get('/worlds/:worldId/categories/:category', asyncHandler(async (req, res) => {
    const raw = await getCategory(textStore, req.params.worldId, req.params.category);
    if (raw === null) {
      res.status(404).json({ error: 'category not found' });
      return;
    }
    res.json({ id: req.params.category, raw });
  }));

  router.put('/worlds/:worldId/categories/:category', asyncHandler(async (req, res) => {
    await saveCategory(textStore, req.params.worldId, req.params.category, req.body.raw);
    res.json({ id: req.params.category, raw: req.body.raw });
  }));

  router.delete('/worlds/:worldId/categories/:category', asyncHandler(async (req, res) => {
    await deleteCategory(textStore, req.params.worldId, req.params.category);
    res.status(204).end();
  }));

  return router;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/worldContent.test.js`
Expected: PASS(10 tests)

- [ ] **Step 5: server/index.jsにworldContentRouterをマウント**

`import`群に追加(`createScenariosRouter`のimportの直後):

```js
import { createWorldContentRouter } from './routes/worldContent.js';
```

`createScenariosRouter`のマウント行の直後、`createRulesetsRouter`のマウント行の前に追加:

```js
  app.use('/api', createWorldContentRouter({ textStore }));
```

- [ ] **Step 6: server/index.test.jsに疎通テストを追加**

`describe('createApp', ...)`ブロック内に追加する:

```js
  it('mounts the world content routes', async () => {
    const res = await request(app).get('/api/worlds/w1/regions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
```

- [ ] **Step 7: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 8: Commit**

```bash
git add server/routes/worldContent.js server/routes/worldContent.test.js server/index.js server/index.test.js
git commit -m "feat(server): add world source/region/category REST API"
```

---

## Task 4: src/api/worldLibraryClient.js(フロントエンドAPIクライアント)

**Files:**
- Create: `src/api/worldLibraryClient.js`
- Create: `src/api/worldLibraryClient.test.js`

**Interfaces:**
- Produces: `putWorld(id, { title, raw })`、`putWorldSource(id, raw)`、`getWorldSource(id)`、`putRegion(worldId, region, raw)`、`putCategory(worldId, category, raw)` — いずれも`Promise<object>`(サーバーのJSONレスポンスをそのまま返す)。Task 6(`src/api/worldImport.js`)が消費する。

- [ ] **Step 1: worldLibraryClient.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { putWorld, putWorldSource, getWorldSource, putRegion, putCategory } from './worldLibraryClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('putWorld', () => {
  it('PUTs to /api/worlds/:id with title and raw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'w1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await putWorld('w1', { title: 'A', raw: 'raw text' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ title: 'A', raw: 'raw text' }) })
    );
    expect(result).toEqual({ id: 'w1' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(putWorld('w1', { title: 'A', raw: 'x' })).rejects.toThrow('API error 500: boom');
  });
});

describe('putWorldSource / getWorldSource', () => {
  it('PUTs source text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ raw: 'x' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putWorldSource('w1', '原文');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/source',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ raw: '原文' }) })
    );
  });

  it('GETs source text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ raw: '原文' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getWorldSource('w1');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1/source', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual({ raw: '原文' });
  });
});

describe('putRegion / putCategory', () => {
  it('PUTs a region', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'waterdeep' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putRegion('w1', 'waterdeep', '地域詳細');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/regions/waterdeep',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ raw: '地域詳細' }) })
    );
  });

  it('PUTs a category', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'magic-system' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putCategory('w1', 'magic-system', 'カテゴリ詳細');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/categories/magic-system',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ raw: 'カテゴリ詳細' }) })
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/worldLibraryClient.test.js`
Expected: FAIL(`worldLibraryClient.js`が存在しない)

- [ ] **Step 3: worldLibraryClient.jsを実装**

```js
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function putWorld(id, { title, raw }) {
  return apiFetch(`/api/worlds/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, raw }),
  });
}

export async function putWorldSource(id, raw) {
  return apiFetch(`/api/worlds/${id}/source`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
}

export async function getWorldSource(id) {
  return apiFetch(`/api/worlds/${id}/source`, { method: 'GET' });
}

export async function putRegion(worldId, region, raw) {
  return apiFetch(`/api/worlds/${worldId}/regions/${region}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
}

export async function putCategory(worldId, category, raw) {
  return apiFetch(`/api/worlds/${worldId}/categories/${category}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/worldLibraryClient.test.js`
Expected: PASS(6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/worldLibraryClient.js src/api/worldLibraryClient.test.js
git commit -m "feat(frontend): add thin fetch client for world/source/region/category API"
```

---

## Task 5: src/api/worldSplit.js(AI分割呼び出し)

**Files:**
- Create: `src/api/worldSplit.js`
- Create: `src/api/worldSplit.test.js`

**Interfaces:**
- Consumes: `callClaude, extractText, parseJsonLoose`(`src/api/client.js`, 既存)
- Produces: `splitWorld(rawText, adjustmentRequest?)` → `Promise<{ world: string, regions: {id,title,content}[], categories: {id,title,content}[] }>`。Task 6(`src/api/worldImport.js`)が消費する。**重要**: `importWorld`/`reimportWorld`から正しくモックできるよう、この関数は`src/api/worldImport.js`とは別ファイルに置く(Global Constraints参照)。

- [ ] **Step 1: worldSplit.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { splitWorld } from './worldSplit.js';
import * as client from './client.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('splitWorld', () => {
  it('parses the split result from the model response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            world: '目次',
            regions: [{ id: 'waterdeep', title: 'ウォーターディープ', content: '詳細' }],
            categories: [{ id: 'magic-system', title: '魔法体系', content: '詳細' }],
          }),
        },
      ],
    });
    const result = await splitWorld('長い世界観テキスト');
    expect(result.world).toBe('目次');
    expect(result.regions).toEqual([{ id: 'waterdeep', title: 'ウォーターディープ', content: '詳細' }]);
    expect(result.categories).toEqual([{ id: 'magic-system', title: '魔法体系', content: '詳細' }]);
  });

  it('slugifies a region id containing spaces and punctuation', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            world: '目次',
            regions: [{ id: 'Water Deep!', title: 'A', content: 'x' }],
            categories: [],
          }),
        },
      ],
    });
    const result = await splitWorld('テキスト');
    expect(result.regions[0].id).toBe('waterdeep');
  });

  it('falls back to "untitled" when a category id has no ascii characters after slugifying', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            world: '目次',
            regions: [],
            categories: [{ id: '魔法体系', title: 'B', content: 'y' }],
          }),
        },
      ],
    });
    const result = await splitWorld('テキスト');
    expect(result.categories[0].id).toBe('untitled');
  });

  it('includes the adjustment request in the prompt when provided', async () => {
    const callClaudeMock = vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ world: 'x', regions: [], categories: [] }) }],
    });
    await splitWorld('原文', '海沿いの街を追加してほしい');
    const sentMessage = callClaudeMock.mock.calls[0][0].messages[0].content;
    expect(sentMessage).toContain('原文');
    expect(sentMessage).toContain('海沿いの街を追加してほしい');
  });

  it('defaults regions and categories to empty arrays when missing from the response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ world: 'x' }) }],
    });
    const result = await splitWorld('テキスト');
    expect(result.regions).toEqual([]);
    expect(result.categories).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/worldSplit.test.js`
Expected: FAIL(`worldSplit.js`が存在しない)

- [ ] **Step 3: worldSplit.jsを実装**

```js
import { callClaude, extractText, parseJsonLoose } from './client.js';

function slugify(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64) || 'untitled';
}

export async function splitWorld(rawText, adjustmentRequest) {
  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: `以下の世界観資料を、TRPGのGMが必要な範囲だけ参照できるよう地域(region)・カテゴリ(category)に分割せよ。

# 出力形式(厳守)
説明文やコードブロック記号を一切付けず、次のJSONのみを出力すること:
{"world": "目次+要約のMarkdown本文(600〜900字程度。各regionとcategoryの一行概要を含めること)", "regions": [{"id": "英数字とハイフンのみのスラグ", "title": "地域名", "content": "その地域の詳細本文"}], "categories": [{"id": "英数字とハイフンのみのスラグ", "title": "カテゴリ名", "content": "そのカテゴリの詳細本文(魔法体系・宗教・歴史・種族・組織など)"}]}

世界観の規模に応じて、region・categoryの数は自由に決めてよい(小規模な世界観なら1〜2個程度でもよい)。`,
    messages: [
      {
        role: 'user',
        content: adjustmentRequest ? `${rawText}\n\n# 再分割の修正依頼\n${adjustmentRequest}` : rawText,
      },
    ],
  });
  const text = extractText(data.content);
  const parsed = parseJsonLoose(text);
  return {
    world: parsed.world,
    regions: (parsed.regions || []).map((r) => ({ ...r, id: slugify(r.id) })),
    categories: (parsed.categories || []).map((c) => ({ ...c, id: slugify(c.id) })),
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/worldSplit.test.js`
Expected: PASS(5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/worldSplit.js src/api/worldSplit.test.js
git commit -m "feat(frontend): add AI-driven world region/category split (splitWorld)"
```

---

## Task 6: src/api/worldImport.js(importWorld / reimportWorld)

**Files:**
- Create: `src/api/worldImport.js`
- Create: `src/api/worldImport.test.js`

**Interfaces:**
- Consumes: `splitWorld`(`src/api/worldSplit.js`, Task 5)。`putWorld, putWorldSource, getWorldSource, putRegion, putCategory`(`src/api/worldLibraryClient.js`, Task 4)
- Produces: `importWorld(worldId, title, rawText)` → `Promise<{world, regions, categories}>`。`reimportWorld(worldId, title, adjustmentRequest)` → 同形。UIからの呼び出しは別サブプロジェクト(本タスクでは呼び出し元を作らない)。

- [ ] **Step 1: worldImport.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importWorld, reimportWorld } from './worldImport.js';
import * as worldSplit from './worldSplit.js';
import * as worldLibraryClient from './worldLibraryClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('importWorld', () => {
  it('splits the raw text, saves the source, and saves world/regions/categories', async () => {
    vi.spyOn(worldSplit, 'splitWorld').mockResolvedValue({
      world: '目次',
      regions: [{ id: 'waterdeep', title: 'A', content: '地域詳細' }],
      categories: [{ id: 'magic-system', title: 'B', content: 'カテゴリ詳細' }],
    });
    const putWorldSpy = vi.spyOn(worldLibraryClient, 'putWorld').mockResolvedValue({});
    const putSourceSpy = vi.spyOn(worldLibraryClient, 'putWorldSource').mockResolvedValue({});
    const putRegionSpy = vi.spyOn(worldLibraryClient, 'putRegion').mockResolvedValue({});
    const putCategorySpy = vi.spyOn(worldLibraryClient, 'putCategory').mockResolvedValue({});

    const result = await importWorld('w1', 'Waterdeep World', '長い原文');

    expect(putSourceSpy).toHaveBeenCalledWith('w1', '長い原文');
    expect(putWorldSpy).toHaveBeenCalledWith('w1', { title: 'Waterdeep World', raw: '目次' });
    expect(putRegionSpy).toHaveBeenCalledWith('w1', 'waterdeep', '地域詳細');
    expect(putCategorySpy).toHaveBeenCalledWith('w1', 'magic-system', 'カテゴリ詳細');
    expect(result.world).toBe('目次');
  });
});

describe('reimportWorld', () => {
  it('fetches the stored source, re-splits with the adjustment request, and re-saves', async () => {
    vi.spyOn(worldLibraryClient, 'getWorldSource').mockResolvedValue({ raw: '保存済み原文' });
    const splitSpy = vi.spyOn(worldSplit, 'splitWorld').mockResolvedValue({
      world: '更新後の目次',
      regions: [],
      categories: [],
    });
    const putWorldSpy = vi.spyOn(worldLibraryClient, 'putWorld').mockResolvedValue({});

    await reimportWorld('w1', 'Waterdeep World', '海沿いの街を追加して');

    expect(splitSpy).toHaveBeenCalledWith('保存済み原文', '海沿いの街を追加して');
    expect(putWorldSpy).toHaveBeenCalledWith('w1', { title: 'Waterdeep World', raw: '更新後の目次' });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/worldImport.test.js`
Expected: FAIL(`worldImport.js`が存在しない)

- [ ] **Step 3: worldImport.jsを実装**

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

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/worldImport.test.js`
Expected: PASS(2 tests)

- [ ] **Step 5: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS(Task1〜6で追加した全テストファイルを含む)

- [ ] **Step 6: ビルドを確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 7: Commit**

```bash
git add src/api/worldImport.js src/api/worldImport.test.js
git commit -m "feat(frontend): add importWorld/reimportWorld orchestration"
```

---

## Self-Review Notes

- **Spec coverage**: spec docのsource保存・region/category CRUD・分割パイプライン(splitWorld/importWorld/reimportWorld)全てにタスクが対応。
- **Placeholder scan**: 「TBD」等の記述なし。全ステップに実行可能なコード/コマンドを記載。
- **モック可能性の検証**: `splitWorld`と`importWorld`/`reimportWorld`を別ファイルに分離したのは、同一モジュール内の関数呼び出しは`vi.spyOn`でモックできない(ESMの静的束縛)という計画時の検証結果を反映したもの。Task 6のテストは`worldSplit.js`という別モジュールへの`vi.spyOn`を使っており、既存`session.test.js`と同じ実績あるパターン。
- **非スコープの遵守**: 選択的注入・UI結線・再分割時の不要ファイル削除は本プランのどのタスクにも含まれていない。
