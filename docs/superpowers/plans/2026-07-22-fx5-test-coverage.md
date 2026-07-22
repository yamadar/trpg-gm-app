# FX5 テスト補強 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 監査で洗い出した高価値のテストカバレッジ欠落(Playの操作/エラー経路、クライアント↔サーバー実結合、parseJsonLooseの現実的失敗、Setupの致命エラー、storage/indexの失敗経路)を、追加テストのみで埋める。

**Architecture:** 既存のVitestハーネスを流用してテストを追加する。プロダクションコードは変更しない(テストが実バグを検出した場合のみ、そのタスク内で最小修正し、レビューで報告する)。新規結合テスト1本(`src/api/integration.test.js`)を除き、既存テストファイルへの追記。

**Tech Stack:** Vitest(`globals: false` — import必須)、`@testing-library/react`(jsdom)、`supertest` + `createApp`(node環境)、`fake-indexeddb`(setupFiles経由)。

## Global Constraints

- テストは明示的import方式(`import { describe, it, expect, vi } from 'vitest'`)。`globals: false`のためグローバルの`describe`等は使えない。
- **プロダクションコード(`src/**` の非テスト、`server/**` の非テスト)は変更しない。** テストが実バグを検出した場合のみ、そのタスク内で最小修正し、レビュー報告で明示する。
- 各タスクの完了時に、そのタスクで追加したテストファイルの`vitest run <file>`が緑であることを確認する。
- 追加テストは**退行検出力を持つ**こと: 対象のプロダクションコードを壊すと失敗する(タウトロジー禁止)。レビューではablation(該当行を一時的に壊してテストが失敗するか)で確認する。
- 既存の全テスト(`npm test`)を壊さないこと。テスト間の副作用リーク(spyの残留等)を作らない。
- Ruleset/growthUnitやstate形状など既存の値は、既存テスト(`Play.test.jsx`/`Setup.test.jsx`)の`makeSession`/mockに合わせる。

---

### Task 1: Play.jsx 操作・エラー経路テスト

`src/screens/Play.test.jsx`は現状`fireEvent`ゼロで、プレイループの中核操作が未検証。既存の`Harness`(親stateを持つラッパ)と`beforeEach`のfetch/putSessionToServerモックを流用して操作系テストを追加する。

**Files:**
- Modify: `src/screens/Play.test.jsx`(import行に`fireEvent`追加、`describe('Play', ...)`内にテスト追加)

**Interfaces:**
- Consumes(既存、変更不可):
  - `Harness({ initialSession, onExit })` — 親stateで`Play`をラップ済み(ファイル内定義)。
  - `makeSession(overrides)` — 既定`state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], turn_count: 0 }`、`log: []`。
  - `beforeEach`のfetchモック: `{ content: [{ type:'text', text: JSON.stringify({ narrative:'物語が始まった。', state_update:{ xp_gained:5 }, choices:['進む'] }) }] }` を返す。`sessionSyncClient.putSessionToServer`は`{}`にspy済み(fetch回数に影響しない)。
  - `Play`の入力欄placeholder: `'PCの行動を自由に書く…'`、送信ボタン文言: `'送る'`、選択肢はGM応答の`choices`がButton化(最後のGM行のみ表示)。Enterは`onKeyDown`で`e.key==='Enter' && !e.nativeEvent.isComposing`のとき送信。失敗時は入力を復元(`submitFree`)。
- Produces: なし(テストのみ)。

- [ ] **Step 1: import行に`fireEvent`を追加**

