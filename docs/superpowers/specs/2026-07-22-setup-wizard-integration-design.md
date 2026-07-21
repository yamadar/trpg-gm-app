# 素材ライブラリ サブプロジェクト4c: Setupウィザード連携 設計ドキュメント

## 1. 背景・目的

サブプロジェクト1〜3(サーバー側CRUD基盤)、4a(不足していたAPIクライアント)、4b(素材ライブラリ画面)が完了し、World/Character/Scenario/Rulesetの全CRUD操作がフロントエンドから可能になった。本サブプロジェクトでは、`src/screens/Setup.jsx`(新規プレイ作成ウィザード)を素材ライブラリと連携させ、`docs/05-ui-ux.md` 14.2節の「既存を選ぶ or 新規作成」フローを実現する。

4サブプロジェクトの進捗:
1. サーバー側CRUD基盤(完了)
2. World region/category分割(完了)
3. Character/Scenario詳細(完了)
4. フロントエンドUI
   - 4a: 不足しているAPIクライアント(完了)
   - 4b: 素材ライブラリ画面(完了。Home画面への導線も含む)
   - **4c: Setupウィザード連携(本ドキュメントのスコープ)**

## 2. スコープ

`src/screens/Setup.jsx`の各ステップ(World/Scenario/Ruleset/PC)を、素材ライブラリの「既存を選ぶ」「新規作成」の2系統に対応させる。

### 対象外

- `session`のデータ構造変更(`world.raw`/`scenario.raw`/`pc.raw`埋め込み方式は維持。`buildSystemPrompt`・`Play.jsx`は無改修)
- カスタムRuleset(サーバー保存分)のSetupでの選択(静的4件のみ引き続き使用)
- Campaign(プロジェクト全体を通じて対象外)

## 3. 全体方針

- 新規作成されたWorld/Scenario/PCは、`slugify(タイトル) + '-' + Date.now()`で自動生成した識別子でサーバーの素材ライブラリにも保存する。ユーザーに識別子入力を求める新規フィールドは追加しない。
  - `slugify`は既存の`src/api/worldSplit.js`内のプライベート関数と同じ実装(小文字化・英数字とハイフン以外除去・64文字制限・空なら`untitled`)を、新規共通ユーティリティ`src/utils/slugify.js`として切り出して再利用する(`worldSplit.js`もこれに差し替える)。
- Rulesetステップは既存の静的`RULESETS`(`src/data/rulesets.js`)のみを使用する。カスタムRulesetは対象外。

## 4. 各ステップの設計

### 4.1 World(ステップ0)

3つのモードをボタンで切り替える(`worldMode`: `'existing' | 'new' | 'skip'`、初期値`'skip'`で現状の空欄挙動と揃える):

- **既存を選ぶ(`existing`)**: マウント時に`listWorlds()`を取得し、一覧から選択。選択したWorldは`getWorld(id)`で本文を取得し、`session.world = { raw: w.raw, summary: w.raw }`とする(ライブラリのWorld.rawは既に分割済み要約(600〜900字)のため、`summarizeWorld`による再要約は不要)。選択したWorldの`id`を以降のScenario/PCステップの絞り込みに使う(`selectedWorldId`)。
- **新規に本文を貼る(`new`)**: 現行の「世界観の資料を貼る」テキストエリア+ファイル取り込み(`FileImportRow`)はそのまま。ライブラリへの保存(`importWorld(id, title, rawText)`呼び出し)は、後述の通り`handleStart`内でまとめて行う(下記5節)。この間、ウィザード上は`selectedWorldId`がまだ確定していない(`handleStart`実行までworldIdは存在しない)。`title`は空なら「無題の世界観」などのデフォルトを使う。
- **空欄のまま進める(`skip`)**: 現状の挙動を維持(`session.world = { raw: '', summary: '(特に指定なし)' }`、ライブラリ保存なし、`selectedWorldId`は`null`のまま)。

`selectedWorldId`が`null`のままScenario/PCステップに進んだ場合(`worldMode`が`new`でまだ`handleStart`前、または`skip`の場合)、両ステップとも「既存を選ぶ」は選択不可(表示中のWorldに紐づく一覧が無いため)で、自由記述の「新規作成」のみになる。この新規作成分がライブラリに実際に保存されるかどうかは、`worldMode`が最終的に`new`(→`handleStart`で`worldId`が確定する)か`skip`(→`worldId`は最後まで`undefined`のまま、保存はスキップ)かに依存する(下記5節)。

### 4.2 Scenario(ステップ1)

`selectedWorldId`が設定されていれば、マウント/World変更時に`listScenarios(selectedWorldId)`を取得する。3モード(`scenarioMode`: `'existing' | 'paste' | 'generate'`、`selectedWorldId`が無い場合は`existing`を選択不可):

- **既存を選ぶ(`existing`)**: 一覧から選択。`getScenario(worldId, id)`で本文取得、`session.scenario = { raw: s.raw }`。選択したScenarioの`recommendedRuleset`を`recommendedRulesetHint`としてRulesetステップに引き継ぐ。
- **自分で用意する(`paste`)**: 現行のテキストエリアのまま。ライブラリへの保存(`putScenario`呼び出し)は`handleStart`内でまとめて行う(下記5節)。`title`は空なら「無題のシナリオ」をデフォルトにする。
- **AIに作ってもらう(`generate`)**: 現行の`generateScenario(genre, pcRaw, worldSummary)`はそのまま(`handleStart`内で呼ぶタイミングも現状通り)。生成結果の保存(`putScenario`呼び出し)も`handleStart`内でまとめて行う(下記5節)。`title`はgenre文字列またはデフォルトを使う。

