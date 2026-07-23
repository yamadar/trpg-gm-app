# 共有機能 (Phase 2) 設計書

作成日: 2026-07-23

## 背景

Phase 1(認証・ユーザー管理、`2026-07-23-auth-user-management-design.md`)で全データがユーザー名前空間化された。Phase 2は「小説/シナリオ/キャラクター/世界観の共有」を実装する。Phase 3(ユーザーページ)は別設計。

## 確定した要件

- **インポート = コピー**: 共有素材を自分のライブラリに追加すると、追加時点の内容が複製される。以後は自由に編集でき、元の変更/削除の影響を受けない
- **個別共有**: 世界観・キャラクター・シナリオをそれぞれ単体で公開できる。キャラ/シナリオのインポート時は行き先世界(自分のライブラリ内)を選ぶ
- **小説は読み取り専用の共有**: 公開・閲覧のみ。インポートはない
- **グローバル公開ギャラリー**: 全ユーザーの公開アイテムを種別ごとに閲覧できる公開ページ。各アイテムは個別URLを持つ
- **未ログインでも閲覧可**: ギャラリーと公開アイテムの読み取りは認証不要。公開操作・インポートはログイン必須
- 公開範囲は非公開/公開の2段階(Phase 1で確定済み)

## アプローチ選定

**案A: 公開スナップショットストア**を採用。公開時に内容を `public/` ツリーへ複製し、公開読み取り・インポートは `public/` だけを読む。

比較した代替案 — **案B: 公開インデックス + 元データ参照**(公開フラグ + グローバル索引から `users/{ownerId}/...` のライブ内容を読む)は、内容の重複がなく所有者の編集が即反映される利点があるが、公開読み取りルートが他ユーザーの名前空間を横断読みするためPhase 1の分離設計が緩み、認可チェックが毎回必要になる。

採用理由: (1) 公開読み取り経路が私的データに物理的に到達不能で認可が単純(「`public/` にあれば公開」)、(2) 「公開 = その時点のスナップショット」という安定した意味論(公開後の私的編集が公開版を勝手に変えない)、(3) Phase 1の名前空間分離と完全に整合。

## 1. データモデル

### 公開ツリー(グローバル、ユーザー名前空間の外)

```
public/worlds/{publicId}                          … メタ(dataStore)
public/worlds/{publicId}/world.md                 … 本文(textStore)
public/worlds/{publicId}/regions/{region}.md
public/worlds/{publicId}/categories/{category}.md
public/characters/{publicId}  +  public/characters/{publicId}/sheet.md
public/scenarios/{publicId}   +  public/scenarios/{publicId}/scenario.md
public/novels/{publicId}      +  public/novels/{publicId}/novel.md
```

- **publicId**: 初回公開時に `pub_{12hex}`(crypto乱数)で採番。元の私的IDは使わない(ユーザー間衝突回避)
- **公開メタ共通フィールド**: `{ publicId, title, ownerId, ownerName, publishedAt, updatedAt }`
  - `ownerName` は公開時点の表示名スナップショット。所有者が改名しても再公開まで旧名のまま(許容)
  - `updatedAt` は再公開のたびに更新。`publishedAt` は初回公開時刻を維持
- **型別フィールド**: characters は `kind`(pc/npc)と `name`(元のキャラ名)、scenarios は `recommendedRuleset`。novels は追加フィールドなし(`title` にセッションタイトルが入る)
- **世界観のスナップショット範囲**: `world.md` + 全region + 全category。`source.md`(分割前の生原文)は公開しない(プレイに不要な来歴データ)。公開メタに `regions: string[]`, `categories: string[]` の名前一覧を持たせ、読み出し時のtextStore走査を不要にする
- **キャラクターの`.parsed`キャッシュ**(goal/bonds)は公開しない。インポート先の既存の遅延パースが再生成する

### 私的側の対応関係(publish mapping)

既存メタの形は変えず、専用キーで「自分のアイテム → publicId」を持つ:

