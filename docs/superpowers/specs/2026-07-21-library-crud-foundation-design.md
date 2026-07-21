# 素材ライブラリ サブプロジェクト1: サーバー側CRUD基盤 設計ドキュメント

## 1. 背景・目的

file-split-refactorブランチのマージ完了後、次工程として「素材ライブラリ」機能(World/Character/Scenario/Rulesetの一覧・保存・既存選択、docs/05-ui-ux.md 14.3相当)の実装に着手する。この機能は規模が大きいため、以下4つのサブプロジェクトに分解した:

1. **サーバー側CRUD基盤**(本ドキュメントのスコープ)
2. World機能: region/category自動分割・インポートパイプライン(docs 06-content-generation.md)
3. Character/Scenario機能: PC・NPC(revealed管理含む)・ScenarioのCRUD詳細
4. フロントエンドUI: 素材ライブラリ画面 + Setupウィザードの「既存を選ぶ/新規作成」連携

本ドキュメントは(1)のみを対象とする。(2)〜(4)は別途spec化する。

## 2. スコープ

### 対象エンティティ
World、Character(PC/NPC)、Scenario、Rulesetの4種類。**Campaignは対象外**(4エンティティに絞る)。

### 対象外(このサブプロジェクトでは扱わない)
- World の region/category 自動分割・大規模インポート(サブプロジェクト2)
- NPCの`revealed`状態を切り替えるUI・業務ロジック(サブプロジェクト3。本サブプロジェクトではフィールドとして保存できるようにするのみ)
- 素材ライブラリ画面・Setupウィザード連携などのフロントエンドUI全般(サブプロジェクト4)
- AIによる自由記述→構造化変換パイプライン(docs 02-data-model.md 3.4節)。`parsed.json`という名前のAI解析結果ではなく、UIが必要とする最小限のメタ情報のみを持つレコードとして扱う

## 3. データモデル

World・Character・Scenarioは「生テキスト(textStore)」+「軽量メタ情報(dataStore)」の組で保存する。Rulesetはメタ情報のみ(textStoreは使わない)。

### World
- textStore: `worlds/{worldId}/world.md` — 生の世界観テキスト
- dataStore: `worlds/{worldId}` — `{ id, title, updatedAt }`

### Character(PC/NPC共通)
- textStore: `worlds/{worldId}/{kind}/{name}.md`(`kind`は`'pc'|'npc'`) — 生のキャラクターシート
- dataStore: `worlds/{worldId}/{kind}/{name}` — `{ id, worldId, kind, name, revealed, updatedAt }`。`revealed`は`kind==='npc'`の場合のみ意味を持つブール値(デフォルト`false`)。PCの場合は`null`または未設定

### Scenario
- textStore: `worlds/{worldId}/scenarios/{scenarioId}/scenario.md` — 生のシナリオ本文
- dataStore: `worlds/{worldId}/scenarios/{scenarioId}` — `{ id, worldId, title, updatedAt }`

### Ruleset
- dataStore: `rulesets/{rulesetId}` — `{ id, label, desc, hint, updatedAt }`
- 既存の組み込み4種(simple/coc7e/dnd5e/gurps、`src/data/rulesets.js`)は変更しない。フロントエンドで組み込み分とユーザー作成分をマージして扱う(サブプロジェクト4で対応、本サブプロジェクトはAPIを提供するのみ)

## 4. paths.js の変更

`server/storage/paths.js`の`worldMetaKey(worldId)`を現在の`worlds/${worldId}/world`から`worlds/${worldId}`に変更する。**同じ理由で`scenarioMetaKey(worldId, scenarioId)`も`worlds/${worldId}/scenarios/${scenarioId}/scenario.parsed`から`worlds/${worldId}/scenarios/${scenarioId}`に変更する**(下記参照)。

**理由**: `dataStore.list(prefix)`は指定prefix直下の`.json`ファイルのみを列挙する実装であり、1階層ネストしたファイルは拾えない。

- World一覧を取得するには`dataStore.list('worlds')`が`worlds/{worldId}.json`を直接見つけられる必要がある → `worldMetaKey`をフラット化
- Scenario一覧を取得するには`dataStore.list('worlds/{worldId}/scenarios')`が`worlds/{worldId}/scenarios/{scenarioId}.json`を直接見つけられる必要がある。現状の`scenarioMetaKey`は`.../scenarios/{scenarioId}/scenario.parsed`と、`{scenarioId}/`というディレクトリを1階層余分に挟んでいるため一覧化できない → `scenarioMetaKey`もフラット化。`scenarioDocPath`(生テキスト側、`.../scenarios/{scenarioId}/scenario.md`)はtextStoreの一覧化ニーズがないため変更不要(同じ`{scenarioId}`という名前がメタ用の`.json`ファイルと生テキスト用のディレクトリ名で並存するが、ファイルとディレクトリなので衝突しない)

