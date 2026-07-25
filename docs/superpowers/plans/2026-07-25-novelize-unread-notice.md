# 小説化の完了通知の永続化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小説化の完了通知(完了ブロックとトースト)を、画面遷移・リロード・タブを閉じるのすべてを跨いで保持する。

**Architecture:** 生成が成功した瞬間にジョブランナーがサーバー側へ「未読」フラグを立て、クライアントが通知を出したら降ろす。「既読記録が無い=未読」という判定にしないことで、既存の小説が一斉に未読になるのを構造的に防ぐ。クライアントの完了通知は遷移検知から `unread` 駆動へ一本化し、二重通知を経路レベルで排除する。

**Tech Stack:** React 18(hooks、インラインスタイル)、Express、Vitest + @testing-library/react + supertest、jsdom

設計ドキュメント: `docs/superpowers/specs/2026-07-25-novelize-unread-notice-design.md`

## Global Constraints

- テストは `npx vitest run <path>` で個別実行、全体は `npm test`。
- コード中のコメントは日本語。「何をしているか」ではなく「なぜそうしたか」を書く(既存コードの方針)。
- コミットメッセージは Conventional Commits + 日本語の要約。本文末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付ける。
- 確定文言(一字一句変えないこと):
  - トースト(成功): `「{セッション名}」の小説ができました`
  - トースト(失敗): `「{セッション名}」の小説化に失敗しました`
- notice レコードが**無い**場合は必ず `unread: false`(既読)として扱う。これがこの機能の後方互換の要であり、破ると既存ユーザーの全小説が一斉に通知される。
- 生成が**失敗**したときは notice を書かない。失敗は `status: 'error'` とエラー行がサーバー状態として残るため、永続通知は不要。
- `truncated: true`(末尾が欠けた完了)でも `unread: true` を立てる。ユーザーにとっては小説ができた事実に変わりはない。
- 既読化のPOSTが失敗しても、UIにエラーを出さない。握りつぶし、次回 Home を開いたときに再通知させる。
- 完了ブロックの消え方は変更しない(DL・挿絵付きDL・再生成のみ)。既読化は画面表示を消す操作ではない。

### 設計ドキュメントからの変更点

設計ドキュメントは既読化エンドポイントを `204` と書いているが、**`200 { ok: true }` に変更する。**

`src/api/apiFetch.js` は成功時に無条件で `res.json()` を呼ぶため、204(空ボディ)ではパースに失敗する。この制約のため既存の204エンドポイント(`server/routes/publish.js` など)はクライアント側で `rawDelete`(生の `fetch`)という別ヘルパーを使っている(`src/api/shareClient.js`)。

一方 `src/api/sessionSyncClient.js` は全関数が `apiFetch` を使っており、生fetchヘルパーを持たない。この1本のためだけに2つ目のパターンを持ち込むより、JSONを返すほうがファイルの一貫性が保たれる。同ファイルの `POST /sessions/:id/novelize` も既に `202 { status: 'running' }` とJSONを返している。

Task 2 の実装時に設計ドキュメントの該当箇所も修正すること。

## File Structure

| ファイル | 責務 |
|---|---|
| `server/storage/paths.js`(変更) | `sessionNovelNoticeKey` を追加。キー命名の単一の置き場 |
| `server/novelJobs.js`(変更) | 生成成功時に notice を立てる |
| `server/routes/sessions.js`(変更) | `/novel-jobs` が `unread` を返す。既読化エンドポイント |
| `src/api/sessionSyncClient.js`(変更) | `markNovelSeen(id)` を追加 |
| `src/screens/Home.jsx`(変更) | `unread` 駆動の通知、`announcedRef`、`collectJobEvents` の縮小 |

notice を小説のメタ(`sessionNovelMetaKey`)に相乗りさせない。メタはジョブランナーが毎回オブジェクトごと上書きするため、既読化の書き込みと生成完了の書き込みが競合する。

---

### Task 1: 生成成功時に未読フラグを立てる

**Files:**
- Modify: `server/storage/paths.js`
- Modify: `server/novelJobs.js`
- Test: `server/novelJobs.test.js`

**Interfaces:**
- Consumes: なし(このタスクが最初)
- Produces:
  - `sessionNovelNoticeKey(userId, sessionId)` → `` `users/${userId}/sessions/${sessionId}/novelNotice` ``
  - 生成成功後、そのキーに `{ unread: true }` が保存されている

- [ ] **Step 1: 失敗するテストを書く**