```
users/{userId}/publish/worlds/{worldId}                          → { publicId }
users/{userId}/publish/worlds/{worldId}/characters/{kind}/{name} → { publicId }
users/{userId}/publish/worlds/{worldId}/scenarios/{scenarioId}   → { publicId }
users/{userId}/publish/sessions/{sessionId}                      → { publicId }   (小説)
```

## 2. 公開・再公開・公開解除の意味論

- **公開**: 現在の私的内容を `public/` へ複製。mappingが既にあれば同じ `publicId` へ上書き(= 再公開)し `updatedAt` を更新
- **公開解除**: 公開スナップショットとmappingを削除。個別URLも404になる
- **私的アイテム削除時のカスケード解除**: 公開中の私的アイテムを削除すると連動して公開解除する。`deleteWorld` は配下の公開済みキャラ/シナリオもまとめて解除する(mappingのprefix `users/{userId}/publish/worlds/{worldId}` を走査)
- **小説の公開**: `novel.md` が存在すること(小説化済み)が前提。未生成なら `409 { error: 'novelize first' }`
- 公開版が私的版より古いかの自動判定(staleバッジ)はやらない(YAGNI)。UIは「公開中」バッジ + 「再公開」「公開解除」を常時表示

## 3. API設計

### 公開読み取り(認証不要)

`requireAuth` より前にマウントする公開ルーター:

```
GET /api/public/worlds               … ギャラリー一覧(メタ配列、publishedAt降順)
GET /api/public/worlds/:publicId     … メタ + raw(world.md) + regions/categories本文
GET /api/public/characters           GET /api/public/characters/:publicId
GET /api/public/scenarios            GET /api/public/scenarios/:publicId
GET /api/public/novels               GET /api/public/novels/:publicId
```

- 一覧は全件返す(現在の規模ではページネーション不要。必要になったら追加)
- `:publicId` は既存 `idParamGuard` を通す。未知IDは404
- 詳細レスポンス: worlds は `{ ...meta, raw, regions: [{name, raw}], categories: [{name, raw}] }`、他は `{ ...meta, raw }`

### 公開・公開解除(要ログイン)

対象は常に自分のアイテムをパスで指定(認可は名前空間構造で担保):

```
POST   /api/publish/worlds/:worldId                          → 200 { publicId }
POST   /api/publish/worlds/:worldId/characters/:kind/:name   → 200 { publicId }
POST   /api/publish/worlds/:worldId/scenarios/:scenarioId    → 200 { publicId }
POST   /api/publish/sessions/:sessionId/novel                → 200 { publicId }
DELETE (同一パス群)                                           → 204
```

- 元アイテムが存在しなければ404。小説はnovel.md未生成なら409
- DELETEはmappingがなければ204(冪等)
- 公開解除は自分のmapping経由でのみ到達するため、他人の公開物は構造的に解除不能

### インポート(要ログイン、コピー方式)

```
POST /api/import/worlds/:publicId                              → 201 作成された世界のメタ
POST /api/import/characters/:publicId  body: { targetWorldId } → 201 作成されたキャラのメタ
POST /api/import/scenarios/:publicId   body: { targetWorldId } → 201 作成されたシナリオのメタ
```

- 世界観: 新worldIdは `slugify(title)`、自分のライブラリと衝突したら `-2`, `-3`… を付与。world.md + 全region + 全categoryを複製
- キャラ/シナリオ: `targetWorldId` は自分の既存世界であること(なければ404)。キャラ名/シナリオID衝突時は同様にサフィックス付与
- インポートは既存の `saveWorld`/`saveRegion`/`saveCategory`/`saveCharacter`/`saveScenario` を再利用し、新しい書き込み経路を作らない
- 小説はインポート対象外

## 4. UI設計

- **公開ギャラリー画面(新規 `src/screens/Gallery.jsx`)**: ホームに「公開ギャラリー」ボタンを追加(素材ライブラリの隣、未ログインでも押せる)。小説/世界観/キャラクター/シナリオの4タブ。カードにタイトル/作者名/公開日。クリックで詳細表示(本文 + regions/categories)+「ライブラリに追加」
  - キャラ/シナリオの「追加」は行き先世界を選ぶ小モーダル(自分の世界一覧から選択)
  - 未ログイン時: 閲覧は可能、「追加」はログイン案内を表示
  - 小説詳細は閲覧のみ(追加ボタンなし)
