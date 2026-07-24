# ルールセット判定アダプタ 設計

2026-07-25 承認済み。[08-feature-ideas.md](../../08-feature-ideas.md) 2章「ルールセット判定アダプタ」および [07-risks-and-roadmap.md](../../07-risks-and-roadmap.md) 10.1節「ルールシステム非依存化の実装方針」を実装に落とす。現状は全ルールセットが共通の `d100 <= success_percent` 判定(`src/engine/dice.js`)を使い、差は system prompt の `hint` 演出のみ。本設計で判定式そのものをルールごとに切り替え、CoC7e に SAN(正気度)副作用リソースを実装する。

## 決定事項(ブレインストーミング結果)

- **スコープ: 判定式アダプタ + 副作用リソース**。判定式(degree の出し方)をルール別に切り替え、加えて数値リソース(SAN)を新設し `side_effect_triggers` を機械的に発火させる。
- **リソースは SAN 1本に絞る**。機構(`resourceDefs`/`sideEffect`)は汎用化するが、具体化するのは coc7e の SAN のみ。HP・戦闘・スタミナ等は作らない(YAGNI)。
- **SAN 初期値は 60 / 最大 99 の固定**。POW 等の能力値モデルは新設しない。
- **副作用の発火はAI駆動 / 解決は決定論**。AIが hint に従い恐怖・正気を試す場面で `roll_check` にタグ(`check_kind: 'sanity'`)を付け、エンジンがアダプタ定義に基づき決定論的に SAN 減少量を算出・適用する。シナリオ本文へのタグ付けスキーマ(`horror_event` 等の構造化)は追加しない(freeform Markdown を維持)。
- **カスタム Ruleset は基準式を選択可能に**。Ruleset に任意 `formula` フィールド(`simple`/`coc7e`/`dnd5e`/`gurps`)を追加。RulesetTab にドロップダウンを設け、未指定は `simple` にフォールバック。
- **機械的ゲームオーバーはしない**。SAN が 0 に達しても死亡・終了はさせず、プロンプトで狂気描写を促すのみ。

## 現状(前提)

- **判定フロー**: `src/api/session.js` の `takeTurn` が、AIの `roll_check` ツール呼び出し(`success_percent`)を受けて `evaluateRoll(success_percent)`(`src/engine/dice.js`)を実行。結果 `{ roll, success_percent, success, degree, check_label }` を得て、`{ roll, success, degree }` を tool_result としてAIへ返し、ログエントリ `roll` に保存する。判定は1ターン最大1回。
- **degree**: `evaluateRoll` は `critical`(roll ≤ round(p·0.05))/ `success` / `fail` / `fumble`(roll ≥ 96)の4種を返す。`src/components/ui/Stamp.jsx` が 会心/成功/失敗/大失敗 のラベルと色で表示。
- **ルールセット**: ビルトインは `src/data/rulesets.js`(`{ id, label, desc, hint, growthUnit }`)。ユーザーカスタムは `server/storage/rulesetLibrary.js` / `server/routes/rulesets.js` / `src/api/rulesetLibraryClient.js` / `src/screens/library/RulesetTab.jsx`(create/edit で `label`/`desc`/`hint`/`growthUnit` を扱う)。
- **セッション**: `src/screens/Setup.jsx` が `rulesetId` と denormalize した `ruleset` スナップショット `{ id, label, desc, hint, growthUnit }` を持たせる。`state` は `{ current_scene, flags, history_summary, recent_log, turn_count, xp }`。**数値リソース(SAN/HP等)は存在しない**。flags は freeform key/value をAIが管理。
- **プロンプト**: `src/api/prompts.js` の `ROLL_TOOL`(定数)、`TURN_OUTPUT_FORMAT`、`buildSystemBlocks(session)`(`resolveRuleset` で `ruleset` を解決し `hint` を注入)、`buildTurnUserContent(session, playerText)`(毎ターンの状態=シーン/フラグ/要約/ログ)。
- **UI**: `src/screens/Play.jsx` がヘッダーに growthUnit/xp を表示、ログに `Stamp` を描画。`src/components/play/CharacterPanel.jsx` が PC シート・目標/因縁・成長ポイントを表示。

## degree 語彙(共通)

全アダプタは以下の共通 degree 語彙の部分集合を使う。`success` 真偽は degree から一意に定まる。

