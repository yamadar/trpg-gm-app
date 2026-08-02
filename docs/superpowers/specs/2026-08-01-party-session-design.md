# 同時参加型パーティセッション 設計

2026-08-01 設計、同日Partyコア実装済み。現行の「1人プレイヤー、1AI GM、1PC」セッションを残しつつ、複数プレイヤーが同時に同じ物語へ参加するPartyモードを追加した。

実装範囲はPS1〜PS4とPS5のCampaign統合。共有storage/membership/invite、ロビー/PC割当、同時行動/ready/typing/カウントダウン、手動・自動離席/再入室、チャット、投票、全行動一括AI解決、コード側複数判定、PC/Scene別projection、`carriedPcs`章精算を接続済み。設計との差分として、RealtimeはWebSocketでなく1秒RESTポーリング。AI解決は永続workerでなくHTTP処理内の同期生成。event先行保存と`resolutionId`二重適用防止はあるが、サーバー再起動時のsnapshot event replay・未完了解決の自動再開は未実装。Party小説化、挿絵、Ending、専用不在中要約も後続。

関連設計:

- [プレイ結果適応型キャンペーン継続・次話生成 設計](2026-08-01-adaptive-campaign-continuation-design.md)
- [アーキテクチャ](../../01-architecture.md)
- [データモデル](../../02-data-model.md)
- [GMロジック](../../03-gm-logic.md)
- [永続化](../../04-persistence.md)

## 1. 背景

現行アプリは次の前提で作られている。

- セッション所有者とプレイヤーが同一
- 1セッションにPCは1人
- 1ターンにプレイヤー入力は1件
- 1ターンに判定は最大1回
- クライアントがAI GMを呼び、ログとstateを更新してセッションJSON全体を保存
- サーバーセッションは`users/{userId}/sessions/{sessionId}`へ保存
- 別端末の同時編集はrevision競合として停止させる

この構造へ複数クライアントが同時にセッション全体PUTを行うと、正常な共同操作がすべて競合になる。また、各クライアントがAI GMを個別に呼ぶと、同じ世界から異なる結果が生成される。

Partyモードでは、1つの共有セッションをサーバーが管理し、参加者全員の行動を一度にAI GMへ渡す。世界状態は一度だけ更新し、同じ結果からPC別視点の文章を配信する。

## 2. 目的

- 複数プレイヤーが同時に同じセッションへ参加できる
- 同じ時間軸、出来事、世界状態を全PCで共有する
- 各プレイヤーは担当PC視点の地の文と選択肢を受け取る
- PCが別行動しても、単一の正史と時間進行を維持する
- 全参加者の行動を集めてからAI GMが一括処理する
- 行動衝突を、両立・援護・別行動・グループ決定へ分類して処理する
- テキストチャットを提供するが、相談内容をAI GMへ渡さない
- 手動離席、無反応、自動離席、切断、再参加を扱う
- 既存ソロセッションを壊さない
- Partyセッションの結果をCampaign次話生成へ渡せる

## 3. 対象外

- 人間GM向けの完全なVTT機能
- マップ、駒、距離、戦闘グリッド
- 音声・映像通話
- チャット内容をAI GMが読み取る機能
- プレイヤーごとに独立した並行世界を生成して後から統合する機能
- オフラインで各自がターンを進める非同期プレイ
- 観戦者、途中参加PC、複数Campaign間のPC移動
- Partyモード投入と同時の既存Soloデータ移行

## 4. 設計原則

### 4.1 正史は一つ、表示はPC別

AI GM呼び出しはグローバルな進行単位ごとに一回だけ開始する。各PC向けに独立した物語生成を行わない。

```text
PC1行動 ─┐
PC2行動 ─┼→ 全行動を一括解決 → 世界状態を1回更新
PC3行動 ─┘                    ├→ PC1視点
                                  ├→ PC2視点
                                  └→ PC3視点
```

PC別地の文は同じ解決結果から派生する表示。PC別地の文から世界状態を別々に更新しない。

### 4.2 サーバーだけがターンを確定する

クライアントは次のcommandだけを送る。

- 参加・退出
- 行動の提出・修正・撤回
- 準備完了
- 投票
- 離席・復帰
- チャット
- ホスト管理操作

ラウンドのロック、AI GM呼び出し、ダイス、state更新、イベント保存はサーバー責務。クライアントが完成済みSession JSONを送信する経路をPartyモードでは使わない。

### 4.3 ゲームイベントを追記し、スナップショットは派生物とする