- **素材ライブラリの各タブ**(WorldTab/CharacterTab/ScenarioTab): 各アイテムに「公開中」バッジ、「公開」or「再公開」+「公開解除」ボタンを追加。操作後はバッジ即時更新
- **ホームのセッションカード**: 「小説を公開」/「公開解除」を追加。novel未生成の409はメッセージ表示で小説化を促す
- **APIクライアント**: `src/api/shareClient.js` に公開読み取り(listPublic/getPublic)・公開/解除(publish/unpublish)・インポート(importWorld/importCharacter/importScenario)をまとめる。既存 `apiFetch` を利用
- Rulesetの公開は対象外(Phase 1の要件リストに含まれないため)

## 5. サーバー実装の構成

```
server/storage/paths.js         … public*/publish* キー生成関数を追加(既存関数は不変)
server/storage/shareLibrary.js  … publish*/unpublish*/getPublic*/listPublic* (新規)
server/storage/importLibrary.js … importWorld/importCharacter/importScenario (新規)
server/routes/publicContent.js  … 認証不要の公開読み取りルーター (新規)
server/routes/publish.js        … 公開/解除ルーター (新規)
server/routes/imports.js        … インポートルーター (新規)
server/index.js                 … publicContent を requireAuth の前、publish/imports を後ろに配線
```

- 既存の `deleteWorld`/`deleteCharacter`/`deleteScenario` に公開解除カスケードを追加(shareLibraryの関数を呼ぶ)
- 公開一覧の並び順はサーバー側で `publishedAt` 降順ソートして返す

## 6. エラーハンドリング

- 公開読み取り: 未知publicId → 404。メタは存在するが本文が欠けている場合は `raw: ''` で返す(既存getWorldと同じ寛容さ)
- 公開操作: 元アイテム404 / novel未生成409 / 未ログイン401(既存requireAuth)
- インポート: publicId404 / targetWorldId404 / 未ログイン401。コピー途中の失敗は途中まで書かれる可能性を許容(アトミック性は保証しない — 再実行で上書き可能なため)
- クライアントは既存 `apiFetch` の401/429ハンドリングをそのまま利用

## 7. テスト戦略

既存パターン(vitest + supertest + スタブ認証 + `createTestUserSession`)を踏襲:

- **shareLibrary**: 公開で公開ツリーに複製・mapping作成/再公開で同一publicId上書き・updatedAt更新/解除で両方消える/世界観スナップショットにregions/categoriesが含まれsource.mdが含まれない/削除カスケード(deleteWorldで配下の公開キャラ/シナリオも解除)
- **importLibrary**: 複製の完全性(world: regions/categoriesまで)/ID・名前衝突のサフィックス付与/インポートしても元の公開データ・所有者データが不変
- **ルーター**: 認証境界(GET /api/public/* は未認証200、POST /api/publish/* と /api/import/* は未認証401)/novel未生成409/targetWorldId不在404/未知publicId404
- **統合(index.test.js)**: ユーザーAが公開 → 未認証でGET可能 → ユーザーBがインポート → Bのライブラリに入りAのデータ不変、のエンドツーエンド
- **クライアント**: Galleryのタブ切替・一覧・詳細表示/未ログイン時の追加ボタンがログイン案内になる/world選択モーダル/ライブラリタブの公開・解除ボタンとバッジ/ホームの小説公開ボタン

## スコープ外(Phase 2ではやらない)

- ユーザーページ(Phase 3)
- 限定公開(URLを知っている人のみ)などの中間公開範囲
- 公開一覧のページネーション・検索・タグ
- staleバッジ(公開版が古いかの自動判定)
- Rulesetの共有
- 小説のインポート
- 通報・モデレーション機能
