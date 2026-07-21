# 素材ライブラリ サブプロジェクト3: Character/Scenario詳細 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scenarioに`recommended_ruleset`メタ情報を追加し、Character(PC/NPC)の自由記述→構造化変換パイプライン(goal/bonds抽出+ハッシュベースキャッシュ)を実装する。

**Architecture:** Scenarioの変更は既存`scenarioLibrary.js`/`routes/scenarios.js`への小さな追加。Characterの構造化パイプラインは、既存メタレコードに`parsed`/`parsedHash`フィールドを追加(別ファイル化しない)し、それを部分更新する軽量エンドポイントをサーバー側に新設。フロントエンドはAI呼び出し(`characterSheetParse.js`)とキャッシュオーケストレーション(`characterSheetCache.js`)を別ファイルに分離する(サブプロジェクト2の`worldSplit.js`/`worldImport.js`と同じ理由=モック可能性)。

**Tech Stack:** Express 4, Vitest, `supertest`(既存の延長。新規依存追加なし)

## Global Constraints

- `"type": "module"`(ESM)。`require()`は使わない。
- Characterの`parsed`/`parsedHash`は既存のCharacterメタレコード(dataStore)に追加するフィールドであり、別ファイル・別キーにはしない。
- ハッシュ判定はセキュリティ用途ではない単なる変更検知のため、Web Crypto等の暗号学的ハッシュは使わず、`src/utils/hashText.js`に依存なしの純粋関数(DJB2系)を実装する。
- `parseCharacterSheet`(AI呼び出し)は`src/api/characterSheetParse.js`に、`getOrParseCharacter`(オーケストレーション)は`src/api/characterSheetCache.js`に**別ファイルとして分離する**。理由: 同一モジュール内の関数呼び出しは`vi.spyOn`でモックできない(ESMの静的束縛)。既にサブプロジェクト2の`worldSplit.js`/`worldImport.js`分離で検証済みのパターン。
- `saveCharacterParsed`は`raw`テキストを一切書き込まない(`textStore`を触らない)。既存メタレコードが存在しない場合は書き込みを行わず`null`を返す。
- 抽出したgoal/bondsをGMプロンプト(`buildSystemPrompt`/`takeTurn`)へ実際に注入する配線は本プランのスコープ外。
- Scenarioの構造化(relevant_docs/climax_marker)、NPCのrevealed_facts要素単位管理、UIへの実配線は本プランのスコープ外。
- テストはVitest。サーバー側は`// @vitest-environment node`。フロントエンド側は`vi.stubGlobal('fetch', ...)`または`vi.spyOn(モジュール, '関数名')`(既存パターンを踏襲)。
- 各タスクの最後は該当ファイルのみをステージしてコミットする。

---

## Task 1: Scenarioに recommended_ruleset を追加

**Files:**
- Modify: `server/storage/scenarioLibrary.js`
- Modify: `server/storage/scenarioLibrary.test.js`
- Modify: `server/routes/scenarios.js`
- Modify: `server/routes/scenarios.test.js`

**Interfaces:**
- Consumes: なし(既存の`scenarioMetaKey`/`scenarioDocPath`をそのまま使う)
- Produces: `saveScenario(dataStore, textStore, { worldId, id, title, raw, recommendedRuleset })`の戻り値に`recommendedRuleset`(未指定なら`null`)が含まれるようになる。`PUT /worlds/:worldId/scenarios/:id`が`recommendedRuleset`をボディから受け取れるようになる。

- [ ] **Step 1: scenarioLibrary.test.jsに新しいテストを追加(失敗する状態)**

`describe('Scenario library functions', ...)`ブロック内、既存テストの末尾に追加する:

