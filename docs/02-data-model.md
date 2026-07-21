# データモデル

## 3. データモデル

### 3.1 キャラクターシート(PC)
自由記述ベース。`goal`(目標)・`bonds`(因縁・関係)の記載を推奨するが必須ではない。
```
PC名: ...
能力値: STR10 DEX12 INT14 ...
スキル: 回避30 交渉45
HP: 20/20
持ち物: item1, item2
goal: (推奨) このPCが物語を通じて達成したいこと
bonds: (推奨) 他PC/NPC/世界との因縁・関係
```
原本は自由記述のまま保持(人間が読み書きしやすい形を優先)。構造化は3.4節のパイプラインで別途生成する。

### 3.1.1 NPCシート
PCとは別フォルダで管理する(`/characters/pc/` vs `/characters/npc/`)。
理由: NPC情報は**可視性ルールがPCと異なる**。goal/bondsを含むNPC設定は基本GM専用であり、物語中で開示されるまでプレイヤー出力に漏らしてはいけない。

```
NPC名: ...
goal: (推奨) このNPCの目的・動機
bonds: PCまたは他NPCとの関係
revealed: false   # 物語中で開示済みの要素はtrueに切替(stateで管理)
```
`revealed`はNPC単位、または`revealed_facts: ["motive", "true_identity"]`のように要素単位で細かく管理してもよい(Phase 2以降で必要になれば)。

### 3.2 世界観・シナリオ
Markdown推奨(逐語厳守したい記述と、GM裁量に委ねる記述を明示的に区別)。
```markdown
## シナリオ概要
[プレイヤーに見せてよい前提]

## GM専用情報
[黒幕の正体・隠しフラグ・敵の弱点など。プレイヤー出力に絶対含めない]

## 章1: ○○
- 分岐条件A: flags.met_npc_x == true → シーン◯へ
- 分岐条件B: ...
```

### 3.3 ゲーム状態(state) — 真実源
```json
{
  "current_scene": "森の入口",
  "current_region": "waterdeep",
  "flags": {"met_npc_a": true},
  "turn_count": 12,
  "history_summary": "直近までの物語要約(数百字)",
  "recent_log": ["直近5-10ターンの生ログ"]
}
```

### 3.4 自由記述→構造化変換パイプライン
PC/NPCシート・シナリオは人間が書きやすい自由記述(Markdown)を原本とし、実行時に使う構造化データは別途生成・キャッシュする。

**フロー**
1. 原本ファイル読み込み時、ハッシュ値をチェック
2. 未パース or 原本変更検知 → 一度だけAI呼び出しで構造化JSONへ変換(進行モードのAPIコールとは別枠)
3. 生成物を `*.parsed.json` として保存(原本と紐付け、ハッシュ値も記録)
4. 以降の進行は`.parsed.json`を参照。原本編集時のみ再パース

```
/characters/pc/alice.md          ← 原本(自由記述)
/characters/pc/alice.parsed.json ← 構造化キャッシュ(goal/bonds/stats等を抽出)
/characters/npc/villain.md
/characters/npc/villain.parsed.json
```

毎ターンAIに解析させるとコスト増・出力ブレの原因になるため、この一回性パースで固定する。シナリオ自動生成(11章)も同じ「生成モード/進行モードの分離」パターン。

### 3.5 エンティティ関連モデル・ストレージ構造

**階層関係**
```
World(世界観)  ─┬─ Character(PC/NPC)   … 世界観に紐づく(goal/bondsが設定依存)
              ├─ Scenario(単発)      … 世界観に紐づく
              └─ Campaign(複数シナリオ) … 世界観に紐づく、内部でScenarioを順序付け保持

Ruleset(ルール)  … World/Scenarioとは独立したライブラリ。Session開始時に選択

Session(プレイ単位) = World + Scenario/Campaign + Ruleset + PC roster + state
                      ↑ 実際に保存・再開される単位
```

**フォルダ構造**
```
/worlds/{world_id}/
  world.md                          世界観本文(目次+要約。3.2.1節参照)
  regions/{region}.md               地域詳細(大規模世界観の場合)
  categories/{topic}.md             カテゴリ詳細(大規模世界観の場合)
  npc/{name}.md + .parsed.json      NPC(revealed管理含む)
  pc/{name}.md + .parsed.json       世界観付属PC(プリセット等)
  scenarios/{scenario_id}/
    scenario.md + .parsed.json      本文(推奨ruleset・章ごとのrelevant_docs等のメタ情報含む)
  campaigns/{campaign_id}/
    campaign.json                   所属scenario_idの順序・キャンペーン跨ぎフラグ

/rulesets/
  coc7e.json / dnd5e.json / simple.json ...  独立ライブラリ、worldと無関係

/sessions/{session_id}/
  session.json     世界観・シナリオ/キャンペーン・ruleset・PC参照
  state.json        current_scene/flags/tension_level/revealed_facts/history_summary/recent_log
```

**紐付けルール**
- Character(PC/NPC): World配下に格納。ただしセッション作成時に「このWorldのPCを使う/新規作成する」を選べ、他Worldへの持ち込みも技術的には可能(ただし世界観との整合性はユーザー判断)
- Scenario/Campaign: 必ず特定のWorldに属する
- Ruleset: どのWorld/Scenarioにも属さない独立ライブラリ。Scenarioは`recommended_ruleset`をメタ情報として持つが、これはソフトな推奨であり、Session作成時に別rulesetへ差し替え可能(D&D5e用シナリオをGURPSで遊ぶ、を許容する設計)
