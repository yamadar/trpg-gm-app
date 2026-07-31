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

`PC名`はSetupの新規作成モードで必須入力になっており(2026-07-25)、入力値は原本の先頭行へ `PC名: ○○` として合成されると同時に、セッションへ `session.pc.name` としても持たれる。小説化がPCと他の登場人物を「彼」で取り違えないために使う(`server/novelGeneration.js`)。既存PCを選んだ場合は3.4節のパイプラインが抽出した`name`が入る。`pc.name`を持たない旧セッションは空文字として扱われ、小説化側がモデルに呼称を一つ決めさせる。

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
  "explained_terms": ["エーテル大水路", "灰鐘区"],
  "recent_log": [
    {"role": "player", "text": "..."},
    {"role": "gm", "text": "..."}
  ],
  "turn_count": 12,
  "xp": 30,
  "tension_level": "medium",
  "ending_reached": false,
  "resources": {"san": {"value": 55, "max": 99}}
}
```
- `recent_log`は文字列配列ではなく`{role, text}`オブジェクトの配列。直近12件を超えると先頭から捨てる(`Play.jsx`)。閾値超過時の要約圧縮トリガーは未実装。
- `explained_terms`はプレイヤー向け出力で説明済みの一般的でない用語・地名の表記一覧。GMは初出時だけ意味・種別・用途などの短い説明を添え、`state_update.newly_explained_terms`へその表記を返す。`Play.jsx`が重複を除いて蓄積し、次ターン以降のプロンプトへ渡す。旧セッションで未定義なら空配列扱い。
- `xp`は`ruleset.growthUnit`(例:「経験値」「CP」)の単位で、GMが`state_update.xp_gained`として提示した値を毎ターン加算していく(`src/api/prompts.js`のturn出力形式、`Play.jsx`の加算処理)。
- `resources`は**実装済み(2026-07-25)**。解決したRulesetアダプタ(`src/engine/rulesetAdapters.js`)の`resourceDefs`から`{ [key]: { value, max } }`形状でセッション作成時に初期化される(coc7eなら`{ san: { value: 60, max: 99 } }`)。`resourceDefs`が空(simple/dnd5e/gurps)なら`resources`キー自体を持たない。既存セッション(`resources`未定義)はプロンプト・UIともに無害に無視される(3.5.1節・07-risks-and-roadmap.md 10.1節参照)。
- `current_region`・`revealed_facts`はコードに存在しない。将来案として残すのみで、現状のstateキーではない。`tension_level`は実装済み(05-ui-ux.md 13.2節参照)。
- `state.ending_reached?: boolean`は**実装済み(2026-07-25)**。GMが毎ターン`state_update.ending_reached`で物語が結末に到達したかを申告する一時的なフラグ(`src/api/prompts.js`のスキーマ、`src/api/turnResult.js`の正規化。既定false。03-gm-logic.md参照)。trueかつ`session.endedAt`未設定のときPlay画面が確定案内カードを出し(05-ui-ux.md参照)、「まだ続ける」を押すとfalseに戻す(次ターンでAIが再度trueを返せば案内は再度出る)。旧セッションはこのキーを持たないため無害にfalse扱いになる。

### 3.4 自由記述→構造化変換パイプライン
実装済み(`src/api/characterSheetCache.js`・`src/api/characterSheetParse.js`)。現状はPCのname/goal/bondsのみを対象とする。NPCの構造化パース、statsの抽出は未実装。抽出スキーマを変更したときは`SHEET_PARSE_VERSION`(`src/api/characterSheetParse.js`)を上げること。この値は`parsedHash`の計算に混ざっており、原本が変わっていない既存キャッシュを一度だけ作り直させる。

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
**Campaign(連作シナリオ)実装済み(2026-07-24、プレイ結果適応型へ2026-08-01拡張)**。事前に全章を固定せず、終了したSessionの結果をGM承認済み正史へ変換してから次話を生成するオープンな連鎖。CampaignメタはWorld配下のライブラリ実体で、`campaignMetaKey`は`users/{userId}/worlds/{worldId}/campaigns/{campaignId}`へフラット化して一覧可能。既存の`carriedPc: { raw, xp }`と`chapters[]`を維持しつつ、`currentState: { canonFacts, characters, factions, timeline, openThreads }`、`canonRevision`、`rulesetId`をadditiveに持つ。章は`status: 'playing' | 'ended' | 'reconciled'`と、精算済みなら`outcome: { summary, changes }`を持つ。`carriedPc`、`currentState`、章outcome、`canonRevision + 1`は章精算案の採用時にCampaign単位ロック内で一括更新する。旧`advanceCampaignPc`は互換関数として残るが、Homeの現行フローからは呼ばれない。

人間が編集する不変寄りの原典はCampaignメタと分離し、`bible.md`(前提・固定事項)、`cast.md`(主要人物・勢力と思惑)、`timeline.md`(PCが介入しない場合の予定事件)として保存する。AIが全Sessionログから作る章精算案も正史と分離し、GMが変更ごとに採用・編集・却下するまで`drafts/{sessionId}.json`へ置く。採用時は`sourceTurnCount`、`sourceSessionUpdatedAt`、`basedOnCanonRevision`を再検証し、ログまたは正史が変わった古い案を409で拒否する。次話候補は生成基準revision付きで保存し、未精算章がある場合、またはrevisionが変わった場合はScenario生成不可。生成Scenarioは通常のScenarioへ保存し、`sourceCampaignId`、`sourceCampaignRevision`、`generatedFromPitchId`をメタへ残す。

素材ライブラリのCampaignタブ(`src/screens/library/CampaignTab.jsx`)は、一覧・新規作成・原典編集・現在状態・章精算レビュー・次話候補生成・Scenario生成・引き継ぎPC・改名・削除を担う。Homeの`worldId`付きSessionには「次話を作る」が出て、Sessionと章を終了状態へ同期した後、対象Campaign/Sessionを選択したCampaignタブへ遷移する。既存Campaignが無い単発Sessionから押した場合は原典未設定Campaignを互換作成する。`campaignId`付きSessionのHomeグルーピングと、削除後のdangling `campaignId`を非グループ表示へ戻す挙動は維持する。クロスWorld、構造化インベントリ、複数PCの`carriedPcs`、PC別既知情報は未実装。

**セッション終了(`endedAt`)は実装済み(2026-07-25)**。セッションは任意`endedAt?: number`を持つ。Play画面で「この物語を終える」を押したとき、またはキャンペーンで「次話を作る」を実行したとき(その章を終わったとみなし、`chapters[].endedAt`と同じタイミングで設定する)に現在時刻が入る。未設定なら未完結。`endedAt`があってもセッションは継続可能(入力欄は塞がれない。エピローグの書き足しや誤操作の救済のため)で、取り消しUIは無い。Home一覧・Play画面ではこのフィールドの有無で「完結」バッジを表示する(05-ui-ux.md参照)。

**SAN(正気度)の章またぎの扱いは意図的な仕様**: `carriedPc`が持ち越すのはPCシート本文(`raw`)とxpのみで、`state.resources`(SAN等)は含まれない。そのため次章のSetupではRulesetアダプタの`resourceDefs`から通常のセッション開始と同じ初期値(coc7eなら60/99)でSANが再初期化される。前章終盤で正気度が減っていても引き継がれない設計であり、不具合ではない(POWからのSAN算出・SAN回復ルールと同様、YAGNIとして対象外。07-risks-and-roadmap.md 10.1節参照)。

**フォルダ構造(`server/storage/paths.js`が正)**
```
worlds/{world_id}.json               Worldメタ(id/title/updatedAt)
worlds/{world_id}/
  world.md                          世界観の要約(GMプロンプトに注入される本体。3.2.1節参照)
  source.md                         Worldインポート時の原文をそのまま保持(要約前の元資料)
  attachments/
    manifest.json                   World添付画像のImageCollection
    {attachment_id}/
      display.webp                  詳細表示用
      thumbnail.webp                一覧・カード用
  regions/{region}.json             地域メタ(id/title)
  regions/{region}.md               地域詳細(大規模世界観の場合)
  categories/{topic}.json           カテゴリメタ(id/title)
  categories/{topic}.md             カテゴリ詳細(大規模世界観の場合)
  npc/{name}.md                     NPC原本
  npc/{name}.parsed.json            NPCメタレコード(revealed管理含む。parsed抽出は未実装)
  npc/{name}/attachments/...        NPC添付画像
  pc/{name}.md                      PC原本
  pc/{name}.parsed.json             PCメタレコード。parsed: {goal, bonds}をキャッシュ
  pc/{name}/attachments/...         PC添付画像
  scenarios/{scenario_id}.json      Scenarioメタ(title/recommendedRuleset/updatedAt、Campaign生成由来メタを含みうる)
  scenarios/{scenario_id}/
    scenario.md                    本文
    attachments/...                Scenario添付画像
  campaigns/{campaign_id}.json      Campaignメタ(carriedPc/chapters/currentState/canonRevision等)
  campaigns/{campaign_id}/
    bible.md                        Campaign原典
    cast.md                         主要人物・勢力の初期設定と思惑
    timeline.md                     PCが介入しない場合の予定事件
    drafts/{session_id}.json        未承認/採用済み章精算案
    nextPitches.json                正史revision付き次話候補

