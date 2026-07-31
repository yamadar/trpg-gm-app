# プレイ結果適応型キャンペーン継続・次話生成 設計

2026-08-01 草案。既存の[キャンペーンSP1 コアループ](2026-07-24-campaign-design.md)と、`Campaign`管理タブを追加したSP2を拡張する設計。

関連設計:

- [同時参加型パーティセッション 設計](2026-08-01-party-session-design.md)
- [データモデル](../../02-data-model.md)
- [コンテンツ生成](../../06-content-generation.md)

## 1. 背景

TRPGでは、同じシナリオを使ってもプレイヤーの選択により結末が変わる。事前に第二話以降を固定すると、第一話で次のような出来事が起きた時点で後続シナリオの修正が必要になる。

- 生存を想定したNPCが死亡した
- 敵対を想定した勢力と同盟を結んだ
- 未発見を想定した秘密が早期に露見した
- 本来の目的を放棄し、別の問題を優先した
- 想定外の場所・人物・物品が物語の中心になった

既存Campaignは「終了したセッションを章として並べ、PCシートとxpを次章へ持ち越す」機能まで実装済み。一方、Campaignメタが保持する継続情報は`carriedPc`と`chapters`が中心で、NPCの状態、世界情勢、未解決の問題、予定事件を次話生成へ渡す仕組みがない。

本設計では、Campaignを単なる章コンテナから、次の3つを持つ連作の真実源へ拡張する。

1. GMが最初に定めた原典
2. プレイによって確定した正史と現在状態
3. 正史から次話を生成する制作フロー

## 2. 目的

- GMが世界設定、主要人物、思惑、予定事件、第一話だけを用意すれば連作を開始できる
- 第一話以降のプレイ結果を、次話生成の正式な入力として保存する
- AIによる誤読や創作を、GM確認前に正史へ混入させない
- 第二話以降を固定プロットではなく、現在の世界状態から逐次生成する
- 生成した次話を既存Scenarioとして保存し、既存Play画面でそのままプレイできる
- 既存ソロCampaignとの後方互換を維持する
- 将来の複数PC・パーティセッションでも同じCampaign継続モデルを利用できる

## 3. 対象外

- AIがプレイ中に次話全文を先回り生成する機能
- GM確認なしでCampaign正史を自動更新する機能
- 全章を開始前に生成する固定キャンペーンビルダー
- 異なるWorldを横断するCampaign
- 公開Campaignの配布・インポート
- 複数Campaignの正史を合流する機能
- プレイヤー同士が別々にプレイした並行世界の統合

## 4. 設計原則

### 4.1 原典・正史・生成物を分離する

Campaign内の情報を次の3層へ分ける。

| 層 | 内容 | 更新主体 |
|---|---|---|
| 原典 | 世界の前提、主要人物の初期設定、固定事項、予定事件 | GMのみ |
| 正史 | プレイで確定した事実、現在の人物・勢力・脅威・未解決事項 | GM承認後にコードが更新 |
| 生成物 | 次話候補、生成Scenario、AIの章分析案 | AIが提案。採用前は正史外 |

AIが原典や正史を書き換えることはない。AIは変更案を返し、GMが採用・編集・却下した結果だけをコードが保存する。

### 4.2 予定事件は「PCが介入しなかった場合」で書く

大まかなタイムラインを固定プロットとして扱わない。

悪い例:

> 三日目に王が暗殺される。

採用する形:

> PCが介入しなければ、黒騎士団は三日目に王を暗殺する。

予定事件は次の情報を持つ。

- 発生条件
- 関係人物・勢力
- PCが介入しない場合の結果
- 現在の進行度
- 状態: `pending` / `advanced` / `prevented` / `delayed` / `transformed` / `completed`

これにより、PCの介入後も「中止」「延期」「別勢力が計画を継承」などへ自然に更新できる。

### 4.3 章終了時に一度だけ詳細分析する

毎ターンCampaign全体を更新しない。コスト、出力揺れ、途中経過の誤確定を避けるため、章終了時にセッションログ全体から「章の精算案」を一度生成する。

以降の次話生成は、過去全ログではなく承認済みの章精算と現在状態を参照する。長期Campaignでもプロンプトサイズを制御できる。

### 4.4 次話生成を二段階にする

いきなりScenario全文を生成しない。

1. 次話候補を2〜3案生成
2. GMが案を選択・修正
3. 選択案からScenario全文を生成

方向性の確認前に長いScenarioを生成して捨てるコストを抑え、GMの意図も残す。

### 4.5 生成Scenarioは既存資産として扱う

