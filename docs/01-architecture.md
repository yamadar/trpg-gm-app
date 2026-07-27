# アーキテクチャ

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
│  - /api/messagesでGemini形式へ変換            │
│  - 小説化(novelize)は非同期ジョブ(実装済み    │
│    2026-07-25)。POSTは202を即返し、生成は     │
│    novelJobsがバックグラウンドで実行・記録する │
│  - World/Character/Scenario/RulesetのCRUD    │
│    ロジックを持つ(素材ライブラリAPI)         │
│  - dataStore/textStoreによるサーバー側永続化  │
│  - 自前OAuth 2.0(Google/Discord/X, PKCE)に   │
│    よるソーシャルログインとhttpOnlyクッキー   │
│    のサーバーサイドセッション                │
│  - 全APIは要認証で`users/{userId}`名前空間   │
│    (例外: `/auth/*`・`GET /api/auth/providers`│
│    ・`GET /api/me`・`GET /api/public/*`・     │
│    `GET /api/users/*`は認証不要)              │
│  - AI呼び出し(messages/novelize)はユーザー   │
│    単位の日次利用制限(超過時429)             │
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

## デプロイ形態

- フロントエンド: Vite + ReactによるSPA。ブラウザのIndexedDBへセッションを永続化し、ログイン中はユーザー名前空間のサーバーセッションと双方向同期する。revision条件更新で別端末からの無警告上書きを防ぐ(詳細は[04-persistence.md](04-persistence.md))。
- バックエンド: Expressサーバー。Google Geminiのテキスト生成キー・モデルを`GEMINI_TEXT_API_KEY`/`GEMINI_TEXT_MODEL`、画像生成キー・モデルを`GEMINI_IMAGE_API_KEY`/`GEMINI_IMAGE_MODEL`として分離保持する。`/api/messages`は既存クライアント形式を`server/textProvider.js`でGemini `generateContent`形式へ変換し、本文・structured output・function callingを互換レスポンスへ戻す。素材ライブラリ(World/Character/Scenario/Ruleset)のCRUDは独自のビジネスロジックを持つ。小説化(novelize)は**非同期ジョブとして実装済み(2026-07-25)**: `POST /api/sessions/:id/novelize`は生成を待たず`202 { status: 'running' }`を即座に返し、実際のGemini呼び出しは`server/novelJobs.js`がバックグラウンドで行う。進行状態は`users/{userId}/sessions/{sessionId}/novelJob`レコード(`{ status, startedAt, updatedAt, error, bootId }`。02-data-model.md 3.5節参照)へ永続化され、`GET /api/novel-jobs`で全セッション分をまとめて参照できる。プロセス再起動でジョブの実行主体が失われた場合(`bootId`不一致)や、開始から30分(`NOVEL_JOB_TIMEOUT_MS`)を超えても完了記録が無い場合は、読み取り時点で失敗として扱う(UIが「小説化中…」のまま固まることを防ぐ)。プロンプト構築と上流呼び出し・出力打ち切り時の継続リクエストは`server/novelGeneration.js`に分離されている(06-content-generation.md 10.6.1節)。サーバー側の永続化抽象化(dataStore/textStore)も担う。加えて、Google/Discord/XのOAuth 2.0(PKCE)によるソーシャルログインとhttpOnlyクッキーベースのサーバーサイドセッションを実装し、`/auth/*`・`GET /api/auth/providers`・`GET /api/me`・`GET /api/public/*`・`GET /api/users/*`を除く全`/api/*`ルートを認証必須にしている(`server/auth/`配下)。加えて、公開スナップショットストア(`public/...`名前空間、`server/storage/shareLibrary.js`)と公開ギャラリーAPI(`server/routes/publicContent.js`・`publish.js`・`imports.js`)を持つ。認証不要の公開読み取り(`GET /api/public/*`)、ユーザー自身の素材の公開/解除(`POST`・`DELETE /api/publish/*`、認証必須)、他ユーザーが公開した素材を自分のライブラリへ独立コピーとして取り込むインポート(`POST /api/import/*`、認証必須)の3系統からなる。同じ`publicContent.js`は、Phase 3で追加した認証不要の公開ユーザープロフィールAPI(`GET /api/users/:userId`)も提供する。ユーザー単位の公開素材一覧は`GET /api/public/:type?ownerId=`(同じく認証不要)で取得する。
- フロントエンドのルーティングはハッシュベースの自前実装(`src/navigation/`。React Routerは導入しない)。`routes.js`がhashをrouteオブジェクトへ解釈し(`parseRoute`)、逆にrouteから正準形のhashを組み立てる(`buildHash`)。`window.location`/`history`に触れるのは`useRoute.js`だけで、画面側は`navigate(route)`/`navigateHash(hash)`を呼ぶ。省略形・旧URL・解釈できないhashは`replaceState`で正準形へ寄せる(履歴は積まない)。全ての画面遷移がURLに現れるため、リロード・ブックマーク・共有・ブラウザの戻る/進むがどの画面でも成立する。ルートは`#/`(ホーム)・`#/library/{tab}[/{worldId}]`・`#/browse/{tab}[/{publicId}]`・`#/records/{endings|achievements}`・`#/u/{userId}[/{tab}[/{publicId}]]`・`#/setup`・`#/play/{sessionId}`で、旧`#/endings`・`#/achievements`は`#/records/*`へ読み替える。
- 環境変数`BASE_URL`(OAuthのredirect_uriおよびCSRF目的のOrigin検証の基準URL)と`DATA_DIR`(dataStore/textStoreの永続化先ディレクトリ)を前提とする。本番運用ではプラットフォームの永続ディスクを`DATA_DIR`にマウントする(ファイルシステムベースの実装のため、再起動やデプロイでディスクが失われるとユーザー・セッション・素材データも失われる)。プロキシ/ロードバランサ配下での実行を想定し`app.set('trust proxy', 1)`を設定している。
- 開発時は単一の`package.json`から`concurrently`でフロントエンド(Vite dev server)とバックエンド(Express)を同時起動する。フロントは5173、バックエンドは8787で動き、`/api`・`/auth`はViteのproxy設定(`vite.config.js`)経由でバックエンドへ転送される。
- 本番は**Expressの単一プロセスがAPIとフロントの両方を配信する**。`STATIC_DIR`が指定されたとき、`server/index.js`が全APIルーターの後段でその配下を`express.static`で配信し、`/api/*`・`/auth/*`以外の未知のGETには`index.html`を返す(SPAフォールバック)。未設定なら配信しない(開発時はViteが5173で配信するため不要)。相対パスはリポジトリルート基準で解決するので、本番は`STATIC_DIR=dist`でよい。
- **本番挙動を左右する設定は`NODE_ENV`ではなく専用の環境変数に分離している**(`resolveSecureCookies`/`resolveStaticDir`、`server/index.js`)。`NODE_ENV`はnpmのdevDependencies省略(`omit=dev`)やライブラリ側の最適化など無関係な意味を同時に背負うため、ビルド都合の変更でセッションクッキーのSecure属性が黙って外れる事故を避ける狙いがある。
  - `SECURE_COOKIES`: セッションクッキーのSecure属性。`true`/`false`(`1`/`0`・`yes`/`no`・`on`/`off`も可)。未設定時は`BASE_URL`のスキームから決まる(Secure属性付きクッキーはHTTPSでしか保存されないため、https=有効・http=無効以外に妥当な既定値がない)。解釈できない値は起動時に例外にする(タイプミスで黙ってSecureが外れる方が危険なため)。
  - `STATIC_DIR`: 上記の静的配信元。
- 具体的なデプロイ手順(Render)と本番運用上の注意は[09-deployment.md](09-deployment.md)、Blueprint定義はリポジトリ直下の`render.yaml`にある。
