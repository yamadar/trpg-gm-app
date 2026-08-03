# アーキテクチャ

> **現行仕様:** SQLite永続化、モジュール別table/repository、S3対応ObjectStorageまで実装済み。filesystem/ローカル画像が既定で、本番SQLite/S3切替は運用runbook実行後。PostgreSQL移行を含む目標構成は[11-sqlite-migration-and-architecture-redesign.md](11-sqlite-migration-and-architecture-redesign.md)を参照。

## システム構成

```
┌─────────────────────────────────────────┐
│              UI (React)                  │
│  - 入力欄 / 選択肢ボタン / ログ表示エリア   │
│  - 成長ポイント表示(growthUnit/xp)         │
│  (キャラシート表示パネルは未実装。素材      │
│   ライブラリ画面で別途キャラシートを閲覧)   │
└───────────────┬───────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│           Game Engine (JS, ローカル)       │
│  - state管理 (真実源)                       │
│  - ダイスロール実行・判定計算(判定式アダプタ │
│    により`formula`ごとにsimple/coc7e/dnd5e/  │
│    gurpsを切り替え。実装済み・詳細は03章)     │
│  - AI応答のパース・state反映                 │
│  - 直近ログ(recent_log)は最大12件保持のみ。  │
│    閾値超過での自動圧縮トリガーは未実装      │
│  - IndexedDBへのセッション永続化             │
└───────────────┬───────────────────────────┘
                │ prompt (state + 履歴要約 + プレイヤー入力)
                ▼
┌─────────────────────────────────────────┐
│      プロキシサーバー (Express)             │
│  - Geminiテキスト/画像APIキーの分離保持       │
│  - 操作別text APIをGemini形式へ変換           │
│  - 小説化(novelize)は非同期ジョブ(実装済み    │
│    2026-07-25)。POSTは202を即返し、生成は     │
│    novelJobsがバックグラウンドで実行・記録する │
│  - World/Character/Scenario/RulesetのCRUD    │
│    ロジックを持つ(素材ライブラリAPI)         │
│  - dataStore/textStore/imageStoreによる      │
│    サーバー側永続化                          │
│  - 添付画像をSharpでWebPへ正規化し、表示用と │
│    サムネイルを生成                          │
│  - 自前OAuth 2.0(Google/Discord/X, PKCE)に   │
│    よるソーシャルログインとhttpOnlyクッキー   │
│    のサーバーサイドセッション                │
│  - 全APIは要認証で`users/{userId}`名前空間   │
│    (例外: `/auth/*`・`GET /api/auth/providers`│
│    ・`GET /api/me`・`GET /api/public/*`・     │
│    `GET /api/users/*`は認証不要)              │
│  - AI呼び出しは回数・token・同時数を制限      │
│  - 保存容量・空き容量を更新前に検査            │
│  - 公開スナップショットストアと公開ギャラリー │
│    API(認証不要の公開読み取り、公開/解除、    │
│    コピーインポート)。公開ユーザープロフィール│
│    API(`GET /api/users/:userId`)も同様に認証  │
│    不要(ユーザー単位の公開素材一覧は          │
│    `GET /api/public/:type?ownerId=`で取得)   │
└───────────────┬───────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│      Google Gemini API (GM役・挿絵)         │
│  - 地の文生成                              │
│  - NPC発言生成                             │
│  - 判定要求 (tool_use: roll_check)          │
│  - state更新案 (JSON)                       │
└───────────────┬───────────────────────────┘
                │ response (narrative + state_update + choices)
                ▼
        Game Engineがstate確定・UIへ反映
```

**設計原則**: 判定結果・state更新の「確定」は必ずコード側。AIは提案のみ。真実源はAIの中ではなくローカルstate。

**Partyモード(実装済み2026-08-01)**はSoloと責務境界が異なる。複数ブラウザはSession全体をPUTせず、参加・PC割当・行動・ready・typing・離席・投票・チャット等のcommandだけをExpressへ送る。`server/partyService.js`が共有Session、ラウンドstate machine、締切、単一プロセス内ロックを管理し、`sharedSessions/{sessionId}`配下へevent、snapshot、round、chat、inviteを保存する。AI GMはGM専用素材を受け取る特権plannerと、公開可能な`narratorBrief`・コードで確定済みの判定結果だけを受け取るplayer-facing narratorへ分離する。全PCの確定行動を一度に計画し、コードがRulesetアダプタで判定した後、同じ世界更新から全体・Scene・PC別の描写を生成する。参加者向けsnapshot/eventは`server/partyState.js`がallowlist方式で投影し、GM専用素材、他PCの生シート、非公開Scene・描写・選択肢を返さない。planner/描写には既知の秘密文字列との直接一致検査も適用する。現行RealtimeはWebSocketでなく1秒間隔の認証済みRESTポーリング。WebSocket配信、永続AI解決ジョブ、再起動時event replayは後続。

## 永続化境界

```text
Express routes / domain services
  └─ createPersistence(DATABASE_DRIVER)
       ├─ filesystem: JSON + Markdown + image files
       └─ sqlite:
            ├─ auth/library/session/campaign/party/publishing等のmodule table
            ├─ usage_counters / jobs / storage_*（専用repository）
            ├─ media_assets / media_bindings（論理pathとimmutable objectを分離）
            └─ ObjectStorage: filesystem または private S3 bucket
```

`DATABASE_DRIVER=filesystem|sqlite`と`OBJECT_STORAGE_DRIVER=filesystem|s3`を独立して切り替える。S3は正確な容量台帳とmedia状態機械を必要とするためSQLite時だけ有効。SQLite書き込みは単一coordinatorが`BEGIN IMMEDIATE`を含め直列化し、Party複数レコード更新も同一transactionへ入る。routeごとに許可moduleをscope化し、未宣言module参照をfail-fastする。旧`domain_records`/`documents`は容量triggerとrollback用のatomic mirrorで、通常read/writeの正本ではない。各module payloadのうち検索・制約対象は通常列へ抽出済み。Sessionログ・Party参加者などの完全な子table分解は後続。

画像writeは`media_assets(state='pending')`作成、immutable object upload、`media_bindings`差替え、旧object削除の順。upload失敗時は旧bindingを維持する。deleteはbindingを先に外して`deleting`へ進め、起動時reconcilerが中断した`pending/deleting`を補償する。File→S3は`npm run migrate:media:s3`でdry-run、upload、checksum検証を分離する。

小説化workerはdurable `jobs` table/File repositoryへlease付きで登録する。サーバー再起動時は起動前に未完了jobをclaimし直し、最新Sessionから再開する。従来の`bootId`不一致を即時エラーにする表示ロジックは、durable recoveryを使えない旧レコードの安全側fallback。

運用probeは`GET /live`と`GET /ready`。`/ready`はDB疎通、適用migration版、`MAINTENANCE_MODE`を検査する。カットオーバー中は`MAINTENANCE_MODE=read-only`で更新APIとOAuth callbackを止める。

## デプロイ形態

- フロントエンド: Vite + ReactによるSPA。ブラウザのIndexedDBへセッションを永続化し、ログイン中はユーザー名前空間のサーバーセッションと双方向同期する。revision条件更新で別端末からの無警告上書きを防ぐ(詳細は[04-persistence.md](04-persistence.md))。
- ユーザー添付画像: `multer`でJPEG/PNG/WebPを受け、`server/imageProcessing.js`がSharpで表示用・サムネイル用WebPへ正規化する。画像メタとトップ画像指定は`dataStore`、バイナリは`imageStore`へ分離保存する。
- バックエンド: Expressサーバー。Google Geminiのテキスト生成キー・モデルを`GEMINI_TEXT_API_KEY`/`GEMINI_TEXT_MODEL`、画像生成キー・モデルを`GEMINI_IMAGE_API_KEY`/`GEMINI_IMAGE_MODEL`として分離保持する。`POST /api/text-operations/:operation`は7個の許可済み操作だけを受理し、入力長、system prompt、tool/output schema、最大出力tokenを`server/routes/textOperations.js`で操作別に固定する。推定入力tokenと要求出力tokenをユーザー・サービス全体の日次枠へ予約し、上流同時実行数も制限する。`server/textProvider.js`が固定リクエストをGemini `generateContent`形式へ変換し、本文・structured output・function callingを互換レスポンスへ戻す。素材ライブラリ(World/Character/Scenario/Ruleset)のCRUDは独自のビジネスロジックを持つ。小説化(novelize)は**非同期ジョブとして実装済み(2026-07-25)**: `POST /api/sessions/:id/novelize`は生成を待たず`202 { status: 'running' }`を即座に返し、実際のGemini呼び出しは`server/novelJobs.js`がバックグラウンドで行う。進行状態は`users/{userId}/sessions/{sessionId}/novelJob`レコード(`{ status, startedAt, updatedAt, error, bootId }`。02-data-model.md 3.5節参照)へ永続化され、`GET /api/novel-jobs`で全セッション分をまとめて参照できる。実行payloadとleaseはdurable job repositoryへ保存し、起動時に未完了jobをclaimして最新Sessionから再開する。開始から80分(`NOVEL_JOB_TIMEOUT_MS`。生成中更新による最大2回の自動再生成を含む最悪ケース)を超えても完了記録が無い場合は失敗へ確定し、UIが「小説化中…」のまま固まることを防ぐ。プロンプト構築と上流呼び出し・出力打ち切り時の継続リクエストは`server/novelGeneration.js`に分離されている(06-content-generation.md 10.6.1節)。サーバー側の永続化抽象化(dataStore/textStore)も担う。加えて、Google/Discord/XのOAuth 2.0(PKCE)によるソーシャルログインとhttpOnlyクッキーベースのサーバーサイドセッションを実装し、`/auth/*`・`GET /api/auth/providers`・`GET /api/me`・`GET /api/public/*`・`GET /api/users/*`を除く全`/api/*`ルートを認証必須にしている(`server/auth/`配下)。認証済みの更新要求には固定カスタムヘッダー、同一Origin、Fetch Metadataを要求する。全応答へCSP等の防御ヘッダーを設定し、予期しない例外は固定エラーcodeとrequest IDだけを返す。加えて、公開スナップショットストア(`public/...`名前空間、`server/storage/shareLibrary.js`)と公開ギャラリーAPI(`server/routes/publicContent.js`・`publish.js`・`imports.js`)を持つ。認証不要の公開読み取り(`GET /api/public/*`)、ユーザー自身の素材の公開/解除(`POST`・`DELETE /api/publish/*`、認証必須)、他ユーザーが公開した素材を自分のライブラリへ独立コピーとして取り込むインポート(`POST /api/import/*`、認証必須)の3系統からなる。同じ`publicContent.js`は、Phase 3で追加した認証不要の公開ユーザープロフィールAPI(`GET /api/users/:userId`)も提供する。ユーザー単位の公開素材一覧は`GET /api/public/:type?ownerId=`(同じく認証不要)で取得する。
- フロントエンドのルーティングはハッシュベースの自前実装(`src/navigation/`。React Routerは導入しない)。`routes.js`がhashをrouteオブジェクトへ解釈し(`parseRoute`)、逆にrouteから正準形のhashを組み立てる(`buildHash`)。`window.location`/`history`に触れるのは`useRoute.js`だけで、画面側は`navigate(route)`/`navigateHash(hash)`を呼ぶ。省略形・旧URL・解釈できないhashは`replaceState`で正準形へ寄せる(履歴は積まない)。全ての画面遷移がURLに現れるため、リロード・ブックマーク・共有・ブラウザの戻る/進むがどの画面でも成立する。ルートは`#/`(ホーム)・`#/library/{tab}[/{worldId}]`・`#/browse/{tab}[/{publicId}]`・`#/records/{endings|achievements}`・`#/u/{userId}[/{tab}[/{publicId}]]`・`#/setup`・`#/play/{sessionId}`・`#/party-setup`・`#/party/{sessionId}`・`#/party/{sessionId}/join/{inviteToken}`で、旧`#/endings`・`#/achievements`は`#/records/*`へ読み替える。
- 環境変数`BASE_URL`、`DATA_DIR`、`DATABASE_DRIVER`、`SQLITE_PATH`、`MEDIA_DIR`、`OBJECT_STORAGE_*`を永続化・認証境界に使う。SQLite DBはローカル永続ディスク、画像はfilesystem選択時だけ`MEDIA_DIR`、S3選択時はprivate bucketへ置く。WebはSQLite期間中1インスタンスに固定し、DBをNFS/S3マウントへ置かない。認証済み更新前に所有者容量、期限付きheadroom予約、ディスク空きを検査する。プロキシ/ロードバランサ配下を想定し`app.set('trust proxy', 1)`を設定している。
- 開発時は単一の`package.json`から`concurrently`でフロントエンド(Vite dev server)とバックエンド(Express)を同時起動する。フロントは5173、バックエンドは8787で動き、`/api`・`/auth`はViteのproxy設定(`vite.config.js`)経由でバックエンドへ転送される。
- 本番は**Expressの単一プロセスがAPIとフロントの両方を配信する**。`STATIC_DIR`が指定されたとき、`server/index.js`が全APIルーターの後段でその配下を`express.static`で配信し、`/api/*`・`/auth/*`以外の未知のGETには`index.html`を返す(SPAフォールバック)。未設定なら配信しない(開発時はViteが5173で配信するため不要)。相対パスはリポジトリルート基準で解決するので、本番は`STATIC_DIR=dist`でよい。
- **本番挙動を左右する設定は`NODE_ENV`ではなく専用の環境変数に分離している**(`resolveSecureCookies`/`resolveStaticDir`、`server/index.js`)。`NODE_ENV`はnpmのdevDependencies省略(`omit=dev`)やライブラリ側の最適化など無関係な意味を同時に背負うため、ビルド都合の変更でセッションクッキーのSecure属性が黙って外れる事故を避ける狙いがある。
  - `SECURE_COOKIES`: セッションクッキーのSecure属性。`true`/`false`(`1`/`0`・`yes`/`no`・`on`/`off`も可)。未設定時は`BASE_URL`のスキームから決まる(Secure属性付きクッキーはHTTPSでしか保存されないため、https=有効・http=無効以外に妥当な既定値がない)。解釈できない値は起動時に例外にする(タイプミスで黙ってSecureが外れる方が危険なため)。
  - `STATIC_DIR`: 上記の静的配信元。
- 具体的なデプロイ手順(Render)と本番運用上の注意は[12-deployment.md](12-deployment.md)、Blueprint定義はリポジトリ直下の`render.yaml`にある。
