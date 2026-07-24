# キャンペーン(連作シナリオ)SP2 管理タブ+Homeグルーピング 設計

2026-07-25 承認済み。[08-feature-ideas.md](../../08-feature-ideas.md) 2章「キャンペーン(連作シナリオ)」の後続SP2。SP1(コアループ)は実装済み([2026-07-24-campaign-design.md](2026-07-24-campaign-design.md))。本SP2はSP1で作った `campaignLibrary`/`campaigns`ルート/`campaignClient` と `carriedPc`・`chapters` を土台に、管理UIとHome表示を追加する。

## 決定事項(ブレインストーミング結果)

- スコープ: **管理タブ + Homeグルーピング**の2本立て。章からのセッション再開・クロスWorld・構造化インベントリ・次章シナリオ自動提案は後続。
- 章(chapters)は**閲覧のみ**(章タイトル・終了日時の読み取り専用)。管理タブはLibrary内で自己完結し、Play再開の配線は持ち込まない。
- 削除の意味論: campaignメタのみ削除。**メンバーセッションの `campaignId` は不変**(セッションには触れない)。dangling `campaignId` はHomeで非グループ表示へフォールバック。
- 改名は新API不要。既存 `putCampaign` を `carriedPc`/`chapters` そのままに `title` だけ差し替えて再利用。

## 現状(前提)

- SP1で以下が存在:
  - `server/storage/campaignLibrary.js`: `saveCampaign` / `getCampaign` / `listCampaigns`(dataStoreのみ)。
  - `server/routes/campaigns.js`: `createCampaignsRouter({ dataStore })`。`GET/PUT /api/worlds/:worldId/campaigns[/:id]`。`worldId`/`id` を `idParamGuard`。**DELETEは未実装**。
  - `src/api/campaignClient.js`: `listCampaigns` / `getCampaign` / `putCampaign`。
  - Campaignメタ: `{ id, worldId, title, carriedPc: { raw, xp }, chapters: [{ sessionId, title, endedAt }], createdAt, updatedAt }`。
  - セッションに任意 `worldId?` / `campaignId?`(SP1で保存)。セッションは**campaignのtitleを持たない**。
- Library storage/routeの流儀: `server/storage/scenarioLibrary.js` + `server/routes/scenarios.js`。削除は `deleteScenario`(dataStore.delete)+ `DELETE` ルート。
- Library UIの流儀: `src/screens/Library.jsx`(タブ+World選択ドロップダウン)+ `src/screens/library/ScenarioTab.jsx`(一覧/選択/編集/削除、`ConfirmModal`)。dataStore は `.delete(key)` を持つ(存在しなくてもENOENTを握り潰す)。
- Home: `src/screens/Home.jsx`。セッションカードを `updatedAt` 降順で一覧。SP1で `s.worldId` 時のみ「次の章へ」ボタン表示。

## コンポーネント

### 1. `server/storage/campaignLibrary.js`(変更)

- `deleteCampaign(dataStore, userId, worldId, id) -> void` を追加。`dataStore.delete(campaignMetaKey(userId, worldId, id))` を呼ぶだけ(存在しなくても no-op)。

### 2. `server/routes/campaigns.js`(変更)

- `DELETE /api/worlds/:worldId/campaigns/:id` を追加。`deleteCampaign` を呼び `res.status(204).end()`。冪等(存在しなくても204)。
- import に `deleteCampaign` を追加。

### 3. クライアント `src/api/campaignClient.js`(変更)

- `deleteCampaign(worldId, id)` を追加。204(no body)は `apiFetch` の `res.json()` で throw するため、**`deleteScenario` と同様に生の `fetch(url, { method: 'DELETE' })`** を使い、`!res.ok` のときのみ throw(bodyは読まない)。

### 4. `src/screens/library/CampaignTab.jsx`(新規)

`ScenarioTab` に倣う。props: `{ worldId }`。
- `worldId` 未選択時は「先にWorldタブでWorldを作成・選択してください。」を表示。
- `worldId` 変更で `listCampaigns(worldId)` して一覧(カード: タイトル・章数 `chapters.length`・更新日)。`selectedId`/`creating` はWorld変更でリセット。
- カード選択で `getCampaign(worldId, id)` して詳細を編集領域に読み込む:
  - タイトル: 編集input。
  - 章: **読み取り専用**リスト(`chapters` を `title` + `endedAt`(ローカル日時)で列挙。空なら「章がまだない」)。
  - carriedPc: `carriedPc.raw` を読み取り専用textarea/pre、`carriedPc.xp` をラベル表示。
  - 保存(改名): `putCampaign(worldId, selectedId, { title: editTitle, carriedPc: loaded.carriedPc, chapters: loaded.chapters })`。保存後 `refresh()`。
  - 削除: `ConfirmModal` → `deleteCampaign(worldId, deleteTarget)` → `selectedId` クリア → `refresh()`。
