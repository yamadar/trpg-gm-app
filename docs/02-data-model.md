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
PCとは別フォルダで管理する(`worlds/{world_id}/pc/` vs `worlds/{world_id}/npc/`)。
理由: NPC情報は**可視性ルールがPCと異なる**。goal/bondsを含むNPC設定は基本GM専用であり、物語中で開示されるまでプレイヤー出力に漏らしてはいけない。

```
NPC名: ...
goal: (推奨) このNPCの目的・動機
bonds: PCまたは他NPCとの関係
revealed: false   # 物語中で開示済みの要素はtrueに切替(stateで管理)
```
`revealed`はNPC単位のフラグとして`saveCharacter`が保存する(`server/storage/characterLibrary.js`)。要素単位の`revealed_facts`(例: `["motive", "true_identity"]`)は未実装(将来案)。

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
実装(`Setup.jsx`の初期値・`Play.jsx`の更新処理)における実際の形状:
```json
{
  "current_scene": "森の入口",
  "flags": {"met_npc_a": true},
  "history_summary": "直近までの物語要約(300字程度、毎ターンGMが書き換える)",
  "recent_log": [
    {"role": "player", "text": "..."},
    {"role": "gm", "text": "..."}
  ],
  "turn_count": 12,
  "xp": 30,
  "resources": {"san": {"value": 55, "max": 99}}
}
```
- `recent_log`は文字列配列ではなく`{role, text}`オブジェクトの配列。直近12件を超えると先頭から捨てる(`Play.jsx`)。閾値超過時の要約圧縮トリガーは未実装。
- `xp`は`ruleset.growthUnit`(例:「経験値」「CP」)の単位で、GMが`state_update.xp_gained`として提示した値を毎ターン加算していく(`src/api/prompts.js`のturn出力形式、`Play.jsx`の加算処理)。
- `resources`は**実装済み(2026-07-25)**。解決したRulesetアダプタ(`src/engine/rulesetAdapters.js`)の`resourceDefs`から`{ [key]: { value, max } }`形状でセッション作成時に初期化される(coc7eなら`{ san: { value: 60, max: 99 } }`)。`resourceDefs`が空(simple/dnd5e/gurps)なら`resources`キー自体を持たない。既存セッション(`resources`未定義)はプロンプト・UIともに無害に無視される(3.5.1節・07-risks-and-roadmap.md 10.1節参照)。
- `current_region`・`revealed_facts`はコードに存在しない。将来案として残すのみで、現状のstateキーではない。`tension_level`は実装済み(05-ui-ux.md 13.2節参照)。
- `state.ending_reached?: boolean`は**実装済み(2026-07-25)**。GMが毎ターン`state_update.ending_reached`で物語が結末に到達したかを申告する一時的なフラグ(`src/api/prompts.js`のスキーマ、`src/api/turnResult.js`の正規化。既定false。03-gm-logic.md参照)。trueかつ`session.endedAt`未設定のときPlay画面が確定案内カードを出し(05-ui-ux.md参照)、「まだ続ける」を押すとfalseに戻す(次ターンでAIが再度trueを返せば案内は再度出る)。旧セッションはこのキーを持たないため無害にfalse扱いになる。

### 3.4 自由記述→構造化変換パイプライン
実装済み(`src/api/characterSheetCache.js`・`src/api/characterSheetParse.js`)。現状はPCのgoal/bondsのみを対象とする。NPCの構造化パース、statsの抽出は未実装。

**フロー(`getOrParseCharacter`)**
1. Character取得時、原本(`raw`)のハッシュ値を計算
2. メタレコードに`parsed`があり`parsedHash`が現在のハッシュと一致すればそれを再利用
3. 不一致 or 未パースなら一度だけAI呼び出しでgoal/bondsのJSONへ変換(進行モードのAPIコールとは別枠)
4. `PUT /worlds/:worldId/characters/:kind/:name/parsed`でサーバーに保存

**保存構造**
`*.parsed.json`は独立ファイルではなく、Characterの主メタレコード自体(`worlds/{worldId}/{kind}/{name}.parsed.json`、`server/storage/paths.js`の`characterMetaKey`)に`parsed`/`parsedHash`フィールドとしてネストされる(`server/storage/characterLibrary.js`)。

```
worlds/{world_id}/pc/{name}.md            ← 原本(自由記述、textStoreで保存)
worlds/{world_id}/pc/{name}.parsed.json   ← Characterのメタレコード本体。{ id, worldId, kind, name, revealed, parsed: {goal, bonds} | null, parsedHash, updatedAt }
worlds/{world_id}/npc/{name}.md
worlds/{world_id}/npc/{name}.parsed.json  ← NPCも同じメタレコード形状を持つが、parsed(goal/bonds抽出)を書き込む経路は未実装
```