Partyセッションでは複数クライアントの操作が短時間に集中する。セッション全体を毎回上書きせず、安定した連番を持つイベントを追記する。

- 行動提出
- 行動修正
- ラウンドロック
- 判定結果
- AI GM解決
- scene移動
- 離席状態変更
- 投票結果

現在状態スナップショットはイベントから再構築できるキャッシュ。イベント追記後、スナップショット更新前にサーバーが停止しても、再起動後に未反映イベントを再生する。

### 4.4 チャットとゲーム入力を分離する

チャットは相談手段であり、PC行動ではない。チャットメッセージはAI GMプロンプト、章精算、判定、state更新へ一切含めない。

プレイヤーが相談結果を世界へ反映したい場合、各自の行動として提出する。

### 4.5 不在PCの自動操作は保守的にする

離席中PCは物語から不自然に消さず、既定では同行する。ただしAI GMへ人格・関係・資源を不可逆に変える権限を与えない。

## 5. 用語

| 用語 | 意味 |
|---|---|
| Partyセッション | 複数ユーザーが共有する1つのセッション |
| ホスト | ルーム作成者。招待、PC割当、強制進行、参加者管理を行う人間 |
| AI GM | 世界進行と物語生成を行うモデル。参加者ではない |
| 参加者 | Partyセッションへ加入したユーザー |
| 担当PC | 参加者が操作するPC。初期実装では1参加者1PC |
| グローバルビート | 全sceneが共有する一回の時間進行単位 |
| Sceneグループ | 同じ場所・状況で行動するPC集合 |
| 行動案 | プレイヤーが入力中・提出済みの意図 |
| 行動ロック | 当該ビートの行動変更を締め切った状態 |
| 同行モード | 離席中PCをAI GMが安全な補助行動で扱う状態 |
| 先導権 | 排他的なグループ決定が同数票だった場合の決定権 |

## 6. セッション作成・参加

### 6.1 Partyセッション作成

ホームの「新規プレイ」からモードを選ぶ。

- ひとりで遊ぶ
- パーティで遊ぶ

Party選択後、既存Setupを拡張する。

1. World
2. Scenario
3. Ruleset
4. PC枠数とPC候補
5. セッション設定
6. ロビー作成

セッション設定:

- 最大参加人数。初期値4、初期実装上限6
- 行動時間。初期値90秒
- 投票時間。初期値30秒
- 別行動時の視点公開: `open` / `character`
- 離席時の既定動作: `follow` / `wait` / `delegate`
- 全員の準備完了まで開始しない

Scenario、World、Ruleset、NPC、GM専用情報は作成時にサーバー側Partyセッションへスナップショットする。参加者へ素材ライブラリ本体のアクセス権を付与しない。

### 6.2 招待

ホストが招待URLを発行する。

```text
#/party/{sessionId}/join/{inviteToken}
```

要件:

- 128bit以上のランダムtoken
- サーバー保存時はhash化
- ホストが失効可能
- 使用回数または期限を設定可能
- ログイン必須
- join成功後はtokenなしURLへ置換

tokenはjoin APIのbodyへ送り、URL文字列全体をサーバーログへ記録しない。

### 6.3 ロビー

参加者は空いているPCを選ぶ。ホストは割当変更可能。

表示:

- 参加者名
- 担当PC
- 接続状態
- 準備完了
- 先導権の初期順序

全参加者の準備完了後、ホストが開始する。AI GMによる導入生成はサーバーが一度だけ実行する。

## 7. Party Play画面

### 7.1 デスクトップ

3領域構成。

```text
┌────────────┬──────────────────────┬──────────────┐
│ Party状態   │ 自分の視点・物語ログ │ 行動・チャット │
│ Scene一覧   │                      │              │
│ 接続/離席   │                      │              │
└────────────┴──────────────────────┴──────────────┘
```

左:

- 参加者・PC一覧
- 入力中、確定、離席、切断状態
- Sceneグループ
- 現在の先導権
- カウントダウン

中央:

- 自分のPC視点の物語
- 自分が参加するsceneの共有描写
- 判定結果
- 選択肢
- 不在中の要約

右:

- 自分の行動入力
- 他PCの提出済み行動
- Partyチャット

### 7.2 モバイル

中央の物語を常時表示し、下部タブで切り替える。

- 行動
- Party
- チャット

カウントダウン、確定状態、自分の離席ボタンは固定表示する。

### 7.3 行動表示

テキスト入力中の本文を他参加者へ逐字配信しない。