```js
  it('saves a scenario with a recommended ruleset', async () => {
    await saveScenario(dataStore, textStore, {
      worldId: 'w1',
      id: 'sc1',
      title: 'A',
      raw: 'a',
      recommendedRuleset: 'coc7e',
    });
    const scenario = await getScenario(dataStore, textStore, 'w1', 'sc1');
    expect(scenario.recommendedRuleset).toBe('coc7e');
  });

  it('defaults recommendedRuleset to null when not specified', async () => {
    await saveScenario(dataStore, textStore, { worldId: 'w1', id: 'sc1', title: 'A', raw: 'a' });
    const scenario = await getScenario(dataStore, textStore, 'w1', 'sc1');
    expect(scenario.recommendedRuleset).toBeNull();
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/storage/scenarioLibrary.test.js`
Expected: FAIL(`recommendedRuleset`が常に`undefined`になる)

- [ ] **Step 3: scenarioLibrary.jsの saveScenario を更新**

`saveScenario`関数のみを以下に置き換える(他の3関数は変更しない):

```js
export async function saveScenario(dataStore, textStore, { worldId, id, title, raw, recommendedRuleset }) {
  await textStore.write(scenarioDocPath(worldId, id), raw);
  const meta = {
    id,
    worldId,
    title,
    recommendedRuleset: recommendedRuleset ?? null,
    updatedAt: Date.now(),
  };
  await dataStore.set(scenarioMetaKey(worldId, id), meta);
  return { ...meta, raw };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/storage/scenarioLibrary.test.js`
Expected: PASS(6 tests)

- [ ] **Step 5: routes/scenarios.test.jsに新しいテストを追加(失敗する状態)**

`describe('scenarios routes', ...)`ブロック内、既存テストの末尾に追加する:

```js
  it('saves and retrieves a scenario with a recommended ruleset', async () => {
    await request(app)
      .put('/api/worlds/w1/scenarios/sc1')
      .send({ title: 'A', raw: 'a', recommendedRuleset: 'coc7e' });
    const res = await request(app).get('/api/worlds/w1/scenarios/sc1');
    expect(res.body.recommendedRuleset).toBe('coc7e');
  });
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npx vitest run server/routes/scenarios.test.js`
Expected: FAIL(PUTハンドラが`recommendedRuleset`を渡していない)

- [ ] **Step 7: routes/scenarios.jsのPUTハンドラを更新**

```js
  router.put('/worlds/:worldId/scenarios/:id', asyncHandler(async (req, res) => {
    const scenario = await saveScenario(dataStore, textStore, {
      worldId: req.params.worldId,
      id: req.params.id,
      title: req.body.title,
      raw: req.body.raw,
      recommendedRuleset: req.body.recommendedRuleset,
    });
    res.json(scenario);
  }));
```

- [ ] **Step 8: テストが通ることを確認**

Run: `npx vitest run server/routes/scenarios.test.js`
Expected: PASS(5 tests)

- [ ] **Step 9: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 10: Commit**

```bash
git add server/storage/scenarioLibrary.js server/storage/scenarioLibrary.test.js server/routes/scenarios.js server/routes/scenarios.test.js
git commit -m "feat(server): add recommendedRuleset metadata to Scenario"
```

---

## Task 2: characterLibrary.js に saveCharacterParsed を追加

**Files:**
- Modify: `server/storage/characterLibrary.js`
- Modify: `server/storage/characterLibrary.test.js`

**Interfaces:**
- Consumes: `characterMetaKey`(`server/storage/paths.js`, 既存)
- Produces: `saveCharacter`が返す/保存するメタレコードに`parsed: null, parsedHash: null`が初期値として含まれるようになる。`saveCharacterParsed(dataStore, worldId, kind, name, { parsed, parsedHash })` → `Promise<object|null>`(既存メタレコードの`parsed`/`parsedHash`のみ更新して返す。レコードが存在しなければ`null`)。Task 3(`routes/characters.js`)が消費する。

- [ ] **Step 1: characterLibrary.test.jsに新しいテストを追加(失敗する状態)**

`import`文に`saveCharacterParsed`を追加する:

```js
import { saveCharacter, getCharacter, listCharacters, deleteCharacter, saveCharacterParsed } from './characterLibrary.js';
```

