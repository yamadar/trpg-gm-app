# TRPG GM App ファイル分割・Webアプリ移行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `trpg-gm-app.jsx`(1223行の単一ファイル)と`docs/trpg_gm_app_design.md`(405行の単一ファイル)を、適切な粒度の複数ファイルへ分割し、Claude Artifacts依存(`window.storage`、キー無し直接fetch)を解消して通常のWebアプリ(Vite+ReactフロントエンドとExpressバックエンド)として動作する構成に移行する。

**Architecture:** 単一`package.json`配下に`src/`(Vite+Reactフロントエンド)と`server/`(Express)を同居させる。フロントエンドはIndexedDB(`idb`パッケージ)でセッションを永続化し、Claude API呼び出しは自前バックエンドの`/api/messages`プロキシ経由に変更する。バックエンドは`dataStore`(JSON、将来Redis化)と`textStore`(テキスト、将来S3化)という2つの抽象化されたストレージインターフェースを持つ。設計ドキュメントは関心事ごとに8ファイルへ分割する。詳細は[docs/superpowers/specs/2026-07-21-file-split-refactor-design.md](../specs/2026-07-21-file-split-refactor-design.md)を参照。

**Tech Stack:** React 18, Vite 5, Express 4, `idb`(IndexedDBラッパー), Vitest, `@testing-library/react`, `supertest`, `fake-indexeddb`

## Global Constraints

- プロジェクト構成: 単一`package.json`。モノレポ/workspaces化はしない。`concurrently`で開発時にフロントエンドとバックエンドを同時起動する。
- モジュール形式: `"type": "module"`(ESM)をフロントエンド・バックエンド共通で使う。
- クライアント側永続化はIndexedDB(`idb`パッケージ)のみ。localStorage/sessionStorageは使わない(理由: 両者は容量上限がほぼ同じで、sessionStorageはタブを閉じると消えるため「続きから再開」機能と両立しない)。
- サーバー側永続化は`dataStore`(JSON、ローカルファイル実装、将来Redis化を想定)と`textStore`(テキスト、ローカルファイル実装、将来S3化を想定)の2つの抽象インターフェース経由でのみ行う。
- World/Character/Scenario/Rulesetの保存は`server/storage/paths.js`のキー生成関数のみ用意し、保存API配線・フロントエンドUIは実装しない(次タスクへ)。
- Sessionsのサーバー保存APIは実装するが、フロントエンド(Play画面)からの自動同期配線は行わない(IndexedDBのみで完結)。
- 小説化(novelization)は`POST /api/sessions/:id/novelize`が`501`を返すプレースホルダーのみ実装する。
- テストランナーはVitest。フロントエンドの純粋関数・IndexedDB層・サーバーのルート/ストレージ層はVitestの`describe/it/expect`(`vitest`から明示import、`globals: false`)で書く。UIコンポーネントは`@testing-library/react`でレンダースモークテストを書く(exhaustiveな挙動網羅は今回のスコープ外)。
- 各タスクの最後は該当ファイルのみをステージしてコミットする(`git add <このタスクのファイル>` → `git commit`)。
- 既存の`trpg-gm-app.jsx`と`docs/trpg_gm_app_design.md`は、分割後の内容が動作確認・検証できてから削除する(Task 17, Task 22)。

---

## Task 1: プロジェクトスキャフォールド(package.json / Vite / テスト基盤)

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `index.html`
- Create: `src/main.jsx`
- Create: `src/App.jsx`(プレースホルダー、Task 17で最終版に置き換え)
- Create: `src/App.test.jsx`(プレースホルダー、Task 17で最終版に置き換え)
- Create: `src/test/setup.js`
- Create: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Produces: `npm run dev`(client+server同時起動), `npm run build`, `npm test`(`vitest run`)というnpm scripts。以降の全タスクはこれらのscriptsを前提にする。

- [ ] **Step 1: package.jsonを作成**

```json
{
  "name": "trpg-gm-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently -n client,server -c blue,green \"vite\" \"node --watch server/index.js\"",
    "build": "vite build",
    "preview": "vite preview",
    "start": "node server/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "idb": "^8.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@vitejs/plugin-react": "^4.3.1",
    "concurrently": "^8.2.2",
    "fake-indexeddb": "^6.0.0",
    "jsdom": "^24.1.1",
    "supertest": "^7.0.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: vite.config.jsを作成**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.js'],
  },
});
```

- [ ] **Step 3: index.htmlを作成**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GM's Desk</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: src/main.jsxを作成(以降のタスクで変更しない最終版)**

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 5: src/App.jsxをプレースホルダーとして作成(Task 17で最終版に置き換える)**

```jsx
export default function App() {
  return <div>Project scaffold ready.</div>;
}
```

- [ ] **Step 6: src/App.test.jsxをプレースホルダーとして作成(Task 17で最終版に置き換える)**

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App.jsx';

describe('App scaffold', () => {
  it('renders the placeholder', () => {
    render(<App />);
    expect(screen.getByText('Project scaffold ready.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: src/test/setup.jsを作成**

jsdomにはIndexedDBと`Element.prototype.scrollIntoView`が実装されていないため、テスト全体で使えるようポリフィルする。また`vite.config.js`で`test.globals: false`にしているため(`describe`/`it`/`expect`を各テストファイルで明示importする方針)、`@testing-library/react`の自動クリーンアップも自動登録されない。そのため`afterEach(cleanup)`を明示的に登録し、同一テストファイル内の複数`render()`呼び出しがDOMに残り続けて後続テストで要素が重複マッチする事故を防ぐ。

```js
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

afterEach(() => {
  cleanup();
});

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
```

- [ ] **Step 8: .gitignoreを作成**

```
node_modules/
dist/
.env
server/data/
.DS_Store
```

- [ ] **Step 9: .env.exampleを作成**

```
ANTHROPIC_API_KEY=your-api-key-here
PORT=8787
```

- [ ] **Step 10: 依存関係をインストール**

Run: `npm install`
Expected: `node_modules/`と`package-lock.json`が生成され、エラーなく完了する。

- [ ] **Step 11: ビルドが通ることを確認**

Run: `npm run build`
Expected: `dist/`が生成され、`✓ built in ...`のようなVite成功メッセージが出る。

- [ ] **Step 12: テストランナーが動くことを確認**

Run: `npx vitest run`
Expected: `src/App.test.jsx`の1テストがPASSする。

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json vite.config.js index.html src/main.jsx src/App.jsx src/App.test.jsx src/test/setup.js .gitignore .env.example
git commit -m "chore: scaffold Vite+React project with Vitest test harness"
```

---

## Task 2: サーバー側ストレージ抽象化(dataStore / textStore / paths)

**Files:**
- Create: `server/storage/dataStore.js`
- Create: `server/storage/dataStore.test.js`
- Create: `server/storage/textStore.js`
- Create: `server/storage/textStore.test.js`
- Create: `server/storage/paths.js`
- Create: `server/storage/paths.test.js`

**Interfaces:**
- Produces: `createFsDataStore(rootDir)` → `{ get(key), set(key, value), list(prefix), delete(key) }`(JSON値)。`createFsTextStore(rootDir)` → `{ read(path), write(path, content), list(prefix) }`(生テキスト)。`sessionKey(id)`, `worldMetaKey(worldId)`, `worldDocPath(worldId)`, `regionDocPath(worldId, region)`, `categoryDocPath(worldId, category)`, `characterDocPath(worldId, kind, name)`, `characterMetaKey(worldId, kind, name)`, `scenarioDocPath(worldId, scenarioId)`, `scenarioMetaKey(worldId, scenarioId)`, `campaignMetaKey(worldId, campaignId)`, `rulesetMetaKey(rulesetId)`(すべて文字列を返す純関数)。
- Consumes: なし(Task 1のNode/npm環境のみ)。

- [ ] **Step 1: dataStore.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';

let dir;
let store;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'datastore-test-'));
  store = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createFsDataStore', () => {
  it('returns null for a missing key', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('round-trips a value through set/get', async () => {
    await store.set('sessions/abc', { id: 'abc', title: 'test' });
    expect(await store.get('sessions/abc')).toEqual({ id: 'abc', title: 'test' });
  });

  it('lists keys under a prefix', async () => {
    await store.set('sessions/a', { id: 'a' });
    await store.set('sessions/b', { id: 'b' });
    const keys = await store.list('sessions');
    expect(keys.sort()).toEqual(['sessions/a', 'sessions/b']);
  });

  it('returns an empty list for a missing prefix', async () => {
    expect(await store.list('nothing')).toEqual([]);
  });

  it('deletes a key', async () => {
    await store.set('sessions/a', { id: 'a' });
    await store.delete('sessions/a');
    expect(await store.get('sessions/a')).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/storage/dataStore.test.js`
Expected: FAIL(`dataStore.js`が存在しない)

- [ ] **Step 3: dataStore.jsを実装**

```js
import fs from 'node:fs/promises';
import path from 'node:path';

export function createFsDataStore(rootDir) {
  function fullPath(key) {
    return path.join(rootDir, `${key}.json`);
  }

  return {
    async get(key) {
      try {
        const raw = await fs.readFile(fullPath(key), 'utf-8');
        return JSON.parse(raw);
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async set(key, value) {
      const file = fullPath(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf-8');
    },
    async list(prefix) {
      const dir = path.join(rootDir, prefix);
      try {
        const files = await fs.readdir(dir);
        return files.filter((f) => f.endsWith('.json')).map((f) => `${prefix}/${f.slice(0, -5)}`);
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },
    async delete(key) {
      try {
        await fs.unlink(fullPath(key));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/storage/dataStore.test.js`
Expected: PASS(5 tests)

- [ ] **Step 5: textStore.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsTextStore } from './textStore.js';

let dir;
let store;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'textstore-test-'));
  store = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createFsTextStore', () => {
  it('returns null for a missing path', async () => {
    expect(await store.read('worlds/x/world.md')).toBeNull();
  });

  it('round-trips text through write/read', async () => {
    await store.write('worlds/x/world.md', '# 世界観\n本文');
    expect(await store.read('worlds/x/world.md')).toBe('# 世界観\n本文');
  });

  it('lists files under a prefix', async () => {
    await store.write('worlds/x/regions/a.md', 'a');
    await store.write('worlds/x/regions/b.md', 'b');
    const files = await store.list('worlds/x/regions');
    expect(files.sort()).toEqual(['worlds/x/regions/a.md', 'worlds/x/regions/b.md']);
  });

  it('returns an empty list for a missing prefix', async () => {
    expect(await store.list('worlds/missing')).toEqual([]);
  });
});
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npx vitest run server/storage/textStore.test.js`
Expected: FAIL(`textStore.js`が存在しない)

- [ ] **Step 7: textStore.jsを実装**

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
  };
}
```

- [ ] **Step 8: テストが通ることを確認**

Run: `npx vitest run server/storage/textStore.test.js`
Expected: PASS(4 tests)

- [ ] **Step 9: paths.test.jsを書く(失敗する状態)**

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
    expect(worldMetaKey('waterdeep')).toBe('worlds/waterdeep/world');
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
    expect(scenarioMetaKey('waterdeep', 'sc1')).toBe('worlds/waterdeep/scenarios/sc1/scenario.parsed');
    expect(campaignMetaKey('waterdeep', 'cp1')).toBe('worlds/waterdeep/campaigns/cp1/campaign');
  });

  it('builds a ruleset key', () => {
    expect(rulesetMetaKey('coc7e')).toBe('rulesets/coc7e');
  });
});
```

- [ ] **Step 10: テストが失敗することを確認**

Run: `npx vitest run server/storage/paths.test.js`
Expected: FAIL(`paths.js`が存在しない)

- [ ] **Step 11: paths.jsを実装**

```js
export function sessionKey(sessionId) {
  return `sessions/${sessionId}`;
}