`server/novelJobs.test.js` の import に `sessionNovelNoticeKey` を追加する。既存の import 文を次で置き換える。

```js
import { sessionNovelJobKey, sessionNovelNoticeKey } from './storage/paths.js';
```

`describe('createNovelJobRunner', ...)` 相当のブロック(`createNovelJobRunner` を使うテストが並んでいる場所)の末尾に次の3つを追加する。

```js
  it('marks the novel as unread when generation succeeds', async () => {
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl: okFetch(), bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect(await dataStore.get(sessionNovelNoticeKey('u1', 's1'))).toEqual({ unread: true });
  });

  it('does not mark anything unread when generation fails', async () => {
    // 失敗は status:'error' とエラー行がサーバー状態として残るため、
    // 永続通知は要らない。noticeを書くと消せない通知になってしまう。
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect(await dataStore.get(sessionNovelNoticeKey('u1', 's1'))).toBeNull();
  });

  it('marks the novel as unread even when it was truncated', async () => {
    // 末尾が欠けていても「小説ができた」ことに変わりはない。欠落は別途警告される。
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '途中' }], stop_reason: 'max_tokens' }),
    });
    const runner = createNovelJobRunner({
      dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1',
    });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect(await dataStore.get(sessionNovelNoticeKey('u1', 's1'))).toEqual({ unread: true });
  });
```

`dataStore.get` は未設定キーに対して `null` を返す(`server/storage/dataStore.js:12-19`、`ENOENT` を `null` に倒している)。`toBeNull()` で正しい。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run server/novelJobs.test.js -t unread`
Expected: FAIL。`marks the novel as unread when generation succeeds` が
`expected null to deeply equal { unread: true }` で落ちる(まだ誰も notice を書いていない)。

- [ ] **Step 3: キーを追加する**

`server/storage/paths.js` の `sessionNovelJobKey` の定義の直後に追加する。

```js
export function sessionNovelNoticeKey(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}/novelNotice`;
}
```

- [ ] **Step 4: 生成成功時に notice を書く**

`server/novelJobs.js` の import に `sessionNovelNoticeKey` を追加する。1行目付近の import 文を次で置き換える。

```js
import {
  sessionNovelDocPath,
  sessionNovelMetaKey,
  sessionNovelJobKey,
  sessionNovelNoticeKey,
} from './storage/paths.js';
```

`run()` の中、メタを保存している `await dataStore.set(sessionNovelMetaKey(...), {...})` の直後、ジョブを `done` にする `await write(...)` の直前に次を挿入する。

```js
      // 生成できたことをユーザーがまだ受け取っていない、という印。
      // 「既読の記録が無い=未読」と定義すると、この機能の投入時に過去の小説が
      // 一斉に未読になってしまう。成功時に立てて受け取り時に降ろす形にする。
      await dataStore.set(sessionNovelNoticeKey(userId, sessionId), { unread: true });
```

失敗時の `catch` 節には**何も足さない**。

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npx vitest run server/novelJobs.test.js`
Expected: PASS(既存テストを含む全テスト)

- [ ] **Step 6: コミット**

```bash
git add server/storage/paths.js server/novelJobs.js server/novelJobs.test.js
git commit -m "$(cat <<'EOF'
feat(server): 小説の生成成功時に未読フラグを立てる

完了通知を画面遷移やリロードを跨いで保持するための土台。既読記録の有無で
判定すると既存の小説が一斉に未読になるため、成功時に立てる方式にする。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 未読の取得と既読化のAPI

**Files:**
- Modify: `server/routes/sessions.js`
- Modify: `src/api/sessionSyncClient.js`
- Modify: `docs/superpowers/specs/2026-07-25-novelize-unread-notice-design.md`
- Test: `server/routes/sessions.test.js`

**Interfaces:**
- Consumes: `sessionNovelNoticeKey(userId, sessionId)`、生成成功時に書かれる `{ unread: true }`(Task 1)
- Produces:
  - `GET /api/novel-jobs` の各エントリに `unread: boolean`
  - `POST /api/sessions/:id/novel/seen` → `200 { ok: true }` / セッション無しは `404`
  - `markNovelSeen(id): Promise<{ ok: true }>`(`src/api/sessionSyncClient.js`)

- [ ] **Step 1: 失敗するテストを書く**

`server/routes/sessions.test.js` の import に `sessionNovelNoticeKey` を追加する。既存の paths import 文を次で置き換える。