- `input`、`keydown`、`compositionupdate`でtyping heartbeatを送る
- 他参加者には「入力中…」だけ表示
- 選択肢選択または「行動を共有」で内容を即時表示
- ロック前なら修正・撤回可能
- 修正履歴はサーバーイベントに残すが、通常UIは最新版だけ表示

これにより、相談しながら他PCの行動へ合わせられる一方、IME変換途中や書き直しを公開しない。

## 8. ラウンド状態機械

```text
presenting
  ↓ 全クライアントへ描写配信
collecting
  ├─ 全アクティブ参加者ready → lock_grace
  └─ deadline到達 → timeout_check
lock_grace
  ├─ 5秒経過 → locked
  └─ 誰かがready解除 → collecting
timeout_check
  ├─ 未入力者がtyping中 → collectingへ延長
  ├─ 人間入力0件 → paused
  └─ 不在者を自動処理 → locked
locked
  ↓ 行動スナップショット固定
resolving
  ├─ 排他的決定が必要 → deciding
  ├─ 判定が必要 → rolling → resolving
  └─ 解決完了 → presenting
deciding
  ↓ 投票結果確定
resolving
paused
  ↓ 誰かが復帰またはホストが再開
collecting
```

Partyセッションの状態:

```js
{
  phase:
    'lobby' |
    'presenting' |
    'collecting' |
    'lock_grace' |
    'locked' |
    'resolving' |
    'deciding' |
    'paused' |
    'ended',
  roundId,
  roundNumber,
  deadlineAt,
  lockAt,
  basedOnStateRevision,
  resolutionId?
}
```

## 9. 行動受付とカウントダウン

### 9.1 基本

- 新しい描写配信後、`collecting`へ移行
- 設定済み行動時間を`deadlineAt`へ保存
- 手動離席・自動離席・切断確定済み参加者を待機対象から除外
- 全待機対象がreadyになった時点で5秒の`lock_grace`
- grace中は撤回可能
- 5秒後、行動を固定して`locked`

### 9.2 typing判定

フォーカスだけではtyping扱いにしない。

- `keydown`: 修飾キー、矢印、Tab等だけの場合は除外
- `input`: 内容が実際に変わった場合
- `compositionupdate`: 日本語IME入力
- heartbeat送信は2秒に1回までthrottle
- 最終heartbeatから6秒でtyping解除

締切時、未提出者がtyping中なら自動進行しない。

- 15秒延長
- 実入力が続く限り再延長
- 基本締切から最大90秒まで自動延長
- 最大延長到達後も自動解決せず、ホストへ「待つ」「先へ進む」を表示

ホストの「先へ進む」は未提出者を当該ラウンドだけAI同行として処理する。操作はイベントとして記録する。

### 9.3 全員無反応

人間が提出した行動が0件の場合、AI GMを呼ばない。全員を自動操作して物語だけが進み続けることを防ぐ。

`paused`へ移行し、「全員離席中。誰かが戻るまで進行停止」と表示する。

## 10. 離席・切断・復帰

### 10.1 参加者状態

```js
{
  connection: 'online' | 'reconnecting' | 'offline',
  activity: 'active' | 'typing' | 'ready' | 'away_manual' | 'away_auto',
  awayPolicy: 'follow' | 'wait' | 'delegate',
  delegatedToUserId?,
  consecutiveMisses,
  lastSeenAt,
  lastActionRound
}
```

`connection`とtyping leaseはpresence情報。`activity`の離席状態、`awayPolicy`、`consecutiveMisses`はゲーム進行へ影響するため永続化する。

### 10.2 手動離席

「離席」ボタンで`away_manual`へ移行し、待機対象から除外する。

離席方針:

| 方針 | 処理 |
|---|---|
| follow | AI GMが防御・同行・援護中心の行動を選ぶ |
| wait | 安全な場面転換でPCを一時的にscene外へ置く |
| delegate | 指定参加者が当該PCの行動も提出する |

### 10.3 無反応

締切時に未提出かつtyping中でない場合:

1. `consecutiveMisses + 1`
2. 当該ラウンドは`awayPolicy`に従って処理
3. 2回連続で無反応なら`away_auto`
4. 以降、本人が反応するまで待機対象から除外

次のいずれかで復帰する。

- 「参加に戻る」
- 新しい行動を提出
- ホストが復帰させる

正常に行動を提出した時点で`consecutiveMisses=0`。

### 10.4 ブラウザ終了・通信断

