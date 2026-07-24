# 公開一覧の検索・絞り込み・ページネーション Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公開ギャラリーとユーザーページの一覧に、テキスト検索(title/ownerName/worldTitle)・雰囲気/ルールセット絞り込み・「もっと見る」ページネーションを追加する。

**Architecture:** 素材本体(World/Scenario)に固定語彙の `moods` を追加し、公開スナップショット時に `moods`/`worldId`/`worldTitle` を公開メタへ載せる。一覧APIはクエリパラメータを受けてサーバー側で絞り込み・スライスし `{ items, total, hasMore }` を返す(索引なし・全件読みのまま。APIの形だけ将来差し替え可能に)。UIは一覧を共有コンポーネント `PublicItemList` に切り出し、Gallery/UserPage 両方から使う。

**Tech Stack:** 既存のみ(Express / React / vitest / supertest)。新規依存なし。

**Spec:** `docs/superpowers/specs/2026-07-24-public-search-pagination-design.md`

## Global Constraints

- 雰囲気語彙(固定8種・完全一致): `ホラー` `冒険` `ミステリー` `日常` `SF` `ファンタジー` `コメディ` `シリアス`
- `moods` は素材本体(World/Scenario)に保存。既存レコードは読み出し時 `?? []` 補完(マイグレーションなし)。**保存時のみ**語彙外400、**クエリでは無視**
- 一覧API: `GET /api/public/:type?q&moods&ruleset&ownerId&limit&offset` → `{ items, total, hasMore }`。`limit` 既定20・上限100、`offset` 既定0。不正値は400にせず既定値/上限に丸める。並びは `publishedAt` 降順。`moods` はOR。`q` は title/ownerName/worldTitle の部分一致・大文字小文字無視
- **破壊的変更**: 一覧APIの戻りが配列→オブジェクト。`GET /api/users/:userId/public` は廃止し `?ownerId=` に統合(プロフィール `GET /api/users/:userId` は不変)
- 既存の公開済みアイテム(moods/worldTitle欠損)は壊れず一覧に出続けること(該当絞り込みにヒットしないだけ)
- UI: 検索は300msデバウンス、雰囲気チップは worlds/scenarios タブのみ、ルールプルダウンは scenarios のみ(選択肢 `simple`/`coc7e`/`dnd5e`/`gurps`)、「もっと見る」は `hasMore` 時のみ・追記型、条件変更で offset=0 に戻す。stale-response ガード必須
- 新規依存なし。ES modules。UI文言は日本語。サーバーテスト node+supertest、クライアント renderWithAuth+fireEvent。テスト出力pristine
- コミットは各タスク末尾、`feat:`/`refactor:` 規約

## 実行前の注意

- 前提: `main`(`57fc5c7` 以降)から作業ブランチを切る
- 受け入れ: 全タスク後 `npx vitest run` 全パス

---

### Task 1: moods語彙とWorld/Scenarioへの保存

**Files:**
- Create: `server/storage/moods.js` / `src/constants/moods.js`
- Modify: `server/storage/worldLibrary.js` / `server/storage/scenarioLibrary.js`(moods往復+補完)、`server/routes/worlds.js` / `server/routes/scenarios.js`(PUTバリデーション)
- Test: `server/storage/worldLibrary.test.js` / `scenarioLibrary.test.js` / `server/routes/worlds.test.js` / `scenarios.test.js` 追記

**Interfaces:**
- Produces:
  - `server/storage/moods.js`: `export const MOODS = ['ホラー','冒険','ミステリー','日常','SF','ファンタジー','コメディ','シリアス'];` / `export function isValidMoods(value)` — 配列かつ全要素がMOODS内ならtrue
  - `src/constants/moods.js`: 同一の `MOODS` 配列(相互参照コメント付き。slugifyの二重定義と同じ前例)
  - `saveWorld(..., { id, title, raw, moods })` — metaに `moods`(配列以外は `[]`)。`getWorld`/`listWorlds` は `moods ?? []` 補完
  - `saveScenario(..., { ..., moods })` — 同様。`getScenario`/`listScenarios` 補完
  - PUT `/worlds/:id` / PUT `/worlds/:worldId/scenarios/:id`: `moods` が指定され `isValidMoods` を満たさなければ `400 { error: 'moods must be an array of known mood labels' }`

