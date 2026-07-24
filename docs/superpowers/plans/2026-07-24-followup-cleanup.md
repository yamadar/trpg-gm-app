# フォローアップ(品質・堅牢性の後片付け)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** 3フェーズのレビューで拾ったMinor(利用カウンタのアトミック化、LIMIT=0対応、stale-responseガード、メニュー外側クリック、定数重複整理)をまとめて修正する。ページネーション/検索(新機能)は含まない。

**Architecture:** 既存コードへの局所修正のみ。新規依存なし。各修正はTDDで、挙動を壊さないこと(既存テストは通ったまま)。

**Tech Stack:** 既存(Express / React / vitest / supertest)。

## Global Constraints

- 新規依存なし。ES modules。UI文言は日本語。テスト出力pristine
- 既存テストは無修正で通り続けること(挙動を壊さない)。振る舞いを変える箇所は新テストで固定する
- サーバーテストは node環境 + supertest、クライアントは renderWithAuth + fireEvent
- コミットは各タスク末尾、`fix:`/`refactor:` 規約
- 利用カウンタのロックは**単一プロセス内**の直列化(このアプリは単一Expressプロセス前提)。複数インスタンス運用時はストア側のアトミック性が別途必要 — コードコメントに明記する

---

### Task 1: 利用カウンタのアトミック化 + LIMIT=0 対応

**Files:**
- Modify: `server/auth/usage.js`
- Modify: `server/index.js`(limits パース)
- Test: `server/auth/usage.test.js` / `server/index.test.js` 追記

**Interfaces:**
- `createUsage` の `consume` はキー単位でRMWを直列化(同一 `usageKey` への同時 `consume` が上限を超えない)。外形(戻り値)は不変
- `server/index.js`: `LIMIT_MESSAGES_PER_DAY`/`LIMIT_NOVELIZE_PER_DAY` が `0` の場合に全拒否できるよう、`Number(v) || def` をやめて `Number.isFinite(n) && n >= 0 ? n : def` にする

- [ ] **Step 1: 失敗するテストを追記**

`server/auth/usage.test.js`:

```js
it('does not exceed the limit under concurrent consume of the same key', async () => {
  const usage = createUsage({ dataStore, limits: { messages: 5, novelize: 1 }, now: () => T0 });
  const results = await Promise.all(Array.from({ length: 20 }, () => usage.consume('usr_1', 'messages')));
  expect(results.filter((r) => r.ok).length).toBe(5);
  expect(await dataStore.get(usageKey('usr_1', '2026-07-23'))).toEqual({ messages: 5 });
});
```

(T0 は既存テストの定数を流用)

`server/index.test.js`:

```js
it('LIMIT_MESSAGES_PER_DAY=0 denies all messages', async () => {
  app = createApp({ apiKey: 'test-key', dataDir: dir, fetchImpl, env: { LIMIT_MESSAGES_PER_DAY: '0' } });
  const { cookie } = await createTestUserSession(app.locals.dataStore);
  expect((await request(app).post('/api/messages').set('Cookie', cookie).send({ messages: [] })).status).toBe(429);
});
```

- [ ] **Step 2: RED確認** — `npx vitest run server/auth/usage.test.js server/index.test.js`(新ケースがFAIL。特に同時実行テストはロックなしだとok数が5を超える)
- [ ] **Step 3: 実装**

`server/auth/usage.js` — キー単位のインプロセス・ロックを追加:

```js
export function createUsage({ dataStore, limits, now = Date.now }) {
  // usageKeyごとに read-modify-write を直列化する(単一プロセス内)。
  // 注: 複数インスタンス運用ではストア側のアトミック性が別途必要。
  const locks = new Map();
  function withKeyLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  }

  return {
    async consume(userId, kind) {
      const limit = limits[kind];
      if (typeof limit !== 'number') throw new Error(`unknown usage kind: ${kind}`);
      const t = now();
      const key = usageKey(userId, utcDay(t));
      return withKeyLock(key, async () => {
        const counts = (await dataStore.get(key)) || {};
        const used = counts[kind] || 0;
        if (used >= limit) return { ok: false, resetAt: nextUtcMidnight(t) };
        counts[kind] = used + 1;
        await dataStore.set(key, counts);
        return { ok: true };
      });
    },
  };
}
```

