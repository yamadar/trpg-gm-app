# キャンペーン(連作シナリオ)SP1 コアループ 設計

2026-07-24 承認済み。[08-feature-ideas.md](../../08-feature-ideas.md) 2章「キャンペーン(連作シナリオ)」の**コアループ**。Campaignは [02-data-model.md](../../02-data-model.md) 3.5節で未実装(`campaignMetaKey` ヘルパのみ存在)。

## 決定事項(ブレインストーミング結果)

- 構造: **オープンな連鎖**。事前に全章を組まず、あるセッションを終えたら「育てたPCで次のシナリオへ」と逐次繋ぐ。
- 引き継ぎ: **テキスト方式**。章末にLLMが既存PCシート(自由記述 `pc.raw`)へ「獲得物・出来事・関係の変化」を織り込んだ更新版を生成し、xpは数値で持ち越す。
- スコープはコアループ(データモデル+引き継ぎ生成+CRUD+次章フロー)。管理UI・クロスWorld・構造化インベントリは後続(SP2)。

## 現状(前提)

- セッション生成: `src/screens/Setup.jsx` の `handleStart`。`world: { raw, summary }` を埋め込むが**worldId は保存していない**。`state.xp` は常に0開始。PCは `pc: { raw, goal, bonds }`。
- ライブラリ storage/route の流儀: `server/storage/scenarioLibrary.js` + `server/routes/scenarios.js`(worldId/id を `idParamGuard`、meta は dataStore、本文は textStore)。`server/index.js` で requireAuth 後にマウント。
- `server/storage/paths.js` の `campaignMetaKey(userId, worldId, campaignId)` は現状 `.../campaigns/${campaignId}/campaign`(ネスト)で**一覧不可**。未使用なので**フラット化して再定義**する(下記)。
- LLM呼び出しのクライアント経路: `src/api/session.js` が `callClaude`(`/api/messages` プロキシ、`messages` 日次上限)を使う(`recallMemory` が前例)。
- Home のセッションカード: `src/screens/Home.jsx`。App の画面遷移: `src/App.jsx`(home/setup/library/play 等)。

## データモデル変更(すべて additive)

- セッションに任意 `worldId?: string`(ライブラリWorld由来。Setupで判明時に保存)と `campaignId?: string`。
- Campaignメタ(フラット化した `campaignMetaKey`): `{ id, worldId, title, carriedPc: { raw, xp }, chapters: [{ sessionId, title, endedAt }], createdAt, updatedAt }`。carriedPc はメタJSONに内包(別テキストドキュメント不要)。

## コンポーネント

### 1. `server/storage/paths.js`

- `campaignMetaKey(userId, worldId, campaignId)` を `users/${userId}/worlds/${worldId}/campaigns/${campaignId}` に**フラット再定義**(一覧可能に)。
- `campaignListPrefix(userId, worldId)` → `users/${userId}/worlds/${worldId}/campaigns` を追加。

### 2. `server/storage/campaignLibrary.js`(新規)

```
saveCampaign(dataStore, userId, campaign) -> meta        // upsert(id必須)。updatedAt付与、createdAt保持
getCampaign(dataStore, userId, worldId, id) -> meta|null
listCampaigns(dataStore, userId, worldId) -> meta[]
```
- dataStore のみ使用(carriedPcはメタ内。textStore不要)。

### 3. `server/routes/campaigns.js`(新規、scenariosに倣う)

`createCampaignsRouter({ dataStore })`。`worldId`/`id` を `idParamGuard`。
- `GET /api/worlds/:worldId/campaigns` → 一覧。
- `GET /api/worlds/:worldId/campaigns/:id` → 単体(無ければ404)。
- `PUT /api/worlds/:worldId/campaigns/:id` → upsert。body必須: `title`(string)、`carriedPc`(`{ raw:string, xp:number }`)、`chapters`(array)。型不正は400。`worldId`/`id` はパスから。
- `server/index.js` の requireAuth 後にマウント。

### 4. クライアント `src/api/campaignClient.js`(新規)

- `listCampaigns(worldId)` / `getCampaign(worldId, id)` / `putCampaign(worldId, id, { title, carriedPc, chapters })`(`apiFetch` 使用)。

### 5. 引き継ぎ生成 `src/api/session.js` に `advanceCampaignPc(session)`