採用した次話は通常のScenarioとしてWorld配下へ保存する。セッション作成時にはScenario原文と`directorGuide`のスナップショットを埋め込み、既存Play処理を使う。

Campaign専用Play分岐を作らず、生成までをCampaign機能、進行を既存Scenario機能の責務とする。

## 5. 用語

| 用語 | 意味 |
|---|---|
| Campaign原典 | GMが最初に入力し、AIが自動変更しない資料 |
| Campaign進行ガイド | 原典からAIが抽出した進行用派生JSON |
| Campaign正史 | GMが採用したプレイ結果の累積 |
| 現在状態 | 現時点の人物、勢力、予定事件、未解決事項 |
| 章精算案 | セッション終了後にAIが生成する正史更新候補 |
| 次話候補 | 正史から生成した短いシナリオ案 |
| 生成基準revision | 候補またはScenarioが参照したCampaign正史のrevision |

## 6. ユーザーフロー

### 6.1 新規Campaign作成

ホームに「新規プレイ」と別に「新規キャンペーン」を置く。素材ライブラリのCampaignタブにも同じ入口を置く。

作成ウィザード:

1. **World**
   - 既存Worldを選択
   - 初期実装ではWorldなしCampaignを許可しない
2. **Campaign原典**
   - 物語の前提
   - テーマ・雰囲気
   - 長期的な大問題
   - 絶対に変えない設定
   - 避けたい展開・表現
3. **主要人物・勢力**
   - 表向きの立場
   - 本当に欲しいもの
   - 恐れているもの
   - 秘密
   - 利用できる資源
   - 妨害がなければ次に起こす行動
   - PC・他人物との関係
4. **世界の動き**
   - 予定事件
   - 発生条件
   - 放置時の結果
   - 初期進行度
5. **第一話**
   - 既存Scenario
   - 貼り付け・ファイル取り込み
   - AI生成
6. **PC・ルール・確認**
   - 既存Setupの処理を再利用

Campaignを保存してから第一話セッションを作成し、セッションに`campaignId`を最初から設定する。現行の「単発セッション終了後、次の章へ押した時点でCampaignを新規作成」経路も互換用に残す。この経路で作られたCampaignは原典未設定として扱い、後からCampaign詳細画面で入力できる。

### 6.2 第一話以降の終了

「この物語を終える」または「次の章へ」から次の処理へ進む。

1. セッションへ`endedAt`を保存
2. 最新セッションログをサーバーへ同期
3. 章精算ジョブを開始
4. 完了後、章精算案レビュー画面を表示
5. GMが各変更を採用・編集・却下
6. 採用内容をCampaign正史へ一括反映
7. PC引き継ぎ内容も同じ画面で確定
8. 「次話を考える」へ進む

章精算に失敗しても、セッションの完結は取り消さない。Campaign詳細画面から再試行できる。

### 6.3 章精算案レビュー

AIが次の分類で提案する。

- 章の要約
- 新しく確定した事実
- PCの重要な選択
- PCの成長・獲得物・状態変化
- NPCの生死・所属・所在・思惑変化
- 勢力関係の変化
- 進行・阻止・変質した予定事件
- 解決した問題
- 未解決の伏線・新しい問題
- プレイヤーへ公開済みの情報
- GMのみが知る情報

各項目に次の操作を付ける。

- 採用
- 内容を編集して採用
- 却下

「すべて採用」は用意できるが、既定では全項目を選択済みにしない。特にNPC死亡、人物関係、秘密、予定事件の完了は明示確認を要求する。

### 6.4 次話候補

正史更新後、「次話を考える」で2〜3案を生成する。

各案の表示内容:

- 仮タイトル
- 導入フック
- 中心となる対立
- 関係人物・勢力
- 拾う未解決事項
- 進行する予定事件・脅威
- 前話から自然に繋がる理由
- 想定傾向: 探索、交渉、戦闘、ホラー等
- 想定プレイ時間
- 原典・正史との整合性注意点

GM追加指定:

- 必ず登場させる人物
- 拾いたい伏線
- 今回は進めない脅威
- 雰囲気
- セッション長
- 避けたい展開
- 自由記述

操作:

- この案でScenario生成
- 案を編集
- この案だけ差し替え
- 全案を作り直す
- 白紙から要望を書く

### 6.5 Scenario生成・開始

選択案から、既存Scenarioと同じMarkdown構造を生成する。

```markdown
## シナリオ概要

## GM専用情報

## 章構成
```

生成後、Scenario編集画面で全文を確認する。保存時に通常のScenario解析を実行し、`directorGuide`を生成する。