| degree | 意味 | success |
|---|---|---|
| `critical` | 会心(大成功) | true |
| `extreme` | イクストリーム成功(coc7e) | true |
| `hard` | ハード成功(coc7e) | true |
| `success` | 通常成功 | true |
| `fail` | 失敗 | false |
| `fumble` | 大失敗(致命的失敗) | false |

`evaluate` の戻り値は `{ roll, success_percent, success, degree, margin? }`。`margin`(= success_percent − roll)は gurps のみ付与し、代償/成功度の描写材料にする。`success_percent` は評価前に `simple` と同じく整数化・[1,99] クランプする(NaN は 50)。

## 判定式(アダプタ別)

`p` = クランプ済み success_percent(整数・[1,99]、NaN→50)、`roll` = rollD100()。**注意**: 現 `rollD100` は 1–100 を返す(`Math.floor(random*100)+1`)。fumble 判定 `roll ≥ 96` と `roll == 100` はこれに依存するため踏襲する。degree の評価順(coc7e/dnd5e/gurps)は上から順に最初にマッチしたものを採用し、`critical` を成功しきい値 `p` より優先する(成功率非依存の会心)。

### simple(現行踏襲)
- `critical`: roll ≤ max(1, round(p·0.05))
- `fumble`: roll ≥ 96
- `success`: roll ≤ p(上記 critical を除く)
- `fail`: それ以外

### coc7e
評価順(先にマッチしたものを採用):
1. `critical`: roll == 1
2. `fumble`: roll == 100、または (p < 50 かつ roll ≥ 96)
3. `extreme`: roll ≤ ceil(p / 5)
4. `hard`: roll ≤ ceil(p / 2)
5. `success`: roll ≤ p
6. `fail`: それ以外

### dnd5e
成功率非依存の固定会心/致命(d20 的)。評価順:
1. `critical`: roll ≤ 5
2. `fumble`: roll ≥ 96
3. `success`: roll ≤ p
4. `fail`: それ以外

### gurps
1. `critical`: roll ≤ 5
2. `fumble`: roll ≥ 96
3. `success`: roll ≤ p
4. `fail`: それ以外
- 加えて `margin = p − roll` を戻り値に付与。

## リソース + 副作用モデル

### resourceDefs
アダプタは `resourceDefs: [{ key, label, max, initial }]` を宣言する。
- coc7e: `[{ key: 'san', label: '正気度', max: 99, initial: 60 }]`
- simple / dnd5e / gurps: `[]`

### session.state.resources
- 形状: `{ [key]: { value, max } }`(例 `{ san: { value: 60, max: 99 } }`)。
- **初期化**: Setup のセッション生成時、解決したアダプタの `resourceDefs` から生成(`{ san: { value: 60, max: 99 } }`)。`resourceDefs` が空なら `resources: {}`。
- **後方互換**: 既存セッション(`resources` 未定義、`formula` 無し)は simple アダプタに解決され `resourceDefs` 空 → リソース表示もプロンプト注入もされない(無害)。takeTurn 側でも `resources` 欠落を `{}` として扱う。

### sideEffect(決定論解決)
アダプタは `sideEffect(kind, degree, rng) -> { key, delta } | null` を持つ。
- coc7e の `kind === 'sanity'` のみ非 null:
  - `hard` / `extreme` / `critical`(強い成功): delta 0(正気を保つ)
  - `success`: delta −1
  - `fail`: delta −(1d6)(rng で 1–6)
  - `fumble`: delta −(1d10)(rng で 1–10)
- 上記以外(他アダプタ、または kind が対応外)は null。

### エンジン適用(session.js)
`takeTurn` 内、`roll_check` 受領後:
1. `adapter.evaluate(input.success_percent)` で roll を得る。
2. `input.check_kind`(既定 `'normal'`)が副作用対象なら `adapter.sideEffect(check_kind, roll.degree, rng)` を算出。
3. 非 null なら `session.state.resources[key].value` を `clamp(value + delta, 0, max)` で更新し、`resourceChange = { key, label, delta, before, after }` を保持。`roll.resourceChange = resourceChange` も付与しログに残す。
4. tool_result へ `{ roll, success, degree }` に加え、副作用があれば `san_loss`(= −delta)/ `san_now`(= after)を含めてAIへ返す(地の文に反映させる)。
5. `after === 0` のとき tool_result に「正気を完全に失った。狂気の描写を」の旨を添える。
- 副作用適用後の `state.resources` を `updated.state.resources` として保存(Play.jsx の状態合成に組み込む)。

