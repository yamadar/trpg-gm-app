# 引き継ぎ書: エンディングコレクション/実績

作成 2026-07-25。直前セッションで「ルールセット判定アダプタ」を完了(main へマージ済み)。次に着手するのは [08-feature-ideas.md](../08-feature-ideas.md) 2章の **エンディングコレクション/実績**。

## 次にやること

08-feature-ideas.md 2章の記述(これが要件の出発点。まだ設計されていない):

> **エンディングコレクション/実績**: セッション終了時にGMへ「エンディングタイトル」を命名させ図鑑化。分岐型なので再プレイ動機に直結。クリティカル/ファンブル回数などのダイス統計を添える。

**着手手順(このリポジトリの確立された流儀。08-feature-ideas.md 冒頭にも「着手時は個別に設計(ブレインストーミング→spec)を行うこと」と明記)**:

1. `superpowers:brainstorming` — 要件と設計スコープを固め、承認を得る
2. spec を `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` に書き、コミット、ユーザーレビュー
3. `superpowers:writing-plans` — 実装計画を `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` に
4. `superpowers:subagent-driven-development` — タスクごとに実装エージェント+レビューエージェント

前回はこの流れがうまく回った。ユーザーはブレインストーミングで**選択肢を提示されて選ぶ**形式を好み、実装中は逐一の確認を求めない(計画と方針が固まったら任せる)。

## 設計で最初に解くべき論点

### 1. 「セッション終了」という概念が存在しない ← 最重要

現状、セッションは**明示的に終わらない**。プレイをやめれば止まるだけで、完了フラグも終了時刻もない。唯一それらしいのは `src/screens/Home.jsx:188` の、キャンペーン「次の章へ」が作る `chapter = { sessionId, title, endedAt: Date.now() }` だけ。

したがって「セッション終了時にGMへ命名させる」には、**終了アクション自体を新設する**必要がある。ここが本機能の設計の核。論点:

- 終了はプレイヤーが明示的に押すのか(Play画面に「物語を終える」)、GMがクライマックス到達を判定するのか、両方か
- 終了済みセッションは Home でどう表示されるか(継続不可にする? 別セクション?)
- キャンペーンの「次の章へ」との関係。次章へ進む=その章の終了、とみなすのか別物か
- 終了を取り消せるか(誤操作の救済)

### 2. ダイス統計の集計元と degree 語彙の変化 ← 前回の実装で前提が変わった箇所

統計は `session.log` の GM エントリが持つ `roll` から集計できる。形状:

```js
{ roll, success_percent, success, degree, check_label, margin?, resourceChange? }
```

**注意**: 前回の実装で `degree` は4種から**6種**に増えた: `critical` / `extreme` / `hard` / `success` / `fail` / `fumble`。`extreme` と `hard` は CoC7e風のみ。「クリティカル/ファンブル回数」を数えるとき、CoC7e セッションでは成功が3段階に割れることを踏まえる必要がある。ルールセットごとに意味のある統計が変わる点は設計判断が要る(共通指標に丸めるか、ルールセット別に出し分けるか)。

`session.state.resources.san`(CoC7e のみ)も、エンディングに添える情報の候補。「正気度 12 で生還」は物語的に強い。

### 3. 「図鑑化」の置き場所

素材ライブラリのタブは現在 World / Character / Scenario / Campaign / Ruleset(`src/screens/Library.jsx:13-17`)。エンディング図鑑を6つ目のタブにするか、Home に置くか、公開ギャラリー側に出すかは未決。

既存の公開・共有基盤(`server/storage/shareLibrary.js`、`src/api/shareClient.js`、小説の公開/公開解除)があるので、エンディングを公開対象にする拡張は既存パターンに乗せられる。ただし 08-feature-ideas.md 2章には別項目「公開シナリオの『遊ばれた数』とリアクション」もあり、**スコープを混ぜないこと**。

### 4. 「実績」をやるかどうか

タイトルは「エンディングコレクション/実績」だが、実績(アチーブメント)はエンディング図鑑とは別物になりうる(実績条件の定義・判定・保存が要る)。**前回はスコープを絞って成功した**(SANのみ実装、HP等は非対象と明記)。同様に、まずエンディング図鑑+ダイス統計に絞り、実績は非対象として spec に書くのが妥当か、ブレインストーミングで確認するとよい。

## 直前セッションで完了したこと(前提知識)

**ルールセット判定アダプタ** — 16コミット、main にマージ済み(`132cf0c`..`4dd9dfe`)。

