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
│  - ダイスロール実行・判定計算(全Ruleset共通  │
│    のd100成功率%判定。ルール別アダプタは     │
│    未実装・将来案)                          │
│  - AI応答のパース・state反映                 │
│  - 直近ログ(recent_log)は最大12件保持のみ。  │
│    閾値超過での自動圧縮トリガーは未実装      │
│  - IndexedDBへのセッション永続化             │
└───────────────┬───────────────────────────┘
                │ prompt (state + 履歴要約 + プレイヤー入力)
                ▼
┌─────────────────────────────────────────┐
│      プロキシサーバー (Express)             │
│  - Anthropic APIキーの保持・付与             │
│  - /api/messagesは単純な中継のみ             │
│  - 小説化(novelize)は独自プロンプトを組んで   │
│    Anthropicを直接呼び出し、結果を保存する    │
│    ビジネスロジックを持つ                    │
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
│    /公開素材API(`GET /api/users/:userId`・   │
│    `/public`)も同様に認証不要                │
└───────────────┬───────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│         Claude API (GM役)                 │
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

- フロントエンド: Vite + ReactによるSPA。ブラウザのIndexedDBにセッションを永続化する(詳細は[04-persistence.md](04-persistence.md))。
- バックエンド: Expressサーバー。Anthropic APIキーをサーバー環境変数として保持し、`/api/messages`はフロントエンドの代わりにAPIを呼び出す単純な中継だが、小説化(novelize)と素材ライブラリ(World/Character/Scenario/Ruleset)のCRUDは独自のビジネスロジックを持つ。サーバー側の永続化抽象化(dataStore/textStore)も担う。加えて、Google/Discord/XのOAuth 2.0(PKCE)によるソーシャルログインとhttpOnlyクッキーベースのサーバーサイドセッションを実装し、`/auth/*`・`GET /api/auth/providers`・`GET /api/me`・`GET /api/public/*`・`GET /api/users/*`を除く全`/api/*`ルートを認証必須にしている(`server/auth/`配下)。加えて、公開スナップショットストア(`public/...`名前空間、`server/storage/shareLibrary.js`)と公開ギャラリーAPI(`server/routes/publicContent.js`・`publish.js`・`imports.js`)を持つ。認証不要の公開読み取り(`GET /api/public/*`)、ユーザー自身の素材の公開/解除(`POST`・`DELETE /api/publish/*`、認証必須)、他ユーザーが公開した素材を自分のライブラリへ独立コピーとして取り込むインポート(`POST /api/import/*`、認証必須)の3系統からなる。同じ`publicContent.js`は、Phase 3で追加した認証不要の公開ユーザープロフィールAPI(`GET /api/users/:userId`・`GET /api/users/:userId/public`)も提供する。
- フロントエンドのルーティングはハッシュベースの簡易実装(`src/router/useHashRoute.js`)。`#/u/{userId}`というURLハッシュのみを解釈し、公開ギャラリーの公開者名クリック等から`navigateToUser(userId)`で遷移する。それ以外の画面遷移(home/setup/library/gallery/play)は`App.jsx`内のstateで管理され、URL(ハッシュ以外)には反映されない。
- 環境変数`BASE_URL`(OAuthのredirect_uriおよびCSRF目的のOrigin検証の基準URL)と`DATA_DIR`(dataStore/textStoreの永続化先ディレクトリ)を前提とする。本番運用ではプラットフォームの永続ディスクを`DATA_DIR`にマウントする(ファイルシステムベースの実装のため、再起動やデプロイでディスクが失われるとユーザー・セッション・素材データも失われる)。プロキシ/ロードバランサ配下での実行を想定し`app.set('trust proxy', 1)`を設定している。
- 開発時は単一の`package.json`から`concurrently`でフロントエンド(Vite dev server)とバックエンド(Express)を同時起動する。
