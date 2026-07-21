# 技術的積み残しの解消 設計ドキュメント

## 1. 背景・目的

素材ライブラリ機能(サブプロジェクト1〜4c)の完了後、レビュー過程で記録された4件の技術的な積み残しを解消する。

1. `Button`コンポーネントがネイティブの`disabled`属性を転送していない(a11yの穴)
2. Worldのregion/category一覧が、既存Worldを選択しただけでは表示できない(直近のimport/reimport結果しか見えない)
3. goal/bonds抽出パイプライン(`characterSheetCache.js`)が実装済みだが、GMプロンプト(`buildSystemPrompt`)への注入配線が未接続
4. カスタムRuleset(サーバー保存分)が実プレイ(Setup→GM進行)で使えない(`buildSystemPrompt`は静的4件のみ解決可能)

## 2. 事前調査で判明した事実

- **項目2について**: サーバー側(`server/storage/worldContentLibrary.js`の`listRegions`/`listCategories`、`server/routes/worldContent.js`の`GET /worlds/:worldId/regions`・`GET /worlds/:worldId/categories`・個別の`GET /worlds/:worldId/regions/:region`・`GET /worlds/:worldId/categories/:category`)は**既に完成済み**。フロントエンドの`src/api/worldLibraryClient.js`にクライアント関数が無く、`WorldTab.jsx`も呼んでいないだけ。
  - `GET /worlds/:worldId/regions`は`["waterdeep", "sword-coast"]`のようなid文字列配列を返す(タイトルは含まない。region/categoryのタイトルはそもそも永続化されておらず、直近のAI分割結果としてのみ一時的に存在する)。
  - `GET /worlds/:worldId/regions/:region`は`{id, raw}`を返す。
- **項目3について**: `buildSystemPrompt(session)`(`src/api/prompts.js`)は`session.pc.raw`のみ読み、`worldId`やキャラクター識別子には一切触れない。`getOrParseCharacter(worldId, kind, name)`は既存だが、`session`自体がworldId/PC識別子を保持していないため呼び出しようがない。
- **項目4について**: `session.rulesetId`を解決する箇所は`src/api/prompts.js:24`の1箇所のみ(`RULESETS.find((r) => r.id === session.rulesetId) || RULESETS[0]`)。`Play.jsx`はRuleset情報を一切参照しない(表示にも使っていない)ため、この1箇所を直せば実プレイへの反映は完結する。

## 3. 各項目の設計

### 3.1 Buttonのdisabled属性

**Files:** `src/components/ui/Button.jsx`

`<button>`要素に`disabled={disabled}`を追加する。既存の`onClick={disabled ? undefined : onClick}`(二重の安全策として残す)、`opacity`/`cursor`制御は変更しない。

### 3.2 Worldのregion/category一覧

**Files:** `src/api/worldLibraryClient.js`、`src/screens/library/WorldTab.jsx`

`worldLibraryClient.js`に4関数を追加:
```js
listRegions(worldId) → string[]
getRegion(worldId, region) → {id, raw}
listCategories(worldId) → string[]
getCategory(worldId, category) → {id, raw}
```

`WorldTab.jsx`は、現行の`splitResult`(import/reimport直後のみ有効、タイトル付き)を`regions`/`categories`という統一state(`[{id, title, content}]`、`content`は未取得なら`null`)に置き換える:
- `selectedWorldId`変更時の`useEffect`で、`getWorld`に加えて`listRegions`/`listCategories`を呼び、`{id, title: id, content: null}`の配列としてセットする(タイトルが無いため、idをそのままラベルに使う)。
- `handleCreate`/`handleReimport`成功時は、返ってきた分割結果(`{id, title, content}`、タイトル・本文とも取得済み)でそのまま上書きする(挙動は現行のsplitResultと同じ)。
- 一覧の「編集」クリック時、`content === null`(一覧経由でまだ本文を取得していない)なら`getRegion`/`getCategory`で遅延取得してから編集フォームを開く。`content`が既にある(直近の分割結果由来)ならそのまま使う。
- 保存(`putRegion`/`putCategory`)は現行のまま。