## コンポーネント

### 1. `src/engine/dice.js`(変更)
- `rollD100()` は現状維持(1–100)。
- `evaluateRoll(successPercent)` は削除せず**維持**するが、実体は simple アダプタへ移す方針。互換のため `evaluateRoll` は `getAdapter('simple').evaluate(successPercent)` に委譲する薄いラッパにする(既存 `dice.test.js` と、万一の外部参照を壊さない)。`success_percent` の正規化(整数化・[1,99]・NaN→50)は共通ヘルパ `normalizePercent` として dice.js に置き、各アダプタが使う。

### 2. `src/engine/rulesetAdapters.js`(新規・純粋)
- 各アダプタオブジェクト `{ id, degrees, evaluate, resourceDefs, sideEffect, promptText }` を定義。
- `evaluate(successPercent, rng = rollD100)`: `normalizePercent` でクランプ後 `rng()` で roll を得て degree を算出。**rng を注入可能**にして単体テストで境界を固定する。
- `promptText`: そのルールの判定式の意味(degree の解釈・SAN の扱い)をAIへ説明する短文。
- `getAdapter(formula)`: 未知/未指定は `simple`。
- React/通信を import しない(dice.js のみ依存)。

### 3. `src/data/rulesets.js`(変更)
- 各ビルトインに `formula` を追加: simple→`'simple'`、coc7e→`'coc7e'`、dnd5e→`'dnd5e'`、gurps→`'gurps'`。
- 既存 `hint` は演出補助として残す(判定式の説明は `promptText` が担うため、hint は「SAN減少の描写を添える」等の演出寄りに整理)。

### 4. `src/api/prompts.js`(変更)
- `resolveRuleset` はそのまま。新規 `resolveAdapter(session)` = `getAdapter(resolveRuleset(session).formula)`。
- `ROLL_TOOL` 定数を関数 `buildRollTool(adapter)` に置換。`adapter.sideEffect` が有効な kind を持つ場合のみ `check_kind`(enum: `['normal', 'sanity']`、既定 `normal`、description に用途)を input schema に追加。持たない場合は現行同等(check_kind 無し)。
- `buildSystemBlocks(session)`: `adapter.promptText` を「# 判定ルール」節へ注入。`resourceDefs` があれば「# リソース」節でSANの意味・0到達時の扱いを説明。既存の degree 固定説明(critical/success/fail/fumble)は adapter.promptText に統合し、ルールごとに正しい degree 語彙を説明する。
- `buildTurnUserContent(session)`: `state.resources` があれば「リソース: 正気度 55/99」を状況ブロックに追加(flags と同様、毎ターンの可変状態)。
- `TURN_OUTPUT_FORMAT` は**変更しない**(リソース増減はエンジンが決めるためAIに報告させない)。

### 5. `src/api/session.js`(変更)
- `import { getAdapter } from '../engine/rulesetAdapters.js'`、`buildRollTool` を使用。
- `takeTurn`: adapter を解決し `tools: [buildRollTool(adapter)]`。roll_check 受領時は上記「エンジン適用」の手順で degree 評価・副作用適用・tool_result 構築。戻り値 `{ result, roll, resourceChange }`(Play が resources を更新できるよう resourceChange も返す。roll にも同梱)。

### 6. `src/screens/Play.jsx`(変更)
- `runTurn`: `takeTurn` の戻りに含まれる更新後 resources を `updated.state.resources` へ反映(resourceChange があればそれを、無ければ現状維持)。
- ヘッダー or ログに SAN 現在値/減少注記の軽い表示(CharacterPanel を主表示とし、Play では減少時に短い注記を出す程度)。

### 7. `src/components/ui/Stamp.jsx`(変更)
- `DEGREE_COLORS` と label マップに `hard`(「ハード」)/`extreme`(「イクストリーム」)を追加。ラベル判定を degree ベースへ整理(現行の success/fumble/critical 分岐を degree マップ参照に)。
- roll に `resourceChange` があれば「正気度 −5」の小注記を併記(任意・控えめ)。

### 8. `src/components/play/CharacterPanel.jsx`(変更)
- `session.state.resources` を「正気度 55/99」の形で表示するリソース節を追加(空なら非表示)。