- [ ] **Step 1: 失敗するテストを追記**(要点)

```js
// worldLibrary.test.js
it('round-trips moods and backfills [] for legacy records', async () => {
  await saveWorld(dataStore, textStore, 'usr_1', { id: 'w1', title: 'T', raw: '#', moods: ['ホラー', '冒険'] });
  expect((await getWorld(dataStore, textStore, 'usr_1', 'w1')).moods).toEqual(['ホラー', '冒険']);
  // 旧レコード再現: moodsを消して書き戻す → getWorld/listWorlds が [] を返す
});
// worlds.test.js
it('rejects unknown moods on PUT with 400 and accepts valid ones', async () => {
  expect((await request(app).put('/api/worlds/w1').send({ title: 'T', raw: '#', moods: ['horror'] })).status).toBe(400);
  expect((await request(app).put('/api/worlds/w1').send({ title: 'T', raw: '#', moods: ['ホラー'] })).status).toBe(200);
  expect((await request(app).put('/api/worlds/w2').send({ title: 'T', raw: '#' })).status).toBe(200); // moods未指定OK
});
```

(scenario側も同型で。既存アサーションは触らない)

- [ ] **Step 2: RED確認** — `npx vitest run server/storage/worldLibrary.test.js server/storage/scenarioLibrary.test.js server/routes/worlds.test.js server/routes/scenarios.test.js`
- [ ] **Step 3: 実装**

```js
// server/storage/moods.js
// 語彙は src/constants/moods.js と同内容の二重定義(サーバーはクライアントのソースをimportしない方針)
export const MOODS = ['ホラー', '冒険', 'ミステリー', '日常', 'SF', 'ファンタジー', 'コメディ', 'シリアス'];

export function isValidMoods(value) {
  return Array.isArray(value) && value.every((m) => MOODS.includes(m));
}
```

`worldLibrary.js`: `saveWorld` のmetaを `{ id, title, moods: Array.isArray(moods) ? moods : [], updatedAt }` に。`getWorld` は `{ ...meta, moods: meta.moods ?? [], raw }`。`listWorlds` は `metas.map((m) => ({ ...m, moods: m.moods ?? [] }))`。`scenarioLibrary.js` も同様(`recommendedRuleset` の隣に)。

`worlds.js` PUT — 既存バリデーションの後に:

```js
if ('moods' in req.body && !isValidMoods(req.body.moods)) {
  res.status(400).json({ error: 'moods must be an array of known mood labels' });
  return;
}
```

`saveWorld` 呼び出しに `moods: req.body.moods` を追加。scenarios.js も同様。

- [ ] **Step 4: GREEN確認** — 上記4ファイル → PASS、`npx vitest run server/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add server/storage/moods.js src/constants/moods.js server/storage/worldLibrary.js server/storage/worldLibrary.test.js server/storage/scenarioLibrary.js server/storage/scenarioLibrary.test.js server/routes/worlds.js server/routes/worlds.test.js server/routes/scenarios.js server/routes/scenarios.test.js
git commit -m "feat(moods): 雰囲気語彙とWorld/Scenarioへの保存(固定8種・語彙外400)"
```

---

### Task 2: 公開メタへ moods / worldId / worldTitle を反映

**Files:**
- Modify: `server/storage/shareLibrary.js`(publishWorld/publishScenario/publishCharacter)
- Test: `server/storage/shareLibrary.test.js` 追記

**Interfaces:**
- Consumes: Task 1の `moods` 付きメタ、既存 `worldMetaKey`
- Produces(公開メタ追加フィールド):
  - worlds: `moods: string[]`
  - scenarios: `moods: string[]`, `worldId: string`, `worldTitle: string|null`
  - characters: `worldId: string`, `worldTitle: string|null`