export function worldMetaKey(worldId) {
  return `worlds/${worldId}/world`;
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
  return `worlds/${worldId}/scenarios/${scenarioId}/scenario.parsed`;
}

export function campaignMetaKey(worldId, campaignId) {
  return `worlds/${worldId}/campaigns/${campaignId}/campaign`;
}

export function rulesetMetaKey(rulesetId) {
  return `rulesets/${rulesetId}`;
}
```

- [ ] **Step 12: テストが通ることを確認**

Run: `npx vitest run server/storage/paths.test.js`
Expected: PASS(6 tests)

- [ ] **Step 13: Commit**

```bash
git add server/storage/dataStore.js server/storage/dataStore.test.js server/storage/textStore.js server/storage/textStore.test.js server/storage/paths.js server/storage/paths.test.js
git commit -m "feat(server): add dataStore/textStore storage abstractions and path builders"
```

---

## Task 3: バックエンドAnthropicプロキシ(server/index.js + routes/messages.js)

**Files:**
- Create: `server/routes/messages.js`
- Create: `server/routes/messages.test.js`
- Create: `server/index.js`
- Create: `server/index.test.js`

**Interfaces:**
- Consumes: `createFsDataStore`(`server/storage/dataStore.js`, Task 2)
- Produces: `createMessagesRouter({ apiKey, fetchImpl })` → Express `Router`(`POST /messages`)。`createApp({ apiKey, dataDir })` → Express `app`(Task 4で`createSessionsRouter`も追加する)。

- [ ] **Step 1: messages.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMessagesRouter } from './messages.js';

describe('POST /messages', () => {
  it('proxies to Anthropic with the api key header and returns the upstream body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }),
    });
    const app = express();
    app.use(express.json());
    app.use('/api', createMessagesRouter({ apiKey: 'test-key', fetchImpl }));

    const res = await request(app).post('/api/messages').send({ model: 'x', messages: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: [{ type: 'text', text: 'hi' }] });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
      })
    );
  });

  it('returns 500 when no api key is configured', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', createMessagesRouter({ apiKey: undefined, fetchImpl: vi.fn() }));

    const res = await request(app).post('/api/messages').send({});

    expect(res.status).toBe(500);
  });

  it('returns 502 when the upstream request throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const app = express();
    app.use(express.json());
    app.use('/api', createMessagesRouter({ apiKey: 'test-key', fetchImpl }));

    const res = await request(app).post('/api/messages').send({});

    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/routes/messages.test.js`
Expected: FAIL(`messages.js`が存在しない)

- [ ] **Step 3: messages.jsを実装**

```js
import { Router } from 'express';

export function createMessagesRouter({ apiKey, fetchImpl = fetch }) {
  const router = Router();

  router.post('/messages', async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
      return;
    }
    try {
      const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(req.body),
      });
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader('Content-Type', 'application/json');
      res.send(text);
    } catch (e) {
      res.status(502).json({ error: `upstream request failed: ${e.message}` });
    }
  });

  return router;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/messages.test.js`
Expected: PASS(3 tests)

- [ ] **Step 5: server/index.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';

let dir;
let app;
let fetchImpl;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-test-'));
  fetchImpl = vi.fn().mockResolvedValue({ status: 200, text: async () => '{}' });
  app = createApp({ apiKey: 'test-key', dataDir: dir, fetchImpl });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createApp', () => {
  it('mounts the messages route and proxies via the injected fetchImpl', async () => {
    const res = await request(app).post('/api/messages').send({});
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.anything());
  });

  it('404s on unknown routes', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npx vitest run server/index.test.js`
Expected: FAIL(`index.js`が存在しない)

- [ ] **Step 7: server/index.jsを実装**

`createApp`は`fetchImpl`を受け取れるようにし(テストで実ネットワークへアクセスしないため)、既定値はグローバルの`fetch`とする。

```js
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessagesRouter } from './routes/messages.js';
import { createFsDataStore } from './storage/dataStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({
  apiKey = process.env.ANTHROPIC_API_KEY,
  dataDir = path.join(__dirname, 'data'),
  fetchImpl = fetch,
} = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const dataStore = createFsDataStore(dataDir);
  app.locals.dataStore = dataStore;

  app.use('/api', createMessagesRouter({ apiKey, fetchImpl }));

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 8787;
  createApp().listen(port, () => {
    console.log(`server listening on port ${port}`);
  });
}
```

- [ ] **Step 8: テストが通ることを確認**

Run: `npx vitest run server/index.test.js`
Expected: PASS(2 tests)

- [ ] **Step 9: Commit**

```bash
git add server/routes/messages.js server/routes/messages.test.js server/index.js server/index.test.js
git commit -m "feat(server): add Anthropic proxy route and Express app assembly"
```

---

## Task 4: セッションAPI(routes/sessions.js)

**Files:**
- Create: `server/routes/sessions.js`
- Create: `server/routes/sessions.test.js`
- Modify: `server/index.js`(`createSessionsRouter`をマウント)
- Modify: `server/index.test.js`(セッションAPIがマウントされていることを確認するテストを追加)

**Interfaces:**
- Consumes: `createFsDataStore`(Task 2), `sessionKey`(`server/storage/paths.js`, Task 2)
- Produces: `createSessionsRouter({ dataStore })` → Express `Router`(`GET /sessions`, `GET /sessions/:id`, `PUT /sessions/:id`, `POST /sessions/:id/novelize`)

- [ ] **Step 1: sessions.test.jsを書く(失敗する状態)**

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createSessionsRouter } from './sessions.js';
import { createFsDataStore } from '../storage/dataStore.js';

let dir;
let app;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-route-test-'));
  const dataStore = createFsDataStore(dir);
  app = express();
  app.use(express.json());
  app.use('/api', createSessionsRouter({ dataStore }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('sessions routes', () => {
  it('returns 404 for a missing session', async () => {
    const res = await request(app).get('/api/sessions/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a session', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'My Session' });
    const res = await request(app).get('/api/sessions/s1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 's1', title: 'My Session' });
  });

  it('lists saved sessions', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A' });
    await request(app).put('/api/sessions/s2').send({ title: 'B' });
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('returns 501 for the novelize placeholder', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A' });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(501);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/routes/sessions.test.js`
Expected: FAIL(`sessions.js`が存在しない)

- [ ] **Step 3: sessions.jsを実装**

```js
import { Router } from 'express';
import { sessionKey } from '../storage/paths.js';

export function createSessionsRouter({ dataStore }) {
  const router = Router();

  router.get('/sessions', async (req, res) => {
    const keys = await dataStore.list('sessions');
    const sessions = await Promise.all(keys.map((k) => dataStore.get(k)));
    res.json(sessions.filter(Boolean));
  });

  router.get('/sessions/:id', async (req, res) => {
    const session = await dataStore.get(sessionKey(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json(session);
  });

  router.put('/sessions/:id', async (req, res) => {
    const session = { ...req.body, id: req.params.id };
    await dataStore.set(sessionKey(req.params.id), session);
    res.json(session);
  });

  router.post('/sessions/:id/novelize', async (req, res) => {
    res.status(501).json({ error: 'novelization is not implemented yet' });
  });

  return router;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/sessions.test.js`
Expected: PASS(4 tests)

- [ ] **Step 5: server/index.jsを変更してセッションルートをマウント**

`server/index.js`の`import`群と`createApp`本体を以下のように変更する:

```js
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMessagesRouter } from './routes/messages.js';
import { createSessionsRouter } from './routes/sessions.js';
import { createFsDataStore } from './storage/dataStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp({
  apiKey = process.env.ANTHROPIC_API_KEY,
  dataDir = path.join(__dirname, 'data'),
  fetchImpl = fetch,
} = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const dataStore = createFsDataStore(dataDir);
  app.locals.dataStore = dataStore;

  app.use('/api', createMessagesRouter({ apiKey, fetchImpl }));
  app.use('/api', createSessionsRouter({ dataStore }));

  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 8787;
  createApp().listen(port, () => {
    console.log(`server listening on port ${port}`);
  });
}
```

- [ ] **Step 6: server/index.test.jsにセッションAPIの疎通テストを追加**

`describe('createApp', ...)`ブロック内に以下のテストを追加する:

```js
  it('mounts the sessions route', async () => {
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
```

- [ ] **Step 7: テストが通ることを確認**

Run: `npx vitest run server/index.test.js server/routes/sessions.test.js`
Expected: PASS(全テスト)

- [ ] **Step 8: Commit**

```bash
git add server/routes/sessions.js server/routes/sessions.test.js server/index.js server/index.test.js
git commit -m "feat(server): add sessions CRUD API and novelize placeholder"
```

---

## Task 5: src/engine/dice.js

**Files:**
- Create: `src/engine/dice.js`
- Create: `src/engine/dice.test.js`

**Interfaces:**
- Produces: `rollD100()` → `number`(1-100)。`evaluateRoll(successPercent)` → `{ roll, success_percent, success, degree }`(`degree`は`'critical' | 'success' | 'fail' | 'fumble'`)。Task 9(`src/api/session.js`)がこれを消費する。

- [ ] **Step 1: dice.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rollD100, evaluateRoll } from './dice.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rollD100', () => {
  it('returns 1 when Math.random returns 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(rollD100()).toBe(1);
  });

  it('returns 100 when Math.random returns just under 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(rollD100()).toBe(100);
  });
});

describe('evaluateRoll', () => {
  it('clamps successPercent into [1, 99]', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(evaluateRoll(150).success_percent).toBe(99);
    expect(evaluateRoll(0).success_percent).toBe(1);
  });

  it('is a success when the roll is at or below the success percent', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.49); // roll = 50
    const result = evaluateRoll(60);
    expect(result.roll).toBe(50);
    expect(result.success).toBe(true);
    expect(result.degree).toBe('success');
  });

  it('is a fail when the roll exceeds the success percent', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.79); // roll = 80
    const result = evaluateRoll(60);
    expect(result.success).toBe(false);
    expect(result.degree).toBe('fail');
  });

  it('is a critical when the roll is within 5% of the success percent', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // roll = 1
    const result = evaluateRoll(60); // critical threshold = round(60*0.05) = 3
    expect(result.degree).toBe('critical');
  });

  it('is a fumble when the roll is 96 or higher', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.96); // roll = 97
    const result = evaluateRoll(60);
    expect(result.degree).toBe('fumble');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/engine/dice.test.js`
Expected: FAIL(`dice.js`が存在しない)

- [ ] **Step 3: dice.jsを実装**

```js
export function rollD100() {
  return Math.floor(Math.random() * 100) + 1;
}

export function evaluateRoll(successPercent) {
  const p = Math.max(1, Math.min(99, Math.round(successPercent)));
  const roll = rollD100();
  const success = roll <= p;
  let degree = success ? 'success' : 'fail';
  if (roll <= Math.max(1, Math.round(p * 0.05))) degree = 'critical';
  if (roll >= 96) degree = 'fumble';
  return { roll, success_percent: p, success, degree };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/engine/dice.test.js`
Expected: PASS(6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/dice.js src/engine/dice.test.js
git commit -m "feat(frontend): extract dice engine (rollD100/evaluateRoll)"
```

---

## Task 6: src/utils/fileImport.js

**Files:**
- Create: `src/utils/fileImport.js`
- Create: `src/utils/fileImport.test.js`

**Interfaces:**
- Produces: `htmlToText(html)` → `string`。`readFilesAsEntries(fileList)` → `Promise<{name, content}[]>`。`combineEntries(entries)` → `string`。Task 15(`src/components/FileImportRow.jsx`)と Task 15(`Setup.jsx`)が消費する。

- [ ] **Step 1: fileImport.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect } from 'vitest';
import { htmlToText, readFilesAsEntries, combineEntries } from './fileImport.js';

