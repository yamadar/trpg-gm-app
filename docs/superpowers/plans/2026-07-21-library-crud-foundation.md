# 素材ライブラリ サブプロジェクト1: サーバー側CRUD基盤 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** World / Character(PC・NPC) / Scenario / Ruleset の4エンティティに対するサーバー側CRUD API(REST)を実装し、素材ライブラリ機能(フロントエンドUIは別サブプロジェクト)の土台を作る。

**Architecture:** 既存の`dataStore`(JSON)/`textStore`(生テキスト)抽象化の上に、エンティティ単位の薄いドメイン関数層(`server/storage/{world,character,scenario,ruleset}Library.js`)を追加し、その上にExpressルート(`server/routes/{worlds,characters,scenarios,rulesets}.js`)を被せる。既存の`server/storage/paths.js`の一部キー(`worldMetaKey`・`scenarioMetaKey`)は一覧取得(`dataStore.list`)が正しく機能するようフラットな形に修正する。

**Tech Stack:** Express 4, Vitest, `supertest`(既存プロジェクトの延長。新規依存追加なし)

## Global Constraints

- `"type": "module"`(ESM)。`require()`は使わない。
- 対象エンティティはWorld・Character(PC/NPC)・Scenario・Rulesetの4種。**Campaignは対象外**。
- World/Character/Scenarioは「生テキスト(textStore)」+「軽量メタ情報(dataStore)」の組で保存する。RulesetはdataStoreのみ(textStoreは使わない)。
- メタ情報はAIによる自由記述→構造化変換パイプライン(parsed.json)ではなく、UIが必要とする最小限のフィールドのみを持つレコードとして扱う。
- `id`(worldId/scenarioId/rulesetId)はクライアント側で生成して渡す想定。`name`(Character)はユーザー入力のキャラクター名をそのままキーにする。入力値のサニタイズ・バリデーション強化は本プランのスコープ外。
- NPCの`revealed`はブール値。PCの場合は`null`固定(保存時に強制する)。
- フロントエンドからのAPI呼び出し・UI、World region/category分割、Rulesetの判定アダプタは本プランのスコープ外(別サブプロジェクト)。
- GET(単体)は`{ ...meta, raw }`を1レスポンスで返す。存在しないIDへのGET/DELETEは`404`。PUTは新規/更新を区別しない(既存の`sessions`ルートのパターンに合わせる)。DELETE成功時は`204`。
- テストはVitest。サーバー側は`// @vitest-environment node`docblockを使う。ルートのテストは`supertest` + 実際の`createFsDataStore`/`createFsTextStore`を一時ディレクトリに対して使う(既存`sessions.test.js`のパターンを踏襲)。
- 各タスクの最後は該当ファイルのみをステージしてコミットする。

---

## Task 1: ストレージ層の基盤調整(paths.js フラット化 + textStore.delete追加)

**Files:**
- Modify: `server/storage/paths.js`
- Modify: `server/storage/paths.test.js`
- Modify: `server/storage/textStore.js`
- Modify: `server/storage/textStore.test.js`

**Interfaces:**
- Produces: `worldMetaKey(worldId)` → `worlds/${worldId}`(変更前は`worlds/${worldId}/world`)。`scenarioMetaKey(worldId, scenarioId)` → `worlds/${worldId}/scenarios/${scenarioId}`(変更前は`.../scenario.parsed`)。`createFsTextStore(rootDir)`が返すオブジェクトに`delete(path)`が追加される。
- Consumes: なし。

**背景**: `dataStore.list(prefix)`は指定prefix直下の`.json`ファイルのみを列挙する(1階層ネストしたファイルは拾えない)。`worldMetaKey`・`scenarioMetaKey`は現状1階層余分にネストしており、`dataStore.list('worlds')`・`dataStore.list('worlds/{id}/scenarios')`で一覧化できない。両方ともフラットな配置に変更する。`characterMetaKey`は元々フラットなので変更不要。

- [ ] **Step 1: server/storage/paths.test.jsを更新(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  sessionKey,
  worldMetaKey,
  worldDocPath,
  regionDocPath,
  categoryDocPath,
  characterDocPath,
  characterMetaKey,
  scenarioDocPath,
  scenarioMetaKey,
  campaignMetaKey,
  rulesetMetaKey,
} from './paths.js';