```js
import { sessionImagePath, sessionNovelJobKey, sessionNovelNoticeKey } from '../storage/paths.js';
```

`describe('sessions routes', ...)` の中に次を追加する。

```js
  it('reports unread in /novel-jobs right after a novel is generated', async () => {
    buildApp();
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');

    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.unread).toBe(true);
  });

  it('reports unread false for a novel that has no notice record', async () => {
    // 回帰防止: この機能の投入以前に生成された小説(noticeレコードが無い)は
    // 既読扱いにする。ここを落とすと既存ユーザーの全小説が一斉に通知される。
    buildApp();
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');
    await dataStore.delete(sessionNovelNoticeKey('usr_test', 's1'));

    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.hasNovel).toBe(true);
    expect(jobs.body.s1.unread).toBe(false);
  });

  it('clears unread via POST novel/seen', async () => {
    buildApp();
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');

    const seen = await request(app).post('/api/sessions/s1/novel/seen');
    expect(seen.status).toBe(200);
    expect(seen.body).toEqual({ ok: true });

    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.unread).toBe(false);
  });

  it('accepts POST novel/seen twice (idempotent)', async () => {
    buildApp();
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');

    expect((await request(app).post('/api/sessions/s1/novel/seen')).status).toBe(200);
    expect((await request(app).post('/api/sessions/s1/novel/seen')).status).toBe(200);
    expect((await request(app).get('/api/novel-jobs')).body.s1.unread).toBe(false);
  });

  it('returns 404 from POST novel/seen for a missing session', async () => {
    const res = await request(app).post('/api/sessions/missing/novel/seen');
    expect(res.status).toBe(404);
  });
```

削除メソッドの名前は `delete` である(`del` ではない — `server/storage/dataStore.js:38`)。生成後に notice を消すことで「この機能の投入以前に生成された小説」の状態を再現している。

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run server/routes/sessions.test.js -t unread`
Expected: FAIL。`expected undefined to be true` — ルートがまだ `unread` を返していない。

- [ ] **Step 3: `/novel-jobs` に `unread` を追加する**

`server/routes/sessions.js` の import に `sessionNovelNoticeKey` を追加する(既存の paths import に足す)。

`/novel-jobs` のループ内、`const meta = await dataStore.get(sessionNovelMetaKey(req.userId, id));` の直後に次を挿入する。

```js
      const notice = await dataStore.get(sessionNovelNoticeKey(req.userId, id));
```

`out[id] = { ... }` の `truncated` の行の直後に次を追加する。

```js
        // レコードが無い(この機能の投入以前に生成された小説)は既読扱いにする。
        // ここを未読に倒すと、投入直後に過去の全小説が一斉に通知される。
        unread: notice?.unread === true,
```

- [ ] **Step 4: 既読化エンドポイントを追加する**

`server/routes/sessions.js` の `router.get('/sessions/:id/novel', ...)` の定義の直前に追加する。

```js
  // 完了通知を受け取ったことを記録する。冪等であり、既に既読でも成功する。
  // 204ではなくJSONを返すのは、クライアントのapiFetchが成功時に必ず
  // res.json()を呼ぶため(空ボディだとパースに失敗する)。
  router.post('/sessions/:id/novel/seen', asyncHandler(async (req, res) => {
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    await dataStore.set(sessionNovelNoticeKey(req.userId, req.params.id), { unread: false });
    res.json({ ok: true });
  }));
```

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npx vitest run server/routes/sessions.test.js`
Expected: PASS(既存テストを含む全テスト)

- [ ] **Step 6: クライアントのAPI関数を追加する**

`src/api/sessionSyncClient.js` の `getIllustratedNovel` の定義の直後に追加する。

```js
// 完了通知を受け取ったことをサーバーに記録する。以降その小説は未読でなくなる。
export async function markNovelSeen(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/novel/seen`, { method: 'POST' });
}
```

- [ ] **Step 7: 設計ドキュメントの204の記述を直す**

`docs/superpowers/specs/2026-07-25-novelize-unread-notice-design.md` の §3.3 にある次の文を

```
`POST /sessions/:id/novel/seen` は `{ unread: false }` を書き、`204` を返す。セッションが存在しない場合は `404`。冪等であり、既に false でも成功する。
```

次で置き換える。

```
`POST /sessions/:id/novel/seen` は `{ unread: false }` を書き、`200 { ok: true }` を返す。セッションが存在しない場合は `404`。冪等であり、既に false でも成功する。