rulesets/{ruleset_id}.json          独立ライブラリ、worldと無関係。{id,label,desc,hint,growthUnit,formula}

sessions/{session_id}.json          セッション本体(world/scenario/ruleset/pc/state/logを1ファイルにフラット保存)
sessions/{session_id}/
  novel.md                         小説化(novelize)した本文
  novel.json                       小説のメタ({ turnCount, updatedAt, imageIds,
                                    truncated })。truncatedは継続リクエストの
                                    上限に達し末尾が欠けている可能性を表す
                                    (06-content-generation.md 10.6.1節)
  novelJob.json                    小説化ジョブの状態(実装済み2026-07-25。
                                    { status: 'running'|'done'|'error',
                                      startedAt, updatedAt, error, bootId })
  novelNotice.json                 完了通知の未読フラグ({ unread: boolean }。
                                    実装済み2026-07-25)
  novel/attachments/...            小説添付画像。本文中の生成挿絵とは別コレクション

profile-image/
  manifest.json                    ユーザーが設定したプロフィール画像。最大1枚
  {attachment_id}/
    display.webp
    thumbnail.webp

public/starters                      スターターパックのマニフェスト({ packs[], seededAt })。
                                     シード(server/starters/seed.js)が書き、GET /api/startersが返す。
                                     各packは開始話のscenarioId/scenarioPublicIdに加え、全話の
                                     scenarios:[{ id, title, publicId }]とscenarioCountを持つ。
                                     単話パックもscenariosを1件持ち、旧マニフェストは開始話のみでも読める。
                                     唯一この行だけは`users/{userId}/`配下ではなくグローバルなキーであり、
                                     公開ツリー`public/...`名前空間の一部(04-persistence.md参照)
