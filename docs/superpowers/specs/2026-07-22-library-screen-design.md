# 素材ライブラリ サブプロジェクト4b: 素材ライブラリ画面 設計ドキュメント

## 1. 背景・目的

サブプロジェクト1〜3(サーバー側CRUD基盤、World region/category分割、Character/Scenario詳細)、4a(不足していたScenario/Ruleset APIクライアント)完了により、フロントエンドから全エンティティ(World/Character/Scenario/Ruleset)のCRUD APIが揃った。本サブプロジェクトでは、それらを使ってユーザーが実際に閲覧・編集・削除・新規作成できる画面(`docs/05-ui-ux.md` 14.3節)を実装する。

4サブプロジェクトの進捗:
1. サーバー側CRUD基盤(完了)
2. World region/category分割(完了)
3. Character/Scenario詳細(完了)
4. フロントエンドUI
   - 4a: 不足しているAPIクライアント(完了)
   - **4b: 素材ライブラリ画面(本ドキュメントのスコープ。Home画面への導線追加も含む)**
   - 4c: Setupウィザード連携(別途)

なお、当初4dとして予定していた「Home画面の導線追加」は、4bで画面を実際にブラウザ確認可能にするため本サブプロジェクトに統合する(下記6節参照)。

## 2. スコープ

- `src/screens/Library.jsx`(タブコンテナ + Worldセレクタ)
- `src/screens/library/WorldTab.jsx`
- `src/screens/library/CharacterTab.jsx`
- `src/screens/library/ScenarioTab.jsx`
- `src/screens/library/RulesetTab.jsx`
- `src/components/library/ConfirmModal.jsx`(削除確認モーダル、全タブ共通)
- `App.jsx`への`view === 'library'`追加
- `Home.jsx`への「素材ライブラリ」ボタン追加

### 対象外

- Setupウィザードとの連携(既存/新規の選択、カスケードフィルタ)は4cで扱う
- Campaign(プロジェクト全体を通じて対象外)
- goal/bonds抽出結果(`getOrParseCharacter`)の一覧表示(本画面はraw編集のみ)
- 新規APIエンドポイントの追加(既存クライアントのみで完結)

## 3. 全体構成

`Library.jsx`がタブ状態(`world` / `character` / `scenario` / `ruleset`)と、Character/Scenarioタブで共有する`selectedWorldId`を保持する。

```
┌─────────────────────────────────────────┐
│ [World] [Character] [Scenario] [Ruleset] │  ← タブ切替(Setup.jsxのstepタブと同じ見た目)
│ World: [ドロップダウン ▼]                  │  ← Character/Scenarioタブでのみ表示
├─────────────────────────────────────────┤
│  (アクティブなタブの内容)                    │
└─────────────────────────────────────────┘
```

- マウント時に`listWorlds()`を呼び、World一覧を保持する。World作成・削除時に再取得する。
- `selectedWorldId`はWorldタブでWorldを選択(閲覧/編集)した際にも更新される(Worldタブ→他タブへ切り替えた際にコンテキストが引き継がれる)。
- Worldが1件も無い状態でCharacter/Scenarioタブを開いた場合は「先にWorldタブでWorldを作成してください」という案内を表示する。

## 4. 各タブの設計

### 4.1 WorldTab

- 一覧: `listWorlds()`の結果をCardで表示(タイトルのみ)。クリックで詳細/編集パネルを開く。
- 新規作成: 「+ 新規World」ボタン → 識別子(id)・タイトル・本文(raw)の入力フォーム。保存時に`importWorld(worldId, title, rawText)`を呼ぶ(内部でAI分割が走る。処理中はbusy表示)。
- 既存World編集: タイトル欄 + 本文(raw)欄。本文を編集して保存すると`reimportWorld(worldId, title, adjustmentRequest)`を呼ぶ。`adjustmentRequest`は「変更したい点」を短く書ける任意入力欄として用意する(空なら`undefined`)。
- Region/Category内訳: 選択中Worldの詳細パネル下部に、直近の分割結果(`importWorld`/`reimportWorld`の戻り値`{world, regions, categories}`)から region/category の一覧を表示。各項目はクリックで本文編集ができ、`putRegion(worldId, id, content)` / `putCategory(worldId, id, content)`で個別保存する。
  - 画面を開き直した際(初回表示時)は分割結果を保持していないため、`getWorldSource(worldId)`は「原本」であり region/category一覧そのものではない。本画面はWorldごとに直近の分割結果をコンポーネントstateとしてのみ保持し、ページ遷移をまたいだ永続化はしない(region/category個別APIには一覧取得エンドポイントがないため、直近のimport/reimport結果を表示するのが唯一の方法)。
