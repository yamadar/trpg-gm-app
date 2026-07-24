# Play画面 演出強化 設計 (08-feature-ideas.md 1.2)

2026-07-24 承認済み。[08-feature-ideas.md](../../08-feature-ideas.md) 1.2「Play画面の『演出』強化」の設計。
[05-ui-ux.md](../../05-ui-ux.md) 13章(テンション制御)のプロンプト側構想をUIまで貫通させる。

実装順: A(ダイス演出) → B(タイプライター+tension_level) → C(雰囲気連動テーマ)。各サブ機能は独立して動作する。

## 現状(前提)

- 判定結果は `src/components/ui/Stamp.jsx` が即時表示(アニメーション無し)。GMログエントリの `entry.roll` に `{check_label, roll, success_percent, success, degree}` が入る(`src/engine/dice.js` の `evaluateRoll`)。
- GM地の文は `Play.jsx` が即時に全文表示。
- `tension_level` は未実装。`TURN_OUTPUT_FORMAT`(`src/api/prompts.js`)の `state_update` に無く、stateにも保存されない。
- セッションの `world` は `{raw, summary}` のみで `moods` を持たない(`Setup.jsx` 243行付近)。World/Scenario素材側には `moods`(`src/constants/moods.js` の固定8種)が存在する。

## A. ダイスロール演出

**目的**: 「ダイスを振る瞬間の緊張」を演出する。紙+スタンプの既存世界観に合わせ、「事務的な道具が劇的に使われる」方向。

- 最新のGMログエントリにロールがある場合のみ、3段階演出:
  1. d100の数字が高速で回転(約0.8秒、ランダムな数字を高速切り替え)
  2. 出目で停止
  3. 判定スタンプが「押印」される(スケール縮小+回転のCSSアニメーション、`transform` ベース)
- degree別の演出色: critical=真鍮(`COLORS.brass`)系で強調、success=通常の朱(`COLORS.stamp`)、fail=朱を薄く、fumble=暗い赤(`COLORS.stampDark`)+微小な揺れ。
- 過去ログの再描画(履歴スクロール・再マウント)ではアニメーションせず即時表示。「最新エントリかつ初回表示」のみ演出する(コンポーネントのマウント時に log index が最新かどうかで判定)。
- `prefers-reduced-motion: reduce` 時はアニメーションを省略し即時表示。
- 実装: `Stamp.jsx` を拡張(または `DiceRollStamp` として内部分離)。CSS keyframes は styleタグ注入かインラインアニメーションで、既存のインラインstyle方式に合わせる。

## B. タイプライター表示 + tension_level導入

**目的**: GMの語りをライブ感のある表示にし、13.1節の文体指示(緊迫=速く畳み掛ける/平穏=ゆったり)をUI速度にも反映する。

- 最新のGMエントリの `narrative` のみ一文字ずつ表示。過去ログは静的表示。
- 表示中に本文クリック(タップ)で全文即時表示(スキップ)。
- choicesボタン・入力欄はタイプ完了(またはスキップ)後に有効化。busy中の既存disabledと合成する。
- `prefers-reduced-motion` 時は即時表示。
- **tension_level**: `TURN_OUTPUT_FORMAT.state_update` に `tension_level`(enum: `low`/`medium`/`high`、required)を追加し、system promptに「場面の緊張度を毎ターン更新する」指示を追記。`normalizeTurnResult` で不正値は `null` にフォールバックし、`Play.jsx` が `session.state.tension_level` へ保存(null時は前値保持、初期値 `medium`)。
- タイプ速度: high=約15ms/字、medium=約25ms/字、low=約35ms/字(実装時に体感調整可)。
- 実装: `useTypewriter(text, {speed, enabled})` カスタムhook(`src/hooks/`新設)+ `Play.jsx` 組み込み。

## C. 雰囲気連動テーマ

**目的**: World/Scenarioの `moods`(固定8種)をプレイ画面の色味に反映し没入感を上げる。

- Setupのセッション作成時、選択した既存World/Scenarioの `moods` を `session.moods`(World優先、無ければScenario)へコピーする。新規貼り付け・空欄Worldでは `moods` 無し。
- Play画面で `session.moods[0]`(先頭優先)に応じ、背景(`COLORS.paper`)とアクセントを微調整した配色オーバーレイを適用:
  - ホラー=紙を暗くグレー寄せ / ミステリー=青灰 / SF=寒色 / ファンタジー・冒険=暖色 / 日常・コメディ=明るく / シリアス=彩度を落とす
  - 「紙の色味が変わる」程度の控えめな変化。文字色系(`ink`/`inkSoft`)は可読性維持のため原則維持。
- マッピングは `src/theme.js` に `moodTheme(mood)` として追加(8種+デフォルト)。`moods` の無いセッション(既存セッション含む)は現行配色。
- Play画面のルートdivの背景等に適用する。他画面には影響しない。

## 互換性・エラー処理

- 旧セッション: `tension_level` 無し→`medium` 扱い、`moods` 無し→現行配色。schema変更はadditiveでセーブデータ移行不要。
- AI出力の崩れ: `normalizeTurnResult` がtension_levelの不正値をnullへフォールバック(既存フィールドと同方針)。
- structured outputs: `state_update` の `required` に `tension_level` を追加(additionalProperties: false 維持)。

## テスト方針

既存のvitestパターンに合わせる:
- `turnResult.test.js`(既存があれば追記): tension_levelの正規化(正常値/不正値/欠落)。
- `useTypewriter` のタイマー挙動(fake timers): 逐次表示・スキップ・reduced-motion。
- `theme` or `moodTheme` のマッピング(8種+未知mood+undefined)。
- `Play.test.jsx`: tension保存・choices無効化タイミングの回帰が壊れないこと。
- `Stamp` は表示要素(check_label/出目/ラベル)の既存表示が保たれること。アニメーションの詳細(keyframes)は目視+reduced-motionパスのテストに留める。