`describe('Character library functions', ...)`ブロック内、既存テストの末尾に追加する:

```js
  it('initializes parsed and parsedHash to null on save', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    const pc = await getCharacter(dataStore, textStore, 'w1', 'pc', 'alice');
    expect(pc.parsed).toBeNull();
    expect(pc.parsedHash).toBeNull();
  });
```

ファイル末尾に新しい`describe`ブロックを追加する:

```js
describe('saveCharacterParsed', () => {
  it('returns null when the character does not exist', async () => {
    const result = await saveCharacterParsed(dataStore, 'w1', 'pc', 'missing', {
      parsed: { goal: 'x', bonds: 'y' },
      parsedHash: 'h1',
    });
    expect(result).toBeNull();
  });

  it('updates parsed and parsedHash without touching raw text', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'alice', raw: '原文' });

    const updated = await saveCharacterParsed(dataStore, 'w1', 'pc', 'alice', {
      parsed: { goal: '妹を救う', bonds: '幼馴染' },
      parsedHash: 'abc123',
    });
    expect(updated.parsed).toEqual({ goal: '妹を救う', bonds: '幼馴染' });
    expect(updated.parsedHash).toBe('abc123');

    const character = await getCharacter(dataStore, textStore, 'w1', 'pc', 'alice');
    expect(character.raw).toBe('原文');
    expect(character.parsed).toEqual({ goal: '妹を救う', bonds: '幼馴染' });
  });

  it('preserves other meta fields (revealed) when updating parsed', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'npc', name: 'villain', raw: 'x', revealed: true });
    await saveCharacterParsed(dataStore, 'w1', 'npc', 'villain', {
      parsed: { goal: 'a', bonds: 'b' },
      parsedHash: 'h',
    });
    const character = await getCharacter(dataStore, textStore, 'w1', 'npc', 'villain');
    expect(character.revealed).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/storage/characterLibrary.test.js`
Expected: FAIL(`parsed`/`parsedHash`が存在しない、`saveCharacterParsed`が存在しない)

- [ ] **Step 3: characterLibrary.jsを更新**

`saveCharacter`関数のmeta生成部分を以下に置き換え、ファイル末尾に`saveCharacterParsed`を追加する(`getCharacter`/`listCharacters`/`deleteCharacter`は変更しない):

```js
export async function saveCharacter(dataStore, textStore, { worldId, kind, name, raw, revealed }) {
  await textStore.write(characterDocPath(worldId, kind, name), raw);
  const meta = {
    id: name,
    worldId,
    kind,
    name,
    revealed: kind === 'npc' ? !!revealed : null,
    parsed: null,
    parsedHash: null,
    updatedAt: Date.now(),
  };
  await dataStore.set(characterMetaKey(worldId, kind, name), meta);
  return { ...meta, raw };
}
```

```js
export async function saveCharacterParsed(dataStore, worldId, kind, name, { parsed, parsedHash }) {
  const meta = await dataStore.get(characterMetaKey(worldId, kind, name));
  if (!meta) return null;
  const updated = { ...meta, parsed, parsedHash, updatedAt: Date.now() };
  await dataStore.set(characterMetaKey(worldId, kind, name), updated);
  return updated;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/storage/characterLibrary.test.js`
Expected: PASS(13 tests)

- [ ] **Step 5: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 6: Commit**

```bash
git add server/storage/characterLibrary.js server/storage/characterLibrary.test.js
git commit -m "feat(server): add saveCharacterParsed for updating cached goal/bonds without touching raw text"
```

---

## Task 3: routes/characters.js に PUT .../parsed を追加

**Files:**
- Modify: `server/routes/characters.js`
- Modify: `server/routes/characters.test.js`

**Interfaces:**
- Consumes: `saveCharacterParsed`(`server/storage/characterLibrary.js`, Task 2)
- Produces: `PUT /worlds/:worldId/characters/:kind/:name/parsed`(`{parsed, parsedHash}`を受け取り、更新後のキャラクターレコードを返す。存在しなければ404)