- **新規作成UIは持たない**(campaignはHomeの「次の章へ」から生成される)。エラーは既存タブ同様カード上部に赤字表示。

### 5. `src/screens/Library.jsx`(変更)

- `TABS` に `{ key: 'campaign', label: 'Campaign' }` を追加。
- World選択ドロップダウンの表示条件を `tab === 'character' || tab === 'scenario' || tab === 'campaign'` に拡張。
- `{tab === 'campaign' && <CampaignTab worldId={selectedWorldId} />}` を描画。
- import に `CampaignTab` を追加。

### 6. `src/screens/Home.jsx`(変更)

- campaignId付きセッションのタイトル解決のため、`useEffect` で以下のマップを構築:
  - セッション群から `campaignId` を持つものの `worldId` の distinct 集合を取る。
  - 各 worldId につき `listCampaigns(worldId)` を1回呼び、`campaignId -> { title, chapterCount }` のマップ(`campaignMap` state)を作る。失敗時は該当worldぶんを空スキップ(全体は握り潰し、非グループ表示にフォールバック)。
  - 依存は `sessions`。`user` 未ログイン時はfetchしない(空マップ)。
- 表示の分割:
  - campaignId付きかつ `campaignMap` に解決できるセッション → キャンペーン別グループ。グループ見出し = `campaignMap[campaignId].title`(+「全N章」)。グループは所属セッションの最大 `updatedAt` 降順、グループ内は `updatedAt` 降順。
  - それ以外(campaignId無し or 未解決) → 従来の非グループ一覧(現行の並び)。
  - グループはページ上部の「キャンペーン」領域、非グループは従来位置。セッションカード自体(「続きから」「次の章へ」「小説化」等)は現行コンポーネントを流用。
- Home に既存の props 以外の追加は不要(`campaignClient` を直接import)。

## エラー処理・互換性

- DELETE は冪等(未存在でも204)。削除後、メンバーセッションの `campaignId` は残るが、Homeのタイトル解決に失敗して非グループ表示にフォールバックするため無害。
- `listCampaigns` 失敗(429/ネットワーク): `campaignMap` は空のまま。全セッションが従来の非グループ一覧で表示(グレースフルデグレード)。エラーはHomeの既存エラー枠があれば使い、無ければコンソールログのみで画面は壊さない。
- データ移行不要(追加フィールド無し。既存campaign/セッションはそのまま動く)。
- 旧セッション(`campaignId` 無し)は常に非グループ表示。

## テスト方針

- `server/storage/campaignLibrary.test.js`: `deleteCampaign` 後に `getCampaign` が null。存在しないidの削除が throw しない。
- `server/routes/campaigns.test.js`(supertest): DELETE が204、削除後GETが404、未存在DELETEも204(冪等)。
- `src/api/campaignClient.test.js`: `deleteCampaign` の URL/メソッド(`fetch(url, { method: 'DELETE' })`)。
- `src/screens/library/CampaignTab.test.jsx`: 一覧描画・カード選択で詳細(章の読み取り専用・carriedPc表示)・改名で `putCampaign` が既存 carriedPc/chapters 付きで呼ばれる・削除で `ConfirmModal`→`deleteCampaign`。`worldId` 未選択時のプレースホルダ。
- `src/screens/Home.test.jsx`: 同一 `campaignId` の複数セッションがタイトル見出し配下にまとまる・`campaignId` 無しは非グループ・`campaignMap` 未解決(dangling)はフォールバックで非グループ表示・`listCampaigns` が worldId ごとに呼ばれる。

## スコープ外(後続 SP3+)

- 章カードからのセッション再開/Play遷移。
- クロスWorldキャンペーン、構造化インベントリ/関係モデル、NPC記憶連携。
- 次章シナリオの自動提案。
- 管理タブでのcampaign新規作成(現状はHomeの「次の章へ」からのみ生成)。