- WebSocket切断後、30秒は`reconnecting`
- 30秒以内の再接続では状態変更なし
- 超過後`offline`かつ`away_auto`
- `sendBeacon`による退出通知は補助として使うが、到達を前提にしない

ブラウザを閉じてもmembershipと担当PCを維持する。再入室後、サーバーsnapshotと未受信イベントを取得する。

復帰画面:

- 不在中のラウンド数
- AI GMが処理した自PCの行動
- 重要な世界変化
- 現在のscene
- 「参加に戻る」

復帰前のラウンドへ遡って行動を差し替えない。次の`collecting`から参加する。

### 10.5 AI同行の禁止事項

離席PCについて、AI GMへ次を禁止する。

- 仲間への裏切り
- 重要NPCの意図的殺害
- 希少品・有限資源の自発的消費
- 永続的な契約、所属変更、改宗
- 恋愛、絶縁、秘密告白
- PCの信条・目標を変更する決断
- 不可逆な自己犠牲

重大な個人決定が避けられない場合、その決定を保留できる状況を作る。危機から完全に除外できない場合、既存設定に沿う防御・撤退・仲間の援護を優先する。

## 11. 行動衝突

AI GMは提出行動を次の順で分類する。

### 11.1 両立

全行動を実行する。

例:

- PC1が扉を調べる
- PC2が廊下を警戒する

### 11.2 主行動と援護

同じ目的へ異なる方法を使っている場合、主行動と援護へまとめる。

例:

- PC1が衛兵を説得する
- PC2が証拠を提示する

主行動PCが判定し、他PCの能力・行動が成功率やdegreeへ影響する。

### 11.3 別行動

個人として両方実行できる場合、Sceneグループを分ける。

例:

- PC1は村に残る
- PC2は森へ向かう

個人の行動を多数決で消さない。

### 11.4 排他的なParty決定

Party全体が同時に一つしか選べない場合、AI GMは物語を進めず`decision_required`を返す。

例:

- 船で北へ行く
- 船で南へ行く

AI GMは提出済み行動を中立的な2〜4案へ正規化し、投票カードを生成する。新しい第三案を勝手に加えない。相談継続は選択肢へ含められる。

投票ルール:

- 手動離席・自動離席・offlineを除く参加者
- 既定30秒
- 多数決
- 同数なら先導権PCの票
- 先導権は決定発生後、次のアクティブPCへ移る

作中文脈上、決定権が一人へ明確に属する場合は投票しない。

例:

- 鍵の所有者が鍵を渡すか
- 船長PCが自船の針路を決める
- 自分の秘密を明かすか

「文章が最も説得力ある行動」をAIが選ぶルールは採用しない。文章量・文章力による恒常的な有利を避ける。AIが評価するのは作中の実行可能性と権限だけ。

## 12. 別行動と時間軸

### 12.1 グローバルビート

MVPでは全Sceneグループが同じグローバルビートを共有する。

- 各Sceneで行動を収集
- 全アクティブSceneの行動を同時ロック
- AI GMへ全Sceneを一括入力
- 世界状態と全Sceneを一回で更新

SceneごとにAI GMを独立実行しない。Scene Aの行動で建物が爆発した一方、Scene Bでは建物が残っている、といった矛盾を防ぐ。

### 12.2 長さの異なる行動

一方のPCが長時間作業、他方が短い会話を行う場合、AI GMが共通ビートへ正規化する。

- 長時間作業を複数ビートの継続行動にする
- 短いsceneへ待機、移動、追加の判断材料を与える
- 明確な時間差をstateへ記録して後で合流する

個別Sceneだけを先に複数ターン進める非同期Scene進行は初期対象外。

### 12.3 視点公開

`viewPolicy`:

| 値 | 表示 |
|---|---|
| open | 自分視点を主表示。他Sceneも「全体ログ」で閲覧可能 |
| character | 自PCが知覚した描写だけ表示。他SceneのGM描写は非公開 |

行動宣言は本要件に従い、どちらの設定でも全参加者へ表示する。GM描写、発見した事実、PC別選択肢だけを公開範囲で制御する。

## 13. AI GM処理

### 13.1 入力

- World要約
- Scenario原文と`directorGuide`
- 全PC設定
- 全体state
- PC別state
- Sceneグループ
- 直近のゲームイベント
- 今回の全提出行動
- 離席PCと`awayPolicy`
- 既知情報の公開範囲
- 投票結果がある場合、その確定結果

Partyチャットは含めない。

### 13.2 処理段階