- [ ] **Step 1: routes/characters.test.jsに新しいテストを追加(失敗する状態)**

`describe('characters routes', ...)`ブロック内、既存テストの末尾に追加する:

```js
  it('returns 404 when updating parsed for a missing character', async () => {
    const res = await request(app)
      .put('/api/worlds/w1/characters/pc/missing/parsed')
      .send({ parsed: { goal: 'x', bonds: 'y' }, parsedHash: 'h' });
    expect(res.status).toBe(404);
  });

  it('updates parsed and parsedHash without requiring raw', async () => {
    await request(app).put('/api/worlds/w1/characters/pc/alice').send({ raw: '原文' });
    const res = await request(app)
      .put('/api/worlds/w1/characters/pc/alice/parsed')
      .send({ parsed: { goal: '目標', bonds: '因縁' }, parsedHash: 'abc' });
    expect(res.status).toBe(200);
    expect(res.body.parsed).toEqual({ goal: '目標', bonds: '因縁' });

    const get = await request(app).get('/api/worlds/w1/characters/pc/alice');
    expect(get.body.raw).toBe('原文');
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/routes/characters.test.js`
Expected: FAIL(`/parsed`ルートが存在しない)

- [ ] **Step 3: routes/characters.jsを更新**

`import`文に`saveCharacterParsed`を追加する:

```js
import { saveCharacter, getCharacter, listCharacters, deleteCharacter, saveCharacterParsed } from '../storage/characterLibrary.js';
```

既存の`DELETE`ハンドラの直前(あるいは直後、ファイル末尾の`return router;`の前であればどこでもよい)に追加する:

```js
  router.put('/worlds/:worldId/characters/:kind/:name/parsed', asyncHandler(async (req, res) => {
    const character = await saveCharacterParsed(dataStore, req.params.worldId, req.params.kind, req.params.name, {
      parsed: req.body.parsed,
      parsedHash: req.body.parsedHash,
    });
    if (!character) {
      res.status(404).json({ error: 'character not found' });
      return;
    }
    res.json(character);
  }));
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/characters.test.js`
Expected: PASS(7 tests)

- [ ] **Step 5: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 6: Commit**

```bash
git add server/routes/characters.js server/routes/characters.test.js
git commit -m "feat(server): add PUT .../parsed endpoint for updating cached character goal/bonds"
```

---

## Task 4: src/utils/hashText.js(変更検知用の簡易ハッシュ)

**Files:**
- Create: `src/utils/hashText.js`
- Create: `src/utils/hashText.test.js`

**Interfaces:**
- Produces: `hashText(text)` → `string`(決定的、暗号学的安全性は不要)。Task 7(`src/api/characterSheetCache.js`)が消費する。

- [ ] **Step 1: hashText.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect } from 'vitest';
import { hashText } from './hashText.js';