- `src/engine/rulesetAdapters.js`(新規・純粋): 4判定式を `getAdapter(formula)` の背後に。未知/未指定は `simple` フォールバック
- 判定式: simple(従来の挙動を維持)/ coc7e(1=critical、100または目標<50で96+=fumble、⌈p/5⌉=extreme、⌈p/2⌉=hard)/ dnd5e・gurps(固定5%帯を成功しきい値より先に評価、gurpsは `margin = p - roll` を付与)
- SAN(正気度): coc7e のみ。`session.state.resources.san` に 60/99 で初期化。AIが `roll_check` に `check_kind:'sanity'` を付けて発火、減少量はエンジンが決定論的に算出(強成功0 / 成功−1 / 失敗−1d6 / ファンブル−1d10)、`[0,max]` に clamp して `san_loss`/`san_now` をAIへ返す。0でも機械的なゲームオーバーはしない
- `takeTurn` は session を**破壊的変更しない**。`resourceChange` を返し `Play.jsx` が state に合成する
- カスタム Ruleset は判定式を選択可能(RulesetTab のドロップダウン、サーバ側で未知値を `simple` に丸めて永続化)

**後方互換の要点**: 旧セッションは `ruleset.formula` も `state.resources` も持たない。`getAdapter(undefined)` → simple で従来通り動く。プロンプト側は「アダプタが解決したか」ではなく「**セッションが実際に持つリソース**」でSAN指示をゲートしている(`src/api/prompts.js` の `activeResourceDefs`)。最終レビューで見つかった実バグの修正であり、**新機能でセッション状態を読むときも同じ注意が要る**: 新しいフィールドを前提にすると旧セッションが壊れる。

関連ドキュメント(すべて実装済みとして同期済み): [07-risks-and-roadmap.md](../07-risks-and-roadmap.md) §10.1、[08-feature-ideas.md](../08-feature-ideas.md) 2章、[02-data-model.md](../02-data-model.md)、[03-gm-logic.md](../03-gm-logic.md)、[05-ui-ux.md](../05-ui-ux.md)、[01-architecture.md](../01-architecture.md)、[README.md](../README.md)。
設計・計画: [specs/2026-07-25-ruleset-adapter-design.md](specs/2026-07-25-ruleset-adapter-design.md)、[plans/2026-07-25-ruleset-adapter.md](plans/2026-07-25-ruleset-adapter.md)。

## 積み残し(本機能とは独立。着手は任意)

前回の最終レビューで Minor と判定し、マージブロッカーではないとして送った項目:

- `src/screens/Play.jsx` の `newResources` フォールバック `|| { max: resourceChange.after }` は現状到達不能(`takeTurn` はリソースが存在するときしか非nullを返さない)。誤解を招くので削除してよい
- `server/routes/rulesets.js` の formula 検証がルート層にあり `saveRuleset` 自体は無検証。書き込み経路が増えると未知の formula が保存されうる
- 判定式リストが3箇所に重複: `src/engine/rulesetAdapters.js`(テストで固定)、`server/routes/rulesets.js:7`(サーバは `src/` を import できないため意図的な複製)、`src/screens/library/RulesetTab.jsx` の `FORMULA_OPTIONS`(未固定)。5つ目のアダプタを足すと後ろ2つが取り残される。3リストの一致を検証するガードテストがあると安全
- `src/engine/rulesetAdapters.js` の `coc7e.sideEffect` の `fail` 分岐はフォールスルー。語彙外の degree が来ると黙って 1d6 減少になる
- `src/screens/library/RulesetTab.test.jsx` に、`formula` を持たない既存カスタム Ruleset を編集したとき drop-down が `simple` に落ちることを確認するテストがない

## 環境メモ

- テスト: `npm test`(vitest、98ファイル / 965テスト、全パス)。単一ファイルは `npx vitest run <path>`
- `server/routes/characters.test.js` の「lists characters scoped to world and kind」は**並列実行時に5秒タイムアウトでたまに落ちるフレーク**。単体では327msでパスする。本件と無関係なので、落ちても再実行で確認すればよい
- ブランチ運用: 前回は `feat/ruleset-adapter` を切って作業し、完了後 main へ早送りマージしてブランチ削除。リポジトリの履歴自体は main 直コミットが主
- `main` は `origin/main` より進んでいる(未push)。push は指示があるまでしない
- `.superpowers/` は gitignore 済み。前回の SDD 台帳・タスクブリーフ・レポートが残っているが、新機能では新しい台帳を作ればよい(古いものは削除して差し支えない)
- 未追跡の `.claude/` がある(前回のセッション開始時点から存在。触っていない)
