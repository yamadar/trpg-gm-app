# 監査修正 FX2: Setup/ライブラリUI整合性 設計ドキュメント

## 1. 背景・目的

監査で洗い出したフロントエンドの**ユーザーに見えるバグ(Important)と関連するMinor**を修正する。FX1(セッション破損防止のCritical)に続く2番目のサブプロジェクト。主にSetupウィザードと素材ライブラリ画面の状態管理・並行操作・URLエンコードの不備を直す。

## 2. スコープ(本FX2で直す指摘)

1. **Setup: 世界を切り替えても前の選択が残る(Important, I4)**: `worldId`変更時に`selectedScenario`/`selectedPC`をクリアしないため、World A選択→シナリオ選択→World B切替で**World BのセッションがWorld Aのシナリオで始まる**。加えて`worldMode==='skip'`でも前に'new'で入力した`worldRaw`が使われる。シナリオAI生成が常に`pcRaw`を渡し既存PC選択を無視する。
2. **Setup: handleStart中の中断が効かない / 一覧エラーが見えない(Important, I5)**: `busy`中も戻る/やめるボタンが押せ、進行中の`handleStart`が最後に`onStart`を呼びPlay画面へ強制遷移する。step-0の一覧取得エラーが`step===4`でしか描画されない。
3. **WorldTab: region/category編集状態がWorld切替後も残る(Important, I6)**: World切替時に`editingRegionId`/`regionDraft`等をリセットせず、`getRegion`にキャンセルトークンも無いため、World Aの地域編集中にBへ切替→保存で**別Worldの内容を書き込む**。
4. **Home: 並行小説化ガード破綻(Important, I7)**: `novelizingId`が単一値のため、AセッションとBセッションを続けて小説化するとAのボタンが再有効化し二重発火しうる。
5. **ConfirmModal: 二重クリックで二重削除(Minor, M1)**: 削除中もモーダルが開いたままで`削除する`が無効化されず、二度押しでDELETEが2回走り2回目が404で誤ったエラー表示になる。
6. **refresh()エラーが成功後もクリアされない / Library.refreshWorldsにtry/catchが無い(Minor, M4)**: Character/Scenario/Rulesetタブの`refresh`が成功時に`error`をクリアしない。`Library.refreshWorlds`はtry/catch無しで、`WorldTab.handleCreate`内で呼ばれると失敗が「World作成に失敗した」と誤表示される。
7. **API clientのid未エンコード(Minor, M5)**: `worldLibraryClient`/`characterLibraryClient`/`scenarioLibraryClient`/`rulesetLibraryClient`/`sessionSyncClient`がユーザー入力id/name/kind/region/categoryを`encodeURIComponent`せずURLへ埋め込む。`#`/`/`/空白でルーティングが壊れる。
8. **Home: ダウンロード実装の脆さ + ファイル名(Minor, M6)**: `<a>`要素をDOMに追加せずクリックし、`URL.revokeObjectURL`を同期直後に呼ぶ。タイトル`".."`が`"...md"`になる。
9. **makeId/セッションidの衝突窓(Minor, M7)**: `slugify(base) + '-' + Date.now()`と`'sess_' + Date.now()`はミリ秒精度のみでランダム成分が無く、同一ms内の2件作成で同一idになり上書きされる。

### 対象外(他FX)

- サーバー側(パストラバーサル・timeout・deleteWorldカスケード・novel鮮度) → FX3(ただしid未エンコードのクライアント側はFX2、サーバー側の厳格バリデーションはFX3で、両者は相補的)
- ドキュメント整合 → FX4 / テスト補強(Play操作・インテグレーション) → FX5

## 3. 設計

### 3.1 API clientのURLエンコード(M5)

`worldLibraryClient.js`/`characterLibraryClient.js`/`scenarioLibraryClient.js`/`rulesetLibraryClient.js`/`sessionSyncClient.js`の全URL補間で、パスセグメントに使うユーザー由来の値(`id`/`worldId`/`name`/`kind`/`region`/`category`/`session.id`)を`encodeURIComponent(...)`でラップする。既存テストは単純id(`w1`等)を使うため`encodeURIComponent('w1')==='w1'`で不変。各clientに特殊文字を含むidのエンコード検証テストを1件ずつ追加する。

### 3.2 ConfirmModalの削除ボタン無効化(M1)