describe('hashText', () => {
  it('returns the same hash for the same text', () => {
    expect(hashText('hello world')).toBe(hashText('hello world'));
  });

  it('returns different hashes for different text', () => {
    expect(hashText('hello')).not.toBe(hashText('world'));
  });

  it('returns a string with no minus sign', () => {
    expect(hashText('x')).not.toMatch(/-/);
  });

  it('handles an empty string deterministically', () => {
    expect(hashText('')).toBe(hashText(''));
    expect(typeof hashText('')).toBe('string');
  });

  it('is sensitive to small changes', () => {
    expect(hashText('goal: 妹を救う')).not.toBe(hashText('goal: 妹を助ける'));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/hashText.test.js`
Expected: FAIL(`hashText.js`が存在しない)

- [ ] **Step 3: hashText.jsを実装**

```js
export function hashText(text) {
  let hash = 0;
  const str = String(text ?? '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/utils/hashText.test.js`
Expected: PASS(5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/hashText.js src/utils/hashText.test.js
git commit -m "feat(frontend): add hashText utility for change detection (not cryptographic)"
```

---

## Task 5: src/api/characterLibraryClient.js(フロントエンドAPIクライアント)

**Files:**
- Create: `src/api/characterLibraryClient.js`
- Create: `src/api/characterLibraryClient.test.js`

**Interfaces:**
- Produces: `getCharacter(worldId, kind, name)`、`putCharacter(worldId, kind, name, { raw, revealed })`、`listCharacters(worldId, kind)`、`deleteCharacter(worldId, kind, name)`、`putCharacterParsed(worldId, kind, name, { parsed, parsedHash })` — いずれも`Promise`(GET/PUT系はサーバーのJSONレスポンス、DELETEは`Promise<void>`)。Task 7(`src/api/characterSheetCache.js`)が`getCharacter`/`putCharacterParsed`を消費する。素材ライブラリ画面(サブプロジェクト4)が他の関数も使う想定。

- [ ] **Step 1: characterLibraryClient.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCharacter, putCharacter, listCharacters, deleteCharacter, putCharacterParsed } from './characterLibraryClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getCharacter', () => {
  it('GETs a character', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'alice' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getCharacter('w1', 'pc', 'alice');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/characters/pc/alice',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual({ id: 'alice' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getCharacter('w1', 'pc', 'missing')).rejects.toThrow('API error 404: not found');
  });
});

describe('putCharacter', () => {
  it('PUTs raw and revealed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'alice' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putCharacter('w1', 'pc', 'alice', { raw: 'PC名: アリス', revealed: undefined });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/characters/pc/alice',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ raw: 'PC名: アリス', revealed: undefined }),
      })
    );
  });
});

describe('listCharacters', () => {
  it('GETs the list for a world and kind', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'alice' }] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listCharacters('w1', 'pc');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/characters/pc',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual([{ id: 'alice' }]);
  });
});

describe('deleteCharacter', () => {
  it('DELETEs a character and does not attempt to parse a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteCharacter('w1', 'pc', 'alice')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/characters/pc/alice',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteCharacter('w1', 'pc', 'alice')).rejects.toThrow('API error 500: boom');
  });
});

describe('putCharacterParsed', () => {
  it('PUTs parsed and parsedHash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'alice' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putCharacterParsed('w1', 'pc', 'alice', { parsed: { goal: 'x', bonds: 'y' }, parsedHash: 'h1' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/characters/pc/alice/parsed',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ parsed: { goal: 'x', bonds: 'y' }, parsedHash: 'h1' }),
      })
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/characterLibraryClient.test.js`
Expected: FAIL(`characterLibraryClient.js`が存在しない)

- [ ] **Step 3: characterLibraryClient.jsを実装**

```js
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function getCharacter(worldId, kind, name) {
  return apiFetch(`/api/worlds/${worldId}/characters/${kind}/${name}`, { method: 'GET' });
}

export async function putCharacter(worldId, kind, name, { raw, revealed }) {
  return apiFetch(`/api/worlds/${worldId}/characters/${kind}/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw, revealed }),
  });
}

export async function listCharacters(worldId, kind) {
  return apiFetch(`/api/worlds/${worldId}/characters/${kind}`, { method: 'GET' });
}

export async function deleteCharacter(worldId, kind, name) {
  const res = await fetch(`/api/worlds/${worldId}/characters/${kind}/${name}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}

export async function putCharacterParsed(worldId, kind, name, { parsed, parsedHash }) {
  return apiFetch(`/api/worlds/${worldId}/characters/${kind}/${name}/parsed`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parsed, parsedHash }),
  });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/characterLibraryClient.test.js`
Expected: PASS(7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/characterLibraryClient.js src/api/characterLibraryClient.test.js
git commit -m "feat(frontend): add thin fetch client for character API"
```

---

## Task 6: src/api/characterSheetParse.js(AI抽出呼び出し)

**Files:**
- Create: `src/api/characterSheetParse.js`
- Create: `src/api/characterSheetParse.test.js`

**Interfaces:**
- Consumes: `callClaude, extractText, parseJsonLoose`(`src/api/client.js`, 既存)
- Produces: `parseCharacterSheet(raw)` → `Promise<{ goal: string, bonds: string }>`。Task 7(`src/api/characterSheetCache.js`)が消費する。**重要**: `getOrParseCharacter`から正しくモックできるよう、この関数は`src/api/characterSheetCache.js`とは別ファイルに置く(Global Constraints参照)。

- [ ] **Step 1: characterSheetParse.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCharacterSheet } from './characterSheetParse.js';
import * as client from './client.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('parseCharacterSheet', () => {
  it('parses goal and bonds from the model response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ goal: '妹を救い出す', bonds: '幼馴染のNPC' }) }],
    });
    const result = await parseCharacterSheet('PC名: アリス\ngoal: 妹を救い出す\nbonds: 幼馴染のNPC');
    expect(result).toEqual({ goal: '妹を救い出す', bonds: '幼馴染のNPC' });
  });

  it('defaults goal and bonds to empty strings when the model omits them', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({}) }],
    });
    const result = await parseCharacterSheet('PC名: ボブ');
    expect(result).toEqual({ goal: '', bonds: '' });
  });

  it('sends the raw character sheet as the user message', async () => {
    const callClaudeMock = vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ goal: '', bonds: '' }) }],
    });
    await parseCharacterSheet('PC名: キャロル');
    expect(callClaudeMock.mock.calls[0][0].messages[0].content).toBe('PC名: キャロル');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/characterSheetParse.test.js`
Expected: FAIL(`characterSheetParse.js`が存在しない)

- [ ] **Step 3: characterSheetParse.jsを実装**

```js
import { callClaude, extractText, parseJsonLoose } from './client.js';

export async function parseCharacterSheet(raw) {
  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `以下のキャラクターシートから goal(目標)・bonds(因縁・関係)を抽出せよ。

# 出力形式(厳守)
説明文やコードブロック記号を一切付けず、次のJSONのみを出力すること:
{"goal": "このキャラクターが物語を通じて達成したいこと(記載がなければ空文字列)", "bonds": "他PC/NPC/世界との因縁・関係(記載がなければ空文字列)"}`,
    messages: [{ role: 'user', content: raw }],
  });
  const text = extractText(data.content);
  const parsed = parseJsonLoose(text);
  return {
    goal: parsed.goal || '',
    bonds: parsed.bonds || '',
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/characterSheetParse.test.js`
Expected: PASS(3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/characterSheetParse.js src/api/characterSheetParse.test.js
git commit -m "feat(frontend): add AI-driven character sheet goal/bonds extraction"
```

---

## Task 7: src/api/characterSheetCache.js(getOrParseCharacter)

**Files:**
- Create: `src/api/characterSheetCache.js`
- Create: `src/api/characterSheetCache.test.js`

**Interfaces:**
- Consumes: `parseCharacterSheet`(`src/api/characterSheetParse.js`, Task 6)。`getCharacter, putCharacterParsed`(`src/api/characterLibraryClient.js`, Task 5)。`hashText`(`src/utils/hashText.js`, Task 4)
- Produces: `getOrParseCharacter(worldId, kind, name)` → `Promise<{ goal: string, bonds: string }>`。UIからの呼び出しは別サブプロジェクト(本タスクでは呼び出し元を作らない)。

- [ ] **Step 1: characterSheetCache.test.jsを書く(失敗する状態)**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrParseCharacter } from './characterSheetCache.js';
import * as characterSheetParse from './characterSheetParse.js';
import * as characterLibraryClient from './characterLibraryClient.js';
import { hashText } from '../utils/hashText.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getOrParseCharacter', () => {
  it('returns the cached parsed result when the hash matches', async () => {
    const raw = 'PC名: アリス\ngoal: 妹を救い出す';
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw,
      parsed: { goal: '妹を救い出す', bonds: '' },
      parsedHash: hashText(raw),
    });
    const parseSpy = vi.spyOn(characterSheetParse, 'parseCharacterSheet');
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed');

    const result = await getOrParseCharacter('w1', 'pc', 'alice');

    expect(result).toEqual({ goal: '妹を救い出す', bonds: '' });
    expect(parseSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('re-parses and saves when there is no cached parsed result', async () => {
    const raw = 'PC名: ボブ';
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({ raw, parsed: null, parsedHash: null });
    vi.spyOn(characterSheetParse, 'parseCharacterSheet').mockResolvedValue({ goal: 'x', bonds: 'y' });
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed').mockResolvedValue({});

    const result = await getOrParseCharacter('w1', 'pc', 'bob');

    expect(result).toEqual({ goal: 'x', bonds: 'y' });
    expect(putSpy).toHaveBeenCalledWith('w1', 'pc', 'bob', {
      parsed: { goal: 'x', bonds: 'y' },
      parsedHash: hashText(raw),
    });
  });

  it('re-parses when the stored hash does not match the current raw text', async () => {
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw: '新しい原文',
      parsed: { goal: '古い目標', bonds: '' },
      parsedHash: 'stale-hash',
    });
    vi.spyOn(characterSheetParse, 'parseCharacterSheet').mockResolvedValue({ goal: '新しい目標', bonds: '' });
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed').mockResolvedValue({});

    const result = await getOrParseCharacter('w1', 'pc', 'alice');

    expect(result).toEqual({ goal: '新しい目標', bonds: '' });
    expect(putSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/characterSheetCache.test.js`
Expected: FAIL(`characterSheetCache.js`が存在しない)

- [ ] **Step 3: characterSheetCache.jsを実装**

```js
import { parseCharacterSheet } from './characterSheetParse.js';
import { getCharacter, putCharacterParsed } from './characterLibraryClient.js';
import { hashText } from '../utils/hashText.js';

export async function getOrParseCharacter(worldId, kind, name) {
  const character = await getCharacter(worldId, kind, name);
  const currentHash = hashText(character.raw);
  if (character.parsed && character.parsedHash === currentHash) {
    return character.parsed;
  }
  const parsed = await parseCharacterSheet(character.raw);
  await putCharacterParsed(worldId, kind, name, { parsed, parsedHash: currentHash });
  return parsed;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/characterSheetCache.test.js`
Expected: PASS(3 tests)

- [ ] **Step 5: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS(Task1〜7で追加した全テストファイルを含む)

- [ ] **Step 6: ビルドを確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 7: Commit**

```bash
git add src/api/characterSheetCache.js src/api/characterSheetCache.test.js
git commit -m "feat(frontend): add getOrParseCharacter cache orchestration"
```

---

## Self-Review Notes

- **Spec coverage**: spec docのScenario recommended_ruleset・Character構造化パイプライン(hashText/characterLibraryClient/characterSheetParse/characterSheetCache)全てにタスクが対応。
- **Placeholder scan**: 「TBD」等の記述なし。全ステップに実行可能なコード/コマンドを記載。
- **モック可能性の検証**: `characterSheetParse.js`と`characterSheetCache.js`を別ファイルに分離したのは、サブプロジェクト2の`worldSplit.js`/`worldImport.js`分離と同じ理由・同じ検証済みパターン。
- **既存ファイルへの変更の安全性**: `saveCharacter`のmeta生成に`parsed: null, parsedHash: null`を追加する変更は、既存テストが`toMatchObject`や部分フィールド比較を使っているため、既存の緑テストを壊さない(Task 2 Step 1で追加する新規テストのみがこの新フィールドを検証する)。
- **非スコープの遵守**: GMプロンプトへのgoal/bonds注入配線、Scenarioの構造化(relevant_docs/climax_marker)、NPCのrevealed_facts要素単位管理、UI結線は本プランのどのタスクにも含まれていない。