`src/screens/Play.test.jsx`の2〜3行目を次に置き換える(既存は`render, screen, waitFor`):

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
```

- [ ] **Step 2: 失敗するテスト群を`describe('Play', ...)`の末尾(閉じ`});`の直前)に追加**

```jsx
  it('logs the player utterance and fetches a new GM turn when free input is submitted', async () => {
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '森へ進む' } });
    fireEvent.click(screen.getByText('送る'));
    await waitFor(() => expect(screen.getByText('森へ進む')).toBeInTheDocument());
    // 開始ターン + 送信ターンで計2回
    expect(global.fetch).toHaveBeenCalledTimes(2);
    // 送信時に入力欄はクリアされる
    expect(box.value).toBe('');
  });

  it('advances a turn when a choice button is clicked', async () => {
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('進む')); // GM応答の選択肢ボタン
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });

  it('submits on Enter when IME composition is not active', async () => {
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '扉を開ける' } });
    fireEvent.keyDown(box, { key: 'Enter' }); // isComposing未指定=false相当
    await waitFor(() => expect(screen.getByText('扉を開ける')).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not submit on Enter while IME composition is active', async () => {
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '変換中' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true }); // IME変換確定のEnter
    // 送信されない: fetchは開始ターンの1回のまま、入力は保持
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(box.value).toBe('変換中');
  });

  it('shows an error and restores the submitted input when the model returns unparseable output', async () => {
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    // 次のターンだけJSONを含まないテキストを返す(parseJsonLooseが投げる)
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'ここにJSONは無い' }] }),
    });
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '罠を調べる' } });
    fireEvent.click(screen.getByText('送る'));
    await waitFor(() => expect(screen.getByText(/GM応答の取得に失敗した/)).toBeInTheDocument());
    // busy解除後、送信した入力が入力欄へ復元される
    expect(box.value).toBe('罠を調べる');
  });

  it('persists the session via saveSession after a turn (regression pin)', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession'); // 既定は本実装を呼ぶ(fake-indexeddb)
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
  });
```

- [ ] **Step 3: 追加テストの実行(緑を確認)**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS(既存テスト含めファイル全体が緑)。

- [ ] **Step 4: 退行検出の自己確認(ablation、コミット前・手動)**

一時的に`src/screens/Play.jsx`の`submitFree`内の入力復元行`if (!ok) setInput(text);`(94行目付近)をコメントアウトし、`unparseable output`テストが失敗することを確認 → 戻す。同様に`saveSession(updated)`呼び出し(59行目付近)を一時削除し`regression pin`テストが失敗することを確認 → 戻す。**プロダクションコードは元に戻すこと。**

- [ ] **Step 5: Commit**

```bash
git add src/screens/Play.test.jsx
git commit -m "test(play): cover free input, choice, Enter/IME, parse-error recovery, save pin"
```

---

### Task 2: クライアント↔サーバー実結合テスト

`supertest`を使う実結合テストが皆無で、クライアントのURL組み立て・ボディ形状・エンコード・FX3パラメータガードが別ファイルの目視一致頼み。`createApp`を一時ディレクトリで生成し、`fetch`をsupertestラッパにstubして、実クライアント関数が実Expressルートへ往復する新規テストを作る。**node環境で実行**(supertest + 実express)。

**Files:**
- Create: `src/api/integration.test.js`

**Interfaces:**
- Consumes(既存、変更不可):
  - `createApp({ apiKey, dataDir, fetchImpl })` from `../../server/index.js` — Expressアプリを返す。`app.use(express.json({ limit:'2mb' }))`。グローバルエラーハンドラは`err.status`を尊重。
  - クライアント関数(全て内部で`fetch(url, options)`を呼び、非okで`throw new Error('API error <status>: ...')`):
    - `putCharacter(worldId, kind, name, { raw, revealed })` / `getCharacter(worldId, kind, name)` from `./characterLibraryClient.js` — URLは各セグメントを`encodeURIComponent`。PUTは`{ raw, revealed }`をJSONボディ送信。
    - `putWorld(id, { title, raw })` / `putRegion(worldId, region, raw)` / `listRegions(worldId)` / `deleteWorld(id)` from `./worldLibraryClient.js`。`listRegions`はid文字列の配列を返す。`deleteWorld`は204でボディをparseしない。
  - サーバー応答: charactersのPUT/GETは保存済みcharacterオブジェクト(`{ raw, ... }`)をjsonで返す。worldContentのregion PUTは`{ id, raw }`。`listRegions`は`['north', ...]`。存在しないworldの`listRegions`は`[]`(textStoreがENOENTで`[]`)。不正パラメータ(`/`含む)は`idParamGuard`が400。
- Produces: なし(テストのみ)。

- [ ] **Step 1: 新規テストファイルを作成(失敗する状態)**

`src/api/integration.test.js`:

```jsx
/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../../server/index.js';
import { putCharacter, getCharacter } from './characterLibraryClient.js';
import { putWorld, putRegion, listRegions, deleteWorld } from './worldLibraryClient.js';