describe('htmlToText', () => {
  it('strips tags and converts block elements to newlines', () => {
    const html = '<html><body><h1>Title</h1><p>Para one</p><p>Para two</p></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('Title');
    expect(text).toContain('Para one');
    expect(text).toContain('Para two');
    expect(text).not.toContain('<p>');
  });

  it('removes script and style content', () => {
    const html = '<body><script>evil()</script><style>.x{}</style><p>Visible</p></body>';
    const text = htmlToText(html);
    expect(text).not.toContain('evil()');
    expect(text).toBe('Visible');
  });
});

describe('combineEntries', () => {
  it('joins entries with a name header', () => {
    const combined = combineEntries([
      { name: 'a.md', content: 'Alpha' },
      { name: 'b.md', content: 'Beta' },
    ]);
    expect(combined).toBe('===== a.md =====\nAlpha\n\n===== b.md =====\nBeta');
  });

  it('returns an empty string for no entries', () => {
    expect(combineEntries([])).toBe('');
  });
});

describe('readFilesAsEntries', () => {
  it('filters to markdown/text/html files and reads their content', async () => {
    const files = [
      new File(['# Hello'], 'world.md', { type: 'text/markdown' }),
      new File(['<p>Hi</p>'], 'page.html', { type: 'text/html' }),
      new File(['ignored'], 'image.png', { type: 'image/png' }),
    ];
    const entries = await readFilesAsEntries(files);
    expect(entries.map((e) => e.name).sort()).toEqual(['page.html', 'world.md']);
    const world = entries.find((e) => e.name === 'world.md');
    expect(world.content).toBe('# Hello');
    const page = entries.find((e) => e.name === 'page.html');
    expect(page.content).toBe('Hi');
  });

  it('sorts entries by name', async () => {
    const files = [new File(['b'], 'b.txt'), new File(['a'], 'a.txt')];
    const entries = await readFilesAsEntries(files);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/fileImport.test.js`
Expected: FAIL(`fileImport.js`が存在しない)

- [ ] **Step 3: fileImport.jsを実装**

```js
const PLAIN_TEXT_RE = /\.(md|markdown|txt)$/i;
const HTML_RE = /\.html?$/i;

export function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
  doc.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  doc
    .querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, blockquote')
    .forEach((el) => el.insertAdjacentText('afterend', '\n'));
  const text = (doc.body ? doc.body.textContent : doc.textContent) || '';
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function readFilesAsEntries(fileList) {
  const files = Array.from(fileList).filter(
    (f) => PLAIN_TEXT_RE.test(f.name) || HTML_RE.test(f.name)
  );
  files.sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name)
  );
  const entries = await Promise.all(
    files.map(async (f) => {
      const raw = await f.text();
      const content = HTML_RE.test(f.name) ? htmlToText(raw) : raw;
      return { name: f.webkitRelativePath || f.name, content };
    })
  );
  return entries;
}

export function combineEntries(entries) {
  return entries.map((e) => `===== ${e.name} =====\n${e.content}`).join('\n\n');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/utils/fileImport.test.js`
Expected: PASS(6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/fileImport.js src/utils/fileImport.test.js
git commit -m "feat(frontend): extract file/folder import utilities"
```

---

## Task 7: src/api/client.js

**Files:**
- Create: `src/api/client.js`
- Create: `src/api/client.test.js`

**Interfaces:**
- Produces: `callClaude(body)` → `Promise<object>`(自前バックエンドの`/api/messages`へPOST)。`extractText(content)` → `string`。`extractToolUse(content)` → `object | undefined`。`parseJsonLoose(text)` → `object`。Task 9(`src/api/session.js`)が消費する。

- [ ] **Step 1: client.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { callClaude, extractText, extractToolUse, parseJsonLoose } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callClaude', () => {
  it('posts to /api/messages and returns the parsed json body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callClaude({ model: 'x' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/messages',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toEqual({ content: [] });
  });

  it('throws with the status and truncated body when the response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server exploded',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(callClaude({})).rejects.toThrow('API error 500: server exploded');
  });
});

describe('extractText', () => {
  it('joins text blocks and ignores other block types', () => {
    const content = [
      { type: 'text', text: 'line one' },
      { type: 'tool_use', name: 'roll_check' },
      { type: 'text', text: 'line two' },
    ];
    expect(extractText(content)).toBe('line one\nline two');
  });

  it('returns an empty string for null content', () => {
    expect(extractText(null)).toBe('');
  });
});

describe('extractToolUse', () => {
  it('finds the tool_use block', () => {
    const content = [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'roll_check' }];
    expect(extractToolUse(content)).toEqual({ type: 'tool_use', name: 'roll_check' });
  });

  it('returns undefined when there is no tool_use block', () => {
    expect(extractToolUse([{ type: 'text', text: 'x' }])).toBeUndefined();
  });
});

describe('parseJsonLoose', () => {
  it('parses raw JSON', () => {
    expect(parseJsonLoose('{"a": 1}')).toEqual({ a: 1 });
  });

  it('strips markdown code fences before parsing', () => {
    expect(parseJsonLoose('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('throws when no JSON object is found', () => {
    expect(() => parseJsonLoose('no json here')).toThrow('JSON not found in response');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/client.test.js`
Expected: FAIL(`client.js`が存在しない)

- [ ] **Step 3: client.jsを実装**

```js
export async function callClaude(body) {
  const res = await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export function extractText(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export function extractToolUse(content) {
  return (content || []).find((b) => b.type === 'tool_use');
}

export function parseJsonLoose(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON not found in response');
  return JSON.parse(cleaned.slice(start, end + 1));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/client.test.js`
Expected: PASS(8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/client.js src/api/client.test.js
git commit -m "feat(frontend): add Claude proxy client and response parsing helpers"
```

---

## Task 8: src/data/rulesets.js + src/api/prompts.js

**Files:**
- Create: `src/data/rulesets.js`
- Create: `src/data/rulesets.test.js`
- Create: `src/api/prompts.js`
- Create: `src/api/prompts.test.js`

**Interfaces:**
- Produces: `RULESETS`(配列、各要素`{ id, label, desc, hint }`)。`ROLL_TOOL`(Anthropic tool定義オブジェクト)。`buildSystemPrompt(session)` → `string`。
- Consumes: `RULESETS`は`prompts.js`が消費する。Task 9(`session.js`)とTask 14-16(画面)がこのタスクの出力を消費する。

- [ ] **Step 1: rulesets.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect } from 'vitest';
import { RULESETS } from './rulesets.js';

describe('RULESETS', () => {
  it('has 4 entries with unique ids', () => {
    expect(RULESETS).toHaveLength(4);
    const ids = RULESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('every entry has id/label/desc/hint fields', () => {
    for (const r of RULESETS) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('label');
      expect(r).toHaveProperty('desc');
      expect(r).toHaveProperty('hint');
    }
  });

  it('includes the simple ruleset with no hint', () => {
    const simple = RULESETS.find((r) => r.id === 'simple');
    expect(simple.hint).toBe('');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/data/rulesets.test.js`
Expected: FAIL(`rulesets.js`が存在しない)

- [ ] **Step 3: rulesets.jsを実装**

```js
export const RULESETS = [
  {
    id: 'simple',
    label: 'シンプル',
    desc: '判定は成功率%のみで統一。ルール色なし、テンポ重視。',
    hint: '',
  },
  {
    id: 'coc7e',
    label: 'CoC7e風',
    desc: 'クトゥルフ神話TRPG風。恐怖・異常事態でSAN値チェックを演出。',
    hint: '恐怖・異常事態の場面では適宜roll_checkでSAN値チェックを表現し、成功してもSAN減少の描写を加えること。',
  },
  {
    id: 'dnd5e',
    label: 'D&D5e風',
    desc: 'ファンタジー王道。戦闘のクリティカルを演出。',
    hint: '戦闘や罠ではクリティカル(会心/致命的失敗)を演出に反映すること。',
  },
  {
    id: 'gurps',
    label: 'GURPS風',
    desc: '汎用ルール寄り。失敗の代償を細かく描写。',
    hint: '判定失敗の程度に応じて代償(時間・資源・状況悪化)を具体的に描写すること。',
  },
];
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/data/rulesets.test.js`
Expected: PASS(3 tests)

- [ ] **Step 5: prompts.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect } from 'vitest';
import { ROLL_TOOL, buildSystemPrompt } from './prompts.js';

function makeSession(overrides = {}) {
  return {
    rulesetId: 'coc7e',
    world: { summary: '霧深い港町' },
    scenario: { raw: '## シナリオ概要\n失踪事件' },
    pc: { raw: 'PC名: アリス' },
    state: {
      current_scene: '波止場',
      flags: { met_npc_a: true },
      history_summary: 'これまでのあらすじ',
      recent_log: [{ role: 'player', text: '波止場を調べる' }],
    },
    ...overrides,
  };
}

describe('ROLL_TOOL', () => {
  it('declares check_label and success_percent as required inputs', () => {
    expect(ROLL_TOOL.name).toBe('roll_check');
    expect(ROLL_TOOL.input_schema.required).toEqual(['check_label', 'success_percent']);
  });
});

describe('buildSystemPrompt', () => {
  it('includes the world summary, scenario, pc sheet, and current scene', () => {
    const prompt = buildSystemPrompt(makeSession());
    expect(prompt).toContain('霧深い港町');
    expect(prompt).toContain('失踪事件');
    expect(prompt).toContain('PC名: アリス');
    expect(prompt).toContain('波止場');
  });

  it('includes the matching ruleset hint', () => {
    const prompt = buildSystemPrompt(makeSession({ rulesetId: 'coc7e' }));
    expect(prompt).toContain('SAN値チェック');
  });

  it('falls back to the simple ruleset when rulesetId is unknown', () => {
    const prompt = buildSystemPrompt(makeSession({ rulesetId: 'unknown' }));
    expect(prompt).toContain('特別な演出指定なし。');
  });

  it('formats flags and falls back to placeholders when empty', () => {
    const prompt = buildSystemPrompt(makeSession({ state: { current_scene: 'x', flags: {}, history_summary: '', recent_log: [] } }));
    expect(prompt).toContain('既知フラグ: (なし)');
    expect(prompt).toContain('物語要約: (まだなし)');
    expect(prompt).toContain('直近のログ\n(まだなし)');
  });
});
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npx vitest run src/api/prompts.test.js`
Expected: FAIL(`prompts.js`が存在しない)

- [ ] **Step 7: prompts.jsを実装**

```js
import { RULESETS } from '../data/rulesets.js';

export const ROLL_TOOL = {
  name: 'roll_check',
  description:
    '行動の結果が不確実な場合に判定を行う。判定は必ずこのツールを介して実行し、結果を自分で決めないこと。',
  input_schema: {
    type: 'object',
    properties: {
      check_label: {
        type: 'string',
        description: '判定の内容(例:「崖を登る」「NPCを説得する」)',
      },
      success_percent: {
        type: 'integer',
        description: 'この状況における成功確率(0-100)。PCの能力・状況・難易度を踏まえて自分で設定する。',
      },
    },
    required: ['check_label', 'success_percent'],
  },
};

export function buildSystemPrompt(session) {
  const rs = RULESETS.find((r) => r.id === session.rulesetId) || RULESETS[0];
  const flags = session.state.flags || {};
  const flagsText =
    Object.entries(flags)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || '(なし)';
  const recentLog =
    (session.state.recent_log || [])
      .map((l) => `${l.role === 'player' ? 'PL' : 'GM'}: ${l.text}`)
      .join('\n') || '(まだなし)';

  return `あなたはTRPGのGM。以下の設定に従い物語を進行する。プレイヤーが楽しめるよう、緊迫感や盛り上がりの演出を大事にすること。

# 世界観
${session.world.summary}

# シナリオ
${session.scenario.raw}
上記のうち「GM専用情報」節は、物語内で自然に明かされた場合を除き、プレイヤーへの出力に絶対含めないこと。

# PC設定
${session.pc.raw}

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

- [ ] **Step 8: テストが通ることを確認**

Run: `npx vitest run src/api/prompts.test.js`
Expected: PASS(5 tests)

- [ ] **Step 9: Commit**

```bash
git add src/data/rulesets.js src/data/rulesets.test.js src/api/prompts.js src/api/prompts.test.js
git commit -m "feat(frontend): extract ruleset data and system prompt builder"
```

---

## Task 9: src/api/session.js

**Files:**
- Create: `src/api/session.js`
- Create: `src/api/session.test.js`

**Interfaces:**
- Consumes: `callClaude, extractText, extractToolUse, parseJsonLoose`(`src/api/client.js`, Task 7), `ROLL_TOOL, buildSystemPrompt`(`src/api/prompts.js`, Task 8), `evaluateRoll`(`src/engine/dice.js`, Task 5)
- Produces: `summarizeWorld(raw)` → `Promise<string>`。`generateScenario(genre, pcRaw, worldSummary)` → `Promise<string>`。`takeTurn(session, playerText)` → `Promise<{ result, roll }>`。Task 15(`Setup.jsx`)と Task 16(`Play.jsx`)が消費する。

- [ ] **Step 1: session.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { summarizeWorld, generateScenario, takeTurn } from './session.js';
import * as client from './client.js';

function makeSession(overrides = {}) {
  return {
    rulesetId: 'simple',
    world: { summary: 'x' },
    scenario: { raw: 'y' },
    pc: { raw: 'z' },
    state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('summarizeWorld', () => {
  it('returns the trimmed text of the response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({ content: [{ type: 'text', text: '  要約結果  ' }] });
    expect(await summarizeWorld('生の世界観テキスト')).toBe('要約結果');
  });
});

describe('generateScenario', () => {
  it('returns the trimmed text of the response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({ content: [{ type: 'text', text: '## シナリオ概要\n本文' }] });
    const scenario = await generateScenario('推理物', 'PC設定', '世界観要約');
    expect(scenario).toBe('## シナリオ概要\n本文');
  });
});

describe('takeTurn', () => {
  it('returns the parsed result without a roll when no tool_use happens', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: '{"narrative": "静かな朝。", "state_update": {}, "choices": []}' }],
    });

    const { result, roll } = await takeTurn(makeSession(), '周りを見渡す');

    expect(result.narrative).toBe('静かな朝。');
    expect(roll).toBeNull();
  });

  it('resolves a roll_check tool_use and sends the result back for the final narrative', async () => {
    const toolUseResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'roll_check',
          input: { check_label: '崖を登る', success_percent: 50 },
        },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "登り切った。", "state_update": {}, "choices": []}' }],
    };
    const callClaudeMock = vi
      .spyOn(client, 'callClaude')
      .mockResolvedValueOnce(toolUseResponse)
      .mockResolvedValueOnce(finalResponse);
    vi.spyOn(Math, 'random').mockReturnValue(0); // roll = 1 -> success

    const { result, roll } = await takeTurn(makeSession(), '崖を登る');

    expect(result.narrative).toBe('登り切った。');
    expect(roll.check_label).toBe('崖を登る');
    expect(roll.success).toBe(true);
    expect(callClaudeMock).toHaveBeenCalledTimes(2);
    const secondCallMessages = callClaudeMock.mock.calls[1][0].messages;
    expect(secondCallMessages.at(-1).content[0].type).toBe('tool_result');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/session.test.js`
Expected: FAIL(`session.js`が存在しない)

- [ ] **Step 3: session.jsを実装**

```js
import { callClaude, extractText, extractToolUse, parseJsonLoose } from './client.js';
import { ROLL_TOOL, buildSystemPrompt } from './prompts.js';
import { evaluateRoll } from '../engine/dice.js';

export async function summarizeWorld(raw) {
  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system:
      '以下の世界観資料を、TRPGのGMが毎ターン参照できる程度の要約(600〜900字)に圧縮せよ。地名・組織・時代背景などキーとなる設定は保持すること。説明文やコードブロック記号は付けず、要約文のみを出力すること。',
    messages: [{ role: 'user', content: raw }],
  });
  return extractText(data.content).trim();
}

export async function generateScenario(genre, pcRaw, worldSummary) {
  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: `TRPGシナリオを作成せよ。

# ジャンル要望
${genre || '(指定なし。世界観に合う自由なジャンルでよい)'}

# 世界観
${worldSummary || '(未設定。ジャンルに応じて自由に構築してよい)'}

# PC設定
${pcRaw || '(未設定)'}

以下の見出し構成のMarkdownで出力せよ(コードブロック記号やコメントは付けない):
## シナリオ概要
(プレイヤーに見せてよい導入)
## GM専用情報
(黒幕・真相・隠しフラグなど、プレイヤーには開示しない情報)
## 章構成
(章ごとの見出しと概要、分岐条件を簡潔に。最終章には climax とわかる一文を添える)

PCのgoal/bondsに関連する引き(hook)を導入部に必ず含めること。`,
    messages: [{ role: 'user', content: 'シナリオを生成せよ。' }],
  });
  return extractText(data.content).trim();
}

export async function takeTurn(session, playerText) {
  const system = buildSystemPrompt(session);
  let messages = [{ role: 'user', content: playerText }];
  const base = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system,
    tools: [ROLL_TOOL],
  };

  let data = await callClaude({ ...base, messages });
  let roll = null;

  const toolUse = extractToolUse(data.content);
  if (toolUse && toolUse.name === 'roll_check') {
    roll = evaluateRoll(toolUse.input.success_percent);
    roll.check_label = toolUse.input.check_label;

    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              roll: roll.roll,
              success: roll.success,
              degree: roll.degree,
            }),
          },
        ],
      },
    ];
    data = await callClaude({ ...base, messages });
  }

  const text = extractText(data.content);
  const result = parseJsonLoose(text);
  return { result, roll };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/session.test.js`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/session.js src/api/session.test.js
git commit -m "feat(frontend): add turn orchestration (summarizeWorld/generateScenario/takeTurn)"
```