```

**添付画像モデル(`server/storage/attachmentLibrary.js`)**

```json
{
  "schemaVersion": 1,
  "topImageId": "att_0123456789abcdef",
  "items": [
    {
      "id": "att_0123456789abcdef",
      "description": "画像ごとの説明",
      "mimeType": "image/webp",
      "width": 1600,
      "height": 900,
      "byteSize": 245678,
      "createdAt": 1785460000000,
      "updatedAt": 1785460000000
    }
  ],
  "updatedAt": 1785460000000
}
```

World・Scenario・Character・Novelは各20枚まで。`topImageId`は同じ`items`内のIDか`null`だけを許す。トップ画像削除時は`null`へ戻す。説明は各500字まで。入力はJPEG/PNG/WebP・1枚10MB・4000万画素までで、EXIF向きを反映してメタデータを除去し、表示用最大2560pxと640×360サムネイルへWebP変換する。プロフィール画像も同じモデルを使うが、アップロードごとに既存画像を置換し、512×512表示用と128×128サムネイルを作る。

Novelの添付画像は、本文中の`〈挿絵N〉`と`novel.json.imageIds`で管理するAI生成挿絵とは別物。添付画像は小説カード・公開詳細のトップ画像/ギャラリー用途、生成挿絵は本文内の位置を持つ。

公開時は`items`、説明、`topImageId`、両WebPを公開ツリーへコピーする。再公開まで非公開側の追加・編集・削除は公開版へ影響しない。公開素材のインポートも画像一式を新しい非公開コレクションへコピーし、以後独立して編集できる。

**キャラクターの`name`はASCIIに限られる内部識別子**: `server/routes/characters.js`が`router.param('name', idParamGuard)`を持ち、`isValidId`が`^[A-Za-z0-9._-]+$`を要求する(`name`がそのままファイルパスになるため)。素材ライブラリの新規作成UIはユーザーへ`name`入力を求めず、`makeId('pc'|'npc')`で一意なASCII値を自動生成する。ユーザー向け名前は任意の`characterName`として別に保存し、空欄なら本文から生成AIが`parsed.name`へ抽出する。一覧・選択・公開の表示優先順位は`characterName`、`parsed.name`、本文の`PC名:`/`NPC名:`行、「名前未設定のPC/NPC」で、内部`name`は表示しない。`characterName`未送信の旧クライアントは既存値を維持し、空文字送信は明示解除として`null`へ正規化する。スターターパックはローマ字スラッグを`name`にし、日本語表記をシート本文の`PC名:`行に持つ(`server/starters/loadPacks.js`はこの`isValidId`を直接importして再利用しており、独自の正規表現は持たない。06-content-generation.md「スターターコンテンツ」節参照)。

**`importWorld`の`preferredId`**: `slugify`は`[^a-z0-9-]`を全除去するため、日本語タイトルのWorldをインポートすると id が`untitled`に潰れる。`importWorld(…, publicId, { preferredId })`で id を明示でき、スターターの一括インポート(`POST /api/starters/:packId/import`、`server/routes/imports.js`)は`packId`を渡す。未指定なら従来どおり`slugify(title)`。

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

`session`は`rulesetId`(選択したRulesetのid)と`ruleset`(選択時点の`{id,label,desc,hint,growthUnit}`スナップショット)を併せ持つ。`buildSystemPrompt`(`src/api/prompts.js`)は`session.ruleset`があればそれを優先し、無ければ`rulesetId`からビルトインRulesetを検索する。これは、後からビルトインRulesetの定義を変更してもプレイ中セッションの演出が変わらないようにするため。この解決規則(`session.ruleset` → `rulesetId`検索 → 先頭)は`src/engine/resolveRuleset.js`の`resolveRuleset`/`resolveAdapter`に切り出されており、`prompts.js`とダイス統計モジュール(3.6節)の双方がここから import する。

### 3.6 エンディング記録・実績(実装済み 2026-07-25)

セッション完結(`endedAt`、3.5節)を確定したとき、Play画面で「この物語を終える」を押すと(05-ui-ux.md 7章)GMがエンディングタイトルと総括を1回のAI呼び出しで生成し(06-content-generation.md参照)、記録として保存する。

**保存先**: `users/{userId}/endings/{sessionId}`(`server/storage/paths.js`の`endingKey`/`endingListPrefix`、`server/storage/endingLibrary.js`)。`sessionId`をキーにするため1セッションにつき記録は1つで、記録し直す(命名の再試行)と上書きされる。

**形状**
```json
{
  "sessionId": "...",
  "sessionTitle": "星降りの夜に",
  "endingTitle": "灰は星を数えない",
  "summary": "...(GMによる2〜3文の総括)",
  "endedAt": 1721900000000,
  "recordedAt": 1721900005000,
  "worldId": null,
  "campaignId": null,
  "rulesetId": "coc7e",
  "formula": "coc7e",
  "moods": ["ホラー", "ミステリー"],
  "stats": { "total": 24, "successes": 15, "successRate": 0.625, "byDegree": { "fumble": 1, "fail": 8, "success": 9, "hard": 5, "extreme": 0, "critical": 1 }, "degrees": ["fumble", "fail", "success", "hard", "extreme", "critical"], "resources": { "san": { "label": "正気度", "value": 12, "max": 99 } } }
}
```
- `sessionTitle`/`worldId`/`campaignId`/`rulesetId`/`formula`(`session.ruleset?.formula`)/`moods`はセッション本体からのスナップショット。`endingTitle`/`summary`はサーバーの1回のAI呼び出し(structured outputs)が生成する。
- **記録は完結確定時点のスナップショットであり、都度再計算しない**: `endedAt`があってもセッションは継続可能(3.5節参照)なので、ログから毎回集計し直すと図鑑の内容が後から変わってしまう。「そのとき到達したエンディング」として固定する。
- `stats`は`src/engine/rollStats.js`の`summarizeRolls(session)`がクライアント側で計算しリクエストボディに載せて送る(サーバーは`src/`をimportできないため統計ロジックをサーバー側へ複製しない。04-persistence.md参照)。形状は`{ total, successes, successRate, byDegree, degrees, resources }`:
  - `total`/`successes`/`successRate`: ログのGMエントリが持つ`roll`の集計数・成功数・成功率(`total===0`なら`0`)
  - `byDegree`/`degrees`: 判定式アダプタ(`resolveAdapter`、本節冒頭・3.5.1節参照)の`degrees`語彙のキーのみを持つ。`simple`/`dnd5e`/`gurps`は`['fumble','fail','success','critical']`、`coc7e`だけが`['fumble','fail','success','hard','extreme','critical']`を持つため、ハード成功・イクストリーム成功はCoC7e風の記録にだけ現れる
  - `resources`: セッションが実際に持つ`state.resources`のキーのみ(旧セッションや`resourceDefs`を持たないルールセットは空`{}`)。CoC7e風なら`{ san: { label: '正気度', value, max } }`
  - **信頼境界の注記**: `stats`はクライアントの自己申告値であり、サーバーは形(オブジェクトかどうか)のみ検証し中身を再計算しない(`server/routes/endings.js`)。エンディング記録が現状ユーザー本人にしか見えない(公開・ユーザー間比較の機能が無い)間はこれで許容できるが、将来エンディングを公開したりユーザー間で比較する機能を作る場合は、`stats`をサーバー側でログから再計算するか、自己申告であることを示す明示的なマーカーを持たせる必要がある。

**実績は保存を持たない**。`src/engine/achievements.js`の`evaluateAchievements(endings)`が、エンディング記録のコレクションだけから実績を都度導出する純関数(カタログ定義は`src/engine/achievementCatalog.js`に分離、ユーザー定義は非対象)。未獲得のものも`earned: false`で返し(実績一覧側でグレー表示)、`earnedAt`/`sessionId`は条件を最初に満たした記録のもの。実績専用の永続化が無いため、定義を後から足しても過去の記録に遡って反映される。

カタログ(`CATALOG`)は**実装済み(2026-07-25拡張)**で50件、7カテゴリ(到達・世界・雰囲気・判定・運命・生還・軌跡)にわたる。各エントリの形:

```js
{
  id: string,
  label: string,
  description: string,               // 条件を日本語1文で
  category: string,                  // 'arrival' | 'world' | 'mood' | 'roll' | 'fate' | 'survival' | 'trace'
  tier: 1 | 2 | 3,                   // 銅 / 銀 / 金
  icon: string,                      // AchievementIconが持つグリフのキー
  isEarnedBy: (list) => boolean,     // endedAt昇順の記録の接頭辞を受け取り、その時点で条件が成立したかを返す
  progress?: (endings) => number,    // 任意。全記録に対する現在値
  target?: number,                   // progressを持つときのみ必須
}
```

`progress`/`target`は「数えれば現在地が出る」実績(記録N本到達・通算判定回数・雰囲気制覇など)にだけ付く。単体の記録で成否が決まる実績(ファンブル0回など)には無く、その場合`evaluateAchievements`が返す`progress`は`null`になる。

`evaluateAchievements(endings)`の戻り値は`CATALOG`の各エントリに対して以下を返す配列:

```js
{
  id, label, description, category, tier, icon,  // カタログの値そのまま
  earned: boolean,
  earnedAt: number | null,   // 条件を最初に満たした記録のendedAt。未獲得ならnull
  sessionId: string | null,  // 同じく最初に満たした記録のsessionId
  progress: { current: number, target: number } | null,  // カタログがprogressを持つ実績のみ非null。currentはtargetで頭打ち
}
```

実績一覧・条件は08-feature-ideas.md 2章、UIは05-ui-ux.md 14.6節・14.7節を参照。