let dataDir;
let app;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fx5-integration-'));
  app = createApp({ apiKey: 'test-key', dataDir });
  // 実クライアントは相対URLでglobal fetchを呼ぶ。supertestで実appへ往復させるシムに差し替える。
  vi.stubGlobal('fetch', async (url, options = {}) => {
    const method = (options.method || 'GET').toLowerCase();
    let req = request(app)[method](url);
    if (options.headers) req = req.set(options.headers);
    if (options.body != null) req = req.send(options.body); // JSON文字列。Content-Typeは.setで設定済み
    const res = await req;
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      json: async () => res.body,
      text: async () => (typeof res.text === 'string' ? res.text : JSON.stringify(res.body)),
    };
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('client ↔ server integration', () => {
  it('round-trips a character through putCharacter/getCharacter', async () => {
    await putCharacter('w1', 'pc', 'alice', { raw: 'PC本文', revealed: undefined });
    const got = await getCharacter('w1', 'pc', 'alice');
    expect(got).toMatchObject({ raw: 'PC本文' });
  });

  it('deletes region content on the server when a world is deleted (FX3 cascade)', async () => {
    await putWorld('w1', { title: 'W', raw: '世界本文' });
    await putRegion('w1', 'north', '北の本文');
    expect(await listRegions('w1')).toContain('north');
    await deleteWorld('w1'); // 204。ボディをparseしないこともここで暗黙に検証
    expect(await listRegions('w1')).toEqual([]);
  });

  it('propagates a 400 from the server param guard when the client sends a slash-bearing id (FX3 guard e2e)', async () => {
    // client側でencodeURIComponent('a/b')='a%2Fb' → サーバーで'/'へデコード → idParamGuardが拒否
    await expect(
      putCharacter('w1', 'pc', 'a/b', { raw: 'x', revealed: undefined })
    ).rejects.toThrow('API error 400');
  });
});
```

- [ ] **Step 2: テスト実行(緑を確認)**

Run: `npx vitest run src/api/integration.test.js`
Expected: PASS(3テスト)。node環境で実express往復。

失敗時の切り分け:
- `fetch is not a function`等 → シムのstub前にクライアントが呼ばれていないか確認。
- 400テストが`API error 400`でなく別エラー(例`t.slice`のTypeError)で落ちる → シムの`text()`が文字列を返しているか確認(上記実装で担保済み)。

- [ ] **Step 3: 退行検出の自己確認(ablation、手動)**

一時的に`src/api/characterLibraryClient.js`の`getCharacter`のURLから`encodeURIComponent`を外す、または`putCharacter`のボディ`{ raw, revealed }`を`{ raw }`に変えるなどしてround-trip/400テストが崩れることを確認 → 戻す。**プロダクションコードは元に戻すこと。**

- [ ] **Step 4: Commit**

```bash
git add src/api/integration.test.js
git commit -m "test(api): client<->server integration via supertest fetch shim (round-trip, cascade, guard 400)"
```

---

### Task 3: parseJsonLoose 現実的失敗コーパス

`src/api/client.js`の`parseJsonLoose`は途中切れ・末尾散文・コードフェンス混在といった現実的なLLM出力に対する挙動が3ケースしか検証されていない。既存の`describe('parseJsonLoose', ...)`にケースを追加する。

**Files:**
- Modify: `src/api/client.test.js`(`describe('parseJsonLoose', ...)`内にテスト追加)

**Interfaces:**
- Consumes(既存、変更不可): `parseJsonLoose(text)` — ```` ```json ````/```` ``` ````を除去しtrim、最初の`{`〜最後の`}`をsliceして`JSON.parse`。どちらかの波括弧が無ければ`throw new Error('JSON not found in response')`。
- Produces: なし(テストのみ)。

- [ ] **Step 1: 失敗するテストを`describe('parseJsonLoose', ...)`の末尾(閉じ`});`の直前)に追加**

```jsx
  it('throws when the JSON object is truncated with no closing brace', () => {
    expect(() => parseJsonLoose('{"narrative": "途中で切れ')).toThrow('JSON not found in response');
  });

  it('extracts the object when prose follows the closing brace', () => {
    expect(parseJsonLoose('{"a": 1}\n以上です。よろしく。')).toEqual({ a: 1 });
  });

  it('extracts the object when a prologue precedes a fenced block', () => {
    expect(parseJsonLoose('了解しました。\n```json\n{"a": 1}\n```\nさらに続きます')).toEqual({ a: 1 });
  });