毎ターンAIに解析させるとコスト増・出力ブレの原因になるため、この一回性パースで固定する。シナリオ自動生成(11章)も同じ「生成モード/進行モードの分離」パターン。

### 3.5 エンティティ関連モデル・ストレージ構造

**階層関係**
```
World(世界観)  ─┬─ Character(PC/NPC)   … 世界観に紐づく(goal/bondsが設定依存)
              └─ Scenario(単発)      … 世界観に紐づく

Ruleset(ルール)  … World/Scenarioとは独立したライブラリ。Session開始時に選択
                   ユーザーが独自に作成したカスタムRulesetも保存・選択できる(3.5.1節参照)

Session(プレイ単位) = World + Scenario + Ruleset(埋め込みスナップショット) + PC + state
                      ↑ 実際に保存・再開される単位
```
**Campaign(連作シナリオ)SP1コアループ実装済み(2026-07-24)**。「育てたPCで次の冒険へ」を**オープンな連鎖**で繋ぐ。事前に全章を組まず、あるセッションを終えたら逐次次章へ接続する。引き継ぎは**テキスト方式**:章末に`advanceCampaignPc`(`/api/messages`経由のLLM)が既存PCシート(`pc.raw`)へ獲得物・成長・関係の変化を織り込んだ更新版を生成し、xpは数値で持ち越す。Campaignメタは World配下のライブラリ実体で、`campaignMetaKey`は`users/{userId}/worlds/{worldId}/campaigns/{campaignId}`へ**フラット化**(一覧可能)。形は`{ id, worldId, title, carriedPc: { raw, xp }, chapters: [{ sessionId, title, endedAt }], createdAt, updatedAt }`で、`carriedPc`はメタJSONに内包する(別ドキュメント不要)。セッションには任意`worldId?`/`campaignId?`が加わり、ライブラリWorld由来のセッション(`worldId`あり)のホームカードに「次の章へ」ボタンが出る。CRUDは`server/routes/campaigns.js`(`GET/PUT/DELETE /api/worlds/:worldId/campaigns[/:id]`)。

**SP2(管理タブ+Homeグルーピング)実装済み(2026-07-25)**。素材ライブラリにCampaignタブ(`src/screens/library/CampaignTab.jsx`)が加わり、選択WorldのCampaign一覧・章の閲覧(読み取り専用)・引き継ぎPC(`carriedPc`)閲覧・改名・削除ができる(`DELETE`は`campaignMetaKey`のみ削除する冪等操作で、メンバーセッションの`campaignId`は不変。dangling`campaignId`はHomeで非グループ表示にフォールバックする)。新規作成UIはタブに無く、Campaignはホームの「次の章へ」からのみ生成される。ホーム画面は`campaignId`付きセッションを、登場`worldId`ごとに`listCampaigns`でタイトル解決してキャンペーン見出し(全N章)配下にグループ表示する。**章からのセッション再開・クロスWorld・構造化インベントリ・NPC記憶連携・次章シナリオ自動提案はSP3以降として未実装**。

**セッション終了(`endedAt`)は実装済み(2026-07-25)**。セッションは任意`endedAt?: number`を持つ。Play画面で「この物語を終える」を押したとき、またはキャンペーンで「次の章へ」を実行したとき(その章を終わったとみなし、`chapters[].endedAt`と同じタイミングで設定する)に現在時刻が入る。未設定なら未完結。`endedAt`があってもセッションは継続可能(入力欄は塞がれない。エピローグの書き足しや誤操作の救済のため)で、取り消しUIは無い。Home一覧・Play画面ではこのフィールドの有無で「完結」バッジを表示する(05-ui-ux.md参照)。

**SAN(正気度)の章またぎの扱いは意図的な仕様**: `carriedPc`が持ち越すのはPCシート本文(`raw`)とxpのみで、`state.resources`(SAN等)は含まれない。そのため次章のSetupではRulesetアダプタの`resourceDefs`から通常のセッション開始と同じ初期値(coc7eなら60/99)でSANが再初期化される。前章終盤で正気度が減っていても引き継がれない設計であり、不具合ではない(POWからのSAN算出・SAN回復ルールと同様、YAGNIとして対象外。07-risks-and-roadmap.md 10.1節参照)。