1. 行動整合性の判定
2. 排他的Party決定が必要なら`decision_required`を返して停止
3. 必要な判定を一括要求
4. コード側がダイスとリソース副作用を解決
5. 判定結果をAI GMへ返す
6. 世界・Scene・PC状態更新案とPC別地の文を生成
7. サーバーが検証してイベントとして確定

### 13.3 複数判定tool

現行`roll_check`の代わりにParty用toolを追加する。

```js
request_checks({
  checks: [
    {
      pcId,
      checkLabel,
      successPercent,
      checkKind: 'normal' | 'sanity',
      supportPcIds: []
    }
  ]
})
```

制約:

- 原則1PCにつき1ビート最大1回
- 1ビートの総判定数はアクティブPC数以下
- 同じ目的の行動は可能な限り主判定＋援護へまとめる
- 判定結果は既存adapterをサーバー側で決定論的に解決
- AIは出目と成功を決めない
- リソース更新はPC別stateへ適用

### 13.4 最終出力

```js
{
  resolution: 'advance',
  globalUpdate: {
    time,
    flags,
    historySummary,
    tensionLevel,
    endingReached
  },
  sceneUpdates: [
    {
      sceneId,
      title,
      participantPcIds,
      location,
      summary
    }
  ],
  pcUpdates: [
    {
      pcId,
      sceneId,
      resourceChanges,
      conditionChanges,
      newlyKnownFactIds
    }
  ],
  narratives: [
    {
      id,
      audience: { kind: 'all' | 'scene' | 'pcs', ids: [] },
      text
    }
  ],
  choicesByPc: [
    { pcId, choices: [] }
  ],
  autoActions: [
    { pcId, text, reason }
  ]
}
```

`autoActions`は章精算時に人間の選択と区別する。

### 13.5 出力検証

- 存在しない`pcId`・`sceneId`を拒否
- audienceへ存在しないIDを指定できない
- AIが未提出PCの人格的決断を生成していないか禁止語だけでなく構造で検査
- state revision不一致なら確定せず再生成または失敗
- リソース値をAI出力から直接採用せず、コード計算結果を使う
- `endingReached`は全Sceneの主要対立が解決した場合だけ許可

## 14. チャット

### 14.1 機能

- Party全体チャンネル1つ
- 送信者名、時刻、本文
- 未読件数
- チャット入力中表示は任意
- 文字数上限2000
- 連投rate limit

### 14.2 AIからの分離

チャット保存先、API、イベント種別をゲームイベントから分離する。

```text
sharedSessions/{sessionId}/chat/{messageId}.json
```

次へ含めない。

- AI GMターン入力
- `historySummary`
- Campaign章精算
- 小説化
- Ending記録

小説化でParty内相談まで掲載したい将来要望は別機能とする。既定で混入させない。

### 14.3 表示安全性

- Markdownとして実行せず、既定はプレーンテキスト
- URLリンク化する場合も危険schemeを拒否
- HTMLエスケープ
- 削除・通報は将来機能

## 15. データモデル

### 15.1 既存Soloとの分離

既存Solo Session:

```text
users/{userId}/sessions/{sessionId}.json
```

Party Session:

```text
sharedSessions/{sessionId}.json
sharedSessions/{sessionId}/snapshot.json
sharedSessions/{sessionId}/events/{eventSeq}.json
sharedSessions/{sessionId}/rounds/{roundId}.json
sharedSessions/{sessionId}/chat/{messageId}.json
sharedSessions/{sessionId}/invites/{inviteId}.json
users/{userId}/sharedSessions/{sessionId}.json
```

共有Sessionを特定ユーザー名前空間の下へ置かない。ユーザー側には一覧取得用membership indexだけを置く。

### 15.2 Party Sessionメタ

```js
{
  id,
  mode: 'party',
  ownerId,
  campaignId?,
  worldId?,
  title,
  status: 'lobby' | 'playing' | 'paused' | 'ended',

  settings: {
    maxPlayers,
    actionTimeoutSeconds,
    voteTimeoutSeconds,
    viewPolicy: 'open' | 'character',
    defaultAwayPolicy: 'follow' | 'wait' | 'delegate'
  },

  participants: [
    {
      userId,
      role: 'host' | 'player',
      pcId?,
      joinedAt,
      awayState,
      awayPolicy,
      delegatedToUserId?,
      consecutiveMisses,
      lastActionRound
    }
  ],

  pcs: [
    {
      id,
      characterName,
      raw,
      goal,
      bonds
    }
  ],

  // サーバー内部だけで使用。参加者向けGETでは返さない
  gmSnapshot: {
    world,
    scenario,
    ruleset,
    directorGuide
  },

  eventSeq,
  stateRevision,
  currentRoundId,
  createdAt,
  updatedAt,
  endedAt?
}
```