### 9. `src/screens/Setup.jsx`(変更)
- `resolvedRuleset` に `formula` を含めて `ruleset` スナップショットへ保存。
- `state.resources` を解決アダプタの `resourceDefs` から初期化。

### 10. `src/screens/library/RulesetTab.jsx`(変更)
- create/edit に formula ドロップダウン(`simple`/`coc7e`/`dnd5e`/`gurps`)を追加。既定 `simple`。`putRuleset` payload に `formula` を含める。

### 11. `server/routes/rulesets.js` / `server/storage/rulesetLibrary.js`(変更)
- PUT の受理フィールドに `formula` を追加(未知値はそのまま保存し、`getAdapter` 側でフォールバックさせる/または既知4種以外は `simple` に丸めて保存。**既知4種以外は保存時に `simple` へ丸める**)。保存メタに `formula` を含める。

## データフロー

```
AI --roll_check{success_percent, check_kind?}--> takeTurn
  adapter = getAdapter(session.ruleset.formula)
  roll = adapter.evaluate(success_percent)                // degree 決定
  eff  = adapter.sideEffect(check_kind, roll.degree, rng) // SAN 減少(決定論)
  apply eff to state.resources (clamp)
  tool_result = {roll, success, degree, san_loss?, san_now?}
AI --narrative(JSON)--> Play が state.resources を保存・表示
```

## エラー処理・エッジ

- `formula` 未知/未指定 → `getAdapter` が simple。
- `resources` 未定義の既存セッション → `{}` 扱い、SAN 表示/注入なし。
- `check_kind === 'sanity'` だがアダプタが sanity 非対応(simple 等)→ sideEffect null、副作用なし(AI が誤ってタグ付けしても無害)。
- SAN clamp[0,max]。delta の rng は `rollD100` を流用(1d6 = 1 + floor((rollD100()-1) % 6) 等の実装で 1–6 に写像。テストで rng を差し替え)。
- `success_percent` NaN/範囲外 → normalizePercent で 50 / [1,99]。

## テスト

- **`src/engine/rulesetAdapters.test.js`(新規)**: 各式の degree 境界を rng 注入で網羅(coc7e: roll=1/⌈p/5⌉/⌈p/2⌉/p/96/100、dnd5e: 5/6/95/96、simple: 現行同等、gurps: margin と 5/96)。`getAdapter` フォールバック。`sideEffect` の decay 量(success=−1、fail=−1d6 の下限/上限、fumble=−1d10、hard以上=0、非対応=null)。
- **`src/engine/dice.test.js`(変更)**: 既存の `evaluateRoll` 期待値が simple ラッパ経由でも通ることを確認(必要なら移行)。
- **`src/api/session.test.js`(変更)**: coc7e で `check_kind:'sanity'` + fail 時に resources.san が減る/tool_result に san_now が入る/戻り値 resourceChange。simple で check_kind 無視。
- **`src/api/prompts.test.js`(変更)**: `buildRollTool` の check_kind 有無、`buildSystemBlocks` に promptText/リソース節、`buildTurnUserContent` にリソース行。
- **`src/components/ui/Stamp.test.jsx`(変更)**: hard/extreme ラベル、resourceChange 注記。
- **`src/components/play/CharacterPanel.test.jsx`(変更)**: リソース表示(有/無)。
- **`src/screens/library/RulesetTab.test.jsx`(変更)**: formula ドロップダウンの保存。
- **`server/routes/rulesets.test.js` / `server/storage/rulesetLibrary.test.js`(変更)**: formula 永続化、未知値の simple 丸め。
- **`src/screens/Setup.test.jsx`(変更)**: coc7e 選択で resources 初期化、snapshot に formula。

## 非対象(将来)

- HP・戦闘・スタミナ等の追加リソース。
- シナリオ本文への構造化イベントタグ(`horror_event` 等)スキーマ。
- 能力値(POW 等)からの SAN 初期値算出、SAN 回復ルール、狂気テーブル。
- SAN 0 での機械的なゲームオーバー/PC ロスト。

## ドキュメント更新

- [07-risks-and-roadmap.md](../../07-risks-and-roadmap.md) 10.1節・9章の表を「実装済み(判定式アダプタ + SAN 副作用)」に更新。
- [08-feature-ideas.md](../../08-feature-ideas.md) 2章「ルールセット判定アダプタ」を実装済みとして反映。