```

- [ ] **Step 2: テスト実行(緑を確認)**

Run: `npx vitest run src/api/client.test.js`
Expected: PASS(ファイル全体が緑)。

- [ ] **Step 3: Commit**

```bash
git add src/api/client.test.js
git commit -m "test(client): parseJsonLoose corpus (truncated, trailing prose, prologue+fence)"
```

---

### Task 4: Setup 致命的エラー経路テスト

`src/screens/Setup.test.jsx`にはSetupの正常系はあるが、`generateScenario`失敗時の致命的エラー経路(`handleStart`の外側catch)が未検証。既存のモック方式(`* as sessionApi`をspy)とウィザード遷移(既定skip World + 既定paste空Scenario→fallback生成)を流用する。

**Files:**
- Modify: `src/screens/Setup.test.jsx`(`describe('Setup', ...)`内にテスト追加)

**Interfaces:**
- Consumes(既存、変更不可):
  - `beforeEach`: `worldLibraryClient.listWorlds`→`[]`、`characterLibraryClient.listCharacters`→`[]`、`rulesetLibraryClient.listRulesets`→`[]`をspy済み。`vi.restoreAllMocks()`も実行済み。
  - `sessionApi` = `* as ../api/session.js`。`generateScenario`をspyできる。
  - ウィザード: 既定でWorldは`空欄のまま進める`(skip)相当、Scenarioは既定`paste`でscenarioRaw空 → `handleStart`のfallback経路で`generateScenario('自由なジャンルで', ...)`が呼ばれる。各ステップは`次へ`で遷移、確認ステップの開始ボタンは`ゲーム開始`(busy中は`準備中…`)。失敗時は`setError('開始処理に失敗した: ' + e.message)`、`onStart`は呼ばれない、`finally`で`busy`解除。
- Produces: なし(テストのみ)。

- [ ] **Step 1: 失敗するテストを`describe('Setup', ...)`の末尾(閉じ`});`の直前)に追加**

```jsx
  it('surfaces a fatal error and does not start the session when scenario generation fails', async () => {
    vi.spyOn(sessionApi, 'generateScenario').mockRejectedValue(new Error('LLM down'));
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    // World(既定skip) -> Scenario(既定paste空) -> Ruleset -> PC -> 確認
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(screen.getByText(/開始処理に失敗した/)).toBeInTheDocument());
    expect(onStart).not.toHaveBeenCalled();
    // busy解除でボタン文言が"ゲーム開始"へ戻る(準備中…のままにならない)
    expect(screen.getByText('ゲーム開始')).toBeInTheDocument();
  });
