# 素材ライブラリ サブプロジェクト4a: Scenario/Ruleset APIクライアント 設計ドキュメント

## 1. 背景・目的

サブプロジェクト1〜3(サーバー側CRUD基盤、World region/category分割、Character/Scenario詳細)完了後、最後のサブプロジェクト4「フロントエンドUI」に着手する。UIの前提として、`src/api/worldLibraryClient.js`・`src/api/characterLibraryClient.js`(いずれも既存・承認済み)と同型のScenario/Ruleset用APIクライアントが不足しているため、まずこれを整備する。

4サブプロジェクトの進捗:
1. サーバー側CRUD基盤(完了)
2. World region/category分割(完了)
3. Character/Scenario詳細(完了)
4. フロントエンドUI(本ドキュメントは4のうち「4a: 不足しているAPIクライアント」のみを扱う。4b: 素材ライブラリ画面、4c: Setupウィザード連携、4d: Home画面の導線追加は別途)

## 2. スコープ

`src/api/scenarioLibraryClient.js`と`src/api/rulesetLibraryClient.js`の新規作成のみ。UIからの呼び出しは含まない(4b/4cのスコープ)。

## 3. 設計

いずれも既存の`worldLibraryClient.js`/`characterLibraryClient.js`と同じ`apiFetch`ヘルパーパターン(非okレスポンスでstatus+末尾200文字のbodyを含むErrorをthrow、DELETEは`.json()`を呼ばない)を踏襲する。

### src/api/scenarioLibraryClient.js

```js
getScenario(worldId, id)
putScenario(worldId, id, { title, raw, recommendedRuleset })
listScenarios(worldId)
deleteScenario(worldId, id)
```
対応エンドポイント: `GET/PUT/DELETE /api/worlds/:worldId/scenarios/:id`、`GET /api/worlds/:worldId/scenarios`(既存・サブプロジェクト1/3で実装済み)

### src/api/rulesetLibraryClient.js

```js
getRuleset(id)
putRuleset(id, { label, desc, hint })
listRulesets()
deleteRuleset(id)
```
対応エンドポイント: `GET/PUT/DELETE /api/rulesets/:id`、`GET /api/rulesets`(既存・サブプロジェクト1で実装済み)。Worldに紐づかないフラットな構造(既存の`rulesetLibrary.js`/`routes/rulesets.js`と同じ)。

## 4. 非スコープ

- UIからの呼び出し(4b/4c)
- Campaign(4サブプロジェクト全体を通じて対象外)