保存メタへ次を追加する。

```js
{
  sourceCampaignId,
  sourceCampaignRevision,
  sourceChapterNumber,
  generatedFromPitchId
}
```

Scenario保存後、World、Campaign、PC、Ruleset、xpを前入力したSetup確認画面へ進み、次章セッションを開始する。

## 7. Campaign詳細画面

現行Campaignタブの詳細を次の構成へ拡張する。

### 7.1 ヘッダー

- Campaignタイトル
- World名
- 全N章
- 正史revision
- 最終更新日時
- 主操作「次話を作る」

未承認の章精算案がある場合、主操作を「前話の結果を確定」へ差し替える。

### 7.2 タブ

| タブ | 内容 |
|---|---|
| 現在 | 世界情勢、直近の重要変化、未解決事項、迫っている予定事件 |
| 人物・勢力 | 現在状態、思惑、関係、生死、所在、利用可能な資源 |
| 世界の動き | 予定事件と進行度、発生条件、阻止・延期・変質状態 |
| 章 | Scenario、Session、章要約、採用済み変更 |
| 原典 | GM入力資料。AIは自動変更しない |
| 引き継ぎPC | 現行`carriedPc`。パーティ対応後は複数PC |

「現在」は長文を一枚出すのではなく、変更の大きい項目と次話へ影響する項目をカード表示する。

## 8. データモデル

### 8.1 Campaignメタ

既存フィールドを維持し、additiveに拡張する。

```js
{
  id,
  worldId,
  title,

  // 既存ソロCampaign互換
  carriedPc: { raw, xp },

  // 将来のパーティCampaignで追加。未実装時は省略
  carriedPcs?: [
    { pcId, characterName, raw, xp, resources?, conditions? }
  ],

  chapters: [
    {
      chapterId,
      sessionId,
      scenarioId?,
      title,
      status: 'playing' | 'ended' | 'reconciled',
      endedAt?,
      reconciledAt?,
      outcome?: {
        summary,
        canonFacts: [],
        pcChanges: [],
        characterChanges: [],
        factionChanges: [],
        timelineChanges: [],
        resolvedThreads: [],
        openThreads: []
      }
    }
  ],

  currentState: {
    canonFacts: [],
    characters: [],
    factions: [],
    timeline: [],
    openThreads: []
  },

  directorGuide: null | {
    schemaVersion,
    premise,
    immutableFacts,
    themes,
    characterIndex,
    factionIndex,
    timelineIndex
  },

  canonRevision: 0,
  createdAt,
  updatedAt
}
```

`currentState`は「次話生成に必要な現在情報」だけを保持する。解決済みの詳細履歴は`chapters[].outcome`へ残し、`currentState`へ無制限に重複蓄積しない。

一覧APIは`directorGuide`、`currentState`、`chapters[].outcome`を除いた軽量メタだけを返す。詳細選択後の単体GETで完全なCampaignを取得する。

### 8.2 原典Markdown

人間が読み書きする原本を`textStore`へ分離する。

```text
users/{userId}/worlds/{worldId}/campaigns/{campaignId}/
  bible.md
  cast.md
  timeline.md
```

- `bible.md`: 前提、テーマ、固定事項、禁止事項
- `cast.md`: 主要人物・勢力の初期設定と思惑
- `timeline.md`: PCが介入しなかった場合の予定事件

`directorGuide`は原典から抽出した派生データ。原典と矛盾した場合、原典を優先する。原典更新時に再解析が失敗した場合、古い`directorGuide`を残さず`null`へ戻す。Scenarioの`raw`と`directorGuide`と同じ方針。

### 8.3 章精算案

未承認案をCampaign正史と分離して保存する。

```text
users/{userId}/worlds/{worldId}/campaigns/{campaignId}/drafts/{sessionId}.json
```

```js
{
  campaignId,
  sessionId,
  sourceTurnCount,
  sourceSessionUpdatedAt,
  basedOnCanonRevision,
  status: 'running' | 'ready' | 'error' | 'accepted',
  proposedOutcome,
  error,
  createdAt,
  updatedAt
}
```

セッションログが精算案生成後に増えた場合、`sourceTurnCount`不一致として「前話の最新ログを反映していない」と表示する。古い案は採用不可。再生成を要求する。

### 8.4 変更項目

各提案に安定IDと可視範囲を持たせる。

```js
{
  id,
  kind,
  targetId?,
  before?,
  after,
  reason,
  sourceLogIndexes: [],
  visibility: 'all' | 'gm' | { pcIds: [] }
}
```