`gmSnapshot`を含む生データをクライアントへ返さない。参加者向けsnapshot APIで、権限と担当PCに応じたprojectionを構築する。

### 15.3 State snapshot

```js
{
  lastEventSeq,
  stateRevision,
  global: {
    time,
    flags,
    historySummary,
    tensionLevel,
    endingReached
  },
  scenes: {
    [sceneId]: {
      title,
      location,
      participantPcIds,
      summary
    }
  },
  pcs: {
    [pcId]: {
      sceneId,
      resources,
      conditions,
      knownFactIds,
      xp
    }
  },
  facts: {
    [factId]: {
      text,
      audience
    }
  }
}
```

### 15.4 Event

```js
{
  seq,
  id,
  sessionId,
  type,
  actorUserId?,
  actorPcId?,
  roundId?,
  commandId?,
  audience,
  payload,
  createdAt
}
```

`seq`はSession単位の単調増加整数。ファイル名はゼロ埋めして字句順と時系列を一致させる。

```text
events/000000000001.json
events/000000000002.json
```

`commandId`でクライアント再送を冪等化する。

PC別公開範囲により途中のeventが非表示になる場合も、クライアントのcursorは進める必要がある。event取得APIは可視event配列と別に`nextSeq`を返し、非可視eventを何度も取得しない形にする。WebSocketも可視payloadがない場合にcursor更新だけを通知できる。

### 15.5 Snapshot更新

設計上はゲームイベントを真実源とする。現行実装もeventをsnapshot/sessionより先に保存するが、未反映eventを再起動時にsnapshotへ再生する処理は未実装。

1. Sessionロック内で次`seq`を採番
2. イベント保存
3. snapshotへ適用
4. Sessionメタの`eventSeq`・`stateRevision`更新
5. WebSocket配信

完成形ではイベント保存後に停止した場合、再起動時に`snapshot.lastEventSeq + 1`以降を再生する。現行はsnapshotが先行してイベントがない状態を作らない順序だけを実装済み。

初期ファイルストレージでは単一Expressプロセス内ロックを使用できる。複数プロセス化時は、共有ロック・transaction・pub/subを持つストレージへ置換する。

## 16. Realtime通信

### 16.1 WebSocket(設計案・未実装)

完成形のPartyモードではWebSocketを使用する。現行実装はsnapshot/chatを1秒間隔のREST pollingで取得し、typing/presenceもREST heartbeatで送る。

用途:

- game event配信
- action状態更新
- typing heartbeat
- presence
- countdown同期
- chat

接続時:

1. httpOnlyセッションクッキーで認証
2. Origin検証
3. membership検証
4. 最終受信`eventSeq`を送信
5. 必要なら最新snapshot＋未受信イベントを返す

### 16.2 サーバー時刻

カウントダウンは`deadlineAt`というサーバー時刻を真実源にする。クライアントは残り時間表示だけを行う。ローカルタイマー終了で勝手にラウンドを進めない。

接続時・定期pingで時刻差を補正する。

### 16.3 Presence

typingと接続presenceは一時情報。サーバー再起動後、クライアント再接続で復元する。

現在の`activePlayers` Mapは「同じ所有者の別端末が開いているか」を検出する機能であり、Party membershipやPC状態には流用しない。Party用presenceを別モジュールにする。

複数サーバープロセスへ拡張する場合、Redis等のTTL付き共有presenceへ移す。

## 17. API案

```text
POST /api/party-sessions
GET  /api/party-sessions
GET  /api/party-sessions/:id/snapshot
POST /api/party-sessions/:id/join
POST /api/party-sessions/:id/leave
POST /api/party-sessions/:id/start

POST /api/party-sessions/:id/intents
PATCH /api/party-sessions/:id/intents/:intentId
DELETE /api/party-sessions/:id/intents/:intentId
POST /api/party-sessions/:id/ready
DELETE /api/party-sessions/:id/ready

POST /api/party-sessions/:id/away
POST /api/party-sessions/:id/return
POST /api/party-sessions/:id/votes

POST /api/party-sessions/:id/host/advance
POST /api/party-sessions/:id/host/pause
POST /api/party-sessions/:id/host/resume
PATCH /api/party-sessions/:id/host/participants/:userId

GET  /api/party-sessions/:id/events?after=:seq
GET  /api/party-sessions/:id/chat?after=:messageId
POST /api/party-sessions/:id/chat

WS   /api/party-sessions/:id/stream
```