- [ ] **Step 1: 失敗するテストを追記**(要点)

```js
it('publishWorld carries moods into the public meta', async () => { /* moods付きworldを公開→public metaにmoods */ });
it('publishScenario carries moods, worldId and worldTitle', async () => { /* worldTitleは所有者のworld metaのtitle */ });
it('publishCharacter carries worldId and worldTitle', async () => {});
it('worldTitle falls back to null when the world meta is missing', async () => {});
```

- [ ] **Step 2: RED確認** — `npx vitest run server/storage/shareLibrary.test.js`
- [ ] **Step 3: 実装** — importに `worldMetaKey` を追加し:
  - `publishWorld`: buildMetaのfieldsに `moods: world.moods ?? []` を追加
  - `publishScenario`: `const worldMeta = await dataStore.get(worldMetaKey(userId, worldId));` を追加し、fieldsに `moods: scenario.moods ?? [], worldId, worldTitle: worldMeta?.title ?? null`
  - `publishCharacter`: 同様に `worldId, worldTitle: worldMeta?.title ?? null`
- [ ] **Step 4: GREEN確認** — `npx vitest run server/storage/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add server/storage/shareLibrary.js server/storage/shareLibrary.test.js
git commit -m "feat(share): 公開メタにmoods/worldId/worldTitleを反映"
```

---

### Task 3: queryPublic と一覧APIの置き換え(+ /users/:userId/public 廃止)

**Files:**
- Modify: `server/storage/shareLibrary.js`(queryPublic追加。listPublicは残す)
- Modify: `server/routes/publicContent.js`(GET /public/:type をquery対応に置き換え、GET /users/:userId/public を削除)
- Test: `server/storage/shareLibrary.test.js` / `server/routes/publicContent.test.js` / `server/index.test.js` 更新

**Interfaces:**
- Produces:

```js
// shareLibrary.js
queryPublic(dataStore, type, { q, moods, ruleset, ownerId, limit, offset })
// → { items: meta[], total: number, hasMore: boolean }
// moods: string[](語彙外は無視) / q: 部分一致(title, ownerName, worldTitle、小文字化) /
// ruleset: recommendedRuleset完全一致 / limit: 既定20・上限100・不正は既定 / offset: 既定0・不正は0
```

- ルート: `GET /public/:type` は上記を返す。`GET /users/:userId/public` は**削除**(プロフィール `GET /users/:userId` は不変)

- [ ] **Step 1: 失敗するテストを書く**(要点 — storage側とroute側の両方)

```js
// shareLibrary.test.js — queryPublic単体
it('filters by q across title, ownerName and worldTitle (case-insensitive)', ...);
it('filters moods with OR semantics and ignores unknown moods', ...);
it('filters by ruleset and by ownerId', ...);
it('paginates: limit/offset, total, hasMore; clamps limit>100 and offset beyond total → empty items', ...);
it('legacy metas without moods/worldTitle pass through when no filter targets them', ...);

// publicContent.test.js — ルート
it('GET /public/:type returns { items, total, hasMore } and honors query params', ...);
it('GET /users/:userId/public is gone (404)', ...);
// 既存の一覧テストは戻り形の変更に合わせて修正(res.body → res.body.items)
// index.test.js — 統合: ?ownerId= で他ユーザーの公開物が混ざらない
```

- [ ] **Step 2: RED確認**
- [ ] **Step 3: 実装**

