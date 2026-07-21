# 素材ライブラリ サブプロジェクト2: World region/category分割・インポートパイプライン 設計ドキュメント

## 1. 背景・目的

サブプロジェクト1(サーバー側CRUD基盤)完了後、次工程としてWorldの大規模世界観分割・インポートパイプライン(docs/06-content-generation.md 3.2.1/3.2.2)を実装する。

4サブプロジェクトの進捗:
1. **サーバー側CRUD基盤**(完了・main統合済み)
2. **World機能: region/category自動分割・インポートパイプライン**(本ドキュメントのスコープ)
3. Character/Scenario機能: PC・NPC(revealed管理含む)・Scenario詳細
4. フロントエンドUI: 素材ライブラリ画面 + Setupウィザード連携

## 2. スコープ

### 対象
- region/categoryファイルのサーバー側CRUD(保存・取得・一覧・削除)
- ユーザーが貼った世界観原文の保存(再分割用)
- AIによる分割パイプライン(`splitWorld`/`importWorld`/`reimportWorld`。フロントエンド側、`callClaude`経由)

### 対象外(このサブプロジェクトでは扱わない)
- **選択的注入**(docs 3.2.1後半): ゲーム進行中に`current_region`に応じてGMプロンプトへ動的注入する仕組み、および未タグ領域遷移時のキーワードフォールバック。これはGM進行ロジック(`buildSystemPrompt`・session state・Play画面)に関わる別領域であり、サブプロジェクト3以降で扱う
- Setup.jsx・素材ライブラリ画面への実際の配線(UIから`importWorld`を呼び出すボタン等)。サブプロジェクト4のスコープ
- 前回分割で作られたが再分割後は不要になったregion/categoryの自動削除(**既知の簡略化**。再分割は常に上書き・追加のみ)
- 入力のサニタイズ・バリデーション強化(region/category idとして不正な文字列のハンドリングなど)。ただしAIが生成するid値は`saveRegion`/`saveCategory`呼び出し前に簡易スラグ化(英数字・ハイフン以外を除去)する程度の最低限の防御は行う

## 3. データモデル・ストレージ

### 3.1 新規: 世界観原文の保存

`server/storage/paths.js`に`worldSourceDocPath(worldId)`を追加: `worlds/${worldId}/source.md`

**理由**: `world.md`はAIが生成した目次+要約であり、ユーザーが貼った原文とは別物。再分割(docs 3.2.2ステップ5「原本自体は保持、再分割のみ」)には原文の保持が必須。

### 3.2 region/category

`regionDocPath(worldId, region)`・`categoryDocPath(worldId, category)`は既存(`server/storage/paths.js`に実装済み、未使用のまま残っていたもの)。dataStoreのメタ情報は持たない(region/categoryは単なるMarkdown断片であり、`textStore.list(prefix)`で一覧取得できるため、Worldのような`{id,title,updatedAt}`メタは不要)。

## 4. server/storage/worldContentLibrary.js(新規)

World/Character/Scenarioの`*Library.js`と同様のドメイン層だが、textStoreのみを使う(dataStoreのメタなし)点が異なる。

```js
// 原文
saveWorldSource(textStore, worldId, raw)
getWorldSource(textStore, worldId)          // string | null

// Region
saveRegion(textStore, worldId, region, raw)
getRegion(textStore, worldId, region)        // string | null
listRegions(textStore, worldId)               // string[] (region id一覧)
deleteRegion(textStore, worldId, region)

// Category
saveCategory(textStore, worldId, category, raw)
getCategory(textStore, worldId, category)     // string | null
listCategories(textStore, worldId)              // string[] (category id一覧)
deleteCategory(textStore, worldId, category)
```

`listRegions`/`listCategories`は`textStore.list('worlds/{worldId}/regions')`等の結果(フルパス配列)から、ファイル名(拡張子`.md`を除いたもの)だけを取り出して返す。

## 5. REST API

```
GET/PUT              /api/worlds/:worldId/source           (原文取得・保存。DELETEなし)
GET/PUT/DELETE        /api/worlds/:worldId/regions/:region   (一覧はGET /api/worlds/:worldId/regions)
GET/PUT/DELETE        /api/worlds/:worldId/categories/:category (一覧はGET /api/worlds/:worldId/categories)
```

`server/routes/worldContent.js`に3系統(source/regions/categories)をまとめて実装する(3つとも同じworldContentLibrary.jsを参照する薄いルートのため、ファイルを分けるほどの分量にならない)。`server/index.js`に追加でマウントする。

## 6. フロントエンド: AI分割パイプライン

### 6.1 出力スキーマ

AIの1回のレスポンスに、目次・region・categoryをまとめてJSON形式で出力させる(既存の`takeTurn`が単一JSON出力を要求するパターンと同じ手法)。

```json
{
  "world": "目次+要約のMarkdown本文(600〜900字程度)",
  "regions": [{ "id": "waterdeep", "title": "ウォーターディープ", "content": "地域の詳細本文" }],
  "categories": [{ "id": "magic-system", "title": "魔法体系", "content": "カテゴリの詳細本文" }]
}
```

`id`はAIが生成する英数字スラグ(例: `waterdeep`, `magic-system`)。ファイルパスの一部になるため、保存前に英数字・ハイフン以外の文字を除去する簡易スラグ化を行う。

### 6.2 src/api/worldImport.js(新規)

```js
splitWorld(rawText, adjustmentRequest)
  // callClaudeで分割を指示、parseJsonLooseで { world, regions, categories } を取得して返す

importWorld(worldId, title, rawText)
  // splitWorld実行 → 原文をsourceに保存 → world.md・各region・各categoryを保存 → 分割結果を返す

reimportWorld(worldId, title, adjustmentRequest)
  // 保存済みsourceを取得 → splitWorld(source, adjustmentRequest) → world.md・各region・各categoryを再保存(上書き) → 分割結果を返す
```

これらはUIから呼ばれることを想定した純粋な関数であり、本サブプロジェクトではUIへの結線は行わない(呼び出し元はサブプロジェクト4で実装)。

### 6.3 src/api/worldLibraryClient.js(新規)

`importWorld`/`reimportWorld`がサーバーへ保存する際に使う薄いfetchラッパー。サブプロジェクト1で作ったサーバーAPI(`/api/worlds/*`)にフロントエンドから初めてアクセスする箇所であり、`callClaude`と同じ形の薄いラッパー関数として実装する。

```js
putWorld(id, { title, raw })
putWorldSource(id, raw)
getWorldSource(id)
putRegion(worldId, region, raw)
putCategory(worldId, category, raw)
```

いずれも`fetch('/api/...', { method: 'PUT'|'GET', ... }).then(r => r.json())`程度の薄いラッパー。素材ライブラリ画面(サブプロジェクト4)が必要とする一覧取得・削除等の他のAPIクライアント関数は、このファイルを土台にサブプロジェクト4で追加する。

## 7. 非スコープの再掲

- 選択的注入(current_region・buildSystemPrompt変更・キーワードフォールバック)
- Setup.jsx・素材ライブラリ画面への実配線
- 再分割時の不要ファイル自動削除
- 入力値の本格的なサニタイズ・バリデーション(region/category idの簡易スラグ化のみ実施)
