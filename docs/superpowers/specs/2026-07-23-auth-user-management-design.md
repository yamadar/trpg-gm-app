# 認証・ユーザー管理 (Phase 1) 設計書

作成日: 2026-07-23

## 背景と全体ロードマップ

アプリを一般公開し、ユーザーごとのデータ保存・共有を実現する。全体は3フェーズに分割し、本設計書は **Phase 1: 認証基盤 + データ所有権** のみを対象とする。

1. **Phase 1(本書)**: ソーシャルログイン、ユーザー管理、サーバーデータのユーザー紐付け、未ログイン時のローカル動作、利用制限
2. **Phase 2(別設計)**: 共有機能 — 小説/シナリオ/キャラクター/世界観の公開フラグ、公開一覧、素材ライブラリへのインポート
3. **Phase 3(別設計)**: ユーザーページ — 公開プロフィールと共有物一覧

## 確定した要件

- 運用環境: PaaS/クラウドに一般公開(永続ディスク付き)
- ソーシャルログイン: Google / Discord / X の3プロバイダ
- 未ログインでも画面閲覧・ローカル(IndexedDB)セッションの閲覧は可能。**AIを使うプレイ進行・素材ライブラリ・小説化・サーバー同期はログイン必須**(運営者負担のAIコスト保護のため)
- プロバイダから取得・保存するのは「プロバイダ内部ID + 表示名 + アバターURL」のみ。**メールアドレスは取得も保存もしない**(取得スコープ自体を最小化)
- AIコストは運営者負担とし、ユーザー単位の日次利用制限を設ける
- 共有の公開範囲は非公開/公開の2段階(Phase 2で実装)

## アプローチ選定

自前OAuth実装(案A)を採用する。比較した代替案:

- **Supabase Auth**: 実装は減るがSupabase側にメールアドレス等が保存され「個人情報を取得しない」方針を貫けない。外部依存も増える
- **Clerk/Auth0**: 実装最速だがMAU課金・ベンダーロックイン・PII保存があり、本プロジェクトの規模と方針に合わない

採用理由: (1) 保存情報を完全にコントロールできる、(2) 既存のExpress + dataStore/textStore抽象への追加が最も自然、(3) ランニングコストゼロ。追加依存はOAuth 2.0クライアントライブラリ`arctic`のみ。

## 1. 全体アーキテクチャ

```
ブラウザ ──(httpOnlyクッキー)── Express
                                 ├─ /auth/*        … OAuthフロー(新規)
                                 ├─ requireAuth    … 認証ミドルウェア(新規)
                                 ├─ /api/me        … ログイン中ユーザー情報(新規)
                                 ├─ /api/messages  … 要ログイン + 利用制限
                                 └─ /api/sessions, /api/worlds, /api/rulesets …
                                     要ログイン + ユーザー名前空間化
```

- 保存先は既存の`dataStore`/`textStore`抽象を継続使用。ユーザー・認証セッション・利用量カウンタもJSONとして保存する。DBは導入しない(スケールで困ったら`dataStore`実装を差し替える既存方針を踏襲)
- PaaSの永続ディスク(Render Disk / Fly Volume等)が運用前提

## 2. 認証フロー(OAuth 2.0 + PKCE)

### エンドポイント

- `GET /auth/:provider/start` … `state` + PKCE code_verifierを生成して一時クッキー(httpOnly、10分)に保存し、プロバイダの認可画面へリダイレクト
- `GET /auth/:provider/callback` … `state`検証 → トークン交換 → プロファイル取得 → ユーザー検索or作成 → ログインセッション発行 → `/`へリダイレクト。失敗時は`/?auth_error=1`へリダイレクト
- `POST /auth/logout` … ログインセッション破棄、クッキー削除
- `GET /api/auth/providers` … クライアントID/シークレットが設定済みのプロバイダ一覧を返す(未設定プロバイダはログインUIに出さない)

### スコープ(最小化)

- Google: `openid profile`(メール取得なし)
- Discord: `identify`
- X: `users.read tweet.read`(X API v2の`/2/users/me`に必要な最小セット)

### ログインセッション

- ランダム256bitトークンを`httpOnly + Secure + SameSite=Lax`クッキーで保持
- サーバー側にはSHA-256ハッシュを`auth/sessions/{tokenHash}`キーで保存: `{ userId, createdAt, expiresAt }`
- 有効期限30日のスライディング方式(アクセスのたびに延長)
- 期限切れセッションはアクセス時に破棄

### CSRF対策

- OAuthフロー: `state`パラメータ + PKCE
- API変更系(POST/PUT/PATCH/DELETE): SameSite=Laxクッキー + Originヘッダ検証ミドルウェア

## 3. ユーザーモデル

```
auth/identities/{provider}:{providerUserId} → { userId }   … ログイン時の逆引き
users/{userId} → {
  id: "usr_xxxx",          // 内部ID(URLにも使用)
  displayName,             // 初期値はプロバイダの表示名、アプリ内で変更可
  avatarUrl,               // プロバイダのアバターURL(参照のみ保存)、null可
  createdAt, updatedAt
}
```

- 1ユーザー = 1プロバイダID。複数プロバイダの連携(アカウント統合)はPhase 1ではやらない(identitiesを分離してあるので後から追加可能)
- プロフィール編集は表示名の変更とアバターの削除のみ(`PATCH /api/me`)。画像アップロードはやらない

## 4. データ所有権と名前空間

`server/storage/paths.js`の各キー生成関数に`userId`引数を追加し、サーバー上の全データをユーザー配下に置く。

```
users/{userId}/sessions/{sessionId}
users/{userId}/worlds/{worldId}/...
users/{userId}/rulesets/{rulesetId}
```