`characterMetaKey`は元々`worlds/{worldId}/{kind}/`の直下に配置される設計であり、`dataStore.list('worlds/{worldId}/pc')`等で一覧取得可能なため変更不要。

### textStore への delete 追加

`server/storage/textStore.js`は現状`read`/`write`/`list`のみを持ち`delete`を持たない。World/Character/ScenarioのCRUDには削除操作が必要で、生テキスト側(textStore)も削除できる必要があるため、`dataStore.delete`と同じパターン(`fs.unlink`、`ENOENT`は無視)で`delete(path)`を追加する。

この変更に伴い、`server/storage/paths.test.js`の該当アサーション(`worldMetaKey('waterdeep')`が`'worlds/waterdeep/world'`を返すことを期待している箇所)を`'worlds/waterdeep'`に更新する。

## 5. server/storage/library.js(新規)

`dataStore`/`textStore`の上にエンティティ単位のドメイン関数を薄く被せる層。Expressルートはこの層のみを呼び、`dataStore`/`textStore`を直接操作しない。

```js
// World
saveWorld(dataStore, textStore, { id, title, raw })
getWorld(dataStore, textStore, id)          // { id, title, updatedAt, raw } | null
listWorlds(dataStore)                        // [{ id, title, updatedAt }]  (rawは含まない、一覧は軽量に)
deleteWorld(dataStore, textStore, id)

// Character
saveCharacter(dataStore, textStore, { worldId, kind, name, raw, revealed })
getCharacter(dataStore, textStore, worldId, kind, name)
listCharacters(dataStore, worldId, kind)      // kind指定で pc/npc を分けて一覧
deleteCharacter(dataStore, textStore, worldId, kind, name)

// Scenario
saveScenario(dataStore, textStore, { worldId, id, title, raw })
getScenario(dataStore, textStore, worldId, id)
listScenarios(dataStore, worldId)
deleteScenario(dataStore, textStore, worldId, id)

// Ruleset
saveRuleset(dataStore, { id, label, desc, hint })
getRuleset(dataStore, id)
listRulesets(dataStore)
deleteRuleset(dataStore, id)
```

`id`(worldId/scenarioId/rulesetId)はクライアント側で生成して渡す想定(既存の`Setup.jsx`が`'sess_' + Date.now()`のようにID生成している慣習に合わせる)。`name`(Character)はユーザーが入力するキャラクター名をそのままキーとして使う(ファイル名として安全な文字列であることの検証は本サブプロジェクトでは行わない — サブプロジェクト4で入力側にて簡易サニタイズを検討)。

## 6. REST API

```
GET    /api/worlds                              一覧
GET    /api/worlds/:id                          単体取得({ ...meta, raw })
PUT    /api/worlds/:id                           作成/更新({ title, raw }を受け取る)
DELETE /api/worlds/:id                          削除

GET    /api/worlds/:worldId/characters/:kind     一覧(kind = pc|npc)
GET    /api/worlds/:worldId/characters/:kind/:name   単体取得
PUT    /api/worlds/:worldId/characters/:kind/:name   作成/更新({ raw, revealed }を受け取る)
DELETE /api/worlds/:worldId/characters/:kind/:name   削除

GET    /api/worlds/:worldId/scenarios           一覧
GET    /api/worlds/:worldId/scenarios/:id       単体取得
PUT    /api/worlds/:worldId/scenarios/:id       作成/更新({ title, raw }を受け取る)
DELETE /api/worlds/:worldId/scenarios/:id       削除

GET    /api/rulesets                            一覧
GET    /api/rulesets/:id                        単体取得
PUT    /api/rulesets/:id                        作成/更新({ label, desc, hint }を受け取る)
DELETE /api/rulesets/:id                        削除
```

GET(単体)は`{ ...meta, raw }`を1レスポンスで返す。存在しないIDへのGET/DELETEは`404`。PUTは新規/更新を区別しない(`sessions`ルートの既存パターンに合わせる)。

`server/index.js`に`createWorldsRouter`・`createRulesetsRouter`を追加でマウントする(`createMessagesRouter`・`createSessionsRouter`と同様のパターン)。

## 7. 非スコープの再掲

- フロントエンドからのAPI呼び出し・UI(サブプロジェクト4)
- World region/category分割(サブプロジェクト2)
- NPC revealed状態の切り替えUI・関連業務ロジック(サブプロジェクト3。本サブプロジェクトはフィールドの保存のみサポート)
- Campaign
- Rulesetの判定アダプタ(check_formula等)実装
- 入力値のサニタイズ・バリデーション強化(ファイル名として不正な文字を含むID/nameのハンドリングなど)