204(空ボディ)にしないのは、クライアントの `apiFetch` が成功時に無条件で `res.json()` を呼ぶため。既存の204エンドポイントは生 `fetch` の別ヘルパーから呼ばれているが、`sessionSyncClient.js` は全関数が `apiFetch` を使っており、この1本のために2つ目のパターンを持ち込む理由がない。
```

- [ ] **Step 8: 全テストを実行する**

Run: `npm test`
Expected: PASS(全ファイル)

- [ ] **Step 9: コミット**

```bash
git add server/routes/sessions.js src/api/sessionSyncClient.js server/routes/sessions.test.js docs/superpowers/specs/2026-07-25-novelize-unread-notice-design.md
git commit -m "$(cat <<'EOF'
feat(server): 小説の未読状態の取得と既読化のAPIを追加

/novel-jobs が unread を返し、POST novel/seen で降ろせるようにする。
noticeレコードが無い小説は既読扱いにして、既存の小説が一斉に通知される
のを防ぐ。204ではなくJSONを返すのはapiFetchが常にres.json()を呼ぶため。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: クライアントの完了通知を unread 駆動にする

**Files:**
- Modify: `src/screens/Home.jsx`
- Test: `src/screens/Home.test.jsx`

**Interfaces:**
- Consumes: `GET /api/novel-jobs` の `unread`、`markNovelSeen(id)`(Task 2)
- Produces:
  - `collectJobEvents(prev, next, titleOf)` → `{ id, kind: 'error', title }[]`(**`done` を返さなくなる**)
  - `collectUnreadIds(jobs, announced)` → `string[]`

- [ ] **Step 1: 純粋関数の失敗するテストを書く**

`src/screens/Home.test.jsx` の import 行を次で置き換える。

```jsx
import Home, { sanitizeFilename, collectJobEvents, collectUnreadIds } from './Home.jsx';
```

ファイル末尾の `describe('collectJobEvents', ...)` ブロックを丸ごと次で置き換える。完了は `unread` が担当するようになるため、`done` を返さなくなったことをここで固定する。

```jsx
describe('collectJobEvents', () => {
  const titleOf = (id) => ({ s1: 'A', s2: 'B' })[id] ?? '';

  it('reports an error transition', () => {
    const prev = { s1: { status: 'running' } };
    const next = { s1: { status: 'error', error: 'boom' } };
    expect(collectJobEvents(prev, next, titleOf)).toEqual([{ id: 's1', kind: 'error', title: 'A' }]);
  });

  it('no longer reports done transitions (completion is driven by the server unread flag)', () => {
    // 遷移とunreadの両方が反応すると同じ完了で二重に通知が出るため、
    // 完了はunreadに一本化した。
    const prev = { s1: { status: 'running' } };
    const next = { s1: { status: 'done' } };
    expect(collectJobEvents(prev, next, titleOf)).toEqual([]);
  });

  it('ignores a job that was not running before', () => {
    expect(collectJobEvents({}, { s1: { status: 'error' } }, titleOf)).toEqual([]);
  });

  it('ignores a job that is still running', () => {
    expect(collectJobEvents({ s1: { status: 'running' } }, { s1: { status: 'running' } }, titleOf)).toEqual([]);
  });
});

describe('collectUnreadIds', () => {
  it('returns ids whose job is flagged unread', () => {
    const jobs = { s1: { status: 'done', unread: true }, s2: { status: 'done', unread: false } };
    expect(collectUnreadIds(jobs, new Set())).toEqual(['s1']);
  });

  it('skips ids already announced in this mount', () => {
    // 既読化POSTの往復中に次のポーリングが返っても二重に通知しないための抑止。
    const jobs = { s1: { status: 'done', unread: true } };
    expect(collectUnreadIds(jobs, new Set(['s1']))).toEqual([]);
  });

  it('returns an empty array when nothing is unread', () => {
    expect(collectUnreadIds({ s1: { status: 'running' } }, new Set())).toEqual([]);
  });

  it('returns every unread id at once', () => {
    const jobs = { s1: { status: 'done', unread: true }, s2: { status: 'done', unread: true } };
    expect(collectUnreadIds(jobs, new Set())).toEqual(['s1', 's2']);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/screens/Home.test.jsx -t collectUnreadIds`
Expected: FAIL。`collectUnreadIds is not a function` — まだ export されていない。

- [ ] **Step 3: 純粋関数を実装する**

`src/screens/Home.jsx` の `collectJobEvents` の定義を丸ごと次で置き換える。