`sourceLogIndexes`はGMが根拠を確認するための参照。ログエントリに将来安定IDを追加した場合、`sourceEventIds`へ移行できる。

## 9. 正史更新処理

### 9.1 章精算入力

- Campaign原典
- Campaign進行ガイド
- 精算前の`currentState`
- 対象Scenario原文と`directorGuide`
- 対象SessionのPC設定
- 対象Sessionの全ログ
- state、flags、resources、xp
- パーティセッションの場合は全PC設定、PC別既知情報、シーン履歴

`history_summary`と直近12件だけでは重要な選択を失うため、章精算は`session.log`全体を真実源とする。

ログがモデル入力上限を超える場合:

1. ログを時系列チャンクへ分割
2. 各チャンクから事実・決定・変化を構造化抽出
3. 抽出結果全体と最終stateから章精算案を生成

途中要約を正史へ直接保存しない。最終章精算案だけをレビュー対象とする。

### 9.2 適用

採用要求時、サーバー側で次を再確認する。

- Campaignの`canonRevision`が`basedOnCanonRevision`と一致
- Sessionの`turn_count`と`updatedAt`が精算案のスナップショットと一致
- 対象章が未精算
- 採用項目のIDが精算案内に存在

検証後、サーバーのCampaign単位ロック内で次を一つのCampaignメタへ合成し、1回の`dataStore.set`で保存する。

- `currentState`
- `chapters[].outcome`
- `carriedPc`または将来の`carriedPcs`
- `canonRevision + 1`
- `updatedAt`

同じ精算案の再送は冪等に成功させる。

## 10. 次話生成

### 10.1 入力優先順位

AIへ次の優先順位を明示する。

1. Campaign原典の固定事項
2. GMが採用したCampaign正史
3. 現在の人物・勢力・予定事件
4. 引き継ぎPC設定
5. GMの今回要望
6. AIによる補完

上位と矛盾する内容を下位で上書きしない。

### 10.2 次話候補structured output

```js
{
  basedOnCanonRevision,
  pitches: [
    {
      id,
      title,
      hook,
      centralConflict,
      involvedCharacterIds: [],
      involvedFactionIds: [],
      threadIds: [],
      timelineEffects: [],
      continuityReasons: [],
      tone,
      estimatedLength,
      consistencyNotes: []
    }
  ]
}
```

候補生成後にCampaign正史が更新された場合、候補をstale表示しScenario生成を禁止する。

### 10.3 Scenario生成

入力:

- 選択・編集済み次話候補
- Campaign原典
- `currentState`
- 引き継ぎPC
- 直前章のoutcome
- GM追加指定

出力は既存Scenario形式。前話の結果を無効化して元の予定へ戻す展開、死亡者の説明なしの再登場、既に公開された秘密の再秘匿などを禁止する。

## 11. API案

既存Campaign CRUDを拡張する。

```text
GET  /api/worlds/:worldId/campaigns/:campaignId
PUT  /api/worlds/:worldId/campaigns/:campaignId

GET  /api/worlds/:worldId/campaigns/:campaignId/source/:kind
PUT  /api/worlds/:worldId/campaigns/:campaignId/source/:kind
     kind = bible | cast | timeline

POST /api/worlds/:worldId/campaigns/:campaignId/chapters/:sessionId/reconcile
GET  /api/worlds/:worldId/campaigns/:campaignId/chapters/:sessionId/reconcile
POST /api/worlds/:worldId/campaigns/:campaignId/chapters/:sessionId/accept

POST /api/worlds/:worldId/campaigns/:campaignId/next-pitches
POST /api/worlds/:worldId/campaigns/:campaignId/next-scenario
```

章精算とScenario生成は長時間化しうるため、POSTは`202`を返す非同期ジョブとする。小説化ジョブと同様、ジョブ状態を永続化し、プロセス再起動やタイムアウトで`running`表示が残り続けないようにする。

Campaign削除時はメタだけでなく原典文書、章精算案、生成ジョブを削除する。既存仕様と同様、所属Session自体は削除せず、参照先CampaignがないSessionとしてホームへ表示する。

AI利用枠は既存`messages`と分け、将来`campaignGeneration`種別として計測可能な境界に置く。初期実装で同じ日次枠を使う場合も、内部操作名は分離する。

## 12. 既存機能との関係

### 12.1 ソロSession

- 既存`session.pc`を維持
- 既存`carriedPc`を維持
- `mode`未指定の旧Sessionはソロ扱い
- 既存「次の章へ」は、原典未設定Campaignでも章精算へ進める

### 12.2 パーティSession