```

- [ ] **Step 2: テスト実行(緑を確認)**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: PASS(ファイル全体が緑)。

失敗時の切り分け: `generateScenario`が呼ばれず`onStart`が成功してしまう場合、既定のworld/scenarioモードが想定と違う可能性 → ウィザードの既定モード(skip World / paste空Scenario)を`src/screens/Setup.jsx`の`handleStart`で再確認。

- [ ] **Step 3: 退行検出の自己確認(ablation、手動)**

一時的に`src/screens/Setup.jsx`の`handleStart`外側catchの`setError('開始処理に失敗した: ' + e.message)`(268行目付近)を削除すると、このテストの`開始処理に失敗した`アサートが失敗することを確認 → 戻す。**プロダクションコードは元に戻すこと。**

- [ ] **Step 4: Commit**

```bash
git add src/screens/Setup.test.jsx
git commit -m "test(setup): fatal error path when scenario generation rejects"
```

---

### Task 5: storage/index.js 失敗経路テスト

`src/storage/index.js`の4つのcatch(IndexedDB失敗時のフォールバック)が未検証。`indexedDbStore`をモジュール名前空間spyで拒否させ、各公開関数のフォールバック値を検証する。既存の`index.test.js`の`beforeEach`(DBクローズ+削除)はそのまま流用。

**Files:**
- Modify: `src/storage/index.test.js`(import追加、`afterEach`追加、失敗経路テスト追加)

**Interfaces:**
- Consumes(既存、変更不可):
  - `isStorageAvailable()` / `listSessions()` / `getSession(id)` / `saveSession(session)` from `./index.js`。各々try/catchで失敗時は`false`/`[]`/`null`/`false`を返す(例外を投げない)。
  - `./indexedDbStore.js`のnamed export: `putSession` / `getSessionById` / `getAllSessions` / `deleteSession`。`index.js`はこれらを名前付きimportして使う。
  - `isStorageAvailable`は`putSession`(ping書き込み)→`getSessionById`→`deleteSession`の順に呼ぶ。`putSession`が拒否すれば`false`。
- Produces: なし(テストのみ)。

- [ ] **Step 1: import行を差し替え、名前空間importと`afterEach`を追加**

`src/storage/index.test.js`の1〜4行目を次に置き換える(既存importに`vi`/`afterEach`を追加し、`indexedDbStore`を名前空間import):

```jsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { deleteDB } from 'idb';
import { isStorageAvailable, listSessions, getSession, saveSession } from './index.js';
import * as idb from './indexedDbStore.js';
import { DB_NAME, closeDb } from './indexedDbStore.js';
```

`beforeEach`ブロックの直後(`describe(...)`の前)に次を追加:

```jsx
afterEach(() => {
  vi.restoreAllMocks();
});
```

- [ ] **Step 2: 失敗するテストを`describe('client session storage', ...)`の末尾(閉じ`});`の直前)に追加**

```jsx
  it('reports storage unavailable when the ping write rejects', async () => {
    vi.spyOn(idb, 'putSession').mockRejectedValueOnce(new Error('quota exceeded'));
    expect(await isStorageAvailable()).toBe(false);
  });

  it('saveSession returns false when the write rejects, without throwing', async () => {
    vi.spyOn(idb, 'putSession').mockRejectedValueOnce(new Error('disk full'));
    await expect(saveSession({ id: 'x', updatedAt: 1 })).resolves.toBe(false);
  });

  it('listSessions returns an empty array when the underlying read rejects', async () => {
    vi.spyOn(idb, 'getAllSessions').mockRejectedValueOnce(new Error('io error'));
    expect(await listSessions()).toEqual([]);
  });

  it('getSession returns null when the underlying read rejects', async () => {
    vi.spyOn(idb, 'getSessionById').mockRejectedValueOnce(new Error('io error'));
    expect(await getSession('x')).toBeNull();
  });