### 4.3 Ruleset(ステップ2)

現行のCard選択はそのまま。Scenarioステップで`recommendedRulesetHint`が設定されており、かつそれが`RULESETS`のいずれかの`id`と一致する場合、Rulesetステップ初回表示時の`rulesetId`初期値をそれに合わせる(`useEffect`で`recommendedRulesetHint`変化を監視)。一致しない場合は現行のデフォルト(`'simple'`)のまま。ユーザーはこの初期選択を自由に変更できる(現行の挙動)。

### 4.4 PC(ステップ3)

`selectedWorldId`が設定されていれば、`listCharacters(selectedWorldId, 'pc')`を取得する。2モード(`pcMode`: `'existing' | 'new'`、`selectedWorldId`が無い場合は`existing`を選択不可):

- **既存を選ぶ(`existing`)**: 一覧から選択。`getCharacter(worldId, 'pc', name)`で本文取得、`session.pc = { raw: c.raw }`。
- **自由記述で新規作成(`new`)**: 現行のテキストエリアのまま。ライブラリへの保存(`putCharacter`呼び出し)は`handleStart`内でまとめて行う(下記5節)。

### 4.5 確認(ステップ4)

現行のまま変更なし。

## 5. handleStartの処理順序

既存の`handleStart`は「World要約→Scenario生成→session構築→onStart」という一直線の非同期処理であり、ステップ間の「次へ」ボタン自体は非同期処理を持たない(状態遷移のみ)。本サブプロジェクトもこの構造を維持し、ライブラリへの書き込み(`importWorld`/`putScenario`/`putCharacter`)は**すべて`handleStart`内にまとめる**(個々のステップの「次へ」に非同期処理・busy状態を追加しない)。

理由: Worldが`new`モードで作成された場合、その`worldId`が確定するのは`importWorld`呼び出し後であり、Scenario/PCの`putScenario`/`putCharacter`はそのidに依存する。そのため呼び出し順序は固定で:

1. `worldMode === 'existing'`: 既に`selectedWorldId`が確定している(選択直後に`getWorld`済み)。追加の書き込みは無い。
2. `worldMode === 'new'`: `importWorld(生成id, title, worldRaw)`を呼び、その結果の`split.world`を`session.world.summary`に使う。返り値の`id`をこの後のScenario/PC保存に使う`worldId`とする。
3. `worldMode === 'skip'`: `worldId`は`undefined`のまま。
4. `scenarioMode === 'existing'`: 既に`getScenario`済み。追加の書き込みは無い。
5. `scenarioMode === 'paste'`: `worldId`が確定していれば`putScenario(worldId, 生成id, {...})`を呼ぶ。無ければスキップ。
6. `scenarioMode === 'generate'`: 現行通り`generateScenario`を呼んだ後、`worldId`が確定していれば`putScenario`を呼ぶ。
7. `pcMode === 'existing'`: 既に`getCharacter`済み。追加の書き込みは無い。
8. `pcMode === 'new'`: `worldId`が確定していれば`putCharacter(worldId, 'pc', 生成id, {...})`を呼ぶ。
9. 上記で構築した`session`を`onStart(session)`に渡す(現行通り)。

「既存を選ぶ」系(`getWorld`/`getScenario`/`getCharacter`)は、選択直後(Card クリック時)に即座に呼び出し、対応する`state`(`session.world`/`session.scenario`/`session.pc`の元データ)に格納しておく。これは単純な読み取りであり、`Library.jsx`配下の各Tabコンポーネントが選択時に`getWorld`/`getCharacter`/`getScenario`を呼ぶのと同じ考え方(即時fetch)。

## 6. UI規約

- 既存/新規の切り替えは、Scenarioステップの「自分で用意する/AIに作ってもらう」と同じボタン2〜3択パターン(`variant={mode === x ? 'primary' : 'ghost'}`)を踏襲する。
- 一覧選択は`Library.jsx`配下の各Tabコンポーネントと同じCard選択パターン(クリックで選択、選択中は`borderColor: COLORS.brass`)を踏襲する。
- ライブラリへの書き込み(`importWorld`/`putScenario`/`putCharacter`)は、`session`構築に必須の`summarizeWorld`/`generateScenario`とは異なり補助的な永続化であるため、**個別に**`try/catch`で包み、失敗してもセッション開始全体を止めない。失敗時は`console.error`に記録し、画面上部(確認ステップ付近)に「素材ライブラリへの保存に失敗した(セッションはこのまま開始できる): <理由>」という非致命的な警告テキスト(`COLORS.stamp`)を表示する。`session.world.raw`/`scenario.raw`/`pc.raw`はライブラリ保存の成否によらず、ローカルの入力値(または`existing`選択で取得済みの値)でそのまま構築される。
- 一方、`worldMode === 'new'`で`importWorld`が失敗した場合は、後続のScenario/PC保存に使う`worldId`が確定しない。この場合はScenario/PC側の`putScenario`/`putCharacter`もスキップする(`worldId`が無い状態と同じ扱い)。`session`自体の構築(`world.summary`)は、ローカル入力の`worldRaw`をそのまま使う(要約なしのフォールバック)。

## 7. 非スコープの再掲

- `session`データ構造の変更
- カスタムRulesetのSetupでの利用
- Campaign