```js
// shareLibrary.js に追加
import { MOODS } from './moods.js';

export async function queryPublic(dataStore, type, { q, moods, ruleset, ownerId, limit, offset } = {}) {
  const all = await listPublic(dataStore, type);
  const norm = (s) => String(s ?? '').toLowerCase();
  const query = norm(q).trim();
  const moodSet = new Set((moods ?? []).filter((m) => MOODS.includes(m)));

  const filtered = all.filter((meta) => {
    if (ownerId && meta.ownerId !== ownerId) return false;
    if (ruleset && meta.recommendedRuleset !== ruleset) return false;
    if (moodSet.size > 0 && !(meta.moods ?? []).some((m) => moodSet.has(m))) return false;
    if (query) {
      const haystack = [meta.title, meta.ownerName, meta.worldTitle].map(norm).join('\n');
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const lim = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 100) : 20;
  const off = Number.isFinite(Number(offset)) && Number(offset) > 0 ? Number(offset) : 0;
  const items = filtered.slice(off, off + lim);
  return { items, total: filtered.length, hasMore: off + items.length < filtered.length };
}
```

`publicContent.js` の `GET /public/:type` ハンドラを:

```js
router.get('/public/:type', asyncHandler(async (req, res) => {
  if (!TYPES.has(req.params.type)) {
    res.status(404).json({ error: 'unknown type' });
    return;
  }
  const moods = String(req.query.moods ?? '').split(',').filter(Boolean);
  res.json(await queryPublic(dataStore, req.params.type, {
    q: req.query.q,
    moods,
    ruleset: req.query.ruleset || undefined,
    ownerId: req.query.ownerId || undefined,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
}));
```

に置き換え(importをqueryPublicに)。`GET /users/:userId/public` のルートとimport中の不要参照を削除(`GET /users/:userId` は残す)。

- [ ] **Step 4: GREEN確認** — `npx vitest run server/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add server/storage/shareLibrary.js server/storage/shareLibrary.test.js server/routes/publicContent.js server/routes/publicContent.test.js server/index.test.js
git commit -m "feat(routes): 公開一覧APIに検索・絞り込み・ページネーション({items,total,hasMore})"
```

---

### Task 4: shareClient の追随

**Files:**
- Modify: `src/api/shareClient.js`(listPublicにparams、getUserPublicItems削除)
- Test: `src/api/shareClient.test.js` 更新

**Interfaces:**
- Produces: `listPublic(type, { q, moods, ruleset, ownerId, limit, offset } = {})` → `{ items, total, hasMore }`。パラメータはURLSearchParamsで付与(未指定は付けない。moodsは配列→カンマ区切り)。`getUserPublicItems` は**削除**(利用箇所はTask 6で置き換え)

- [ ] **Step 1: 失敗するテストを更新/追記**(要点: パラメータ付きURLの検証、moods配列→カンマ区切り、未指定パラメータがURLに現れない、getUserPublicItemsが存在しない)
- [ ] **Step 2: RED確認** — `npx vitest run src/api/shareClient.test.js`
- [ ] **Step 3: 実装**

```js
export async function listPublic(type, { q, moods, ruleset, ownerId, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (moods && moods.length > 0) params.set('moods', moods.join(','));
  if (ruleset) params.set('ruleset', ruleset);
  if (ownerId) params.set('ownerId', ownerId);
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const qs = params.toString();
  return apiFetch(`/api/public/${encodeURIComponent(type)}${qs ? `?${qs}` : ''}`);
}
```

`getUserPublicItems` を削除。**注**: この時点で Gallery/UserPage は一時的に壊れる(戻り形変更)が、Task 5/6 で修正する — `npx vitest run src/api/` のみGREENを確認して先へ進む(フルスイートはTask 6完了時に回復)。

- [ ] **Step 4: GREEN確認** — `npx vitest run src/api/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add src/api/shareClient.js src/api/shareClient.test.js
git commit -m "feat(client): 一覧APIのクエリ対応({items,total,hasMore})とgetUserPublicItems廃止"
```

---

### Task 5: PublicItemList 共有コンポーネント + Gallery 組み込み

**Files:**
- Create: `src/components/share/PublicItemList.jsx`
- Modify: `src/screens/Gallery.jsx`(一覧部分を置き換え)
- Test: `src/components/share/PublicItemList.test.jsx`(新規)、`src/screens/Gallery.test.jsx`(一覧関連のみ更新 — 詳細/インポートのテストは不変)