```

- [ ] **Step 3: テスト実行(緑を確認)**

Run: `npx vitest run src/storage/index.test.js`
Expected: PASS(既存5 + 追加4)。

**重要 — spy貫通の確認:** `vi.spyOn(idb, 'putSession')`が`index.js`の呼び出しを差し替えられなかった場合(テストが期待値でなく実挙動で通ってしまう)は、上記ablationで検出する(Step 4)。同リポジトリでは`Play.test.jsx`が`storage.saveSession`をnamespace spyで差し替えて機能しており(module間のnamespace spyが有効)、同じ仕組みが`index.js`↔`indexedDbStore.js`にも当てはまる。万一貫通しない場合のみ、`vi.mock`ではなく(happy-path用に実fake-indexeddbが必要)、テスト側での関数注入不可のため、レビューへエスカレーションする。

- [ ] **Step 4: 退行検出の自己確認(ablation、手動)**

`reports storage unavailable`テストが実際に失敗経路を通っていることを確認するため、spyが効いているかを一時ログで確認するか、`mockRejectedValueOnce`を`mockResolvedValueOnce({ id:'__ping__' })`に変えると`isStorageAvailable`が`true`を返し当該テストが失敗することを確認 → 戻す。これによりテストがspy貫通に依存して真に失敗経路を検証していることを担保する。

- [ ] **Step 5: Commit**

```bash
git add src/storage/index.test.js
git commit -m "test(storage): index.js failure paths (ping/save/list/get reject fallbacks)"
```

---

### Task 6: 全体テスト + 最終レビュー

**Files:** なし(検証とレビューのみ)

- [ ] **Step 1: 全体テスト + ビルド**

Run: `npm test`
Expected: 全テスト緑。テスト数が既存(341)+ 今回追加分だけ増加していること(worktree二重計上が無いこと)。

Run: `npm run build`
Expected: ビルド成功。

- [ ] **Step 2: 最終whole-branchレビュー**

`scripts/review-package <merge-base> HEAD`で差分パッケージを生成し、最も高性能なモデルでレビューを1回dispatchする。レビュー観点:
- 追加テストが全て退行検出力を持つ(タウトロジーでない)。特にTask 2のfetchシムとTask 5のnamespace spyが「実結合/実失敗経路」を通していること。
- プロダクションコードが変更されていないこと(変更があれば実バグ修正として正当か)。
- テスト間の副作用リーク(spy残留、temp dir残留、global stub残留)が無いこと。
- Global Constraints(explicit import、`globals: false`)遵守。

Critical/Important指摘は1つのfix subagentでまとめて修正 → 再レビュー。

- [ ] **Step 3: finishing-a-development-branch**

`superpowers:finishing-a-development-branch`でmainへのマージ(オプション1)を実施。マージ後、**worktreeを削除してから**main rootで`npm test`を再実行し、テスト数が正しい(worktree二重計上なし)ことを最終確認する。

## Self-Review(この計画の自己チェック結果)

- **Spec coverage:** FX5 specの3.1→Task1、3.2→Task2、3.3→Task3、3.4→Task4、3.5→Task5、完了条件(全体緑+退行検出)→Task6。全項目カバー。
- **Placeholder scan:** 各stepに実テストコードを記載済み。TBD/TODOなし。
- **Type/interface整合:** `makeSession`のstate形状、fetchモックのnarrative`物語が始まった。`/choices`進む`、placeholder`PCの行動を自由に書く…`、送信ボタン`送る`、Setupの`次へ`/`ゲーム開始`/`開始処理に失敗した`、クライアント関数シグネチャ(`putCharacter(worldId,kind,name,{raw,revealed})`等)、`listRegions`がid配列、`createApp({apiKey,dataDir})`、`indexedDbStore`のexport名は全て実ファイルで確認済み。
- **依存の実挙動確認済み:** `takeTurn`は`parseJsonLoose`の例外を伝播(内部catchなし)。`textStore.list`はENOENTで`[]`。`deleteWorld`は`deleteDir('worlds/'+id)`でcascade。express paramは`%2F`を`/`へデコードしguardが400。
