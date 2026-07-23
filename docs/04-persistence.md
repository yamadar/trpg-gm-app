# 状態管理・永続化

## クライアント側(IndexedDB)

- ブラウザのIndexedDBでセッション跨ぎ保存する。`sessions`という1つのobject store(キー: session id)にセッション全体を保存する。
- localStorage/sessionStorageではなくIndexedDBを採用する理由:
  - localStorageとsessionStorageは容量上限がほぼ同じ(数MB程度)であり、sessionStorageに容量面の優位性はない
  - sessionStorageはタブを閉じると消えるため、「続きから再開」機能と両立しない
  - 将来的に画像等のバイナリデータを扱う計画があり、IndexedDBならBlobを直接扱え容量上限も大きい
- 一覧表示(ホーム画面の「続きから再開」)はIndexedDBの`getAll()`で全セッションを取得し`updatedAt`降順にソートして使う。専用の索引(旧`sessions_index`)は持たない。
- スキーマバージョン管理: session内に`schema_version`を持たせ、将来の移行に対応(未実装、Phase以降で必要になれば追加)。

## サーバー側(dataStore / textStore)

- サーバーはJSON向けの`dataStore`とテキスト(Markdown等)向けの`textStore`という2つの抽象インターフェースを持つ。現状はどちらもローカルファイルシステム実装。
  - `dataStore`: 将来Redis等のキーバリューストアへの差し替えを想定
  - `textStore`: 将来S3等のクラウドストレージへの差し替えを想定
- 認証機能の追加に伴い、素材ライブラリ・セッション関連のキーはすべて**ユーザー単位の名前空間`users/{userId}/...`配下**に置かれる(`server/storage/paths.js`)。認証(識別情報・セッショントークン)自体はユーザー名前空間の外側に置かれる。
- Sessionsは`dataStore`経由で`users/{userId}/sessions/{id}`キーに保存され、`GET /api/sessions`・`GET /api/sessions/:id`・`PUT /api/sessions/:id`で読み書きできる(`req.userId`はログインセッションから解決され、他ユーザーのセッションにはアクセスできない)。**フロントエンドからの自動同期は実装済み**: `Play.jsx`が毎ターン、IndexedDBへの保存に加えて`putSessionToServer`(`src/api/sessionSyncClient.js`)経由で`PUT /api/sessions/:id`を呼び、サーバー側にもセッション全体を同期する(失敗してもプレイは継続、コンソールにエラーを出すのみ)。
- World/Character/Scenario/Rulesetについては、`server/storage/paths.js`のキー生成関数(`users/{userId}/worlds/{worldId}/...`等)を使った**保存API・素材ライブラリUIが両方稼働している**(データモデルは[02-data-model.md](02-data-model.md)の3.5節のフォルダ構造に対応)。フロントエンドの`src/screens/Library.jsx`(World/Character/Scenario/Rulesetタブ)からこれらのAPIを呼び出し、CRUDが完結する。

### 認証関連のキー構造(`server/auth/*.js`)

- **`auth/identities/{provider}/{providerUserId}`**: OAuthプロバイダ(google/discord/x)のユーザーIDから自サービスの内部`userId`への対応(`server/auth/users.js`の`identityKey`)。初回ログイン時に`findOrCreateUser`が作成し、以後の同一プロバイダアカウントでのログインをこのキーで突き合わせる。
- **`auth/sessions/{tokenHash}`**: サーバーサイドセッション本体(`server/auth/sessions.js`)。`{ userId, createdAt, expiresAt }`を保持し、キーはセッショントークンそのものではなくそのSHA-256ハッシュ(`tokenHash`)。トークン自体はhttpOnlyクッキー(`gmdesk_session`)としてのみクライアントに渡り、有効期限は30日(残り15日未満でアクセスがあれば自動延長)。
- **`users/{userId}/profile`**: ユーザープロフィール(`server/auth/users.js`の`userProfileKey`)。`{ id, displayName, avatarUrl, createdAt, updatedAt }`。`GET/PATCH /api/me`で参照・更新する。
- **`users/{userId}/usage/{YYYY-MM-DD}`**: ユーザー・日(UTC日付)単位のAI呼び出し回数カウンタ(`server/auth/usage.js`の`usageKey`)。`{ messages: n, novelize: n }`形式で、`LIMIT_MESSAGES_PER_DAY`/`LIMIT_NOVELIZE_PER_DAY`(環境変数、既定200/10)を超えると`429`を返す。