**フォルダ構造(`server/storage/paths.js`が正)**
```
worlds/{world_id}.json               Worldメタ(id/title/updatedAt)
worlds/{world_id}/
  world.md                          世界観の要約(GMプロンプトに注入される本体。3.2.1節参照)
  source.md                         Worldインポート時の原文をそのまま保持(要約前の元資料)
  regions/{region}.md               地域詳細(大規模世界観の場合)
  categories/{topic}.md             カテゴリ詳細(大規模世界観の場合)
  npc/{name}.md                     NPC原本
  npc/{name}.parsed.json            NPCメタレコード(revealed管理含む。parsed抽出は未実装)
  pc/{name}.md                      PC原本
  pc/{name}.parsed.json             PCメタレコード。parsed: {goal, bonds}をキャッシュ
  scenarios/{scenario_id}.json      Scenarioメタ(title/recommendedRuleset/updatedAt)
  scenarios/{scenario_id}/
    scenario.md                    本文
  campaigns/{campaign_id}.json      Campaignメタ({id,worldId,title,carriedPc:{raw,xp},chapters[],createdAt,updatedAt})

rulesets/{ruleset_id}.json          独立ライブラリ、worldと無関係。{id,label,desc,hint,growthUnit,formula}

sessions/{session_id}.json          セッション本体(world/scenario/ruleset/pc/state/logを1ファイルにフラット保存)
sessions/{session_id}/
  novel.md                         小説化(novelize)した本文
  novel.json                       小説の鮮度メタ({turnCount, updatedAt})
  novelJob.json                    小説化ジョブの状態(実装済み2026-07-25。
                                    { status: 'running'|'done'|'error',
                                      startedAt, updatedAt, error, bootId })
```

**紐付けルール**
- Character(PC/NPC): World配下に格納。ただしセッション作成時に「このWorldのPCを使う/新規作成する」を選べ、他Worldへの持ち込みも技術的には可能(ただし世界観との整合性はユーザー判断)
- Scenario: 必ず特定のWorldに属する
- Ruleset: どのWorld/Scenarioにも属さない独立ライブラリ。Scenarioは`recommendedRuleset`をメタ情報として持つが、これはソフトな推奨であり、Session作成時に別rulesetへ差し替え可能(D&D5e用シナリオをGURPSで遊ぶ、を許容する設計)。Setup画面ではこの推奨rulesetが自動選択される。

### 3.5.1 Ruleset(実装)
`src/data/rulesets.js`にビルトイン4種(simple/coc7e/dnd5e/gurps)が定義されるほか、ユーザーはRulesetタブ(素材ライブラリ)からカスタムRulesetを作成・保存できる(`server/storage/rulesetLibrary.js`)。
```json
{
  "id": "coc7e",
  "label": "CoC7e風",
  "desc": "クトゥルフ神話TRPG風。恐怖・異常事態でSAN値チェックを演出。",
  "hint": "恐怖・異常事態の場面では適宜roll_checkでSAN値チェックを表現し、正気度の変化は判定結果に応じて描写すること。",
  "growthUnit": "経験値",
  "formula": "coc7e"
}
```
- `growthUnit`は成長ポイントの呼び名(「経験値」「CP」等)。GMプロンプトのxp_gained指示とPlay画面の成長ポイント表示の両方に使われる。
- `formula`は**実装済み(2026-07-25)**。判定式アダプタ(`src/engine/rulesetAdapters.js`の`getAdapter`)を選択するフィールドで、`simple`/`coc7e`/`dnd5e`/`gurps`の4値を持つ。ビルトインは上記4値がそのまま`id`と一致する形で設定済み。カスタムRulesetもRulesetタブのドロップダウンで選択でき(既定`simple`)、未知の値はサーバー保存時に`simple`へ丸められる。未指定・未知の`formula`は`getAdapter`が`simple`にフォールバックする。判定式そのものの違い(degree語彙・SANの有無)は03-gm-logic.md 5章・07-risks-and-roadmap.md 10.1節を参照。`hint`は判定式の説明ではなく演出の色付けとして残る(3.6節参照)。

`session`は`rulesetId`(選択したRulesetのid)と`ruleset`(選択時点の`{id,label,desc,hint,growthUnit}`スナップショット)を併せ持つ。`buildSystemPrompt`(`src/api/prompts.js`)は`session.ruleset`があればそれを優先し、無ければ`rulesetId`からビルトインRulesetを検索する。これは、後からビルトインRulesetの定義を変更してもプレイ中セッションの演出が変わらないようにするため。