---

## Task 10: src/storage(IndexedDB永続化)

**Files:**
- Create: `src/storage/indexedDbStore.js`
- Create: `src/storage/index.js`
- Create: `src/storage/index.test.js`

**Interfaces:**
- Produces: `isStorageAvailable()` → `Promise<boolean>`。`listSessions()` → `Promise<Session[]>`(`updatedAt`降順)。`getSession(id)` → `Promise<Session | null>`。`saveSession(session)` → `Promise<boolean>`。Task 14-16(画面)とTask 17(`App.jsx`)が消費する。`DB_NAME`(テスト用にexport)。

- [ ] **Step 1: index.test.jsを書く(失敗する状態)**

`src/test/setup.js`(Task 1)がグローバルに`fake-indexeddb/auto`を読み込んでいるため、テストファイル側での追加importは不要。テスト間でDBをリセットするため`idb`の`deleteDB`を使う。

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { deleteDB } from 'idb';
import { isStorageAvailable, listSessions, getSession, saveSession } from './index.js';
import { DB_NAME } from './indexedDbStore.js';

beforeEach(async () => {
  await deleteDB(DB_NAME);
});

describe('client session storage', () => {
  it('reports storage as available', async () => {
    expect(await isStorageAvailable()).toBe(true);
  });

  it('returns null for a missing session', async () => {
    expect(await getSession('missing')).toBeNull();
  });

  it('saves and retrieves a session by id', async () => {
    await saveSession({ id: 's1', title: 'Test', updatedAt: 1 });
    expect(await getSession('s1')).toMatchObject({ id: 's1', title: 'Test' });
  });

  it('lists sessions sorted by updatedAt descending, excluding the internal ping key', async () => {
    await saveSession({ id: 's1', title: 'Old', updatedAt: 1 });
    await saveSession({ id: 's2', title: 'New', updatedAt: 2 });
    const sessions = await listSessions();
    expect(sessions.map((s) => s.id)).toEqual(['s2', 's1']);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/storage/index.test.js`
Expected: FAIL(`index.js`/`indexedDbStore.js`が存在しない)

- [ ] **Step 3: indexedDbStore.jsを実装**

```js
import { openDB } from 'idb';

export const DB_NAME = 'trpg-gm-app';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';

function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
    },
  });
}

export async function putSession(session) {
  const db = await getDb();
  await db.put(STORE_SESSIONS, session);
}

export async function getSessionById(id) {
  const db = await getDb();
  return (await db.get(STORE_SESSIONS, id)) || null;
}

export async function getAllSessions() {
  const db = await getDb();
  return db.getAll(STORE_SESSIONS);
}
```

- [ ] **Step 4: index.jsを実装**

```js
import { putSession, getSessionById, getAllSessions } from './indexedDbStore.js';

const PING_ID = '__ping__';

export async function isStorageAvailable() {
  try {
    if (!('indexedDB' in window)) return false;
    await putSession({ id: PING_ID, updatedAt: Date.now() });
    const r = await getSessionById(PING_ID);
    return !!r;
  } catch (e) {
    console.error('storage availability check failed', e);
    return false;
  }
}

export async function listSessions() {
  try {
    const all = await getAllSessions();
    return all
      .filter((s) => s.id !== PING_ID)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) {
    console.error('listSessions failed', e);
    return [];
  }
}

export async function getSession(id) {
  try {
    return await getSessionById(id);
  } catch (e) {
    console.error('getSession failed', e);
    return null;
  }
}