```jsx
// 小説化の失敗を通知イベントとして取り出す。
// 完了(done)はサーバーのunreadフラグが担当するため、ここでは扱わない。
// 両方が反応すると同じ完了に対して通知が二重に出るため、経路を一本化している。
export function collectJobEvents(prev, next, titleOf) {
  const events = [];
  for (const [id, job] of Object.entries(next)) {
    if (prev[id]?.status !== 'running') continue;
    if (job.status === 'error') events.push({ id, kind: 'error', title: titleOf(id) });
  }
  return events;
}

// 未読の完了を取り出す。announcedは同一マウント内で通知済みのID。
// サーバーのフラグはマウントを跨いだ抑止、announcedはマウント内の抑止を担う。
export function collectUnreadIds(jobs, announced) {
  return Object.entries(jobs)
    .filter(([id, job]) => job.unread === true && !announced.has(id))
    .map(([id]) => id);
}
```

- [ ] **Step 4: 純粋関数のテストが通ることを確認する**

Run: `npx vitest run src/screens/Home.test.jsx -t collect`
Expected: PASS(collectJobEvents 4件 + collectUnreadIds 4件)

統合テストはまだ落ちてよい(Step 7 で直す)。

- [ ] **Step 5: 統合テストを書く**

`src/screens/Home.test.jsx` の `describe('Home', ...)` の中、既存の
`shows the completion block and a toast on a running → done transition` テストを丸ごと次で置き換える。完了の駆動が遷移から `unread` に変わるため、このテストは新しい経路のものに差し替える。

```jsx
  it('announces an unread completion on mount and marks it seen', async () => {
    const seenSpy = vi.spyOn(sessionSyncClient, 'markNovelSeen').mockResolvedValue({ ok: true });
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false, unread: true },
    });
    const sessions = [{ id: 's1', title: '黄昏の塔の契約', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説ができました')).toBeInTheDocument();
    expect(screen.getByText('「黄昏の塔の契約」の小説ができました')).toBeInTheDocument();
    await waitFor(() => expect(seenSpy).toHaveBeenCalledWith('s1'));
  });

  it('does not announce a completion that is already read', async () => {
    const seenSpy = vi.spyOn(sessionSyncClient, 'markNovelSeen').mockResolvedValue({ ok: true });
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false, unread: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説をDL')).toBeInTheDocument();
    expect(screen.queryByText('小説ができました')).not.toBeInTheDocument();
    expect(seenSpy).not.toHaveBeenCalled();
  });

  it('announces an unread completion only once even if a later poll still reports it unread', async () => {
    // 既読化POSTがサーバーに届く前に次のポーリングが返る競合。s1がrunningなので
    // ポーリングが継続し、s2のunreadが2回観測される。
    const seenSpy = vi.spyOn(sessionSyncClient, 'markNovelSeen').mockResolvedValue({ ok: true });
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'running', error: null, elapsedMs: 1000, hasNovel: false, stale: false, unread: false },
      s2: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false, unread: true },
    });
    const sessions = [
      { id: 's1', title: 'A', updatedAt: 2, state: {}, log: [] },
      { id: 's2', title: 'B', updatedAt: 1, state: {}, log: [] },
    ];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.getAllByText('「B」の小説ができました')).toHaveLength(1);
      expect(seenSpy).toHaveBeenCalledTimes(1);
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('keeps the notification visible when marking it seen fails', async () => {
    // 既読化に失敗してもユーザーには何も見せない(対処できることではない)。
    // サーバーのフラグが残るので次にHomeを開いたときに再通知される。
    vi.spyOn(sessionSyncClient, 'markNovelSeen').mockRejectedValue(new Error('offline'));
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false, unread: true },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説ができました')).toBeInTheDocument();
    expect(screen.queryByText(/失敗/)).not.toBeInTheDocument();
  });
```

既存の他のテストで `listNovelJobs` をモックしているものは `unread` を持たないが、
`collectUnreadIds` は `job.unread === true` の厳密比較なので `undefined` は未読にならない。
既存テストの修正は不要。

- [ ] **Step 6: テストを実行して失敗を確認する**

Run: `npx vitest run src/screens/Home.test.jsx -t "unread completion"`
Expected: FAIL。`Unable to find an element with the text: 小説ができました` — まだ `unread` を見ていない。

- [ ] **Step 7: `applyNovelJobs` を unread 駆動にする**

`src/screens/Home.jsx` の import に `markNovelSeen` を追加する。`sessionSyncClient.js` からの import 文を次で置き換える。