`server/index.js` — limits パースを修正:

```js
function parseLimit(value, def) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : def;
}
// ...
  const usage = createUsage({
    dataStore,
    limits: {
      messages: parseLimit(env.LIMIT_MESSAGES_PER_DAY, 200),
      novelize: parseLimit(env.LIMIT_NOVELIZE_PER_DAY, 10),
    },
  });
```

- [ ] **Step 4: GREEN確認** — `npx vitest run server/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add server/auth/usage.js server/auth/usage.test.js server/index.js server/index.test.js
git commit -m "fix(usage): 利用カウンタの同時更新を直列化しLIMIT=0で全拒否可能に"
```

---

### Task 2: stale-responseガード(UserPage / Gallery)+ useSessionTakeover アンマウントガード

**Files:**
- Modify: `src/screens/UserPage.jsx`(userId取得effect)
- Modify: `src/screens/Gallery.jsx`(tab一覧取得effect)
- Modify: `src/auth/useSessionTakeover.js`
- Test: 対応する各 `.test.jsx` 追記

**実装前に読む**: 3ファイルの現行effect(UserPageは`[userId]`のPromise.all、Galleryは`[tab]`で`setItems(await listPublic(t))`、useSessionTakeoverは`[user]`の非同期IIFE)

**Interfaces:**
- 各非同期effectに `let cancelled = false;` を入れ、cleanupで `cancelled = true`。await解決後 `if (!cancelled)` のときだけ `setState` する(アンマウント後・supersede後の更新を防ぐ)
- 挙動(正常系)は不変。既存テストは通ったまま

- [ ] **Step 1: 失敗するテストを追記**(要点)

各ファイルで「解決前にアンマウント(または依存変更)しても、古いレスポンスで状態を上書きしない」ことを固定する。例(UserPage):

```js
it('ignores a stale profile response after userId changes', async () => {
  // getUserProfile を deferred にして、userId=A のフェッチ未解決のまま userId=B に切替
  // → A のプロフィールが表示されない(B のが出る/またはローディングのまま)
  // 実装は renderWithAuth + rerender で userId prop を変える。既存テストのモックスタイルに合わせる
});
```

Galleryは `[tab]` 切替、useSessionTakeoverは `renderHook` + `unmount()` 前に解決させ、`setCandidates` が呼ばれない(状態が空のまま)ことを確認。テストが書きにくい場合は「unmount後に解決してもthrow/警告が出ない」ことの確認で可。

- [ ] **Step 2: RED確認**(新ケース)
- [ ] **Step 3: 実装** — 3ファイルそれぞれの非同期effectに `cancelled` フラグ + cleanup を追加。`setState` 前にガード。useSessionTakeoverでは `checkedForRef` はそのまま、IIFE内の `setCandidates` を `if (!cancelled)` で囲む
- [ ] **Step 4: GREEN確認** — `npx vitest run src/screens/UserPage.test.jsx src/screens/Gallery.test.jsx src/auth/useSessionTakeover.test.jsx` → 全PASS。`npx vitest run` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add src/screens/UserPage.jsx src/screens/UserPage.test.jsx src/screens/Gallery.jsx src/screens/Gallery.test.jsx src/auth/useSessionTakeover.js src/auth/useSessionTakeover.test.jsx
git commit -m "fix(ui): 非同期取得にstale-response/アンマウントガードを追加"
```

---

### Task 3: AuthBarメニューの外側クリックで閉じる

**Files:**
- Modify: `src/components/auth/AuthBar.jsx`
- Test: `src/components/auth/AuthBar.test.jsx` 追記

**実装前に読む**: `AuthBar.jsx`(`menuOpen`/`setMenuOpen`、メニューのJSX構造 85行目付近、トグルボタン46行目)

**Interfaces:**
- `menuOpen` が true のとき、メニュー領域外の `mousedown` でメニューを閉じる。メニュー領域は `ref` で判定。トグルボタン自身のクリックは既存のトグル挙動を維持(外側クリック判定に含めない)

- [ ] **Step 1: 失敗するテストを追記**

```js
it('closes the menu when clicking outside', () => {
  renderWithAuth(<AuthBar />); // 既定ログイン
  fireEvent.click(screen.getByText('テスト')); // メニューを開く(表示名トグル)
  expect(screen.getByText('ログアウト')).toBeInTheDocument();
  fireEvent.mouseDown(document.body);
  expect(screen.queryByText('ログアウト')).toBeNull();
});
```

(トグルボタンのラベルは実ファイルの表示名要素に合わせる)

- [ ] **Step 2: RED確認**
- [ ] **Step 3: 実装** — メニューのコンテナ(トグルボタン+ドロップダウンを包む要素)に `ref` を付け、`useEffect` で `menuOpen` の間だけ `document` に `mousedown` リスナーを張り、`ref.current` の外側なら `setMenuOpen(false)`。cleanupでリスナー解除
- [ ] **Step 4: GREEN確認** — `npx vitest run src/components/auth/AuthBar.test.jsx` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add src/components/auth/AuthBar.jsx src/components/auth/AuthBar.test.jsx
git commit -m "fix(ui): AuthBarメニューを外側クリックで閉じる"
```