describe('storage paths', () => {
  it('builds a session key', () => {
    expect(sessionKey('s1')).toBe('sessions/s1');
  });

  it('builds world paths', () => {
    expect(worldMetaKey('waterdeep')).toBe('worlds/waterdeep');
    expect(worldDocPath('waterdeep')).toBe('worlds/waterdeep/world.md');
  });

  it('builds region and category paths', () => {
    expect(regionDocPath('waterdeep', 'dock-ward')).toBe('worlds/waterdeep/regions/dock-ward.md');
    expect(categoryDocPath('waterdeep', 'magic-system')).toBe('worlds/waterdeep/categories/magic-system.md');
  });

  it('builds character paths for pc and npc', () => {
    expect(characterDocPath('waterdeep', 'pc', 'alice')).toBe('worlds/waterdeep/pc/alice.md');
    expect(characterDocPath('waterdeep', 'npc', 'villain')).toBe('worlds/waterdeep/npc/villain.md');
    expect(characterMetaKey('waterdeep', 'pc', 'alice')).toBe('worlds/waterdeep/pc/alice.parsed');
  });

  it('builds scenario and campaign paths', () => {
    expect(scenarioDocPath('waterdeep', 'sc1')).toBe('worlds/waterdeep/scenarios/sc1/scenario.md');
    expect(scenarioMetaKey('waterdeep', 'sc1')).toBe('worlds/waterdeep/scenarios/sc1');
    expect(campaignMetaKey('waterdeep', 'cp1')).toBe('worlds/waterdeep/campaigns/cp1/campaign');
  });

  it('builds a ruleset key', () => {
    expect(rulesetMetaKey('coc7e')).toBe('rulesets/coc7e');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/storage/paths.test.js`
Expected: FAIL(`worldMetaKey('waterdeep')`が現行の`'worlds/waterdeep/world'`を返すため、`'worlds/waterdeep'`との比較で失敗。`scenarioMetaKey`も同様に失敗)

- [ ] **Step 3: server/storage/paths.jsを更新**

```js
export function sessionKey(sessionId) {
  return `sessions/${sessionId}`;
}

export function worldMetaKey(worldId) {
  return `worlds/${worldId}`;
}

export function worldDocPath(worldId) {
  return `worlds/${worldId}/world.md`;
}

export function regionDocPath(worldId, region) {
  return `worlds/${worldId}/regions/${region}.md`;
}

export function categoryDocPath(worldId, category) {
  return `worlds/${worldId}/categories/${category}.md`;
}

export function characterDocPath(worldId, kind, name) {
  return `worlds/${worldId}/${kind}/${name}.md`;
}

export function characterMetaKey(worldId, kind, name) {
  return `worlds/${worldId}/${kind}/${name}.parsed`;
}

export function scenarioDocPath(worldId, scenarioId) {
  return `worlds/${worldId}/scenarios/${scenarioId}/scenario.md`;
}

export function scenarioMetaKey(worldId, scenarioId) {
  return `worlds/${worldId}/scenarios/${scenarioId}`;
}

export function campaignMetaKey(worldId, campaignId) {
  return `worlds/${worldId}/campaigns/${campaignId}/campaign`;
}

export function rulesetMetaKey(rulesetId) {
  return `rulesets/${rulesetId}`;
}
```

- [ ] **Step 4: paths.test.jsが通ることを確認**

Run: `npx vitest run server/storage/paths.test.js`
Expected: PASS(6 tests)

- [ ] **Step 5: textStore.test.jsに削除系のテストを追加(失敗する状態)**

`describe('createFsTextStore', ...)`ブロック内、既存テストの末尾に追加する:

```js
  it('deletes a file', async () => {
    await store.write('worlds/x/world.md', 'content');
    await store.delete('worlds/x/world.md');
    expect(await store.read('worlds/x/world.md')).toBeNull();
  });

  it('does not throw when deleting a missing file', async () => {
    await expect(store.delete('worlds/missing.md')).resolves.not.toThrow();
  });
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npx vitest run server/storage/textStore.test.js`
Expected: FAIL(`store.delete`が存在しない)

- [ ] **Step 7: server/storage/textStore.jsに delete を追加**

```js
import fs from 'node:fs/promises';
import path from 'node:path';

export function createFsTextStore(rootDir) {
  function fullPath(p) {
    return path.join(rootDir, p);
  }

  return {
    async read(p) {
      try {
        return await fs.readFile(fullPath(p), 'utf-8');
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async write(p, content) {
      const file = fullPath(p);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content, 'utf-8');
    },
    async list(prefix) {
      const dir = fullPath(prefix);
      try {
        return (await fs.readdir(dir)).map((f) => `${prefix}/${f}`);
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },
    async delete(p) {
      try {
        await fs.unlink(fullPath(p));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    },
  };
}
```

- [ ] **Step 8: textStore.test.jsが通ることを確認**

Run: `npx vitest run server/storage/textStore.test.js`
Expected: PASS(6 tests)

- [ ] **Step 9: 全体テストを実行し既存テストの回帰がないことを確認**

Run: `npx vitest run`
Expected: 全テストPASS(既存87テストのうち、paths.js/textStore.jsを利用する箇所に回帰がないこと。`worldMetaKey`/`scenarioMetaKey`はこの時点でまだどこからも呼ばれていないため、他ファイルへの影響はない)

- [ ] **Step 10: Commit**

```bash
git add server/storage/paths.js server/storage/paths.test.js server/storage/textStore.js server/storage/textStore.test.js
git commit -m "fix(server): flatten worldMetaKey/scenarioMetaKey for listability; add textStore.delete"
```

---

## Task 2: server/storage/worldLibrary.js(World CRUD関数)

**Files:**
- Create: `server/storage/worldLibrary.js`
- Create: `server/storage/worldLibrary.test.js`

**Interfaces:**
- Consumes: `worldMetaKey, worldDocPath`(`server/storage/paths.js`, Task 1)。`dataStore`/`textStore`インスタンス(呼び出し側が渡す、`createFsDataStore`/`createFsTextStore`)
- Produces: `saveWorld(dataStore, textStore, { id, title, raw })` → `Promise<{ id, title, updatedAt, raw }>`。`getWorld(dataStore, textStore, id)` → `Promise<{ id, title, updatedAt, raw } | null>`。`listWorlds(dataStore)` → `Promise<{ id, title, updatedAt }[]>`(rawを含まない)。`deleteWorld(dataStore, textStore, id)` → `Promise<void>`。Task 3(`routes/worlds.js`)が消費する。

- [ ] **Step 1: worldLibrary.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsTextStore } from './textStore.js';
import { saveWorld, getWorld, listWorlds, deleteWorld } from './worldLibrary.js';

let dir;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'world-library-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('World library functions', () => {
  it('returns null for a missing world', async () => {
    expect(await getWorld(dataStore, textStore, 'missing')).toBeNull();
  });

  it('saves and retrieves a world with its raw text', async () => {
    await saveWorld(dataStore, textStore, { id: 'w1', title: 'Waterdeep', raw: '# 世界観' });
    const world = await getWorld(dataStore, textStore, 'w1');
    expect(world).toMatchObject({ id: 'w1', title: 'Waterdeep', raw: '# 世界観' });
    expect(typeof world.updatedAt).toBe('number');
  });

  it('lists saved worlds without their raw text', async () => {
    await saveWorld(dataStore, textStore, { id: 'w1', title: 'A', raw: 'raw-a' });
    await saveWorld(dataStore, textStore, { id: 'w2', title: 'B', raw: 'raw-b' });
    const worlds = await listWorlds(dataStore);
    expect(worlds.map((w) => w.id).sort()).toEqual(['w1', 'w2']);
    expect(worlds[0].raw).toBeUndefined();
  });

  it('returns an empty list when there are no worlds', async () => {
    expect(await listWorlds(dataStore)).toEqual([]);
  });

  it('deletes a world and its raw text', async () => {
    await saveWorld(dataStore, textStore, { id: 'w1', title: 'A', raw: 'raw-a' });
    await deleteWorld(dataStore, textStore, 'w1');
    expect(await getWorld(dataStore, textStore, 'w1')).toBeNull();
  });

  it('overwrites an existing world on save (no create/update distinction)', async () => {
    await saveWorld(dataStore, textStore, { id: 'w1', title: 'Old', raw: 'old' });
    await saveWorld(dataStore, textStore, { id: 'w1', title: 'New', raw: 'new' });
    const world = await getWorld(dataStore, textStore, 'w1');
    expect(world).toMatchObject({ title: 'New', raw: 'new' });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/storage/worldLibrary.test.js`
Expected: FAIL(`worldLibrary.js`が存在しない)

- [ ] **Step 3: worldLibrary.jsを実装**

```js
import { worldMetaKey, worldDocPath } from './paths.js';

export async function saveWorld(dataStore, textStore, { id, title, raw }) {
  await textStore.write(worldDocPath(id), raw);
  const meta = { id, title, updatedAt: Date.now() };
  await dataStore.set(worldMetaKey(id), meta);
  return { ...meta, raw };
}

export async function getWorld(dataStore, textStore, id) {
  const meta = await dataStore.get(worldMetaKey(id));
  if (!meta) return null;
  const raw = (await textStore.read(worldDocPath(id))) ?? '';
  return { ...meta, raw };
}

export async function listWorlds(dataStore) {
  const keys = await dataStore.list('worlds');
  const worlds = await Promise.all(keys.map((k) => dataStore.get(k)));
  return worlds.filter(Boolean);
}

export async function deleteWorld(dataStore, textStore, id) {
  await dataStore.delete(worldMetaKey(id));
  await textStore.delete(worldDocPath(id));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/storage/worldLibrary.test.js`
Expected: PASS(6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/storage/worldLibrary.js server/storage/worldLibrary.test.js
git commit -m "feat(server): add World library CRUD functions"
```

---

## Task 3: server/routes/worlds.js + server/index.js配線

**Files:**
- Create: `server/routes/worlds.js`
- Create: `server/routes/worlds.test.js`
- Modify: `server/index.js`
- Modify: `server/index.test.js`

**Interfaces:**
- Consumes: `saveWorld, getWorld, listWorlds, deleteWorld`(`server/storage/worldLibrary.js`, Task 2)
- Produces: `createWorldsRouter({ dataStore, textStore })` → Express `Router`(`GET /worlds`, `GET /worlds/:id`, `PUT /worlds/:id`, `DELETE /worlds/:id`)。`server/index.js`の`createApp`が`textStore`を作成・`app.locals`に保持し、`createWorldsRouter`をマウントするようになる。

- [ ] **Step 1: worlds.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createWorldsRouter } from './worlds.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';

let dir;
let app;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'worlds-route-test-'));
  const dataStore = createFsDataStore(dir);
  const textStore = createFsTextStore(dir);
  app = express();
  app.use(express.json());
  app.use('/api', createWorldsRouter({ dataStore, textStore }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('worlds routes', () => {
  it('returns 404 for a missing world', async () => {
    const res = await request(app).get('/api/worlds/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a world', async () => {
    await request(app).put('/api/worlds/w1').send({ title: 'Waterdeep', raw: '# 世界観' });
    const res = await request(app).get('/api/worlds/w1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'w1', title: 'Waterdeep', raw: '# 世界観' });
  });

  it('lists saved worlds', async () => {
    await request(app).put('/api/worlds/w1').send({ title: 'A', raw: 'a' });
    await request(app).put('/api/worlds/w2').send({ title: 'B', raw: 'b' });
    const res = await request(app).get('/api/worlds');
    expect(res.status).toBe(200);
    expect(res.body.map((w) => w.id).sort()).toEqual(['w1', 'w2']);
  });

  it('deletes a world', async () => {
    await request(app).put('/api/worlds/w1').send({ title: 'A', raw: 'a' });
    const del = await request(app).delete('/api/worlds/w1');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/worlds/w1');
    expect(get.status).toBe(404);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/routes/worlds.test.js`
Expected: FAIL(`worlds.js`が存在しない)

- [ ] **Step 3: worlds.jsを実装**

```js
import { Router } from 'express';
import { saveWorld, getWorld, listWorlds, deleteWorld } from '../storage/worldLibrary.js';

export function createWorldsRouter({ dataStore, textStore }) {
  const router = Router();

  router.get('/worlds', async (req, res) => {
    res.json(await listWorlds(dataStore));
  });

  router.get('/worlds/:id', async (req, res) => {
    const world = await getWorld(dataStore, textStore, req.params.id);
    if (!world) {
      res.status(404).json({ error: 'world not found' });
      return;
    }
    res.json(world);
  });

  router.put('/worlds/:id', async (req, res) => {
    const world = await saveWorld(dataStore, textStore, {
      id: req.params.id,
      title: req.body.title,
      raw: req.body.raw,
    });
    res.json(world);
  });

  router.delete('/worlds/:id', async (req, res) => {
    await deleteWorld(dataStore, textStore, req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/worlds.test.js`
Expected: PASS(4 tests)

- [ ] **Step 5: server/index.jsを変更(textStore作成 + worldsRouterマウント)**

`server/index.js`全体を以下に置き換える:

```js
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessagesRouter } from './routes/messages.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createWorldsRouter } from './routes/worlds.js';
import { createFsDataStore } from './storage/dataStore.js';
import { createFsTextStore } from './storage/textStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({
  apiKey = process.env.ANTHROPIC_API_KEY,
  dataDir = path.join(__dirname, 'data'),
  fetchImpl = fetch,
} = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const dataStore = createFsDataStore(dataDir);
  const textStore = createFsTextStore(dataDir);
  app.locals.dataStore = dataStore;
  app.locals.textStore = textStore;

  app.use('/api', createMessagesRouter({ apiKey, fetchImpl }));
  app.use('/api', createSessionsRouter({ dataStore }));
  app.use('/api', createWorldsRouter({ dataStore, textStore }));

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 8787;
  createApp().listen(port, () => {
    console.log(`server listening on port ${port}`);
  });
}
```

- [ ] **Step 6: server/index.test.jsにworldsルートの疎通テストを追加**

`describe('createApp', ...)`ブロック内に追加する:

```js
  it('mounts the worlds route', async () => {
    const res = await request(app).get('/api/worlds');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
```

- [ ] **Step 7: テストが通ることを確認**

Run: `npx vitest run server/index.test.js server/routes/worlds.test.js`
Expected: 全テストPASS

- [ ] **Step 8: Commit**

```bash
git add server/routes/worlds.js server/routes/worlds.test.js server/index.js server/index.test.js
git commit -m "feat(server): add worlds REST API and wire textStore into app assembly"
```

---

## Task 4: server/storage/characterLibrary.js(Character CRUD関数)

**Files:**
- Create: `server/storage/characterLibrary.js`
- Create: `server/storage/characterLibrary.test.js`

**Interfaces:**
- Consumes: `characterMetaKey, characterDocPath`(`server/storage/paths.js`, Task 1)
- Produces: `saveCharacter(dataStore, textStore, { worldId, kind, name, raw, revealed })` → `Promise<{ id, worldId, kind, name, revealed, updatedAt, raw }>`。`getCharacter(dataStore, textStore, worldId, kind, name)` → 同形 or `null`。`listCharacters(dataStore, worldId, kind)` → メタ配列(rawなし)。`deleteCharacter(dataStore, textStore, worldId, kind, name)` → `Promise<void>`。`kind`は`'pc'|'npc'`。`revealed`は`kind==='npc'`のときブール値(未指定なら`false`)、`kind==='pc'`のときは常に`null`に強制する。Task 5(`routes/characters.js`)が消費する。

- [ ] **Step 1: characterLibrary.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsTextStore } from './textStore.js';
import { saveCharacter, getCharacter, listCharacters, deleteCharacter } from './characterLibrary.js';

let dir;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'character-library-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Character library functions', () => {
  it('returns null for a missing character', async () => {
    expect(await getCharacter(dataStore, textStore, 'w1', 'pc', 'missing')).toBeNull();
  });

  it('saves and retrieves a pc, forcing revealed to null', async () => {
    await saveCharacter(dataStore, textStore, {
      worldId: 'w1',
      kind: 'pc',
      name: 'alice',
      raw: 'PC名: アリス',
      revealed: true,
    });
    const pc = await getCharacter(dataStore, textStore, 'w1', 'pc', 'alice');
    expect(pc).toMatchObject({
      id: 'alice',
      worldId: 'w1',
      kind: 'pc',
      name: 'alice',
      raw: 'PC名: アリス',
      revealed: null,
    });
  });

  it('saves an npc with revealed defaulting to false when not specified', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'npc', name: 'villain', raw: 'NPC名: 黒幕' });
    const npc = await getCharacter(dataStore, textStore, 'w1', 'npc', 'villain');
    expect(npc.revealed).toBe(false);
  });

  it('saves an npc with revealed set to true', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'npc', name: 'villain', raw: 'x', revealed: true });
    const npc = await getCharacter(dataStore, textStore, 'w1', 'npc', 'villain');
    expect(npc.revealed).toBe(true);
  });

  it('lists characters scoped to a world and kind', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'bob', raw: 'b' });
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'npc', name: 'villain', raw: 'v' });
    const pcs = await listCharacters(dataStore, 'w1', 'pc');
    expect(pcs.map((c) => c.name).sort()).toEqual(['alice', 'bob']);
    const npcs = await listCharacters(dataStore, 'w1', 'npc');
    expect(npcs.map((c) => c.name)).toEqual(['villain']);
  });

  it('scopes listing to the given world (does not leak characters from other worlds)', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    await saveCharacter(dataStore, textStore, { worldId: 'w2', kind: 'pc', name: 'carol', raw: 'c' });
    const pcs = await listCharacters(dataStore, 'w1', 'pc');
    expect(pcs.map((c) => c.name)).toEqual(['alice']);
  });

  it('deletes a character', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    await deleteCharacter(dataStore, textStore, 'w1', 'pc', 'alice');
    expect(await getCharacter(dataStore, textStore, 'w1', 'pc', 'alice')).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/storage/characterLibrary.test.js`
Expected: FAIL(`characterLibrary.js`が存在しない)

- [ ] **Step 3: characterLibrary.jsを実装**

```js
import { characterMetaKey, characterDocPath } from './paths.js';

export async function saveCharacter(dataStore, textStore, { worldId, kind, name, raw, revealed }) {
  await textStore.write(characterDocPath(worldId, kind, name), raw);
  const meta = {
    id: name,
    worldId,
    kind,
    name,
    revealed: kind === 'npc' ? !!revealed : null,
    updatedAt: Date.now(),
  };
  await dataStore.set(characterMetaKey(worldId, kind, name), meta);
  return { ...meta, raw };
}

export async function getCharacter(dataStore, textStore, worldId, kind, name) {
  const meta = await dataStore.get(characterMetaKey(worldId, kind, name));
  if (!meta) return null;
  const raw = (await textStore.read(characterDocPath(worldId, kind, name))) ?? '';
  return { ...meta, raw };
}

export async function listCharacters(dataStore, worldId, kind) {
  const keys = await dataStore.list(`worlds/${worldId}/${kind}`);
  const characters = await Promise.all(keys.map((k) => dataStore.get(k)));
  return characters.filter(Boolean);
}

export async function deleteCharacter(dataStore, textStore, worldId, kind, name) {
  await dataStore.delete(characterMetaKey(worldId, kind, name));
  await textStore.delete(characterDocPath(worldId, kind, name));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/storage/characterLibrary.test.js`
Expected: PASS(7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/storage/characterLibrary.js server/storage/characterLibrary.test.js
git commit -m "feat(server): add Character library CRUD functions (pc/npc, revealed handling)"
```

---

## Task 5: server/routes/characters.js + server/index.js配線

**Files:**
- Create: `server/routes/characters.js`
- Create: `server/routes/characters.test.js`
- Modify: `server/index.js`

**Interfaces:**
- Consumes: `saveCharacter, getCharacter, listCharacters, deleteCharacter`(`server/storage/characterLibrary.js`, Task 4)
- Produces: `createCharactersRouter({ dataStore, textStore })` → Express `Router`(`GET /worlds/:worldId/characters/:kind`, `GET /worlds/:worldId/characters/:kind/:name`, `PUT /worlds/:worldId/characters/:kind/:name`, `DELETE /worlds/:worldId/characters/:kind/:name`)

- [ ] **Step 1: characters.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createCharactersRouter } from './characters.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';

let dir;
let app;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'characters-route-test-'));
  const dataStore = createFsDataStore(dir);
  const textStore = createFsTextStore(dir);
  app = express();
  app.use(express.json());
  app.use('/api', createCharactersRouter({ dataStore, textStore }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('characters routes', () => {
  it('returns 404 for a missing character', async () => {
    const res = await request(app).get('/api/worlds/w1/characters/pc/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a pc', async () => {
    await request(app).put('/api/worlds/w1/characters/pc/alice').send({ raw: 'PC名: アリス' });
    const res = await request(app).get('/api/worlds/w1/characters/pc/alice');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'alice', kind: 'pc', raw: 'PC名: アリス', revealed: null });
  });

  it('saves an npc with revealed', async () => {
    await request(app).put('/api/worlds/w1/characters/npc/villain').send({ raw: 'x', revealed: true });
    const res = await request(app).get('/api/worlds/w1/characters/npc/villain');
    expect(res.body.revealed).toBe(true);
  });

  it('lists characters scoped to world and kind', async () => {
    await request(app).put('/api/worlds/w1/characters/pc/alice').send({ raw: 'a' });
    await request(app).put('/api/worlds/w1/characters/npc/villain').send({ raw: 'v' });
    const res = await request(app).get('/api/worlds/w1/characters/pc');
    expect(res.body.map((c) => c.name)).toEqual(['alice']);
  });

  it('deletes a character', async () => {
    await request(app).put('/api/worlds/w1/characters/pc/alice').send({ raw: 'a' });
    const del = await request(app).delete('/api/worlds/w1/characters/pc/alice');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/worlds/w1/characters/pc/alice');
    expect(get.status).toBe(404);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/routes/characters.test.js`
Expected: FAIL(`characters.js`が存在しない)

- [ ] **Step 3: characters.jsを実装**

```js
import { Router } from 'express';
import { saveCharacter, getCharacter, listCharacters, deleteCharacter } from '../storage/characterLibrary.js';

export function createCharactersRouter({ dataStore, textStore }) {
  const router = Router();

  router.get('/worlds/:worldId/characters/:kind', async (req, res) => {
    res.json(await listCharacters(dataStore, req.params.worldId, req.params.kind));
  });

  router.get('/worlds/:worldId/characters/:kind/:name', async (req, res) => {
    const character = await getCharacter(dataStore, textStore, req.params.worldId, req.params.kind, req.params.name);
    if (!character) {
      res.status(404).json({ error: 'character not found' });
      return;
    }
    res.json(character);
  });

  router.put('/worlds/:worldId/characters/:kind/:name', async (req, res) => {
    const character = await saveCharacter(dataStore, textStore, {
      worldId: req.params.worldId,
      kind: req.params.kind,
      name: req.params.name,
      raw: req.body.raw,
      revealed: req.body.revealed,
    });
    res.json(character);
  });

  router.delete('/worlds/:worldId/characters/:kind/:name', async (req, res) => {
    await deleteCharacter(dataStore, textStore, req.params.worldId, req.params.kind, req.params.name);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/characters.test.js`
Expected: PASS(5 tests)

- [ ] **Step 5: server/index.jsにcharactersRouterをマウント**

`server/index.js`の`import`群と`createApp`本体に以下を追加する:

```js
import { createCharactersRouter } from './routes/characters.js';
```

`createWorldsRouter`のマウント行の直後に追加:

```js
  app.use('/api', createCharactersRouter({ dataStore, textStore }));
```

- [ ] **Step 6: 全体テストを実行し回帰がないことを確認**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 7: Commit**

```bash
git add server/routes/characters.js server/routes/characters.test.js server/index.js
git commit -m "feat(server): add characters REST API (pc/npc, nested under worlds)"
```

---

## Task 6: server/storage/scenarioLibrary.js(Scenario CRUD関数)

**Files:**
- Create: `server/storage/scenarioLibrary.js`
- Create: `server/storage/scenarioLibrary.test.js`

**Interfaces:**
- Consumes: `scenarioMetaKey, scenarioDocPath`(`server/storage/paths.js`, Task 1)
- Produces: `saveScenario(dataStore, textStore, { worldId, id, title, raw })` → `Promise<{ id, worldId, title, updatedAt, raw }>`。`getScenario(dataStore, textStore, worldId, id)` → 同形 or `null`。`listScenarios(dataStore, worldId)` → メタ配列。`deleteScenario(dataStore, textStore, worldId, id)` → `Promise<void>`。Task 7(`routes/scenarios.js`)が消費する。

- [ ] **Step 1: scenarioLibrary.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsTextStore } from './textStore.js';
import { saveScenario, getScenario, listScenarios, deleteScenario } from './scenarioLibrary.js';

let dir;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scenario-library-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Scenario library functions', () => {
  it('returns null for a missing scenario', async () => {
    expect(await getScenario(dataStore, textStore, 'w1', 'missing')).toBeNull();
  });

  it('saves and retrieves a scenario with its raw text', async () => {
    await saveScenario(dataStore, textStore, { worldId: 'w1', id: 'sc1', title: '失踪事件', raw: '## シナリオ概要' });
    const scenario = await getScenario(dataStore, textStore, 'w1', 'sc1');
    expect(scenario).toMatchObject({ id: 'sc1', worldId: 'w1', title: '失踪事件', raw: '## シナリオ概要' });
  });

  it('lists scenarios scoped to a world', async () => {
    await saveScenario(dataStore, textStore, { worldId: 'w1', id: 'sc1', title: 'A', raw: 'a' });
    await saveScenario(dataStore, textStore, { worldId: 'w1', id: 'sc2', title: 'B', raw: 'b' });
    await saveScenario(dataStore, textStore, { worldId: 'w2', id: 'sc3', title: 'C', raw: 'c' });
    const scenarios = await listScenarios(dataStore, 'w1');
    expect(scenarios.map((s) => s.id).sort()).toEqual(['sc1', 'sc2']);
  });

  it('deletes a scenario and its raw text', async () => {
    await saveScenario(dataStore, textStore, { worldId: 'w1', id: 'sc1', title: 'A', raw: 'a' });
    await deleteScenario(dataStore, textStore, 'w1', 'sc1');
    expect(await getScenario(dataStore, textStore, 'w1', 'sc1')).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/storage/scenarioLibrary.test.js`
Expected: FAIL(`scenarioLibrary.js`が存在しない)

- [ ] **Step 3: scenarioLibrary.jsを実装**

```js
import { scenarioMetaKey, scenarioDocPath } from './paths.js';

export async function saveScenario(dataStore, textStore, { worldId, id, title, raw }) {
  await textStore.write(scenarioDocPath(worldId, id), raw);
  const meta = { id, worldId, title, updatedAt: Date.now() };
  await dataStore.set(scenarioMetaKey(worldId, id), meta);
  return { ...meta, raw };
}

export async function getScenario(dataStore, textStore, worldId, id) {
  const meta = await dataStore.get(scenarioMetaKey(worldId, id));
  if (!meta) return null;
  const raw = (await textStore.read(scenarioDocPath(worldId, id))) ?? '';
  return { ...meta, raw };
}

export async function listScenarios(dataStore, worldId) {
  const keys = await dataStore.list(`worlds/${worldId}/scenarios`);
  const scenarios = await Promise.all(keys.map((k) => dataStore.get(k)));
  return scenarios.filter(Boolean);
}

export async function deleteScenario(dataStore, textStore, worldId, id) {
  await dataStore.delete(scenarioMetaKey(worldId, id));
  await textStore.delete(scenarioDocPath(worldId, id));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/storage/scenarioLibrary.test.js`
Expected: PASS(4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/storage/scenarioLibrary.js server/storage/scenarioLibrary.test.js
git commit -m "feat(server): add Scenario library CRUD functions"
```

---

## Task 7: server/routes/scenarios.js + server/index.js配線

**Files:**
- Create: `server/routes/scenarios.js`
- Create: `server/routes/scenarios.test.js`
- Modify: `server/index.js`

**Interfaces:**
- Consumes: `saveScenario, getScenario, listScenarios, deleteScenario`(`server/storage/scenarioLibrary.js`, Task 6)
- Produces: `createScenariosRouter({ dataStore, textStore })` → Express `Router`(`GET /worlds/:worldId/scenarios`, `GET /worlds/:worldId/scenarios/:id`, `PUT /worlds/:worldId/scenarios/:id`, `DELETE /worlds/:worldId/scenarios/:id`)

- [ ] **Step 1: scenarios.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createScenariosRouter } from './scenarios.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';

let dir;
let app;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scenarios-route-test-'));
  const dataStore = createFsDataStore(dir);
  const textStore = createFsTextStore(dir);
  app = express();
  app.use(express.json());
  app.use('/api', createScenariosRouter({ dataStore, textStore }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('scenarios routes', () => {
  it('returns 404 for a missing scenario', async () => {
    const res = await request(app).get('/api/worlds/w1/scenarios/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a scenario', async () => {
    await request(app).put('/api/worlds/w1/scenarios/sc1').send({ title: '失踪事件', raw: '## シナリオ概要' });
    const res = await request(app).get('/api/worlds/w1/scenarios/sc1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'sc1', worldId: 'w1', title: '失踪事件', raw: '## シナリオ概要' });
  });

  it('lists scenarios scoped to a world', async () => {
    await request(app).put('/api/worlds/w1/scenarios/sc1').send({ title: 'A', raw: 'a' });
    await request(app).put('/api/worlds/w1/scenarios/sc2').send({ title: 'B', raw: 'b' });
    const res = await request(app).get('/api/worlds/w1/scenarios');
    expect(res.body.map((s) => s.id).sort()).toEqual(['sc1', 'sc2']);
  });

  it('deletes a scenario', async () => {
    await request(app).put('/api/worlds/w1/scenarios/sc1').send({ title: 'A', raw: 'a' });
    const del = await request(app).delete('/api/worlds/w1/scenarios/sc1');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/worlds/w1/scenarios/sc1');
    expect(get.status).toBe(404);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/routes/scenarios.test.js`
Expected: FAIL(`scenarios.js`が存在しない)

- [ ] **Step 3: scenarios.jsを実装**

```js
import { Router } from 'express';
import { saveScenario, getScenario, listScenarios, deleteScenario } from '../storage/scenarioLibrary.js';

export function createScenariosRouter({ dataStore, textStore }) {
  const router = Router();

  router.get('/worlds/:worldId/scenarios', async (req, res) => {
    res.json(await listScenarios(dataStore, req.params.worldId));
  });

  router.get('/worlds/:worldId/scenarios/:id', async (req, res) => {
    const scenario = await getScenario(dataStore, textStore, req.params.worldId, req.params.id);
    if (!scenario) {
      res.status(404).json({ error: 'scenario not found' });
      return;
    }
    res.json(scenario);
  });

  router.put('/worlds/:worldId/scenarios/:id', async (req, res) => {
    const scenario = await saveScenario(dataStore, textStore, {
      worldId: req.params.worldId,
      id: req.params.id,
      title: req.body.title,
      raw: req.body.raw,
    });
    res.json(scenario);
  });

  router.delete('/worlds/:worldId/scenarios/:id', async (req, res) => {
    await deleteScenario(dataStore, textStore, req.params.worldId, req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/scenarios.test.js`
Expected: PASS(4 tests)

- [ ] **Step 5: server/index.jsにscenariosRouterをマウント**

`import`群に追加:

```js
import { createScenariosRouter } from './routes/scenarios.js';
```

`createCharactersRouter`のマウント行の直後に追加:

```js
  app.use('/api', createScenariosRouter({ dataStore, textStore }));
```

- [ ] **Step 6: 全体テストを実行し回帰がないことを確認**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 7: Commit**

```bash
git add server/routes/scenarios.js server/routes/scenarios.test.js server/index.js
git commit -m "feat(server): add scenarios REST API (nested under worlds)"
```

---

## Task 8: server/storage/rulesetLibrary.js(Ruleset CRUD関数)

**Files:**
- Create: `server/storage/rulesetLibrary.js`
- Create: `server/storage/rulesetLibrary.test.js`

**Interfaces:**
- Consumes: `rulesetMetaKey`(`server/storage/paths.js`, Task 1)
- Produces: `saveRuleset(dataStore, { id, label, desc, hint })` → `Promise<{ id, label, desc, hint, updatedAt }>`。`getRuleset(dataStore, id)` → 同形 or `null`。`listRulesets(dataStore)` → 配列。`deleteRuleset(dataStore, id)` → `Promise<void>`。Task 9(`routes/rulesets.js`)が消費する。RulesetはtextStoreを使わない(dataStoreのみ)。

- [ ] **Step 1: rulesetLibrary.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { saveRuleset, getRuleset, listRulesets, deleteRuleset } from './rulesetLibrary.js';

let dir;
let dataStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ruleset-library-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Ruleset library functions', () => {
  it('returns null for a missing ruleset', async () => {
    expect(await getRuleset(dataStore, 'missing')).toBeNull();
  });

  it('saves and retrieves a ruleset', async () => {
    await saveRuleset(dataStore, { id: 'homebrew', label: '自作ルール', desc: '独自ルール', hint: '演出ヒント' });
    const ruleset = await getRuleset(dataStore, 'homebrew');
    expect(ruleset).toMatchObject({ id: 'homebrew', label: '自作ルール', desc: '独自ルール', hint: '演出ヒント' });
    expect(typeof ruleset.updatedAt).toBe('number');
  });

  it('lists saved rulesets', async () => {
    await saveRuleset(dataStore, { id: 'a', label: 'A', desc: 'a', hint: '' });
    await saveRuleset(dataStore, { id: 'b', label: 'B', desc: 'b', hint: '' });
    const rulesets = await listRulesets(dataStore);
    expect(rulesets.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('deletes a ruleset', async () => {
    await saveRuleset(dataStore, { id: 'a', label: 'A', desc: 'a', hint: '' });
    await deleteRuleset(dataStore, 'a');
    expect(await getRuleset(dataStore, 'a')).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/storage/rulesetLibrary.test.js`
Expected: FAIL(`rulesetLibrary.js`が存在しない)

- [ ] **Step 3: rulesetLibrary.jsを実装**

```js
import { rulesetMetaKey } from './paths.js';

export async function saveRuleset(dataStore, { id, label, desc, hint }) {
  const meta = { id, label, desc, hint, updatedAt: Date.now() };
  await dataStore.set(rulesetMetaKey(id), meta);
  return meta;
}

export async function getRuleset(dataStore, id) {
  return (await dataStore.get(rulesetMetaKey(id))) ?? null;
}

export async function listRulesets(dataStore) {
  const keys = await dataStore.list('rulesets');
  const rulesets = await Promise.all(keys.map((k) => dataStore.get(k)));
  return rulesets.filter(Boolean);
}

export async function deleteRuleset(dataStore, id) {
  await dataStore.delete(rulesetMetaKey(id));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/storage/rulesetLibrary.test.js`
Expected: PASS(4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/storage/rulesetLibrary.js server/storage/rulesetLibrary.test.js
git commit -m "feat(server): add Ruleset library CRUD functions"
```

---

## Task 9: server/routes/rulesets.js + server/index.js配線(最終)

**Files:**
- Create: `server/routes/rulesets.js`
- Create: `server/routes/rulesets.test.js`
- Modify: `server/index.js`
- Modify: `server/index.test.js`

**Interfaces:**
- Consumes: `saveRuleset, getRuleset, listRulesets, deleteRuleset`(`server/storage/rulesetLibrary.js`, Task 8)
- Produces: `createRulesetsRouter({ dataStore })` → Express `Router`(`GET /rulesets`, `GET /rulesets/:id`, `PUT /rulesets/:id`, `DELETE /rulesets/:id`)。この時点で`server/index.js`は4つのライブラリ系ルーター(worlds/characters/scenarios/rulesets)を全てマウントし終える。

- [ ] **Step 1: rulesets.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createRulesetsRouter } from './rulesets.js';
import { createFsDataStore } from '../storage/dataStore.js';

let dir;
let app;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rulesets-route-test-'));
  const dataStore = createFsDataStore(dir);
  app = express();
  app.use(express.json());
  app.use('/api', createRulesetsRouter({ dataStore }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('rulesets routes', () => {
  it('returns 404 for a missing ruleset', async () => {
    const res = await request(app).get('/api/rulesets/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a ruleset', async () => {
    await request(app).put('/api/rulesets/homebrew').send({ label: '自作ルール', desc: '独自ルール', hint: 'ヒント' });
    const res = await request(app).get('/api/rulesets/homebrew');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'homebrew', label: '自作ルール', desc: '独自ルール', hint: 'ヒント' });
  });

  it('lists saved rulesets', async () => {
    await request(app).put('/api/rulesets/a').send({ label: 'A', desc: 'a', hint: '' });
    await request(app).put('/api/rulesets/b').send({ label: 'B', desc: 'b', hint: '' });
    const res = await request(app).get('/api/rulesets');
    expect(res.body.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('deletes a ruleset', async () => {
    await request(app).put('/api/rulesets/a').send({ label: 'A', desc: 'a', hint: '' });
    const del = await request(app).delete('/api/rulesets/a');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/rulesets/a');
    expect(get.status).toBe(404);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/routes/rulesets.test.js`
Expected: FAIL(`rulesets.js`が存在しない)

- [ ] **Step 3: rulesets.jsを実装**

```js
import { Router } from 'express';
import { saveRuleset, getRuleset, listRulesets, deleteRuleset } from '../storage/rulesetLibrary.js';

export function createRulesetsRouter({ dataStore }) {
  const router = Router();

  router.get('/rulesets', async (req, res) => {
    res.json(await listRulesets(dataStore));
  });

  router.get('/rulesets/:id', async (req, res) => {
    const ruleset = await getRuleset(dataStore, req.params.id);
    if (!ruleset) {
      res.status(404).json({ error: 'ruleset not found' });
      return;
    }
    res.json(ruleset);
  });

  router.put('/rulesets/:id', async (req, res) => {
    const ruleset = await saveRuleset(dataStore, {
      id: req.params.id,
      label: req.body.label,
      desc: req.body.desc,
      hint: req.body.hint,
    });
    res.json(ruleset);
  });

  router.delete('/rulesets/:id', async (req, res) => {
    await deleteRuleset(dataStore, req.params.id);
    res.status(204).end();
  });

  return router;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/rulesets.test.js`
Expected: PASS(4 tests)

- [ ] **Step 5: server/index.jsにrulesetsRouterをマウント(最終形)**

`server/index.js`全体を以下に置き換える:

```js
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessagesRouter } from './routes/messages.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createWorldsRouter } from './routes/worlds.js';
import { createCharactersRouter } from './routes/characters.js';
import { createScenariosRouter } from './routes/scenarios.js';
import { createRulesetsRouter } from './routes/rulesets.js';
import { createFsDataStore } from './storage/dataStore.js';
import { createFsTextStore } from './storage/textStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({
  apiKey = process.env.ANTHROPIC_API_KEY,
  dataDir = path.join(__dirname, 'data'),
  fetchImpl = fetch,
} = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const dataStore = createFsDataStore(dataDir);
  const textStore = createFsTextStore(dataDir);
  app.locals.dataStore = dataStore;
  app.locals.textStore = textStore;

  app.use('/api', createMessagesRouter({ apiKey, fetchImpl }));
  app.use('/api', createSessionsRouter({ dataStore }));
  app.use('/api', createWorldsRouter({ dataStore, textStore }));
  app.use('/api', createCharactersRouter({ dataStore, textStore }));
  app.use('/api', createScenariosRouter({ dataStore, textStore }));
  app.use('/api', createRulesetsRouter({ dataStore }));

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 8787;
  createApp().listen(port, () => {
    console.log(`server listening on port ${port}`);
  });
}
```

- [ ] **Step 6: server/index.test.jsにrulesetsルートの疎通テストを追加**

`describe('createApp', ...)`ブロック内に追加する:

```js
  it('mounts the rulesets route', async () => {
    const res = await request(app).get('/api/rulesets');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
```

- [ ] **Step 7: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS(Task1〜9で追加した全テストファイルを含む)

- [ ] **Step 8: Commit**

```bash
git add server/routes/rulesets.js server/routes/rulesets.test.js server/index.js server/index.test.js
git commit -m "feat(server): add rulesets REST API; complete library CRUD foundation wiring"
```

---

## Self-Review Notes

- **Spec coverage**: spec docの4エンティティ(World/Character/Scenario/Ruleset)全てにCRUD関数+REST APIが対応済み。paths.jsのフラット化・textStore.delete追加もTask 1でカバー。
- **Placeholder scan**: 「TBD」等の記述なし。全ステップに実行可能なコード/コマンドを記載。
- **Type consistency**: `saveWorld`/`getWorld`/`listWorlds`/`deleteWorld`(Task 2)、`saveCharacter`/`getCharacter`/`listCharacters`/`deleteCharacter`(Task 4)、`saveScenario`/`getScenario`/`listScenarios`/`deleteScenario`(Task 6)、`saveRuleset`/`getRuleset`/`listRulesets`/`deleteRuleset`(Task 8)の関数名・シグネチャは、対応するルートタスク(3, 5, 7, 9)まで一貫して使用している。
- **非スコープの遵守**: フロントエンドAPI呼び出し・UI、World region/category分割、NPC revealed切り替えUI、Campaign、Rulesetアダプタは本プランのどのタスクにも含まれていない。