export async function saveSession(session) {
  try {
    await putSession(session);
    return true;
  } catch (e) {
    console.error('saveSession failed', e);
    return false;
  }
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/storage/index.test.js`
Expected: PASS(4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/storage/indexedDbStore.js src/storage/index.js src/storage/index.test.js
git commit -m "feat(frontend): add IndexedDB session storage (replaces window.storage)"
```

---

## Task 11: src/theme.js

**Files:**
- Create: `src/theme.js`
- Create: `src/theme.test.jsx`

**Interfaces:**
- Produces: `COLORS`, `F_DISPLAY`, `F_BODY`, `F_MONO`, `inputStyle`(定数)。`useGoogleFonts()`(Reactフック、`<link id="trpg-fonts">`をheadに追加する)。Task 12(UIコンポーネント)、Task 14-17(画面/App)が消費する。

- [ ] **Step 1: theme.test.jsxを書く(失敗する状態)**

```jsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle, useGoogleFonts } from './theme.js';

function FontProbe() {
  useGoogleFonts();
  return null;
}

beforeEach(() => {
  document.getElementById('trpg-fonts')?.remove();
});

describe('theme constants', () => {
  it('exposes color and font tokens', () => {
    expect(COLORS.ink).toBe('#1F2A38');
    expect(F_DISPLAY).toContain('Special Elite');
    expect(F_BODY).toContain('Source Serif 4');
    expect(F_MONO).toContain('IBM Plex Mono');
    expect(inputStyle.fontFamily).toBe(F_BODY);
  });
});

describe('useGoogleFonts', () => {
  it('appends a stylesheet link to the document head once', () => {
    render(<FontProbe />);
    render(<FontProbe />);
    const links = document.head.querySelectorAll('#trpg-fonts');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toContain('fonts.googleapis.com');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/theme.test.jsx`
Expected: FAIL(`theme.js`が存在しない)

- [ ] **Step 3: theme.jsを実装**

```js
import { useEffect } from 'react';

export const COLORS = {
  paper: '#EDE6D6',
  paperDark: '#E2D9C3',
  card: '#F6F1E6',
  ink: '#1F2A38',
  inkSoft: '#3B372E',
  brass: '#9C7A45',
  brassDark: '#7C6136',
  stamp: '#A13D3D',
  stampDark: '#7E2E2E',
  line: '#C9BFA3',
  faint: '#B8AE93',
};

const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Special+Elite&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500&display=swap';

export const F_DISPLAY = "'Special Elite', 'Courier New', monospace";
export const F_BODY = "'Source Serif 4', Georgia, serif";
export const F_MONO = "'IBM Plex Mono', monospace";

export const inputStyle = {
  width: '100%',
  fontFamily: F_BODY,
  fontSize: 14,
  color: COLORS.inkSoft,
  background: COLORS.paper,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 4,
  padding: '10px 12px',
  outline: 'none',
  boxSizing: 'border-box',
};

export function useGoogleFonts() {
  useEffect(() => {
    if (document.getElementById('trpg-fonts')) return;
    const link = document.createElement('link');
    link.id = 'trpg-fonts';
    link.rel = 'stylesheet';
    link.href = FONT_LINK;
    document.head.appendChild(link);
  }, []);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/theme.test.jsx`
Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/theme.js src/theme.test.jsx
git commit -m "feat(frontend): extract design tokens and useGoogleFonts hook"
```

---

## Task 12: src/components/ui/{Card,Button,Field,Stamp}.jsx

**Files:**
- Create: `src/components/ui/Card.jsx`
- Create: `src/components/ui/Card.test.jsx`
- Create: `src/components/ui/Button.jsx`
- Create: `src/components/ui/Button.test.jsx`
- Create: `src/components/ui/Field.jsx`
- Create: `src/components/ui/Field.test.jsx`
- Create: `src/components/ui/Stamp.jsx`
- Create: `src/components/ui/Stamp.test.jsx`

**Interfaces:**
- Consumes: `COLORS, F_DISPLAY, F_BODY, F_MONO`(`src/theme.js`, Task 11)
- Produces: `Card`, `Button`, `Field`, `Stamp`(デフォルトエクスポートのReactコンポーネント)。Task 13(`FileImportRow.jsx`)、Task 14-16(画面)が消費する。

- [ ] **Step 1: Card.test.jsxを書く(失敗する状態)**

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Card from './Card.jsx';

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>hello</Card>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/ui/Card.test.jsx`
Expected: FAIL(`Card.jsx`が存在しない)

- [ ] **Step 3: Card.jsxを実装**

```jsx
import { COLORS } from '../../theme.js';

export default function Card({ children, style }) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 6,
        boxShadow: '0 1px 0 rgba(31,42,56,0.06)',
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Card.test.jsxが通ることを確認**

Run: `npx vitest run src/components/ui/Card.test.jsx`
Expected: PASS(1 test)

- [ ] **Step 5: Button.test.jsxを書く(失敗する状態)**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from './Button.jsx';

describe('Button', () => {
  it('calls onClick when enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByText('Go'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Go
      </Button>
    );
    fireEvent.click(screen.getByText('Go'));
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npx vitest run src/components/ui/Button.test.jsx`
Expected: FAIL(`Button.jsx`が存在しない)

- [ ] **Step 7: Button.jsxを実装**

```jsx
import { COLORS, F_MONO } from '../../theme.js';

export default function Button({ children, onClick, disabled, variant = 'primary', style }) {
  const base = {
    fontFamily: F_MONO,
    fontSize: 13,
    letterSpacing: 0.5,
    padding: '10px 16px',
    borderRadius: 4,
    cursor: disabled ? 'default' : 'pointer',
    border: 'none',
    opacity: disabled ? 0.5 : 1,
    transition: 'transform 0.1s ease',
  };
  const variants = {
    primary: { background: COLORS.ink, color: COLORS.paper },
    brass: { background: COLORS.brass, color: COLORS.paper },
    ghost: {
      background: 'transparent',
      color: COLORS.ink,
      border: `1px solid ${COLORS.line}`,
    },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = 'scale(0.97)';
      }}
      onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 8: テストが通ることを確認**

Run: `npx vitest run src/components/ui/Button.test.jsx`
Expected: PASS(2 tests)

- [ ] **Step 9: Field.test.jsxを書く(失敗する状態)**

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Field from './Field.jsx';

describe('Field', () => {
  it('renders label, hint, and children', () => {
    render(
      <Field label="世界観" hint="資料を貼る">
        <input aria-label="input" />
      </Field>
    );
    expect(screen.getByText('世界観')).toBeInTheDocument();
    expect(screen.getByText('資料を貼る')).toBeInTheDocument();
    expect(screen.getByLabelText('input')).toBeInTheDocument();
  });

  it('omits the hint element when no hint is given', () => {
    render(<Field label="世界観">child</Field>);
    expect(screen.queryByText('資料を貼る')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 10: テストが失敗することを確認**

Run: `npx vitest run src/components/ui/Field.test.jsx`
Expected: FAIL(`Field.jsx`が存在しない)

- [ ] **Step 11: Field.jsxを実装**

```jsx
import { COLORS, F_DISPLAY, F_BODY } from '../../theme.js';

export default function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontFamily: F_DISPLAY,
          fontSize: 13,
          color: COLORS.brassDark,
          marginBottom: 6,
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      {hint && (
        <div
          style={{
            fontFamily: F_BODY,
            fontSize: 12,
            color: COLORS.faint,
            marginBottom: 6,
          }}
        >
          {hint}
        </div>
      )}
      {children}
    </div>
  );
}
```

- [ ] **Step 12: テストが通ることを確認**

Run: `npx vitest run src/components/ui/Field.test.jsx`
Expected: PASS(2 tests)

- [ ] **Step 13: Stamp.test.jsxを書く(失敗する状態)**

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Stamp from './Stamp.jsx';

describe('Stamp', () => {
  it('renders nothing when roll is null', () => {
    const { container } = render(<Stamp roll={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the check label, roll numbers, and success label', () => {
    render(
      <Stamp roll={{ check_label: '崖を登る', roll: 42, success_percent: 60, success: true, degree: 'success' }} />
    );
    expect(screen.getByText('崖を登る')).toBeInTheDocument();
    expect(screen.getByText('42/60')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
  });

  it('labels a fumble as 大失敗', () => {
    render(
      <Stamp roll={{ check_label: 'x', roll: 99, success_percent: 60, success: false, degree: 'fumble' }} />
    );
    expect(screen.getByText('大失敗')).toBeInTheDocument();
  });
});
```

- [ ] **Step 14: テストが失敗することを確認**

Run: `npx vitest run src/components/ui/Stamp.test.jsx`
Expected: FAIL(`Stamp.jsx`が存在しない)

- [ ] **Step 15: Stamp.jsxを実装**

```jsx
import { COLORS, F_MONO } from '../../theme.js';

export default function Stamp({ roll }) {
  if (!roll) return null;
  const label =
    roll.degree === 'critical'
      ? '会心'
      : roll.degree === 'fumble'
      ? '大失敗'
      : roll.success
      ? '成功'
      : '失敗';
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        transform: 'rotate(-3deg)',
        border: `2px solid ${COLORS.stamp}`,
        color: COLORS.stamp,
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
        {roll.roll}/{roll.success_percent}
      </span>
      <span style={{ opacity: 0.6 }}>|</span>
      <span>{label}</span>
    </div>
  );
}
```

- [ ] **Step 16: テストが通ることを確認**

Run: `npx vitest run src/components/ui/Stamp.test.jsx`
Expected: PASS(3 tests)

- [ ] **Step 17: Commit**

```bash
git add src/components/ui
git commit -m "feat(frontend): extract Card/Button/Field/Stamp UI atoms"
```

---

## Task 13: src/components/FileImportRow.jsx

**Files:**
- Create: `src/components/FileImportRow.jsx`
- Create: `src/components/FileImportRow.test.jsx`

**Interfaces:**
- Consumes: `Button`(Task 12), `readFilesAsEntries`(`src/utils/fileImport.js`, Task 6)
- Produces: `FileImportRow`(デフォルトエクスポート、props: `entries, onImport, onClear`)。Task 15(`Setup.jsx`)が消費する。

- [ ] **Step 1: FileImportRow.test.jsxを書く(失敗する状態)**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import FileImportRow from './FileImportRow.jsx';