```
advanceCampaignPc(session) -> Promise<{ pcRaw: string, xp: number }>
```
- `callClaude({ model:'claude-sonnet-5', max_tokens: 1500, thinking:{type:'disabled'}, system, messages })`。
- system: 「TRPGの1つの冒険を終えたPCの、次の冒険へ持ち越す更新版シートを書け。元のPCシートの体裁(PC名・能力・持ち物・goal・bonds等)を保ちつつ、この冒険で得た物・能力の成長・出来事・新たな因縁や関係の変化を反映する。未開示の秘密やメタ情報・ゲーム的表現(フラグのキー名等)は書かない。シート本文のみ出力。」
- user: 元PCシート(`pc.raw`)+ 物語要約(`history_summary`)+ 既知フラグ(`flags` を材料として列挙)+ 直近ログ。
- `pcRaw = extractText(...).trim() || session.pc.raw`(空はフォールバック)。`xp = session.state?.xp || 0`。

### 6. `src/screens/Setup.jsx` の変更

- 任意prop `campaignContext`(`{ worldId, world:{raw,summary}, moods, pcRaw, xp, rulesetId, campaignId }` | null)。指定時:
  - World: 既存扱いで `resolvedWorldId = campaignContext.worldId`、`worldSummary/worldRawForSession = campaignContext.world.*`(Worldステップを前埋め・確定)。
  - PC: `pcRaw` を前埋め(`pcMode='new'` 相当、`pcRaw = campaignContext.pcRaw`)。
  - Ruleset: `campaignContext.rulesetId` を既定選択。
  - 生成セッションに `worldId = campaignContext.worldId`、`campaignId = campaignContext.campaignId`、`state.xp = campaignContext.xp`。
- `campaignContext` 無指定時は現行動作のまま。**加えて、全セッションで `session.worldId = resolvedWorldId`(判明時のみ)を保存**する(次章ボタンの起点)。

### 7. `src/screens/Home.jsx` + `src/App.jsx`

- Home セッションカードに、`s.worldId` がある時のみ「次の章へ」ボタン(既存の「小説化」等の並び)。押下 `handleNextChapter(e, s)`:
  1. `advanceCampaignPc(s)` → `{ pcRaw, xp }`。
  2. campaign解決: `s.campaignId` があれば `getCampaign(s.worldId, s.campaignId)`、無ければ新規(id採番、title=世界観/セッション由来、chapters=[])。`chapters` に `{ sessionId: s.id, title: s.title, endedAt: Date.now() }` を追記し、`carriedPc={raw:pcRaw,xp}` に更新して `putCampaign`。
  3. 元セッション `s` に `campaignId` を付与して `putSessionToServer` + IndexedDB保存(新規campaign時のみ)。
  4. App へ「次章のcampaignContext付きでSetupを開く」よう通知(`onNextChapter(campaignContext)`)。App は `campaignContext` state を持ち、Setupへ渡す。Setup開始時に消費・クリア。
- 失敗時は既存の `novelizeError` と同じ枠でカード内エラー表示。二重実行防止(既存 `novelizing` と別の `advancing` state）。

### 8. `src/App.jsx`

- `campaignContext` state を追加。`Home` の `onNextChapter(ctx)` で set し、画面を setup へ。`Setup` に `campaignContext` を渡す。Setupの `onStart`/`onCancel` 時に null クリア。

## エラー処理・互換性

- `worldId` の無い旧セッション・空欄Worldセッション: 「次の章へ」非表示(キャンペーンはライブラリWorld前提)。
- `advanceCampaignPc` 失敗(429/ネットワーク): カード内エラー、セッションは不変。
- campaign CRUD 失敗: 同上。
- `campaignMetaKey` フラット化は未使用のため後方互換の破壊なし(paths.test.js の該当アサートを更新)。
- データ移行不要(全フィールド任意)。

## テスト方針

- `server/storage/paths.test.js`: `campaignMetaKey` フラット・`campaignListPrefix`。
- `server/storage/campaignLibrary.test.js`: save/get/list、createdAt保持・updatedAt更新。
- `server/routes/campaigns.test.js`(supertest): PUT upsert・GET単体/一覧・404・型不正400。
- `server/index.test.js`: 新ルート結線で既存が壊れないこと(既存で担保)。
- `src/api/campaignClient.test.js`: URL/メソッド。
- `src/api/session.test.js`: `advanceCampaignPc`(system指示・userにpc.raw/history/flags・抽出・空フォールバック)。
- `src/screens/Setup.test.jsx`: `campaignContext` 前埋めで worldId/campaignId/state.xp/pcRaw が反映される。無指定時は現行。全セッションで worldId 保存。
- `src/screens/Home.test.jsx`: `worldId` 有無でボタン出し分け、押下で advance→putCampaign→onNextChapter 呼び出し、失敗時エラー表示。

## スコープ外(後続 SP2)

- Campaign管理タブ(一覧・章表示・改名・削除)、Home でのキャンペーン単位表示。
- クロスWorldキャンペーン、構造化インベントリ/関係モデル、NPC記憶連携。
- 次章シナリオの自動提案(現状は既存選択/生成のユーザー操作)。