### サーバーAPIサーフェス(`server/routes/*.js`, `server/auth/routes.js`)

- **auth**: `GET /auth/:provider/start`(OAuth開始・PKCEのcode_verifier発行・stateをクッキーに保持してプロバイダへリダイレクト)、`GET /auth/:provider/callback`(コールバック。state検証・コード交換・プロフィール取得・ユーザー作成/取得・セッション発行後`/`へリダイレクト)、`POST /auth/logout`(セッション破棄)。いずれも認証不要。
- **me / providers**: `GET /api/auth/providers`(有効な(クライアントID/シークレットが設定された)プロバイダ名の一覧。認証不要)、`GET /api/me`(ログイン中ユーザー情報。未ログイン時は`user: null`。認証不要)、`PATCH /api/me`(`displayName`/`avatarUrl`の更新。ログイン必須で未ログインは`401`)
- **sessions**: `GET /api/sessions`(一覧)、`GET /api/sessions/:id`、`PUT /api/sessions/:id`、`POST /api/sessions/:id/novelize`(ログをAI小説化して保存)、`GET /api/sessions/:id/novel`(小説本文+鮮度フラグ`stale`を返す)
- **worlds**: `GET /api/worlds`、`GET /api/worlds/:id`、`PUT /api/worlds/:id`、`DELETE /api/worlds/:id`(関連するCharacter/Scenario/region/categoryをカスケード削除)
- **worldContent**: `GET/PUT /api/worlds/:worldId/source`、`GET/PUT/DELETE /api/worlds/:worldId/regions/:region`、`GET /api/worlds/:worldId/regions`(一覧)、`GET/PUT/DELETE /api/worlds/:worldId/categories/:category`、`GET /api/worlds/:worldId/categories`(一覧)
- **characters**: `GET /api/worlds/:worldId/characters/:kind`(一覧、kindはpc/npc)、`GET/PUT/DELETE /api/worlds/:worldId/characters/:kind/:name`、`PUT /api/worlds/:worldId/characters/:kind/:name/parsed`(goal/bonds構造化キャッシュの保存)
- **scenarios**: `GET /api/worlds/:worldId/scenarios`、`GET/PUT/DELETE /api/worlds/:worldId/scenarios/:id`
- **rulesets**: `GET /api/rulesets`、`GET/PUT/DELETE /api/rulesets/:id`
- **認証必須・利用制限**: 上記の`sessions`/`worlds`/`worldContent`/`characters`/`scenarios`/`rulesets`および`POST /api/messages`は`createRequireAuth`ミドルウェア(`server/auth/middleware.js`)を通り、有効なセッションクッキーがなければ`401`を返す(`/auth/*`・`GET /api/auth/providers`・`GET /api/me`のみ例外)。加えて`POST /api/messages`と`POST /api/sessions/:id/novelize`はユーザー単位の日次利用制限に達すると`429`を返す(`server/auth/usage.js`)。またミューテーション系メソッド(POST/PUT/PATCH/DELETE)は`Origin`ヘッダが`BASE_URL`と一致しない場合`403`(`createOriginCheck`、CSRF対策)。

### 入力堅牢化(FX3で追加)

- 全ルートの`:id`/`:worldId`/`:name`等のパスパラメータは`idParamGuard`(`server/routes/validateId.js`)を通り、空文字・128文字超・`..`を含む・先頭ドット・許可文字集合(英数字/`.`/`_`/`-`)外の値は`400`で拒否する(パストラバーサル対策)。`kind`パラメータも`pc`/`npc`以外を`400`で拒否する。
- PUT系エンドポイントは必須フィールドの型チェック(例: `raw`/`title`/`label`が文字列でなければ`400`)を行う。
- `dataStore.set`はテンポラリファイルへの書き込み後に`rename`するアトミック書き込み(`server/storage/dataStore.js`)。
- `deleteWorld`はWorld本体だけでなく配下のCharacter/Scenario/region/categoryもまとめて削除するカスケード処理。
- `POST /api/sessions/:id/novelize`と`POST /api/messages`はいずれもAnthropicへの上流リクエストにタイムアウト(`AbortSignal.timeout`)を設定する。