describe('FileImportRow', () => {
  it('shows import buttons and no summary when there are no entries', () => {
    render(<FileImportRow entries={[]} onImport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText('ファイルを選択(複数可)')).toBeInTheDocument();
    expect(screen.getByText('フォルダを選択')).toBeInTheDocument();
    expect(screen.queryByText(/読み込み済み/)).not.toBeInTheDocument();
  });

  it('shows a summary and clear button when entries exist', () => {
    render(<FileImportRow entries={[{ name: 'a.md', content: 'x' }]} onImport={vi.fn()} onClear={vi.fn()} />);
    expect(screen.getByText(/読み込み済み\(1件\): a\.md/)).toBeInTheDocument();
    expect(screen.getByText('インポート内容をクリア')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/FileImportRow.test.jsx`
Expected: FAIL(`FileImportRow.jsx`が存在しない)

- [ ] **Step 3: FileImportRow.jsxを実装**

```jsx
import { useRef } from 'react';
import Button from './ui/Button.jsx';
import { readFilesAsEntries } from '../utils/fileImport.js';
import { COLORS, F_MONO } from '../theme.js';

export default function FileImportRow({ entries, onImport, onClear }) {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  async function handleFiles(e) {
    const list = e.target.files;
    if (list && list.length > 0) {
      const entries = await readFilesAsEntries(list);
      onImport(entries);
    }
    e.target.value = '';
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={() => fileInputRef.current?.click()}>
          ファイルを選択(複数可)
        </Button>
        <Button variant="ghost" onClick={() => folderInputRef.current?.click()}>
          フォルダを選択
        </Button>
        {entries.length > 0 && (
          <Button variant="ghost" onClick={onClear}>
            インポート内容をクリア
          </Button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.markdown,.txt,.html,.htm"
        style={{ display: 'none' }}
        onChange={handleFiles}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory="true"
        directory="true"
        multiple
        style={{ display: 'none' }}
        onChange={handleFiles}
      />
      {entries.length > 0 && (
        <div
          style={{
            marginTop: 8,
            fontFamily: F_MONO,
            fontSize: 11,
            color: COLORS.brassDark,
          }}
        >
          読み込み済み({entries.length}件): {entries.map((e) => e.name).join(', ')}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/components/FileImportRow.test.jsx`
Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/FileImportRow.jsx src/components/FileImportRow.test.jsx
git commit -m "feat(frontend): extract FileImportRow component"
```

---

## Task 14: src/screens/Home.jsx

**Files:**
- Create: `src/screens/Home.jsx`
- Create: `src/screens/Home.test.jsx`

**Interfaces:**
- Consumes: `COLORS, F_DISPLAY, F_BODY, F_MONO`(Task 11), `Card, Button`(Task 12)
- Produces: `Home`(デフォルトエクスポート、props: `sessions, storageOk, onNew, onContinue`)。**注意**: 旧実装の`index`(サマリー配列)ではなく、`sessions`(完全なセッションオブジェクトの配列)を受け取る。一覧の最終行は`session.log`から動的に算出する(旧`sessions_index`の`lastLine`はTask 10で廃止済み)。Task 17(`App.jsx`)が消費する。

- [ ] **Step 1: Home.test.jsxを書く(失敗する状態)**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Home from './Home.jsx';

describe('Home', () => {
  it('shows the storage warning when storage is unavailable', () => {
    render(<Home sessions={[]} storageOk={false} onNew={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.getByText(/保存機能\(IndexedDB\)が使えていない/)).toBeInTheDocument();
  });

  it('does not show the warning when storage is available', () => {
    render(<Home sessions={[]} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} />);
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
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.getByText('セッションA')).toBeInTheDocument();
    expect(screen.getByText(/森/)).toBeInTheDocument();
    expect(screen.getByText(/森の奥から物音がした。/)).toBeInTheDocument();
  });

  it('shows a placeholder last line when the session has no log yet', () => {
    const sessions = [{ id: 's1', title: 'セッションB', updatedAt: 1, state: {}, log: [] }];
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} />);
    expect(screen.getByText('(まだ進行なし)')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: FAIL(`Home.jsx`が存在しない)

- [ ] **Step 3: Home.jsxを実装**

```jsx
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';

function lastLineOf(session) {
  const lastGm = [...session.log].reverse().find((e) => e.role === 'gm');
  if (!lastGm) return '(まだ進行なし)';
  return lastGm.text.slice(0, 60) + (lastGm.text.length > 60 ? '…' : '');
}

export default function Home({ sessions, storageOk, onNew, onContinue }) {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px' }}>
      <h1
        style={{
          fontFamily: F_DISPLAY,
          fontSize: 32,
          color: COLORS.ink,
          marginBottom: 4,
          letterSpacing: 1,
        }}
      >
        GM's Desk
      </h1>
      <p
        style={{
          fontFamily: F_BODY,
          color: COLORS.inkSoft,
          fontSize: 14,
          marginBottom: 32,
        }}
      >
        AIがGMを務めるインタラクティブ物語
      </p>

      {!storageOk && (
        <div
          style={{
            fontFamily: F_MONO,
            fontSize: 12,
            color: COLORS.stamp,
            border: `1px solid ${COLORS.stamp}`,
            borderRadius: 4,
            padding: '10px 12px',
            marginBottom: 24,
          }}
        >
          この環境では保存機能(IndexedDB)が使えていない。「続きから再開」は動作せず、ページを離れると進行が失われる。ブラウザのコンソールにエラー詳細が出ている。
        </div>
      )}

      <Button variant="brass" onClick={onNew} style={{ marginBottom: 32 }}>
        + 新規プレイ
      </Button>

      {sessions.length > 0 && (
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
            {sessions
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((s) => (
                <Card key={s.id} style={{ cursor: 'pointer' }}>
                  <div
                    onClick={() => onContinue(s.id)}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 8,
                          marginBottom: 4,
                        }}
                      >
                        <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>
                          {s.title}
                        </div>
                        {s.state?.current_scene && (
                          <div
                            style={{
                              fontFamily: F_MONO,
                              fontSize: 11,
                              color: COLORS.brassDark,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            シーン: {s.state.current_scene}
                            {typeof s.state.turn_count === 'number' ? ` / ${s.state.turn_count}手` : ''}
                          </div>
                        )}
                      </div>
                      <div
                        style={{
                          fontFamily: F_BODY,
                          fontSize: 13,
                          color: COLORS.inkSoft,
                          opacity: 0.8,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {lastLineOf(s)}
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: F_MONO,
                        fontSize: 12,
                        color: COLORS.brass,
                        alignSelf: 'center',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      続ける →
                    </div>
                  </div>
                </Card>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: PASS(4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "feat(frontend): add Home screen backed by full session list"
```

---

## Task 15: src/screens/Setup.jsx

**Files:**
- Create: `src/screens/Setup.jsx`
- Create: `src/screens/Setup.test.jsx`

**Interfaces:**
- Consumes: `COLORS, F_MONO, F_BODY, F_DISPLAY, inputStyle`(Task 11), `RULESETS`(Task 8), `summarizeWorld, generateScenario`(Task 9), `Card, Button, Field`(Task 12), `FileImportRow`(Task 13), `combineEntries`(Task 6)
- Produces: `Setup`(デフォルトエクスポート、props: `onStart, onCancel`)。`onStart`に渡すsessionオブジェクトの形は`{ id, title, world: {raw, summary}, scenario: {raw}, rulesetId, pc: {raw}, state: {current_scene, flags, history_summary, recent_log, turn_count}, log, updatedAt }`。Task 17(`App.jsx`)が消費する。

- [ ] **Step 1: Setup.test.jsxを書く(失敗する状態)**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Setup from './Setup.jsx';

describe('Setup', () => {
  it('renders the first wizard step (世界観)', () => {
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('世界観')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/世界観の資料を貼る/)).toBeInTheDocument();
  });

  it('shows the step indicator for all 5 steps', () => {
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    // ステップタブ("1. 世界観"等)とForm 0のField labelの両方が"世界観"を含みうるため、
    // 厳密一致のgetByTextではなく部分一致のgetAllByTextで存在確認する。
    ['世界観', 'シナリオ', 'ルール', 'PC', '確認'].forEach((label) => {
      expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: FAIL(`Setup.jsx`が存在しない)

- [ ] **Step 3: Setup.jsxを実装**

```jsx
import { useState } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../theme.js';
import { RULESETS } from '../data/rulesets.js';
import { summarizeWorld, generateScenario } from '../api/session.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Field from '../components/ui/Field.jsx';
import FileImportRow from '../components/FileImportRow.jsx';
import { combineEntries } from '../utils/fileImport.js';

export default function Setup({ onStart, onCancel }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [worldRaw, setWorldRaw] = useState('');
  const [worldFiles, setWorldFiles] = useState([]);
  const [scenarioMode, setScenarioMode] = useState('paste'); // paste | generate
  const [scenarioRaw, setScenarioRaw] = useState('');
  const [scenarioFiles, setScenarioFiles] = useState([]);
  const [genre, setGenre] = useState('');
  const [rulesetId, setRulesetId] = useState('simple');
  const [pcRaw, setPcRaw] = useState('');
  const [title, setTitle] = useState('');

  const steps = ['世界観', 'シナリオ', 'ルール', 'PC', '確認'];

  async function handleStart() {
    setBusy(true);
    setError('');
    try {
      const worldSummary =
        worldRaw.length > 1500 ? await summarizeWorld(worldRaw) : worldRaw || '(特に指定なし)';

      let scenario = scenarioRaw;
      if (scenarioMode === 'generate') {
        scenario = await generateScenario(genre, pcRaw, worldSummary);
      }
      if (!scenario) {
        scenario = await generateScenario('自由なジャンルで', pcRaw, worldSummary);
      }

      const session = {
        id: 'sess_' + Date.now(),
        title: title || 'セッション ' + new Date().toLocaleDateString('ja-JP'),
        world: { raw: worldRaw, summary: worldSummary },
        scenario: { raw: scenario },
        rulesetId,
        pc: { raw: pcRaw || '(自由記述なし)' },
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
    } catch (e) {
      console.error(e);
      setError('開始処理に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 20px' }}>
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 24,
          fontFamily: F_MONO,
          fontSize: 11,
          color: COLORS.faint,
        }}
      >
        {steps.map((s, i) => (
          <div
            key={s}
            style={{
              padding: '4px 10px',
              borderRadius: 3,
              background: i === step ? COLORS.ink : 'transparent',
              color: i === step ? COLORS.paper : COLORS.faint,
              border: `1px solid ${i === step ? COLORS.ink : COLORS.line}`,
            }}
          >
            {i + 1}. {s}
          </div>
        ))}
      </div>

      <Card style={{ minHeight: 320 }}>
        {step === 0 && (
          <Field
            label="世界観"
            hint="資料を貼るか、分割済みファイル(またはフォルダ)をそのまま取り込める。長ければ自動で要約してから使う。未入力ならAIが自由に構築する。"
          >
            <FileImportRow
              entries={worldFiles}
              onImport={(entries) => {
                const merged = [...worldFiles, ...entries];
                setWorldFiles(merged);
                setWorldRaw(combineEntries(merged));
              }}
              onClear={() => {
                setWorldFiles([]);
                setWorldRaw('');
              }}
            />
            <textarea
              value={worldRaw}
              onChange={(e) => setWorldRaw(e.target.value)}
              rows={10}
              placeholder="世界観の資料を貼る、ファイルを取り込む、または空欄のままでよい"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
        )}

        {step === 1 && (
          <>
            <Field label="シナリオの用意方法">
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  variant={scenarioMode === 'paste' ? 'primary' : 'ghost'}
                  onClick={() => setScenarioMode('paste')}
                >
                  自分で用意する
                </Button>
                <Button
                  variant={scenarioMode === 'generate' ? 'primary' : 'ghost'}
                  onClick={() => setScenarioMode('generate')}
                >
                  AIに作ってもらう
                </Button>
              </div>
            </Field>
            {scenarioMode === 'paste' ? (
              <Field label="シナリオ本文" hint="分割済みファイル(章ごと等)をそのまま取り込める。">
                <FileImportRow
                  entries={scenarioFiles}
                  onImport={(entries) => {
                    const merged = [...scenarioFiles, ...entries];
                    setScenarioFiles(merged);
                    setScenarioRaw(combineEntries(merged));
                  }}
                  onClear={() => {
                    setScenarioFiles([]);
                    setScenarioRaw('');
                  }}
                />
                <textarea
                  value={scenarioRaw}
                  onChange={(e) => setScenarioRaw(e.target.value)}
                  rows={8}
                  placeholder="シナリオ本文を貼る、またはファイルを取り込む"
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
                />
              </Field>
            ) : (
              <Field label="やりたいジャンル・要望" hint="例:「推理物がしたい」「洋館からの脱出」等">
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="例: 冒険者らしい探索と戦闘がしたい"
                  style={inputStyle}
                />
              </Field>
            )}
          </>
        )}

        {step === 2 && (
          <Field label="ルール性向" hint="判定は成功率%に統一して実行する(どのルールでも公平に判定できる)。ここでの選択は主に演出の色付けに使う。">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {RULESETS.map((r) => (
                <Card
                  key={r.id}
                  style={{
                    cursor: 'pointer',
                    borderColor: rulesetId === r.id ? COLORS.brass : COLORS.line,
                    background: rulesetId === r.id ? COLORS.paperDark : COLORS.card,
                  }}
                >
                  <div onClick={() => setRulesetId(r.id)}>
                    <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>
                      {r.label}
                    </div>
                    <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft }}>
                      {r.desc}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </Field>
        )}

        {step === 3 && (
          <Field
            label="PC設定"
            hint="自由記述でよい。goal(目標)・bonds(因縁・関係)を書いておくと、GMがそれを絡めた展開を作りやすくなる。"
          >
            <textarea
              value={pcRaw}
              onChange={(e) => setPcRaw(e.target.value)}
              rows={8}
              placeholder={'PC名: ...\n能力値・スキル: ...\ngoal: ...\nbonds: ...'}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
        )}

        {step === 4 && (
          <>
            <Field label="セッション名">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="任意(未入力なら日付から自動生成)"
                style={inputStyle}
              />
            </Field>
            <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
              世界観・シナリオ・ルール・PCの準備ができたらゲームを開始する。
              {worldRaw.length > 1500 && ' 世界観は長いため開始時に自動で要約する。'}
              {scenarioMode === 'generate' && ' シナリオはAIが開始時に生成する。'}
            </div>
            {error && (
              <div style={{ color: COLORS.stamp, fontSize: 13, marginTop: 12 }}>{error}</div>
            )}
          </>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <Button variant="ghost" onClick={step === 0 ? onCancel : () => setStep(step - 1)}>
          {step === 0 ? 'やめる' : '戻る'}
        </Button>
        {step < steps.length - 1 ? (
          <Button variant="primary" onClick={() => setStep(step + 1)}>
            次へ
          </Button>
        ) : (
          <Button variant="brass" onClick={handleStart} disabled={busy}>
            {busy ? '準備中…' : 'ゲーム開始'}
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/Setup.jsx src/screens/Setup.test.jsx
git commit -m "feat(frontend): add Setup wizard screen"
```

---

## Task 16: src/screens/Play.jsx

**Files:**
- Create: `src/screens/Play.jsx`
- Create: `src/screens/Play.test.jsx`

**Interfaces:**
- Consumes: `COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle`(Task 11), `takeTurn`(Task 9), `saveSession`(Task 10), `Card, Button, Stamp`(Task 12)
- Produces: `Play`(デフォルトエクスポート、props: `session, setSession, onExit`)。**注意**: 旧実装にあった`loadSessionIndex`/`saveSessionIndex`の呼び出しは削除し、`saveSession(updated)`のみ呼ぶ(Task 10でセッション一覧はIndexedDBの`getAll()`から動的に導出する設計に変更したため)。Task 17(`App.jsx`)が消費する。

- [ ] **Step 1: Play.test.jsxを書く(失敗する状態)**

```jsx
import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import Play from './Play.jsx';

function makeSession(overrides = {}) {
  return {
    id: 's1',
    title: 'テストセッション',
    world: { raw: '', summary: '' },
    scenario: { raw: '' },
    rulesetId: 'simple',
    pc: { raw: '' },
    state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], turn_count: 0 },
    log: [],
    updatedAt: 0,
    ...overrides,
  };
}

// Playはsessionをpropで受け取るcontrolled componentなので、setSessionをモック関数の
// ままにするとPlayが更新後のsessionを再描画できない。App.jsxと同様に親側でstateを
// 持つ小さなハーネスを用意し、実際の再レンダリングを再現する。
function Harness({ initialSession, onExit }) {
  const [session, setSession] = useState(initialSession);
  return <Play session={session} setSession={setSession} onExit={onExit} />;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ narrative: '物語が始まった。', state_update: {}, choices: ['進む'] }),
          },
        ],
      }),
    })
  );
});

describe('Play', () => {
  it('requests an opening scene when the log is empty and renders the narrative', async () => {
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('進む')).toBeInTheDocument();
  });

  it('does not request an opening scene when the log already has entries', async () => {
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    render(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    expect(screen.getByText('既存のログ')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: FAIL(`Play.jsx`が存在しない)

- [ ] **Step 3: Play.jsxを実装**

```jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../theme.js';
import { takeTurn } from '../api/session.js';
import { saveSession } from '../storage/index.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Stamp from '../components/ui/Stamp.jsx';

export default function Play({ session, setSession, onExit }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.log.length, busy]);

  const runTurn = useCallback(
    async (playerText, displayText) => {
      setBusy(true);
      setError('');
      try {
        const { result, roll } = await takeTurn(session, playerText);

        const newFlags = { ...session.state.flags, ...(result.state_update?.flags || {}) };
        const newLog = [...session.log];
        if (displayText) newLog.push({ role: 'player', text: displayText });
        newLog.push({ role: 'gm', text: result.narrative, choices: result.choices || [], roll });

        const recent = [...(session.state.recent_log || [])];
        if (displayText) recent.push({ role: 'player', text: displayText });
        recent.push({ role: 'gm', text: result.narrative });
        while (recent.length > 12) recent.shift(); // 簡易履歴管理。Phase2で要約圧縮に置き換え予定

        const updated = {
          ...session,
          state: {
            ...session.state,
            current_scene: result.state_update?.current_scene || session.state.current_scene,
            flags: newFlags,
            history_summary: result.state_update?.history_summary ?? session.state.history_summary,
            recent_log: recent,
            turn_count: session.state.turn_count + 1,
          },
          log: newLog,
          updatedAt: Date.now(),
        };
        setSession(updated);
        await saveSession(updated);
      } catch (e) {
        console.error(e);
        setError('GM応答の取得に失敗した: ' + e.message);
      } finally {
        setBusy(false);
      }
    },
    [session, setSession]
  );

  useEffect(() => {
    if (session.log.length === 0 && !busy) {
      runTurn('(セッション開始。導入シーンを描写せよ)', null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitFree() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    runTurn(text, text);
  }

  function submitChoice(choice) {
    if (busy) return;
    runTurn(choice, choice);
  }

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 20px 140px',
        minHeight: '100vh',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 18, color: COLORS.ink }}>
            {session.title}
          </div>
          <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>
            シーン: {session.state.current_scene}
          </div>
        </div>
        <Button variant="ghost" onClick={onExit}>
          ホームへ
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {session.log.map((entry, i) =>
          entry.role === 'player' ? (
            <div
              key={i}
              style={{
                alignSelf: 'flex-end',
                maxWidth: '80%',
                fontFamily: F_MONO,
                fontSize: 13,
                color: COLORS.paper,
                background: COLORS.ink,
                borderRadius: 4,
                padding: '8px 12px',
              }}
            >
              {entry.text}
            </div>
          ) : (
            <Card key={i}>
              <Stamp roll={entry.roll} />
              <div
                style={{
                  fontFamily: F_BODY,
                  fontSize: 15,
                  lineHeight: 1.8,
                  color: COLORS.inkSoft,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {entry.text}
              </div>
              {i === session.log.length - 1 && entry.choices?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {entry.choices.map((c, ci) => (
                    <Button key={ci} variant="ghost" onClick={() => submitChoice(c)} disabled={busy}>
                      {c}
                    </Button>
                  ))}
                </div>
              )}
            </Card>
          )
        )}
        {busy && (
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>
            GMが考えている…
          </div>
        )}
        {error && <div style={{ color: COLORS.stamp, fontSize: 13 }}>{error}</div>}
        <div ref={logEndRef} />
      </div>

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: COLORS.paper,
          borderTop: `1px solid ${COLORS.line}`,
          padding: 16,
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitFree()}
            placeholder="PCの行動を自由に書く…"
            style={{ ...inputStyle, flex: 1 }}
            disabled={busy}
          />
          <Button variant="brass" onClick={submitFree} disabled={busy || !input.trim()}>
            送る
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "feat(frontend): add Play screen (simplified session persistence)"
```

---

## Task 17: src/App.jsx最終版 + 旧trpg-gm-app.jsxの削除

**Files:**
- Modify: `src/App.jsx`(プレースホルダーから最終版へ)
- Modify: `src/App.test.jsx`(プレースホルダーテストから最終版へ)
- Delete: `trpg-gm-app.jsx`

**Interfaces:**
- Consumes: `useGoogleFonts, COLORS`(Task 11), `listSessions, getSession, saveSession, isStorageAvailable`(Task 10), `Home`(Task 14), `Setup`(Task 15), `Play`(Task 16)
- Produces: `App`(デフォルトエクスポート)。`src/main.jsx`(Task 1で作成済み、変更不要)がこれをレンダリングする。

- [ ] **Step 1: src/App.test.jsxを最終版に置き換える(失敗する状態)**

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';

describe('App', () => {
  it('shows the home screen after the initial storage check completes', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());
    expect(screen.getByText('+ 新規プレイ')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/App.test.jsx`
Expected: FAIL(`App.jsx`がまだプレースホルダーのため`GM's Desk`が見つからない)

- [ ] **Step 3: src/App.jsxを最終版に置き換える**

```jsx
import { useState, useEffect } from 'react';
import { useGoogleFonts, COLORS, F_MONO } from './theme.js';
import { listSessions, getSession, saveSession, isStorageAvailable } from './storage/index.js';
import Home from './screens/Home.jsx';
import Setup from './screens/Setup.jsx';
import Play from './screens/Play.jsx';

export default function App() {
  useGoogleFonts();
  const [view, setView] = useState('home'); // home | setup | play
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
          <Home sessions={sessions} storageOk={storageOk} onNew={() => setView('setup')} onContinue={handleContinue} />
        ))}
      {view === 'setup' && <Setup onStart={handleStart} onCancel={() => setView('home')} />}
      {view === 'play' && session && (
        <Play session={session} setSession={setSession} onExit={handleExit} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/App.test.jsx`
Expected: PASS(1 test)

- [ ] **Step 5: 全フロントエンドテストを一括実行して回帰がないことを確認**

Run: `npx vitest run`
Expected: 全テストPASS(Task 1〜17で作成した全テストファイル)

- [ ] **Step 6: ビルドが通ることを確認**

Run: `npm run build`
Expected: `dist/`が正常に生成される

- [ ] **Step 7: 旧trpg-gm-app.jsxを削除**

Run: `git rm trpg-gm-app.jsx`

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/App.test.jsx
git commit -m "feat(frontend): wire up final App component; remove legacy single-file artifact"
```

---

## Task 18: エンドツーエンド動作確認(ブラウザ)

**Files:** なし(コード変更を伴わない検証タスク。問題が見つかった場合のみ該当ファイルを修正し、その回帰修正としてコミットする)

- [ ] **Step 1: サーバーを起動**

Run: `PORT=8787 node server/index.js`(`.env`に`ANTHROPIC_API_KEY`が未設定でも起動自体は成功する。実際のGM応答取得には有効なAPIキーが必要)

- [ ] **Step 2: 別ターミナルでVite開発サーバーを起動**

Run: `npm run dev`(または`vite`のみ)

- [ ] **Step 3: ブラウザでホーム画面を確認**

`http://localhost:5173`を開き、以下を確認する:
- 「GM's Desk」の見出しと「+ 新規プレイ」ボタンが表示される
- ブラウザのコンソールにエラーが出ていない(IndexedDBの初期化含む)

- [ ] **Step 4: セットアップウィザードの画面遷移を確認**

「+ 新規プレイ」をクリックし、5ステップ(世界観/シナリオ/ルール/PC/確認)すべてで「次へ」「戻る」が正しく機能することを確認する。

- [ ] **Step 5: (`ANTHROPIC_API_KEY`が設定されている場合)実際のプレイフローを確認**

サーバーの`.env`に有効な`ANTHROPIC_API_KEY`を設定した状態で「ゲーム開始」まで進め、以下を確認する:
- `/api/messages`へのリクエストがネットワークタブで確認できる(Anthropicへの直接fetchではない)
- GMの導入文が表示される
- 自由記述入力とダイス判定(該当する場面があれば)が機能する
- ホームへ戻った後、「続きから再開」に該当セッションが表示され、再開できる

- [ ] **Step 6: 見つかった問題を修正した場合はコミット**

```bash
git add <修正したファイル>
git commit -m "fix: <問題の内容>"
```

---

## Task 19: docs/README.md + docs/01-architecture.md

**Files:**
- Create: `docs/README.md`
- Create: `docs/01-architecture.md`

- [ ] **Step 1: docs/README.mdを作成**

```markdown
# AI-GM型TRPGアプリ 設計ドキュメント

ユーザーとAI(GM)がインタラクティブに物語を紡ぐTRPG型アプリ。
入力: キャラクターシート・世界観・シナリオ。
AI-GMがシナリオに沿って進行、プレイヤーはPCの行動・選択を入力して物語を分岐させる。

## 目的

- 既存TRPGシステムの手動GM負荷をAIで代替
- シナリオ・キャラシートさえ用意すれば誰でもGM役なしでプレイ可能に

## スコープ(MVP)

- 1人プレイヤー、1AI-GM
- テキストベース入出力(自由記述主体、GM側からの二択/Yes-No問いかけを補助的に使用)
- ダイス判定あり(ルールシステム非依存、アダプタ方式)
- シナリオ既存読み込み / AI自動生成の両対応
- Vite+Reactのフロントエンドと軽量プロキシサーバー(Express)から成るWebアプリとして動作

## 目次

- [01-architecture.md](01-architecture.md) — システム構成・デプロイ形態
- [02-data-model.md](02-data-model.md) — データモデル(キャラクターシート/世界観/state/ストレージ構造)
- [03-gm-logic.md](03-gm-logic.md) — GMロジック(ターン処理フロー)・判定システム
- [04-persistence.md](04-persistence.md) — 状態管理・永続化
- [05-ui-ux.md](05-ui-ux.md) — UI/UX方針・演出方針・起動直後のUI
- [06-content-generation.md](06-content-generation.md) — シナリオ自動生成・世界観分割/インポート・活用方針
- [07-risks-and-roadmap.md](07-risks-and-roadmap.md) — 留意点・リスク一覧・実装フェーズ計画・設計決定事項
```

- [ ] **Step 2: docs/01-architecture.mdを作成**

````markdown
# アーキテクチャ

## システム構成

```
┌─────────────────────────────────────────┐
│              UI (React)                  │
│  - 入力欄 / 選択肢ボタン / ログ表示エリア   │
│  - キャラシート表示パネル                   │
└───────────────┬───────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│           Game Engine (JS, ローカル)       │
│  - state管理 (真実源)                       │
│  - ダイスロール実行・判定計算                │
│  - AI応答のパース・state反映                 │
│  - 履歴要約トリガー                         │
│  - IndexedDBへのセッション永続化             │
└───────────────┬───────────────────────────┘
                │ prompt (state + 履歴要約 + プレイヤー入力)
                ▼
┌─────────────────────────────────────────┐
│      プロキシサーバー (Express)             │
│  - Anthropic APIキーの保持・付与             │
│  - リクエストの中継のみ(ロジックを持たない)    │
│  - dataStore/textStoreによるサーバー側永続化  │
└───────────────┬───────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│         Claude API (GM役)                 │
│  - 地の文生成                              │
│  - NPC発言生成                             │
│  - 判定要求 (tool_use: roll_check)          │
│  - state更新案 (JSON)                       │
└───────────────┬───────────────────────────┘
                │ response (narrative + state_update + choices)
                ▼
        Game Engineがstate確定・UIへ反映
```

**設計原則**: 判定結果・state更新の「確定」は必ずコード側。AIは提案のみ。真実源はAIの中ではなくローカルstate。

## デプロイ形態

- フロントエンド: Vite + ReactによるSPA。ブラウザのIndexedDBにセッションを永続化する(詳細は[04-persistence.md](04-persistence.md))。
- バックエンド: Expressによる薄いプロキシサーバー。Anthropic APIキーをサーバー環境変数として保持し、フロントエンドの代わりにAPIを呼び出す。サーバー側の永続化抽象化(dataStore/textStore)も担う。
- 開発時は単一の`package.json`から`concurrently`でフロントエンド(Vite dev server)とバックエンド(Express)を同時起動する。
````

- [ ] **Step 3: 内容を目視確認**

Run: `cat docs/README.md docs/01-architecture.md`
Expected: 上記の内容がそのまま表示される

- [ ] **Step 4: Commit**

```bash
git add docs/README.md docs/01-architecture.md
git commit -m "docs: add design doc index and updated architecture doc"
```

---

## Task 20: docs/02-data-model.md + docs/03-gm-logic.md(既存docsからの抽出)

**Files:**
- Create: `docs/02-data-model.md`
- Create: `docs/03-gm-logic.md`

既存の`docs/trpg_gm_app_design.md`から該当行をそのまま抽出する(内容は変更しない)。抽出後、`docs/trpg_gm_app_design.md`自体はTask 22で削除するため、この時点ではまだ残しておく。

- [ ] **Step 1: docs/02-data-model.mdを抽出**

セクション3(データモデル)全体のうち、3.2.1・3.2.2(世界観の分割・インポート)は[06-content-generation.md](06-content-generation.md)側に分割するため、ここでは3(導入)・3.1・3.1.1・3.2(世界観・シナリオの基本形式)・3.3・3.4・3.5のみを抽出する。

Run:
```bash
{
  echo '# データモデル'
  echo
  sed -n '57,96p' docs/trpg_gm_app_design.md
  echo
  sed -n '132,200p' docs/trpg_gm_app_design.md
} > docs/02-data-model.md
```

- [ ] **Step 2: 抽出結果を検証**

`## 3. データモデル`(H2)1個 + `### 3.1`〜`### 3.5`(H3)6個で、見出し行(`^##`にマッチする行、`###`も含む)は合計7行になるはずである。

Run: `grep -c '^##' docs/02-data-model.md`
Expected: `7`

Run: `grep -q '3.2.1' docs/02-data-model.md && echo FOUND || echo NOT_FOUND`
Expected: `NOT_FOUND`(3.2.1は06-content-generation.mdに移すため、このファイルには含まれない)

- [ ] **Step 3: docs/03-gm-logic.mdを抽出**

Run:
```bash
{
  echo '# GMロジック・判定システム'
  echo
  sed -n '204,238p' docs/trpg_gm_app_design.md
} > docs/03-gm-logic.md
```

- [ ] **Step 4: 抽出結果を検証**

Run: `grep -q '## 4. GMロジック' docs/03-gm-logic.md && grep -q '## 5. 判定システム' docs/03-gm-logic.md && echo OK`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add docs/02-data-model.md docs/03-gm-logic.md
git commit -m "docs: split data model and GM logic sections into dedicated files"
```

---

## Task 21: docs/04-persistence.md(新規) + docs/05-ui-ux.md(抽出)

**Files:**
- Create: `docs/04-persistence.md`
- Create: `docs/05-ui-ux.md`

- [ ] **Step 1: docs/04-persistence.mdを作成**

```markdown
# 状態管理・永続化

## クライアント側(IndexedDB)

- ブラウザのIndexedDBでセッション跨ぎ保存する。`sessions`という1つのobject store(キー: session id)にセッション全体を保存する。
- localStorage/sessionStorageではなくIndexedDBを採用する理由:
  - localStorageとsessionStorageは容量上限がほぼ同じ(数MB程度)であり、sessionStorageに容量面の優位性はない
  - sessionStorageはタブを閉じると消えるため、「続きから再開」機能と両立しない
  - 将来的に画像等のバイナリデータを扱う計画があり、IndexedDBならBlobを直接扱え容量上限も大きい
- 一覧表示(ホーム画面の「続きから再開」)はIndexedDBの`getAll()`で全セッションを取得し`updatedAt`降順にソートして使う。専用の索引(旧`sessions_index`)は持たない。
- スキーマバージョン管理: session内に`schema_version`を持たせ、将来の移行に対応(未実装、Phase以降で必要になれば追加)。

## サーバー側(dataStore / textStore)

- サーバーはJSON向けの`dataStore`とテキスト(Markdown等)向けの`textStore`という2つの抽象インターフェースを持つ。現状はどちらもローカルファイルシステム実装。
  - `dataStore`: 将来Redis等のキーバリューストアへの差し替えを想定
  - `textStore`: 将来S3等のクラウドストレージへの差し替えを想定
- Sessionsは`dataStore`経由で`sessions/{id}`キーに保存され、`GET /api/sessions`・`GET /api/sessions/:id`・`PUT /api/sessions/:id`で読み書きできる。ただしフロントエンドから自動的にこのAPIへ同期する配線は現時点では行っていない(IndexedDBのみで完結)。
- World/Character/Scenario/Rulesetについては、`server/storage/paths.js`でキー生成関数のみ用意されており(データモデルは[02-data-model.md](02-data-model.md)の3.5節相当のフォルダ構造に対応)、実際の保存API配線は未実装。
```

- [ ] **Step 2: docs/05-ui-ux.mdを抽出**

Run:
```bash
{
  echo '# UI/UX方針'
  echo
  sed -n '250,256p' docs/trpg_gm_app_design.md
  echo
  sed -n '359,369p' docs/trpg_gm_app_design.md
  echo
  sed -n '373,405p' docs/trpg_gm_app_design.md
} > docs/05-ui-ux.md
```

- [ ] **Step 3: 抽出結果を検証**

Run: `grep -q '## 7. UI/UX方針' docs/05-ui-ux.md && grep -q '## 13. 演出方針' docs/05-ui-ux.md && grep -q '## 14. 起動直後のUI' docs/05-ui-ux.md && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add docs/04-persistence.md docs/05-ui-ux.md
git commit -m "docs: add updated persistence doc; split UI/UX sections into a dedicated file"
```

---

## Task 22: docs/06-content-generation.md + docs/07-risks-and-roadmap.md(抽出) + 旧docsの削除

**Files:**
- Create: `docs/06-content-generation.md`
- Create: `docs/07-risks-and-roadmap.md`
- Delete: `docs/trpg_gm_app_design.md`

- [ ] **Step 1: docs/06-content-generation.mdを抽出**

Run:
```bash
{
  echo '# コンテンツ生成・世界観活用'
  echo
  sed -n '98,130p' docs/trpg_gm_app_design.md
  echo
  sed -n '322,343p' docs/trpg_gm_app_design.md
  echo
  sed -n '347,355p' docs/trpg_gm_app_design.md
} > docs/06-content-generation.md
```

- [ ] **Step 2: 抽出結果を検証**

Run: `grep -q '### 3.2.1 大規模世界観の分割' docs/06-content-generation.md && grep -q '## 11. シナリオ自動生成モード' docs/06-content-generation.md && grep -q '## 12. 世界観・キャラ設定の活用方針' docs/06-content-generation.md && echo OK`
Expected: `OK`

- [ ] **Step 3: docs/07-risks-and-roadmap.mdを抽出**

Run:
```bash
{
  echo '# リスク・ロードマップ・設計決定事項'
  echo
  sed -n '260,271p' docs/trpg_gm_app_design.md
  echo
  sed -n '275,291p' docs/trpg_gm_app_design.md
  echo
  sed -n '295,318p' docs/trpg_gm_app_design.md
} > docs/07-risks-and-roadmap.md
```

- [ ] **Step 4: 抽出結果を検証**

Run: `grep -q '## 8. 留意点・リスク一覧' docs/07-risks-and-roadmap.md && grep -q '## 9. 実装フェーズ計画' docs/07-risks-and-roadmap.md && grep -q '### 10.1 ルールシステム非依存化' docs/07-risks-and-roadmap.md && echo OK`
Expected: `OK`

- [ ] **Step 5: 全8ファイルが揃っていることを最終確認**

Run: `ls docs/*.md`
Expected: `docs/01-architecture.md docs/02-data-model.md docs/03-gm-logic.md docs/04-persistence.md docs/05-ui-ux.md docs/06-content-generation.md docs/07-risks-and-roadmap.md docs/README.md`

- [ ] **Step 6: 旧docs/trpg_gm_app_design.mdを削除**

Run: `git rm docs/trpg_gm_app_design.md`

- [ ] **Step 7: Commit**

```bash
git add docs/06-content-generation.md docs/07-risks-and-roadmap.md
git commit -m "docs: split content-generation and risks/roadmap sections; remove legacy single-file design doc"
```

---

## Self-Review Notes

- **Spec coverage**: 全非機能要件(単一package.json、IndexedDB、dataStore/textStore抽象化、Sessionsの最小API、World/Character/Scenario/Rulesetの配線なし、小説化プレースホルダー、docsの8分割)はTask 1〜22でそれぞれ対応済み。
- **Placeholder scan**: 「TBD」「後で実装」等の記述なし。すべてのステップに実行可能なコード/コマンドを記載。
- **Type consistency**: `saveSession`/`getSession`/`listSessions`/`isStorageAvailable`(storage/index.js)、`takeTurn`/`summarizeWorld`/`generateScenario`(api/session.js)、`createFsDataStore`/`createFsTextStore`(server/storage)、`sessionKey`等(server/storage/paths.js)の関数名・シグネチャはTask 2, 5-10で定義したものをTask 15-17まで一貫して使用している。