- 削除: `deleteWorld(id)`(既存の`worldLibraryClient`ではなく、L2で実装済みの`server/storage/worldLibrary.js`に対応するクライアント関数が必要——確認: `worldLibraryClient.js`には`deleteWorld`が無い。4a対象外だったため、本タスクで追加する)。

> **注記**: `src/api/worldLibraryClient.js`には`putWorld`/`putWorldSource`/`getWorldSource`/`putRegion`/`putCategory`のみが存在し、`getWorld`/`listWorlds`/`deleteWorld`が未実装であることが判明した(既存ファイルはW4タスクで作成されたが、当時はimport/split用途に限定されたため)。本サブプロジェクトのTask 1でこれを追加する。

### 4.2 CharacterTab

- `selectedWorldId`が無ければ案内メッセージのみ表示。
- PC/NPC切り替え: Setup.jsxのシナリオ用意方法と同じボタン2択(`kind`state)。
- 一覧: `listCharacters(worldId, kind)`。各Cardにraw冒頭40文字程度 + (NPCのみ)`revealed`バッジ。既存の`Stamp`コンポーネントはダイス結果専用(`roll`オブジェクトを前提とした固定レイアウト)のため転用せず、`CharacterTab.jsx`内にインラインの小さなラベル(`revealed`の真偽値に応じて色を変えるだけの`span`)を直接実装する。
- 新規作成: 「+ 新規Character」→ 識別子(name)・raw本文・(NPCのみ)revealedチェックボックス。保存: `putCharacter(worldId, kind, name, {raw, revealed})`。
- 削除: `deleteCharacter(worldId, kind, name)`。

### 4.3 ScenarioTab

- `selectedWorldId`が無ければ案内メッセージのみ表示。
- 一覧: `listScenarios(worldId)`。各Cardにtitle + recommendedRuleset(未設定なら「未設定」表示)。
- 新規作成/編集: 識別子(id)・title・raw本文・recommendedRuleset(自由テキスト入力)。保存: `putScenario(worldId, id, {title, raw, recommendedRuleset})`。
- 削除: `deleteScenario(worldId, id)`。

### 4.4 RulesetTab

- Worldに依存しないフラットな一覧。`listRulesets()`。
- 新規作成/編集: 識別子(id)・label・desc・hint。保存: `putRuleset(id, {label, desc, hint})`。
- 削除: `deleteRuleset(id)`。
- 既存の`src/data/rulesets.js`の静的4件はこのタブでは一切扱わない(Setup.jsxが独立して使い続ける。4cで整理する)。

## 5. ConfirmModal

```
ConfirmModal({ open, message, onConfirm, onCancel })
```
Card風の中央モーダル(背景オーバーレイ + Cardコンポーネント)。「削除する」(brass variant Button)と「キャンセル」(ghost variant Button)の2択。全タブの削除ボタンから共通利用する。

## 6. Home画面・App.jsxへの導線追加

- `App.jsx`: `view`stateに`'library'`を追加。`Home`から`onOpenLibrary`コールバックで遷移、`Library`画面から`onClose`で`'home'`に戻る。
- `Home.jsx`: 「+ 新規プレイ」ボタンの下に「素材ライブラリ」ボタン(ghost variant)を追加(docs 14.1のモックアップ通り)。

## 7. エラーハンドリング・UI規約

- 保存/削除処理中は対象ボタンを`disabled`にし、Setup.jsxと同じ`busy`パターンを使う。
- API呼び出し失敗時は`COLORS.stamp`色のテキストでエラーメッセージを表示(Setup.jsxのエラー表示と同じ)。
- 識別子(id/name)入力欄には「内部で使う一意なキー(英数字推奨)。本文中の名称とは別」というヒントを付ける(`Field`の`hint`prop使用)。

## 8. テスト方針

- 各タブコンポーネントは`@testing-library/react`でレンダリング・一覧表示・作成・編集・削除の主要フローをモックfetch経由でテストする(`vi.stubGlobal('fetch', ...)`)。
- `Library.jsx`はタブ切り替えとWorldセレクタの連動を中心にテストする。
- `App.jsx`/`Home.jsx`の変更は遷移(`onOpenLibrary`/`onClose`)の呼び出しをテストする。

## 9. 非スコープの再掲

- Setupウィザードとの連携(4c)
- Campaign
- goal/bonds抽出結果の一覧表示
- 新規サーバーAPIの追加(worldLibraryClientへの`getWorld`/`listWorlds`/`deleteWorld`追加は既存エンドポイントに対応するクライアント関数の追加であり、新規APIではない)
