# 素材ライブラリ サブプロジェクト4a: Scenario/Ruleset APIクライアント Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存の`worldLibraryClient.js`/`characterLibraryClient.js`と同型の、Scenario/Ruleset用フロントエンドAPIクライアントを追加する。

**Architecture:** 両ファイルとも`apiFetch`共通ヘルパー(非okレスポンスでstatus+末尾200文字のbodyを含むErrorをthrow)を各ファイル内に持つ薄いfetchラッパー。DELETEは204 No Contentのため`.json()`を呼ばない特別扱い。既存パターンの純粋な複製。

**Tech Stack:** Vitest(新規依存追加なし)

## Global Constraints

- `"type": "module"`(ESM)。`require()`は使わない。
- 全関数は相対パス(`/api/...`)のみを使う。絶対URL・第三者ホストへのアクセスは一切行わない。
- エラーハンドリングは既存の`apiFetch`パターン(`worldLibraryClient.js`/`characterLibraryClient.js`)と完全に一致させる。
- `deleteScenario`/`deleteRuleset`は`.json()`を呼ばない(204 No Contentのため)。
- UIからの呼び出しは本プランのスコープ外(別サブプロジェクト)。
- テストは`vi.stubGlobal('fetch', ...)`でモックし、実ネットワーク呼び出しを行わない。
- 各タスクの最後は該当ファイルのみをステージしてコミットする。

---

## Task 1: src/api/scenarioLibraryClient.js

**Files:**
- Create: `src/api/scenarioLibraryClient.js`
- Create: `src/api/scenarioLibraryClient.test.js`

**Interfaces:**
- Produces: `getScenario(worldId, id)`、`putScenario(worldId, id, { title, raw, recommendedRuleset })`、`listScenarios(worldId)`、`deleteScenario(worldId, id)`。素材ライブラリ画面(サブプロジェクト4b)が消費する。

- [ ] **Step 1: scenarioLibraryClient.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getScenario, putScenario, listScenarios, deleteScenario } from './scenarioLibraryClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getScenario', () => {
  it('GETs a scenario', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sc1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getScenario('w1', 'sc1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/scenarios/sc1',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual({ id: 'sc1' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getScenario('w1', 'missing')).rejects.toThrow('API error 404: not found');
  });
});

describe('putScenario', () => {
  it('PUTs title, raw, and recommendedRuleset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sc1' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putScenario('w1', 'sc1', { title: '失踪事件', raw: '## シナリオ概要', recommendedRuleset: 'coc7e' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/scenarios/sc1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ title: '失踪事件', raw: '## シナリオ概要', recommendedRuleset: 'coc7e' }),
      })
    );
  });
});

describe('listScenarios', () => {
  it('GETs the list for a world', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'sc1' }] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listScenarios('w1');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1/scenarios', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual([{ id: 'sc1' }]);
  });
});

describe('deleteScenario', () => {
  it('DELETEs a scenario and does not attempt to parse a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteScenario('w1', 'sc1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/scenarios/sc1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteScenario('w1', 'sc1')).rejects.toThrow('API error 500: boom');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/scenarioLibraryClient.test.js`
Expected: FAIL(`scenarioLibraryClient.js`が存在しない)

- [ ] **Step 3: scenarioLibraryClient.jsを実装**

```js
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function getScenario(worldId, id) {
  return apiFetch(`/api/worlds/${worldId}/scenarios/${id}`, { method: 'GET' });
}

export async function putScenario(worldId, id, { title, raw, recommendedRuleset }) {
  return apiFetch(`/api/worlds/${worldId}/scenarios/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, raw, recommendedRuleset }),
  });
}

export async function listScenarios(worldId) {
  return apiFetch(`/api/worlds/${worldId}/scenarios`, { method: 'GET' });
}

export async function deleteScenario(worldId, id) {
  const res = await fetch(`/api/worlds/${worldId}/scenarios/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/scenarioLibraryClient.test.js`
Expected: PASS(7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/scenarioLibraryClient.js src/api/scenarioLibraryClient.test.js
git commit -m "feat(frontend): add thin fetch client for scenario API"
```

---

## Task 2: src/api/rulesetLibraryClient.js

**Files:**
- Create: `src/api/rulesetLibraryClient.js`
- Create: `src/api/rulesetLibraryClient.test.js`

**Interfaces:**
- Produces: `getRuleset(id)`、`putRuleset(id, { label, desc, hint })`、`listRulesets()`、`deleteRuleset(id)`。Worldに紐づかないフラットな構造。素材ライブラリ画面(サブプロジェクト4b)・Setupウィザード連携(サブプロジェクト4c)が消費する。

- [ ] **Step 1: rulesetLibraryClient.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRuleset, putRuleset, listRulesets, deleteRuleset } from './rulesetLibraryClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getRuleset', () => {
  it('GETs a ruleset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'homebrew' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getRuleset('homebrew');
    expect(fetchMock).toHaveBeenCalledWith('/api/rulesets/homebrew', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual({ id: 'homebrew' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getRuleset('missing')).rejects.toThrow('API error 404: not found');
  });
});

describe('putRuleset', () => {
  it('PUTs label, desc, and hint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'homebrew' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putRuleset('homebrew', { label: '自作ルール', desc: '独自ルール', hint: '演出ヒント' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rulesets/homebrew',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ label: '自作ルール', desc: '独自ルール', hint: '演出ヒント' }),
      })
    );
  });
});

describe('listRulesets', () => {
  it('GETs the full ruleset list', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'homebrew' }] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listRulesets();
    expect(fetchMock).toHaveBeenCalledWith('/api/rulesets', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual([{ id: 'homebrew' }]);
  });
});

describe('deleteRuleset', () => {
  it('DELETEs a ruleset and does not attempt to parse a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteRuleset('homebrew')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/rulesets/homebrew', expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteRuleset('homebrew')).rejects.toThrow('API error 500: boom');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/rulesetLibraryClient.test.js`
Expected: FAIL(`rulesetLibraryClient.js`が存在しない)

- [ ] **Step 3: rulesetLibraryClient.jsを実装**

```js
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function getRuleset(id) {
  return apiFetch(`/api/rulesets/${id}`, { method: 'GET' });
}

export async function putRuleset(id, { label, desc, hint }) {
  return apiFetch(`/api/rulesets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, desc, hint }),
  });
}

export async function listRulesets() {
  return apiFetch('/api/rulesets', { method: 'GET' });
}

export async function deleteRuleset(id) {
  const res = await fetch(`/api/rulesets/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/rulesetLibraryClient.test.js`
Expected: PASS(7 tests)

- [ ] **Step 5: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 6: ビルドを確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 7: Commit**

```bash
git add src/api/rulesetLibraryClient.js src/api/rulesetLibraryClient.test.js
git commit -m "feat(frontend): add thin fetch client for ruleset API"
```

---

## Self-Review Notes

- **Spec coverage**: spec docの両クライアント(scenarioLibraryClient.js/rulesetLibraryClient.js)ともタスクが対応。
- **Placeholder scan**: 「TBD」等の記述なし。
- **既存パターンとの一貫性**: `apiFetch`ヘルパー・エラーメッセージ形式・DELETE特別扱いは`worldLibraryClient.js`/`characterLibraryClient.js`と完全に一致させている。
- **非スコープの遵守**: UIからの呼び出しは本プランのどのタスクにも含まれていない。