`ConfirmModal`に`confirmDisabled`(boolean、任意)propを追加し、`削除する`ボタンに`disabled={confirmDisabled}`を渡す。各タブ(WorldTab/CharacterTab/ScenarioTab/RulesetTab)の`<ConfirmModal>`呼び出しで`confirmDisabled={busy}`を渡す。削除中は`busy`が`true`のため二度押しを防ぐ。

### 3.3 refresh/refreshWorldsのエラー処理(M4)

- Character/Scenario/RulesetタブのReactの`refresh`関数の先頭で`setError('')`し、成功時は残らないようにする(catchで再設定)。
- `Library.jsx`の`refreshWorlds`をtry/catchで包み、Library自身の`error` stateに設定して画面上部に表示する。`onWorldsChanged`(= `refreshWorlds`)が例外を投げなくなるため、`WorldTab.handleCreate`での「World作成に失敗した」誤表示も解消する。

### 3.4 WorldTabのWorld切替時リセット + キャンセルガード(I6)

- `[selectedWorldId]`のeffect内で`editingRegionId`/`regionDraft`/`editingCategoryId`/`categoryDraft`もリセットする。
- World切替を跨いだ遅延fetchの誤適用を防ぐため、`worldEpochRef`(`useRef(0)`)をeffect内で`+= 1`し、`startEditingRegion`/`startEditingCategory`は呼び出し時に`const epoch = worldEpochRef.current`を捕捉、`getRegion`/`getCategory`のawait後に`if (worldEpochRef.current !== epoch) return`で古い結果を破棄する。

### 3.5 Homeの並行小説化 + ダウンロード(I7, M6)

- `novelizingId`(単一)を`novelizing`(id→true のオブジェクト)に変更する。`handleNovelize`で該当idを立て、`finally`で該当idを消す。ボタンの`disabled`/ラベルは`novelizing[s.id]`で判定する。これで別セッションを並行して小説化してもガードが独立する。
- ダウンロード: `<a>`要素を`document.body.appendChild`してから`click()`し、直後に`removeChild`する。`URL.revokeObjectURL`はダウンロード開始を確実にするため`setTimeout(() => URL.revokeObjectURL(url), 0)`で遅延する。
- `sanitizeFilename`: ファイル名に使えない文字を除去した後、結果が空・またはドットのみなら`'session'`にフォールバックする。

### 3.6 Setupの状態リーク・中断・エラー可視化・makeId(I4, I5, M7)

- `worldId`変更のeffectで`setSelectedScenario(null)`/`setSelectedPC(null)`もクリアする。
- `handleStart`の`worldMode === 'skip'`分岐を、残留`worldRaw`を使わず常に空扱いにする(`worldRawForSession = ''`、`worldSummary = '(特に指定なし)'`)。これに伴い確認ステップの`worldMode === 'skip' && worldRaw.length > 1500`のヒントは削除する(skipは常に空のため)。
- シナリオAI生成に渡すPC本文を、既存PC選択時はその本文にする: `const pcForGen = pcMode === 'existing' && selectedPC ? selectedPC.raw : pcRaw;`を`generateScenario(genre, pcForGen, worldSummary)`に使う(fallback生成側も同様)。
- 戻る/やめるボタンに`disabled={busy}`を付け、`handleStart`実行中の中断(→在庫の`onStart`による強制遷移)を防ぐ。
- エラー表示`{error && ...}`を`step===4`ブロックから出し、`</Card>`直後の常時表示位置へ移す(どのステップでも一覧取得失敗が見える)。`libraryWarning`は確認ステップのままでよいが、同様に常時表示へ移してもよい(実装は常時表示に統一する)。
- `makeId(base)`と`session.id`にランダム成分を追加する。共通の`src/utils/makeId.js`(新規)に`makeId(base)`→`slugify(base) + '-' + Date.now() + '-' + <4桁のbase36乱数>`を実装し、`Setup.jsx`から利用する。session idも`'sess_' + Date.now() + '-' + <乱数>`にする。

## 4. 非スコープの再掲

- サーバー側の対策(FX3)。id未エンコードのクライアント側のみFX2で扱う。
- ドキュメント/追加テストはFX4/FX5。
- makeIdの非ASCIIタイトルが`untitled-...`になる件は、ランダム成分追加で衝突は解消するため、スラグ生成自体の日本語対応は行わない(スコープ外)。