これにより、既存Worldを選択しただけでもregion/category一覧(id表示)が見え、クリックで本文を見る・編集できるようになる。タイトルの永続化(region/categoryのメタデータ拡張)は本項目のスコープ外とする(データモデル変更が必要なため)。

### 3.3 goal/bonds注入配線

**Files:** `src/screens/Setup.jsx`、`src/api/prompts.js`

**適用範囲**: PCが素材ライブラリに紐づいている場合のみ(既存PC選択、または新規作成でライブラリ保存に成功した場合)。Worldを空欄のまま進めた場合や、ライブラリ保存が失敗した場合は対象外(既存の「ライブラリ紐づきがない場合は拡張機能の恩恵を受けない」という設計方針を踏襲)。

`Setup.jsx`の`handleStart`で、PCのライブラリ連携が確定した時点(既存PC選択時、または新規PCの`putCharacter`成功時)で`getOrParseCharacter(worldId, 'pc', name)`を1回呼び、結果(`{goal, bonds}`)を`session.pc`に埋め込む:
```js
session.pc = { raw: pcRawForSession, goal: pcGoal, bonds: pcBonds }
```
`pcGoal`/`pcBonds`はライブラリ紐づきが無い場合`undefined`のまま。`getOrParseCharacter`呼び出しが失敗した場合も、非致命的に`console.error`するだけでセッション開始は妨げない(既存の`trySaveToLibrary`と同じ考え方。ただしこちらは「開始をブロックしない」の一貫性のため専用のtry/catchとする)。

`buildSystemPrompt`(`src/api/prompts.js`)は、`session.pc.goal`または`session.pc.bonds`が存在する場合のみ、「# PC設定」の直後に新しい節を追加する:
```
# PCの目標・因縁(抽出済み)
goal: <値または「(未設定)」>
bonds: <値または「(未設定)」>
```
存在しない場合(旧形式のセッション、またはライブラリ紐づきが無いセッション)は現行通り何も追加しない。既存のIndexedDB永続化セッション(`session.pc`に`goal`/`bonds`フィールドが無い)との後方互換性が保たれる。

NPCへの拡張(どのNPCが現在のシーンに関与するかという「アクティブNPCロスター」の概念は現状のプロンプト設計に存在しない)は対象外。

### 3.4 カスタムRulesetの実プレイ利用

**Files:** `src/screens/Setup.jsx`、`src/api/prompts.js`

`Setup.jsx`のRulesetステップで、マウント時に`listRulesets()`(`src/api/rulesetLibraryClient.js`、既存)を取得し、静的`RULESETS`と1つの結合リスト(`allRulesets = [...RULESETS, ...customRulesets]`)として表示する。カード選択・ハイライトの挙動は現行のまま(`rulesetId`で管理)。ScenarioのrecommendedRulesetとの照合(`RULESETS.some(...)`)も結合リストに対して行うよう変更する。

`handleStart`で、`rulesetId`に対応する完全なruleset情報を結合リストから解決し、`session.ruleset`として埋め込む:
```js
session.ruleset = { id, label, desc, hint }
```
`rulesetId`(既存フィールド)はそのまま残す。

`buildSystemPrompt`は`session.ruleset`があればそれを使い、無ければ既存の`RULESETS.find((r) => r.id === session.rulesetId) || RULESETS[0]`にフォールバックする(既存IndexedDBセッションとの後方互換性維持)。

静的idとカスタムidが衝突した場合(ユーザーがLibrary画面で`simple`等と同じidのカスタムRulesetを作った場合)、結合リストの`.find()`は静的側を優先する(先に並べているため)。この既知の限定的なエッジケースは対応しない(YAGNI)。

## 4. 非スコープ

- Campaign(プロジェクト全体を通じて対象外)
- Region/categoryのタイトル永続化(データモデル拡張が必要)
- NPCへのgoal/bonds注入(「アクティブNPCロスター」という別課題)
- 静的idとカスタムidの衝突対策

## 5. 後方互換性の確認

- `buildSystemPrompt`は`session.ruleset`・`session.pc.goal`/`bonds`のいずれも「存在すれば使う、無ければ現行の挙動」という設計のため、既にIndexedDBに保存されている旧形式のセッションもそのまま`Play`画面で問題なく再開できる。schema_versionによる移行処理は不要。