**実装前に読む**: `src/screens/Gallery.jsx`(現一覧レンダリング・タブ・openDetail)、`src/components/share/PublicItemDetail.jsx`(`publicMetaLine`/`authorButtonStyle`/`KIND_LABELS` のimport元)、`src/constants/moods.js`(Task 1)、`src/constants/publicContent.js`、`src/data/rulesets.js`(プルダウン選択肢)、`src/test/renderWithAuth.jsx`

**Interfaces:**
- Produces: `PublicItemList({ type, ownerId, onOpenDetail, onAuthorClick })`
  - 内部state: `q`(即時入力値)/デバウンス後の実効クエリ(300ms、`setTimeout`+cleanup)/`selectedMoods: string[]`/`ruleset`/`items`/`total`/`hasMore`/`offset`/`loading`/`error`
  - 取得: `listPublic(type, { q, moods, ruleset, ownerId, limit: 20, offset })`。`type`/実効クエリ/絞り込み/`ownerId` が変わったら offset=0 で取り直し(**追記ではなく置換**)。「もっと見る」は `offset += 20` で取得し `items` に**追記**。リクエストトークンで stale ガード
  - UI: 検索窓(placeholder「タイトル・作者名で検索」)/雰囲気チップ(`type` が `worlds`|`scenarios` のみ、選択中は強調、複数可)/ルールプルダウン(`scenarios` のみ、「すべて」+既定4種)/カード(既存Galleryの見た目を踏襲: title、作者リンク(`onAuthorClick` あれば)、`publicMetaLine`、charactersはkindバッジ)/「もっと見る」(`hasMore` 時のみ)/0件時は絞り込み無し「まだ公開されたものがありません」・絞り込み中「条件に合う公開物がありません」+「条件をクリア」
- Gallery側: タブ・詳細(`openDetail`/`PublicItemDetail`)は現状維持。一覧のstate/fetch/レンダリングを `<PublicItemList type={tab} onOpenDetail={openDetail} onAuthorClick={(id) => navigateToUser(id)} />` に置き換え(自前の items/loading/listError と `[tab]` の一覧取得effectを削除。タブ切替時の詳細リセットeffectは残す)

**テスト(要点)**: 初回取得と表示/検索入力300ms後に q 付きで再取得(vi.useFakeTimers)/チップ選択で moods 付き再取得+offset=0/「もっと見る」で offset=20 の取得と**追記**/条件変更で置換(追記でない)/hasMore=false でボタン非表示/0件の出し分けと条件クリア/worlds以外でチップ非表示・scenarios以外でプルダウン非表示/staleガード(古い応答を破棄)。Gallery.test.jsx は一覧系アサーションを新構造に合わせて修正(詳細・インポート系は不変で通ること)

- [ ] **Step 1: PublicItemList.test.jsx を書いて RED確認**
- [ ] **Step 2: 実装(コンポーネント作成 + Gallery置き換え)して GREEN確認** — `npx vitest run src/components/share/ src/screens/Gallery.test.jsx`
- [ ] **Step 3: Commit**

```bash
git add src/components/share/PublicItemList.jsx src/components/share/PublicItemList.test.jsx src/screens/Gallery.jsx src/screens/Gallery.test.jsx
git commit -m "feat(ui): 検索・絞り込み・もっと見る付き公開一覧コンポーネント(Gallery組み込み)"
```

---

### Task 6: UserPage を PublicItemList に載せ替え

**Files:**
- Modify: `src/screens/UserPage.jsx`
- Test: `src/screens/UserPage.test.jsx` 更新

**実装前に読む**: `src/screens/UserPage.jsx`(現profile+items取得・タブ・詳細)、Task 5の `PublicItemList`