通常操作をREST command、即時配信をWebSocket eventとして分ける。WebSocket一時切断中もREST commandと再取得で回復可能にする。

join APIは招待tokenをJSON bodyで受け取る。tokenをquery parameterやアクセスログへ残さない。

## 18. 認可

| 操作 | host | player |
|---|---:|---:|
| snapshot取得 | ○ | ○ |
| 自PC行動提出 | ○ | ○ |
| 他PC行動提出 | delegate時のみ | delegate時のみ |
| チャット | ○ | ○ |
| 招待発行・失効 | ○ | × |
| PC割当変更 | ○ | × |
| 強制進行・停止 | ○ | × |
| 参加者削除 | ○ | × |
| GM専用snapshot取得 | Campaign編集画面のみ | × |

ホストがプレイヤーを兼ねる場合も、自分の担当PC以外を通常操作できない。管理権限とPC操作権限を分離する。

参加者向けprojection作成後にフィールドを削る方式ではなく、許可されたフィールドだけを新しいオブジェクトへ組み立てるallowlist方式を使う。GM専用情報の漏えいを防ぐ。

## 19. AI解決ジョブと障害処理

### 19.1 二重起動防止

ラウンドロック時に一意な`resolutionId`と行動スナップショットを保存する。同じラウンドへの開始要求は既存`resolutionId`を返し、AI呼び出しを重複させない。

### 19.2 AI処理中の切断

クライアント切断でAI処理を中断しない。結果はサーバーへ保存し、再接続時に配信する。

### 19.3 AI失敗

- 行動スナップショットを保持
- `phase='paused'`
- 参加者へ失敗表示
- ホストへ「同じ行動で再試行」「行動受付へ戻す」
- 利用枠超過時はreset時刻表示

「行動受付へ戻す」場合、元行動を初期値として残し、編集可能にする。

### 19.4 サーバー再起動(未実装)

resolution jobへ`bootId`、`startedAt`、`updatedAt`を保存する。再起動後、異なる`bootId`で`resolving`のままなら失敗として回復UIを出す。小説化ジョブと同じ考え方。

### 19.5 不正AI出力

schema検証失敗時、stateとeventを確定しない。判定結果だけが適用されて物語が失われる状態を避けるため、ダイス・リソース変化も解決イベント確定時にまとめてcommitする。

## 20. Campaignとの連携

Partyセッション終了後、[適応型Campaign設計](2026-08-01-adaptive-campaign-continuation-design.md)の章精算へ次を渡す。

- 全ゲームイベント
- 全PC設定
- 全体state
- PC別resources・conditions・knownFacts
- Scene別履歴
- Party投票結果
- 人間提出行動
- 離席中のAI同行行動

章精算では人間行動とAI同行を区別する。

- AI同行の結果も世界の正史には含める
- AI同行を「プレイヤーが選んだ重要行動」として記録しない
- 離席中に人格的決断が混入していた場合、章精算レビューで警告する

Campaign引き継ぎは`carriedPcs[]`へ拡張する。各PCのシート、xp、必要なら章間持ち越し対象resources・conditionsを保存する。

## 21. 小説化・挿絵・Ending

### 21.1 小説化

Partyイベントから公開可能な物語ログを組み立てる。

選択肢:

- 群像視点
- 指定PC視点
- Scene別構成

Partyチャット、typing、presence、投票途中経過は本文へ入れない。確定した行動、判定、GM描写だけを使う。

### 21.2 挿絵

Scene単位のGM描写を対象とする。PC別にほぼ同じ挿絵を重複生成しない。解決イベントへ共通`sceneNarrativeId`を持たせ、挿絵を紐付ける。

### 21.3 Ending

全体Endingに加え、将来PC別エピローグを保存可能な形にする。初期実装は全体Ending一件でよい。

## 22. 互換性

- 既存Sessionは`mode`未指定を`solo`として扱う
- 既存`#/play/:sessionId`はSolo専用のまま維持
- Partyは`#/party/:sessionId`を新設
- 既存`PUT /api/sessions/:id`をPartyへ使用しない
- 既存IndexedDB Sessionを共有Sessionへ自動変換しない
- 既存`pc`を直ちに`pcs[]`へ置換しない
- Party専用プロンプト・ターン処理を新設し、Solo処理を維持
- 表示コンポーネント、Ruleset adapter、ダイス評価、Markdown表示等は共有可能