---

### Task 4: 定数重複の共有化(公開コンテンツのTABS/KIND_LABELS + displayName既定値)

**Files:**
- Create: `src/constants/publicContent.js`
- Modify: `src/screens/Gallery.jsx` / `src/screens/UserPage.jsx` / `src/components/share/PublicItemDetail.jsx`
- Create/Modify: サーバー側 displayName 既定値の共有(`server/auth/users.js` に定数をexportし `server/routes/publish.js` が使う)
- Test: 既存テストが通ること(挙動不変)。必要なら軽い追加

**実装前に読む/確認**: `src/screens/Gallery.jsx:9` の `TABS` と `src/screens/UserPage.jsx:9` の `TABS` が**完全一致**であること(公開4タブ: 小説/世界観/キャラクター/シナリオ)。`src/screens/Library.jsx:11` の `TABS` は**別物**(ライブラリ用: world/character/scenario/ruleset)なので**触らない**。`KIND_LABELS` は Gallery/UserPage/PublicItemDetail の3箇所に同一定義

**Interfaces:**
- `src/constants/publicContent.js`: `export const PUBLIC_TABS = [...]`(Gallery/UserPageの現TABSと同一内容)、`export const KIND_LABELS = { pc: 'PC', npc: 'NPC' }`
- Gallery/UserPage は自前の `TABS`/`KIND_LABELS` を削除して import。PublicItemDetail は `KIND_LABELS` を import
- `server/auth/users.js`: `export const DEFAULT_DISPLAY_NAME = 'ユーザー';` を追加し、`findOrCreateUser` の `displayName || 'ユーザー'` を `displayName || DEFAULT_DISPLAY_NAME` に。`server/routes/publish.js` の `?? 'ユーザー'` を `?? DEFAULT_DISPLAY_NAME`(import追加)に

- [ ] **Step 1: Gallery.jsx:9 と UserPage.jsx:9 の TABS が同一内容か確認**(差異があれば統合前に報告。同一なら続行)
- [ ] **Step 2: 共有定数ファイルを作成し、3コンポーネント + 2サーバーファイルを差し替え**(挙動不変)
- [ ] **Step 3: 確認** — `npx vitest run` → 全PASS(既存テストが無修正で通ること = 挙動不変の証明)
- [ ] **Step 4: Commit**

```bash
git add src/constants/publicContent.js src/screens/Gallery.jsx src/screens/UserPage.jsx src/components/share/PublicItemDetail.jsx server/auth/users.js server/routes/publish.js
git commit -m "refactor: 公開タブ/種別ラベル/表示名既定値の重複を共有定数に集約"
```

---

## 完了条件
- `npx vitest run` 全パス
- 挙動不変(既存テストは無修正で通る)。振る舞いを変えた箇所(利用カウンタ直列化・LIMIT=0・メニュー外側クリック)は新テストで固定