```jsx
import {
  novelizeSession,
  getNovel,
  getIllustratedNovel,
  putSessionToServer,
  listNovelJobs,
  markNovelSeen,
} from '../api/sessionSyncClient.js';
```

`novelJobsRef` の宣言の直後に追加する。

```jsx
  // 同一マウント内で通知済みのセッションID。既読化POSTの往復中に次のポーリングが
  // 返っても二重に通知しないための抑止(マウントを跨いだ抑止はサーバーのフラグが担う)。
  const announcedRef = useRef(new Set());
```

`applyNovelJobs` の定義を丸ごと次で置き換える。

```jsx
  // novelJobsの更新経路(マウント時取得・ポーリング・楽観的更新)をすべてここに通し、
  // hasRunningRefを常に最新の状態と一致させる。通知の判定もここに集約する。
  function applyNovelJobs(updater) {
    const prev = novelJobsRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    const titleOf = (id) => sessions.find((s) => s.id === id)?.title ?? '';
    const errorEvents = collectJobEvents(prev, next, titleOf);
    const unreadIds = collectUnreadIds(next, announcedRef.current);

    novelJobsRef.current = next;
    hasRunningRef.current = Object.values(next).some((j) => j.status === 'running');
    setNovelJobs(next);

    if (unreadIds.length === 0 && errorEvents.length === 0) return;

    if (unreadIds.length > 0) {
      // POSTの応答を待たずに控える。待つと往復中のポーリングで二重に通知される。
      for (const id of unreadIds) announcedRef.current.add(id);
      setFinishedIds((prevSet) => {
        const nextSet = new Set(prevSet);
        for (const id of unreadIds) nextSet.add(id);
        return nextSet;
      });
      for (const id of unreadIds) {
        // 失敗は握りつぶす。サーバーのフラグが残るので次にHomeを開いたときに
        // 再通知される。通知を失うより出し直すほうが害が小さい。
        markNovelSeen(id).catch(() => {});
      }
    }

    // makeId()はupdaterの外で呼ぶ(updaterが複数回実行されても無駄なidを作らない)。
    const added = [
      ...unreadIds.map((id) => ({ id: makeId(), text: `「${titleOf(id)}」の小説ができました`, tone: 'success' })),
      ...errorEvents.map((ev) => ({ id: makeId(), text: `「${ev.title}」の小説化に失敗しました`, tone: 'error' })),
    ];
    setToasts((prevToasts) => [...prevToasts, ...added]);
  }
```

- [ ] **Step 8: ログアウト時に announcedRef をクリアする**

`src/screens/Home.jsx` のポーリング `useEffect` の `!user` 分岐、`setToasts([]);` の直後に追加する。

```jsx
      // 別のユーザーでログインし直したとき、前のユーザーの通知済み記録が残っていると
      // 新しいユーザーの未読を握りつぶしてしまう。
      announcedRef.current = new Set();
```

- [ ] **Step 9: テストを実行して通ることを確認する**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: PASS(既存テストを含む全テスト)

- [ ] **Step 10: 全テストを実行する**

Run: `npm test`
Expected: PASS(全ファイル)

- [ ] **Step 11: コミット**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "$(cat <<'EOF'
feat(home): 完了通知をサーバーの未読フラグで駆動する

画面遷移・リロード・タブを閉じるを跨いでも完了に気づけるようにする。
遷移検知とunreadの両方を残すと同じ完了で二重に通知が出るため、完了は
unreadに一本化し、collectJobEventsは失敗のみを担当する。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the implementer

- **既存テストへの影響**: 他の多くのテストが `listNovelJobs` をモックしているが、`unread` を含まない。`collectUnreadIds` は `job.unread === true` の厳密比較なので `undefined` は未読と判定されず、既存テストは変更不要。
- **`announcedRef` は state ではなく ref**: 通知の判定は描画ではなく `applyNovelJobs` の中(副作用)で行うため、更新で再描画を誘発する必要がない。
- **既知の不安定テスト**: `server/auth/routes.test.js > auth routes > callback redirects to /?auth_error=1 when the token exchange fails` がフルスイート実行時に約8回に1回 `TypeError: Invalid URL` で落ちる。このブランチとは無関係で別途対応中。**そのテストが落ちた場合は再実行すること。他のテストの失敗は自分の責任。**
- **`vi.useFakeTimers()` は `Date.now()` も差し替える**(vitest の既定)。