- `/api/*`ルートは`requireAuth`ミドルウェアを通し、セッションから`req.userId`を解決。各ハンドラが`req.userId`をキー生成関数に渡す素直な方式とする。例外は認証不要の3つのみ: `/auth/*`(OAuthフロー)、`GET /api/auth/providers`、`GET /api/me`(未ログイン時は`200 { user: null }`を返す)
- 認可は「自分のデータしか触れない」のみ。キーに自分の`userId`が入るため構造的に他人のデータへ到達不能。公開データの読み取りはPhase 2で追加
- 未ログインで`/api/*`を叩くと`401 { error: "login required" }`

## 5. 利用制限(コスト保護)

- 対象はAnthropicを呼ぶ2エンドポイント: `POST /api/messages`、`POST /api/sessions/:id/novelize`
- `usage/{userId}/{YYYY-MM-DD}`に日次カウンタ`{ messages, novelize }`を保存し、超過時は`429 { error, resetAt }`
- 上限は環境変数で設定: `LIMIT_MESSAGES_PER_DAY`(既定200)、`LIMIT_NOVELIZE_PER_DAY`(既定10)
- 日付はサーバーのUTC日付でリセット。トークン数ベースの精密管理はやらない(日次回数で十分)
- クライアントは429を受けたら「本日の利用上限に達しました」と表示

## 6. 未ログイン時の動作とデータ引き継ぎ

### 未ログイン時

- ホーム画面・過去のローカルセッション(IndexedDB)の閲覧・ローカル保存済み小説の閲覧は可能
- プレイ進行(AI呼び出し)・素材ライブラリ・小説化・サーバー同期は不可。UIはログインボタン付きの案内を表示
- `putSessionToServer`はログイン時のみ実行(既存の「失敗してもプレイ続行」ロジックは維持)

### ログイン時のローカルデータ引き継ぎ

- ログイン直後、IndexedDBにサーバー未同期のセッションがあれば「このブラウザのセッション○件をアカウントに保存しますか?」と確認し、既存の`PUT /api/sessions/:id`で一括アップロード
- 同一IDがサーバーに既にある場合は`updatedAt`が新しい方を採用

### 既存サーバーデータの移行

- 現在`server/data/`にある認証以前のデータは自動移行せず、一回限りの移行スクリプト`scripts/migrate-legacy-data.js <userId>`で指定ユーザー配下へ移動する(既存データは開発データのみ。本番は最初から名前空間ありで開始)

## 7. フロントエンド構成

- **`AuthContext`(新規)**: 起動時に`GET /api/me`を1回呼び`{ user, loading }`を提供。`login(provider)`は`/auth/{provider}/start`への遷移、`logout()`は`POST /auth/logout`後にstate更新
- **ヘッダーUI**: 未ログイン時「ログイン」ボタン(モーダルでGoogle/Discord/Xを選択、`/api/auth/providers`の結果で出し分け)。ログイン時はアバター+表示名 → メニュー(プロフィール編集/ログアウト)
- **プロフィール編集**: 表示名変更とアバター削除のみの小さなモーダル
- **ゲート処理**: `Play.jsx`のAI呼び出し・`Library.jsx`・小説化ボタンは未ログイン時にログイン案内を表示。App.jsxのscreen切替構造は変えない
- 共通fetchラッパーに401/429ハンドリングを追加(401→auth state再取得、429→上限メッセージ表示)

## 8. エラーハンドリング

- OAuthコールバック失敗(state不一致・トークン交換失敗・プロファイル取得失敗)は`/?auth_error=1`へリダイレクトし、フロントでトースト表示
- 期限切れ・無効セッションのAPIアクセスは401。クライアントはauth stateを未ログインに更新
- プロバイダ障害時はそのプロバイダのログインだけが失敗し、他プロバイダ・既ログインユーザーには影響しない

## 9. テスト戦略

既存パターン(vitest + supertest + `fetchImpl`注入)を踏襲する。

- **サーバー**: OAuthフロー(トークン交換・プロファイル取得を`fetchImpl`モックで再現、state不一致・期限切れの異常系含む)/ `requireAuth`(未認証401、他ユーザーのデータへ到達不能)/ 利用制限(境界値・日付リセット・429)/ Origin検証 / 移行スクリプト
- **クライアント**: `AuthContext`(me成功/失敗/未ログイン)/ ログインUI出し分け / ゲート処理 / ローカルセッション引き継ぎ(確認→アップロード→衝突解決)
- **既存テストの修正**: 全ルートが要認証になるため、supertest用に「テスト用ログイン済みセッションを作る」ヘルパーを追加して既存テストを通す

## 10. 環境変数・デプロイ前提

```
BASE_URL                 … OAuthコールバックURL生成用 (例: https://app.example.com)
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET
X_CLIENT_ID / X_CLIENT_SECRET
LIMIT_MESSAGES_PER_DAY=200
LIMIT_NOVELIZE_PER_DAY=10
DATA_DIR                 … データ保存先(永続ディスクのマウント先。未設定時はserver/data)
```

- クッキーの`Secure`属性のため本番はTLS前提。PaaSのTLS終端を考慮し`app.set('trust proxy', 1)`を設定
- 開発時はGoogleのみ設定して動作確認できる(未設定プロバイダはUIに出ない)

## スコープ外(Phase 1ではやらない)

- 共有・公開機能、公開一覧、素材インポート(Phase 2)
- ユーザーページ(Phase 3)
- 複数プロバイダのアカウント統合
- アバター画像アップロード
- メールアドレスの取得・保存、アカウント復旧フロー(プロバイダのアカウントが失われた場合の救済はしない)
- トークン数ベースの利用量管理・課金