**Interfaces:**
- Consumes: `getUserProfile`(不変)、`PublicItemList`(Task 5)
- 変更: `getUserPublicItems` の利用をやめ、プロフィールのみ `[userId]` effectで取得(404→「ユーザーが見つかりません」は不変)。タブ本体を `<PublicItemList type={tab} ownerId={userId} onOpenDetail={openDetail} />`(onAuthorClickは渡さない)に置き換え。自前の items state と空一覧メッセージは削除(空表示はPublicItemListが担う)。詳細表示・タブリセットeffect・戻るボタンは不変

**テスト(要点)**: プロフィール表示は従来どおり/一覧が ownerId 付きで `listPublic` を呼ぶ/404・bio非表示・詳細遷移の既存テストは(モック差し替え以外)意図を変えず更新

- [ ] **Step 1: テスト更新 → RED確認**
- [ ] **Step 2: 実装 → GREEN確認** — `npx vitest run src/screens/UserPage.test.jsx`
- [ ] **Step 3: フルスイート** — `npx vitest run` → **全PASS**(Task 4で壊した箇所がここで全回復していること)
- [ ] **Step 4: Commit**

```bash
git add src/screens/UserPage.jsx src/screens/UserPage.test.jsx
git commit -m "feat(ui): ユーザーページの一覧をPublicItemListに統合(ownerId絞り込み)"
```

---

### Task 7: ライブラリの雰囲気入力UI(World/Scenarioタブ)

**Files:**
- Modify: `src/screens/library/WorldTab.jsx` / `src/screens/library/ScenarioTab.jsx`
- Test: 各 `.test.jsx` 追記

**実装前に読む**: 両タブの編集フォーム(title/raw等の入力と保存ボタン、PUTクライアント呼び出し)、`src/constants/moods.js`、`src/api/worldLibraryClient.js` / `scenarioLibraryClient.js`(putにmoodsを通す必要があるか — bodyをそのまま送る形なら引数追加)

**Interfaces:**
- 編集フォームに雰囲気チップ(MOODS、複数選択トグル)を追加。保存時に選択値を `moods` としてPUTに含める。既存アイテムの編集開始時は `item.moods ?? []` を初期値に。クライアントのput関数がフィールド固定なら `moods` を追加(既存呼び出しに影響しない省略可能引数として)
- 一覧カードに選択中moodsの小さな表示(任意だが推奨: F_MONO 10-11px)

**テスト(要点)**: チップ選択→保存でPUTボディに moods が含まれる/既存moodsが編集フォームに反映される/未選択なら空配列

- [ ] **Step 1: テスト追記 → RED確認**
- [ ] **Step 2: 実装 → GREEN確認** — `npx vitest run src/screens/library/`
- [ ] **Step 3: Commit**

```bash
git add src/screens/library/ src/api/worldLibraryClient.js src/api/scenarioLibraryClient.js
git commit -m "feat(ui): ライブラリのWorld/Scenarioに雰囲気タグ入力"
```

(クライアントput関数を触らなかった場合はgit addから除外)

---

### Task 8: ドキュメント更新と受け入れ確認

**Files:**
- Modify: `docs/04-persistence.md`(一覧APIのクエリパラメータと戻り形、`/users/:userId/public` 廃止、World/Scenarioメタの `moods`、公開メタの追加フィールド)
- Modify: `docs/05-ui-ux.md`(ギャラリー/ユーザーページの検索・絞り込み・もっと見る、ライブラリの雰囲気入力)

- [ ] **Step 1: 実コード(publicContent.js/shareLibrary.js/moods.js)と突き合わせてdocs更新**
- [ ] **Step 2: 受け入れ** — `npx vitest run` → 全PASS
- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: 公開一覧の検索・絞り込み・ページネーションを反映"
```

---

## 完了条件

- `npx vitest run` 全パス
- 手動確認: ギャラリーで検索語を打つと300ms後に絞り込まれる → 雰囲気チップで絞れる → 「もっと見る」で追記される → ユーザーページでも同様に動く → ライブラリで世界観に雰囲気を付けて再公開するとギャラリーの絞り込みに載る
