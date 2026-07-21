# 素材ライブラリ サブプロジェクト3: Character/Scenario詳細 設計ドキュメント

## 1. 背景・目的

サブプロジェクト1(サーバー側CRUD基盤)・2(World region/category分割)完了後、次工程としてCharacter/Scenarioの詳細機能を実装する。

4サブプロジェクトの進捗:
1. **サーバー側CRUD基盤**(完了・main統合済み)
2. **World機能: region/category自動分割・インポートパイプライン**(完了・main統合済み)
3. **Character/Scenario機能の詳細**(本ドキュメントのスコープ)
4. フロントエンドUI: 素材ライブラリ画面 + Setupウィザード連携

## 2. スコープ

サブプロジェクト1で実装済みのCharacter/Scenario基本CRUDに対し、以下2点を追加する:

1. Scenarioの`recommended_ruleset`メタ情報(docs/02-data-model.md 3.5節)
2. Character(PC/NPC)の自由記述→構造化変換パイプライン(docs/02-data-model.md 3.4節)。goal/bondsの抽出・ハッシュベースのキャッシュに限定

### 対象外(このサブプロジェクトでは扱わない)

- **Scenarioの構造化**(`relevant_docs`・`climax_marker`)。サブプロジェクト2で見送った「選択的注入」(current_regionに応じた動的プロンプト注入)やテンション制御(docs 13.2)と同じGM進行ロジック領域であり、別途扱う
- **抽出したgoal/bondsをGMプロンプト(`buildSystemPrompt`/`takeTurn`)へ実際に注入する配線**。パイプライン自体(抽出・キャッシュ)の構築に留める。現状`buildSystemPrompt`はPCの`raw`テキストをそのままsystem promptに注入しており、ユーザーがgoal/bondsを書いていれば実質的にAIには見えている。本サブプロジェクトは、それをプログラムから明示的に参照・活用したい場合(例: 定期リマインドの挿入)に備えた構造化データを用意するだけ
- NPCの`revealed_facts`要素単位管理(docs自体が「Phase 2以降で必要になれば」と明記)
- 素材ライブラリ画面・Setupウィザードからの実際の呼び出し(サブプロジェクト4)

## 3. Scenarioの recommended_ruleset

`server/storage/scenarioLibrary.js`の`saveScenario`に`recommendedRuleset`を追加する。

```js
saveScenario(dataStore, textStore, { worldId, id, title, raw, recommendedRuleset })
// meta: { id, worldId, title, recommendedRuleset: recommendedRuleset ?? null, updatedAt }
```

`server/routes/scenarios.js`のPUTハンドラが`req.body.recommendedRuleset`を渡すよう変更する。既存の`GET`/`DELETE`ハンドラは変更不要。

## 4. Character構造化変換パイプライン

### 4.1 保存形式

docsは`alice.parsed.json`という別ファイルを想定しているが、既存の`dataStore`抽象化では1エンティティ1メタレコードが自然であるため、**別ファイルではなく既存のCharacterメタレコードにフィールドを追加する形**にする(将来dataStoreがRedis化される際もキーが増えないメリットがある)。

`characterLibrary.js`の`saveCharacter`が作るメタレコードに以下を追加(新規保存時は両方`null`):
```js
{ id, worldId, kind, name, revealed, parsed: null, parsedHash: null, updatedAt }
```

### 4.2 ハッシュ判定

セキュリティ用途ではなく単なる変更検知のため、Web Crypto等の暗号学的ハッシュは使わない。`src/utils/hashText.js`に依存なしの純粋関数(DJB2系の簡易文字列ハッシュ)を実装し、フロントエンド側で「保存済みの`parsedHash`と現在の`raw`から計算したハッシュが一致するか」を判定する。

```js
hashText(text) // string を返す(例: '1a2b3c'のような36進数文字列)
```

### 4.3 サーバー側: 軽量な部分更新エンドポイント

`raw`の再書き込みを伴わずに`parsed`/`parsedHash`だけを更新できる専用エンドポイントを新設する(既存の`saveCharacter`は毎回`raw`を必須で受け取り書き込む設計のため、キャッシュ更新のためだけに`raw`を再送させるのは無駄が多い)。

`characterLibrary.js`に追加:
```js
saveCharacterParsed(dataStore, worldId, kind, name, { parsed, parsedHash })
// 既存メタレコードを読み込み、parsed/parsedHashのみ上書きして再保存し、更新後のレコードを返す。
// レコードが存在しない場合は書き込みを行わず null を返す(既存の getCharacter/getWorld 等が
// 「存在しなければ null」を返す慣習に合わせる)。
```

ルート: `PUT /api/worlds/:worldId/characters/:kind/:name/parsed`

### 4.4 フロントエンド: AI抽出呼び出し

`src/api/characterSheetParse.js`(新規)に`parseCharacterSheet(raw)`を実装する。既存の`callClaude`/`extractText`/`parseJsonLoose`(`src/api/client.js`)を使い、単一JSON出力方式(既存の`splitWorld`等と同じパターン)で`{goal, bonds}`を抽出する。

```js
parseCharacterSheet(raw) // Promise<{ goal: string, bonds: string }>
```

### 4.5 フロントエンド: キャッシュオーケストレーション

`src/api/characterSheetCache.js`(新規)に`getOrParseCharacter(worldId, kind, name)`を実装する。

```js
getOrParseCharacter(worldId, kind, name)
// 1. characterLibraryClient.getCharacter で現在のキャラクターレコードを取得
// 2. hashText(character.raw) で現在のハッシュを計算
// 3. character.parsed が存在し、character.parsedHash === 現在のハッシュ なら character.parsed を返す(キャッシュヒット)
// 4. そうでなければ parseCharacterSheet(character.raw) を呼び、結果を
//    characterLibraryClient.putCharacterParsed で保存してから返す
```

**重要**: `parseCharacterSheet`は`getOrParseCharacter`とは別ファイル(`characterSheetParse.js`)に置く。同一モジュール内の関数呼び出しは`vi.spyOn`でモックできない(ESMの静的束縛)ため。サブプロジェクト2の`worldSplit.js`/`worldImport.js`分離と同じ理由・同じパターン。

### 4.6 フロントエンド: Character用APIクライアント

`src/api/characterLibraryClient.js`(新規)。サブプロジェクト2の`worldLibraryClient.js`と同型の薄いfetchラッパー。Character CRUD全体(取得・保存・一覧・削除)と、4.3の部分更新エンドポイントをカバーする。

```js
getCharacter(worldId, kind, name)
putCharacter(worldId, kind, name, { raw, revealed })
listCharacters(worldId, kind)
deleteCharacter(worldId, kind, name)
putCharacterParsed(worldId, kind, name, { parsed, parsedHash })
```

素材ライブラリ画面(サブプロジェクト4)が必要とする基本CRUDもここでまとめて用意しておく(worldLibraryClient.jsと同じ考え方)。

## 5. 非スコープの再掲

- GMプロンプトへのgoal/bonds注入配線
- Scenarioの構造化(relevant_docs/climax_marker)
- NPCのrevealed_facts要素単位管理
- UIへの実配線