[同時参加型パーティセッション設計](2026-08-01-party-session-design.md)実装後、章精算入力を次のように拡張する。

- `pcs[]`
- PC別resources・conditions・knownFacts
- Scene別ログ
- Party全体の決定
- 離席中のAI同行行動と人間入力の区別

AI同行で生成された行動は正史上の出来事には含めるが、「プレイヤーが選んだ重要行動」として扱わない。

### 12.3 Scenarioライブラリ

生成Scenarioは通常Scenario。編集、公開、インポート等の既存操作を使える。ただし公開時、Campaign正史や未公開の原典を付属させない。Scenario本文と通常メタだけを公開する。

### 12.4 Ending・小説化

章精算はEnding記録・小説化と独立。どの順番でも実行できる。章精算は最新ログを対象とし、小説本文を入力には使わない。

## 13. エラー・競合処理

| 状況 | 処理 |
|---|---|
| 章精算中にログが増えた | 精算案をstaleにし、再生成 |
| 精算案確認中に別端末が正史更新 | `canonRevision`競合。最新Campaignを再取得 |
| 原典解析失敗 | 原典は保存。`directorGuide=null`。再解析導線表示 |
| 章精算AI失敗 | Session完結は維持。Campaign詳細から再試行 |
| 候補生成後に正史更新 | 候補stale。Scenario生成禁止 |
| Scenario生成失敗 | 候補を保持して再試行 |
| Scenario保存失敗 | 生成本文を画面に保持。再保存可能 |
| 同じSessionを二重精算 | 既存採用結果を返す冪等処理 |

## 14. セキュリティ・情報公開

- 原典、正史、章精算案はCampaign所有者だけが編集可能
- パーティ参加者へCampaign原典やGM専用正史を返さない
- PC別秘密は`visibility`でフィルタし、次話Playの該当PCコンテキストだけへ渡す
- 次話候補や生成Scenario確認画面はGM/ホスト専用
- クライアント送信の`canonRevision`だけを信用せず、サーバー保存値と照合する
- AI出力内の任意IDをそのまま保存パスへ使わず、既存ID検証を通す

## 15. テスト方針

### 15.1 Storage・route

- 原典3文書の保存・取得・削除
- Campaign保存時の既存`carriedPc`互換
- `canonRevision`初期値と更新
- 章精算案の保存・取得・stale判定
- 同一精算案の冪等accept
- revision不一致時409
- SessionがCampaignに属さない場合403/404
- World・Campaign所有者以外からのアクセス拒否

### 15.2 章精算

- 全ログ、Scenario、原典、既存正史を入力する
- AI提案が正史へ自動反映されない
- 採用項目だけが反映される
- 却下項目が`currentState`へ入らない
- PCシート引き継ぎが同じacceptで確定する
- 長いログのチャンク抽出と最終統合
- stale Session・stale canonの採用拒否

### 15.3 次話生成

- 候補が2〜3件のstructured outputになる
- 原典固定事項と採用済み正史をプロンプトへ含める
- stale候補からScenario生成できない
- 生成ScenarioにCampaign由来メタが付く
- 保存後に通常Scenario取得とSetup開始が成立する

### 15.4 UI

- 新規Campaign作成から第一話開始まで
- 旧Campaignの原典未設定表示
- 章精算案の採用・編集・却下
- 未承認精算案がある場合の主操作切り替え
- 次話候補の再生成・編集・選択
- 非同期ジョブの実行中・失敗・再試行・完了
- revision競合時の再読み込み案内

## 16. 段階導入

### AC1: Campaign原典と現在状態

- 原典3文書
- Campaign詳細タブ拡張
- `currentState`と`canonRevision`
- 既存Campaign互換

### AC2: 章精算

- 全ログから章精算案生成
- レビューUI
- 採用時の正史・PC一括更新

### AC3: 次話候補

- 2〜3案生成
- GM条件入力
- stale管理

### AC4: Scenario生成

- 候補からScenario全文生成
- 通常Scenario保存
- Setup前入力と次章開始

### AC5: パーティCampaign統合

- `carriedPcs`
- PC別既知情報
- Scene別章精算
- AI同行行動の識別

## 17. 完了条件

次の一連操作が成立した時点でコア機能完成とする。

1. GMがWorld、原典、主要人物、予定事件、第一話を登録
2. 第一話をプレイして完結
3. AIが章精算案を生成
4. GMが内容を確認して正史へ反映
5. AIが正史に基づく次話候補を生成
6. GMが一案を選びScenario化
7. 第二話を通常Play画面で開始
8. 第一話で起きた想定外の結果が、第二話の前提へ反映される