## 23. テスト方針

### 23.1 Storage・event

- event seq単調増加
- commandId再送の冪等性
- event保存後snapshot更新
- snapshot遅延時のevent replay
- membership index一覧
- GM専用情報をprojectionへ含めない

### 23.2 認証・認可

- 非memberアクセス拒否
- playerのhost操作拒否
- delegateされていない他PC操作拒否
- 失効invite拒否
- WebSocket Origin・cookie・membership検証
- PC別audienceフィルタ

### 23.3 ラウンド

- 全員readyで5秒grace後lock
- grace中のready解除
- deadlineで未入力PCをAI同行
- typing中の延長
- focusだけではtypingにならない
- 最大延長後のhost判断待ち
- 人間入力0件でpaused
- 同じroundのresolution二重起動防止

### 23.4 離席・復帰

- 手動離席を待機対象から除外
- 2回連続missで自動離席
- 正常入力でmissリセット
- WebSocket再接続猶予
- offline後の再入室
- 不在中要約と未受信event取得
- 過去roundへ遡って入力できない

### 23.5 行動衝突

- 両立行動を同時解決
- 主行動＋援護
- 別行動でScene分割
- 排他的行動で投票へ遷移
- 同数時の先導権
- 個人決定を投票へ出さない
- 離席者を投票母数へ含めない

### 23.6 AI・判定

- 全PC・全Scene・全行動を一回の解決へ入力
- Partyチャットを入力しない
- 複数判定をadapterで解決
- 1PC1判定制約
- 不正pcId・sceneId・audience拒否
- AI失敗時に行動保持
- 再起動後のstale resolution回復
- AI同行禁止事項のプロンプトと出力検査

### 23.7 UI

- ロビー作成・招待・参加・PC割当
- Party状態のリアルタイム表示
- 行動提出・修正・撤回
- typing表示
- カウントダウン同期
- 投票カード
- 手動離席・復帰
- モバイルタブ
- 切断後再接続

## 24. 段階導入

### PS1: 共有ルーム基盤 — コア実装済み

- Party Session storage
- membership・invite
- REST polling・event seq・snapshot(WebSocketは後続)
- ロビー・PC割当
- 同一sceneのみ

### PS2: 同時行動受付 — 実装済み

- 行動提出・修正・ready
- countdown・lock grace
- typing presence
- 手動離席・自動離席・再接続
- Partyチャット

この時点では全PCへ同じGM地の文を表示してよい。

### PS3: Party AI GM — 実装済み

- 全行動一括解決
- 主行動・援護
- 複数判定
- 排他的行動の投票
- AI同行制約

### PS4: PC別視点・別行動 — 実装済み

- PC別state・knownFacts
- audienceフィルタ
- Sceneグループ
- open/character視点設定
- グローバルビートで複数Scene一括解決

### PS5: 周辺機能 — Campaign統合のみ実装済み

- Party小説化
- Party Ending
- Scene単位挿絵
- Campaign `carriedPcs`・章精算統合(実装済み)

## 25. 最初の実用版(実装済み)

最初に完成させる縦断スコープ:

- 2〜4人
- 全員同一scene
- 行動は全員へ公開
- Partyチャット
- 90秒カウントダウン
- typing延長
- 手動離席
- 2回無反応で自動離席
- AI同行は防御・援護のみ
- 全行動をAI GMが一括処理
- GM地の文は全員共通
- 判定は複数対応
- ブラウザ終了後に再参加可能

この縦断スコープに加え、PC別視点、別Scene、`open|character`公開範囲、Campaign統合まで実装した。初期案の2〜4人に対し実装上限は6人。GM地の文は全員共通だけでなく`all|scene|pcs` audienceへ拡張済み。

## 26. 完了条件

次の一連操作が成立した時点でPartyセッションのコア機能完成とする。

1. ホストがPartyセッションを作成して招待URLを発行
2. 複数プレイヤーが参加し、別々のPCを担当
3. 全員が同じ導入を受け取る
4. 各自が行動を提出し、他参加者が即時確認
5. 全行動を一度のAI GM処理で解決
6. 同じ世界更新から各PC視点を受け取る
7. 排他的行動を投票で決定
8. 手動離席・無反応・切断中PCを待たずに進行
9. 離席者が再入室し、蓄積済みPC視点ログから復帰(専用不在中要約は後続)
10. 別行動時も単一正史と共有時間軸を維持
