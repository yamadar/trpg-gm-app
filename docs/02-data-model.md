# データモデル

## 素材ライブラリ

- **World**: 原文、要約、雰囲気タグ。補助コンテンツとして地域・カテゴリを保持できる
- **Character**: PC または NPC のシート。PC は名前、目標、因縁の抽出結果をキャッシュできる
- **Scenario**: 原文、タイトル、雰囲気タグ、抽出済みの AI 進行ガイド
- **Ruleset**: 表示名、説明、演出ヒント、成長単位、`formula`
- **Campaign**: World に紐づく継続プレイの章と進行情報

World、Character、Scenario、Ruleset はセッション開始時に必要な値をスナップショットへコピーする。ライブラリの後続編集は進行中セッションを変更しない。

## ソロセッション

```js
{
  id, title, worldId, campaignId,
  world: { raw, summary },
  scenario: { id, title, raw, directorGuide },
  rulesetId, ruleset: { id, label, desc, hint, growthUnit, formula },
  pc: { name, raw, goal, bonds },
  moods, state, log, updatedAt, endedAt
}
```

`state` がプレイ進行の正本。主要フィールド:

- `current_scene`: 現在の場面名
- `flags`: プレイヤーに公開済みの事実
- `history_summary`: 現在までの重要事実・目的・未解決事項の要約
- `gm_memory`: 敵側進行、秘密、伏線の非公開メモ。画面へ出さない
- `explained_terms`: 既に説明した固有用語
- `recent_log`: 直近 12 件の `{ role, text }`
- `turn_count`、`xp`、`resources`、`tension_level`、`ending_reached`

`resources` は Ruleset アダプタが定義する場合だけ作成する。`tension_level` は `low`、`medium`、`high`。`log` はプレイヤー入力と GM 出力を保存し、ノベル化とエンディング生成の入力になる。

## Party セッション

Party はサーバー正本。セッション本体に参加者、PC、設定、ラウンドを持ち、共有 `snapshot` に以下を保持する。

- `global`: 時刻、公開フラグ、要約、緊張度、終了状態
- `scenes`: 場面と参加 PC
- `pcs`: 場面、リソース、状態異常、既知 Fact、経験値
- `facts` と `narratives`: `all`、`scene`、`pcs` の audience を持つ情報
- `choicesByPc`、`autoActions`、状態リビジョン、イベント連番

読み取り時は参加者ごとに snapshot を投影し、対象外の Fact・描写・選択肢を返さない。

## 記録と公開

- エンディングは終了したソロセッションから名前と記録を作る
- 実績はプレイ内容から計算する
- 公開コンテンツは所有者、公開状態、公開用メタデータを分離して保持する
- 添付・場面挿絵はメディア所有者と紐づけ、ストレージ使用量へ計上する
