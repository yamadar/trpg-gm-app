# デプロイ手順(Render)

> **現行仕様:** filesystem/SQLite並用のRender手順。初回SQLiteカットオーバーまでは`DATABASE_DRIVER=filesystem`、完了後は`sqlite`。S3とPostgreSQL移行条件は[11-sqlite-migration-and-architecture-redesign.md](11-sqlite-migration-and-architecture-redesign.md)を参照。

Renderの **Web Service + Persistent Disk** で公開する手順。所要時間は初回で30〜60分程度。

## なぜこの構成か

このアプリは以下の制約を持つため、永続ディスクを1インスタンスに接続できるPaaSが必要になる。

- JSON/Markdownは`DATABASE_DRIVER`でfilesystem/SQLiteを切替可能。SQLite DBは`/data/gmdesk.sqlite3`、画像はS3移行まで`MEDIA_DIR=/data`のローカルファイルへ保存する。
- ユーザー添付画像は`sharp`でWebP変換する。`npm ci`が対象環境向けネイティブバイナリを導入するため、依存を本番で省略しない。
- ディスクを共有する複数インスタンス構成は想定していない(ロック機構なし)。**必ず1インスタンスで運用する**。
- `POST /api/text-operations/:operation`はGemini APIの応答を非ストリーミングで待つ(`server/routes/textOperations.js`・`server/textProvider.js`)ため、1リクエストが数十秒に達する。短いリクエストタイムアウトを持つ実行環境では動作しない。
- OAuthのredirect_uri(`${BASE_URL}/auth/{provider}/callback`)とCSRF目的のOrigin検証が`BASE_URL`基準のため、**固定ドメイン**が必要。認証済み更新は固定カスタムヘッダーとFetch Metadataも検査する。

## 前提

- GitHubリポジトリにpush済みであること
- Renderアカウント(支払い方法の登録が必要。永続ディスクはFreeプランでは使えない)
- Geminiテキスト生成APIキー
- 任意: Gemini画像生成APIキー(場面挿絵用。未設定なら挿絵機能はUIごと無効になる)
- 任意: Google / Discord / X のOAuthアプリ(**最低1つは必須**。ログインしないと`/api/*`の大半が401になる)

## 1. サービスを作成する

リポジトリ直下の[`render.yaml`](../render.yaml)がBlueprintとして用意してある。

1. Renderダッシュボード → **Blueprints** → **New Blueprint Instance**
2. このリポジトリを選択 → **Apply**
3. `sync: false`の環境変数(APIキー類・`BASE_URL`)の入力を求められる。この時点では`BASE_URL`が確定していないので、**一旦仮の値**(例: `https://example.com`)を入れて先に進む

Blueprintを使わず手動で作る場合は、以下の設定で **New → Web Service** を作成する。

| 項目 | 値 |
|---|---|
| Language / Runtime | Node |
| Region | Singapore(日本から最も近い) |
| Branch | `main` |
| Build Command | `npm ci && npm run build` |
| Start Command | `NODE_ENV=production npm start` |
| Instance Type | Starter($7/月)以上 |
| Health Check Path | `/ready` |

> **注意**: `NODE_ENV` を**サービスの環境変数に置かないこと**。Renderの環境変数はビルドと実行の両方に適用されるが、`NODE_ENV=production` はnpmの `omit=dev` を意味するため、ビルド時の `npm ci` が `vite` を含むdevDependenciesを省略し `vite: not found` で失敗する。ランタイムにだけ渡したいので、上記のようにStart Commandへ書く。
>
> このアプリ自身の挙動は `NODE_ENV` ではなく `SECURE_COOKIES` と `STATIC_DIR` で決まる(`server/index.js`)ため、Start Commandに置いても設定が見えなくなる心配はない。

続いて **Settings → Disks → Add Disk** で永続ディスクを追加する。

| 項目 | 値 |
|---|---|
| Name | `gmdesk-data` |
| Mount Path | `/data` |
| Size | 5GB(場面挿絵とユーザー添付画像が増えるので使用量を見て拡張。**縮小は不可**) |

## 2. 環境変数を設定する

**Environment** タブで以下を設定する(Blueprint適用済みなら`sync: false`の分だけ)。

| 変数 | 値 | 必須 |
|---|---|---|
| `STATIC_DIR` | `dist` | ✅ ビルド済みフロントの配信元。未設定だと画面が表示されない。相対パスはリポジトリルート基準 |
| `SECURE_COOKIES` | `true` | ✅ セッションクッキーのSecure属性。未設定でも`BASE_URL`がhttpsなら有効になるが、本番では明示する |
| `DATA_DIR` | `/data` | ✅ ディスクのマウントパスと一致させる |
| `DATABASE_DRIVER` | 初回移行前`filesystem`、移行後`sqlite` | ✅ |
| `SQLITE_PATH` | `/data/gmdesk.sqlite3` | SQLite時必須 |
| `MEDIA_DIR` | `/data` | ✅ S3移行までは永続ディスク |
| `MAINTENANCE_MODE` | 通常`off`、移行中`read-only` | ✅ |
| `BASE_URL` | `https://<サービス名>.onrender.com`(末尾スラッシュなし) | ✅ |
| `GEMINI_TEXT_API_KEY` | Google AI Studioのテキスト生成用キー | ✅ |
| `GEMINI_TEXT_MODEL` | 使用するテキスト生成モデルID | ✅ |
| `GEMINI_IMAGE_API_KEY` | Google AI Studioの画像生成用キー | 任意(挿絵機能) |
| `GEMINI_IMAGE_MODEL` | 使用する画像生成モデルID | `GEMINI_IMAGE_API_KEY`設定時に必須 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuthアプリの資格情報 | プロバイダごとに任意(合計1つ以上必須) |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | 同上 | 同上 |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | 同上 | 同上 |
| `LIMIT_MESSAGES_PER_DAY` | 既定`200` | 任意 |
| `LIMIT_TEXT_TOKENS_PER_DAY` | 既定`500000` | 任意。操作別テキスト生成のユーザー単位予約token上限 |
| `LIMIT_GLOBAL_TEXT_TOKENS_PER_DAY` | 既定`5000000` | 任意。操作別テキスト生成のサービス全体予約token上限 |
| `LIMIT_TEXT_CONCURRENT` | 既定`6` | 任意。操作別テキスト生成の同時上流呼び出し上限 |
| `LIMIT_NOVELIZE_PER_DAY` | 既定`10` | 任意 |
| `LIMIT_IMAGES_PER_DAY` | 既定`30` | 任意 |
| `MAX_USER_STORAGE_BYTES` | 既定`268435456`(256MiB) | 任意。ユーザー所有領域と所有Party共有領域の合計上限 |
| `MIN_FREE_STORAGE_BYTES` | 既定`268435456`(256MiB) | 任意。更新を拒否し始めるディスク空き容量 |
| `STORAGE_WRITE_HEADROOM_BYTES` | 既定`12582912`(12MiB) | 任意。書き込みごとの一時領域・増分見積もり |

`PORT`はRenderが自動で注入するので設定しない(`server/index.js`が`process.env.PORT`を読む)。

> **コスト上の注意**: AI APIの利用料は**サーバーの鍵で全ユーザー分がオーナーに課金される**。回数上限に加え、操作別テキスト生成は推定入力+要求出力tokenのユーザー単位・サービス全体の日次上限と同時実行上限を持つ。予約tokenは請求上の実利用tokenと一致しないため、Gemini側のハードクォータと予算アラートも設定する。

## 3. ドメインを確定し、`BASE_URL`を直す

1. 初回デプロイ完了後、Renderが払い出したURL(`https://<サービス名>.onrender.com`)を確認する
2. 独自ドメインを使う場合は **Settings → Custom Domains** で追加し、表示されるCNAMEをDNSに登録する(証明書はRenderが自動発行)
3. **最終的に利用するURL**を`BASE_URL`に設定し直して再デプロイする

`BASE_URL`が実際のアクセス元と食い違うと、**すべての更新系リクエストが403**(Origin不一致)になり、**OAuthも`redirect_uri`不一致で失敗する**。ここが最も間違えやすい。

## 4. OAuthプロバイダを設定する

各プロバイダの開発者コンソールで、コールバックURLに以下を**完全一致**で登録する。

| プロバイダ | コールバックURL | 登録先 |
|---|---|---|
| Google | `https://<ドメイン>/auth/google/callback` | Google Cloud Console → 認証情報 → OAuth 2.0 クライアント ID |
| Discord | `https://<ドメイン>/auth/discord/callback` | Discord Developer Portal → OAuth2 → Redirects |
| X | `https://<ドメイン>/auth/x/callback` | X Developer Portal → User authentication settings |

クライアントID/シークレットが設定されたプロバイダだけが`GET /api/auth/providers`に載り、ログイン画面に表示される(`server/auth/providers.js`)。

## 5. 動作確認

```bash
# 1. liveness/readiness(認証不要)
curl https://<ドメイン>/live
# => {"ok":true}
curl -i https://<ドメイン>/ready
# => 200。driver、migrationVersion、expectedMigrationVersion、maintenanceModeを確認

# 2. 有効なログインプロバイダ(認証不要)
curl https://<ドメイン>/api/auth/providers

# 3. 未ログイン状態の確認
curl https://<ドメイン>/api/me
# => {"user":null}

# 4. 認証必須APIが401を返すこと(SPAのHTMLが返ってきたら静的配信の設定ミス)
curl -i https://<ドメイン>/api/sessions
# => 401 {"error":"login required"}
```

ブラウザで開き、ログイン → World作成 → 画像添付 → セッション開始まで確認する。画像はJPEG/PNG/WebP、1枚10MBまで。ログインと添付画像が**再デプロイ後も維持される**ことも確認する(維持されない場合は`DATA_DIR`がディスクを指していない)。

## 6. バックアップ(必須)

**`DATA_DIR`が失われるとDBと画像がすべて失われる。** Render disk snapshotだけを唯一のbackupにしない。

- SQLite稼働中DBを`cp`/`tar`で直接コピーしない。Node Online Backup APIを使う
- 生成snapshotは`integrity_check`、`foreign_key_check`、SHA-256を自動検証する
- 画像は別途Render disk snapshotまたは`MEDIA_DIR` archiveで保護する
- DB snapshotと画像backupを暗号化された外部ストレージへ退避する
- 定期的に別環境へ復元し、ログインと代表データを確認する

```bash
# Render Shell。出力先は既存ファイルを既定で上書きしない
npm run backup:sqlite -- \
  --sqlite-path=/data/gmdesk.sqlite3 \
  --output=/tmp/gmdesk-YYYYMMDD-HHMM.sqlite3

# JSON出力の integrity:"ok"、foreignKeyViolations:0、sha256 を保存
```

filesystem運用中とSQLite初回カットオーバー前は、`MAINTENANCE_MODE=read-only`で書き込みを止めてから`/data`全体のsnapshot/archiveを作る。

## 7. filesystemからSQLiteへの初回カットオーバー

本番ではdual-writeせず短いmaintenance windowを使う。以下はRender Shellで実行する。事前に同じデータcopyで所要時間を測定する。

### 7.1 事前確認

1. Nodeを`24.15.0`、Webを1インスタンスに固定
2. `DATABASE_DRIVER=filesystem`、`SQLITE_PATH=/data/gmdesk.sqlite3`、`MEDIA_DIR=/data`
3. source/backup用の十分な空き容量を確認
4. dry-runを実行

```bash
npm run migrate:sqlite -- \
  --dry-run \
  --data-dir=/data \
  --report=/tmp/sqlite-dry-run.json
```

`ok:false`なら切替禁止。`quarantined`、`orphanReferences`を解消する。認証導入前のトップレベル`sessions/worlds/rulesets`がある場合だけ、所有者を確認して`--legacy-owner=usr_xxxxxxxxxxxxxxxx`を付ける。推測で割り当てない。

### 7.2 書き込み停止・backup

1. Render health checkを一時的に`/live`へ変更
2. `MAINTENANCE_MODE=read-only`へ変更して再起動
3. `/ready`が`503`、`maintenanceMode:"read-only"`、更新APIが`503 READ_ONLY_MAINTENANCE`を返すことを確認
4. `/data`のdisk snapshot/archiveを作る

`/ready`は保守モードを意図的に不健康と判定するため、`/live`への一時変更なしでRender deployしない。

### 7.3 import・検証

```bash
npm run migrate:sqlite -- \
  --confirm-offline \
  --data-dir=/data \
  --sqlite-path=/data/gmdesk.sqlite3 \
  --report=/tmp/sqlite-import.json

npm run migrate:sqlite -- \
  --validate-only \
  --data-dir=/data \
  --sqlite-path=/data/gmdesk.sqlite3 \
  --report=/tmp/sqlite-validate.json

npm run backup:sqlite -- \
  --sqlite-path=/data/gmdesk.sqlite3 \
  --output=/tmp/gmdesk-post-import.sqlite3
```

認証前データにはdry-runと同じ`--legacy-owner`を付ける。移行先に同一IDの新しい認証後コピーがあり、旧レコードを保持したまま新しい方を正とする判断を承認した場合だけ、import時に`--accept-superseded-legacy`を追加する。journalへ`superseded`が残る。

合格条件:

- import/validate双方`ok:true`
- `validated == totals.files`
- quarantine、validationErrors、orphanReferencesが0
- backupが`integrity:"ok"`、`foreignKeyViolations:0`
- 所有者別byteとファイル数に説明不能な差がない

### 7.4 driver切替

1. `DATABASE_DRIVER=sqlite`へ変更
2. `MAINTENANCE_MODE=off`へ戻す
3. health checkを`/ready`へ戻してdeploy
4. `/ready`が200かつmigration版一致を確認
5. ログイン、World/Session CRUD、画像、Party、公開/Import、小説化をsmoke test
6. 旧ファイルを削除せずread-only backupとして保持

### 7.5 rollback

書き込み再開前なら`MAINTENANCE_MODE=read-only`を維持し、`DATABASE_DRIVER=filesystem`へ戻せる。SQLiteで書き込み再開後はfilesystemへ逆同期しないため、単純rollback禁止。障害調査・復元判断が終わるまで保守モードを維持する。

## 運用メモ

### デプロイ

`main`へのpushで自動デプロイされる。デプロイ中は短いダウンタイムが発生する(ディスク付きサービスはゼロダウンタイムデプロイができず、旧インスタンス停止 → 新インスタンス起動の順になるため)。

### スケール

**インスタンス数は1から増やさないこと。** 複数インスタンスは同じディスクを共有できず、データが分裂する。負荷が上がった場合はインスタンス**タイプ**を上げる(垂直方向)。

### コスト目安

| 項目 | 月額 |
|---|---|
| Web Service (Starter) | $7 |
| Persistent Disk 5GB | $1.25($0.25/GB) |
| **小計** | **約$8.25** |
| AI API利用料 | 利用量次第(通常こちらが支配的) |

ディスクを付けたサービスはゼロスケールできないため、アクセスがなくても課金される。

### トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| ビルドが`vite: not found`で失敗 | サービスの環境変数に`NODE_ENV=production`が入っている。npmが`omit=dev`と解釈しdevDependenciesを入れない。環境変数から外し、Start Command側に書く |
| 更新系APIが全部403 | `BASE_URL`が実アクセス元と不一致(スキーム・末尾スラッシュ・wwwの有無) |
| OAuthが`redirect_uri_mismatch` | プロバイダ側のコールバックURLと`${BASE_URL}/auth/{provider}/callback`が不一致 |
| 再デプロイでデータが消える | `DATA_DIR`がディスクのマウントパス(`/data`)を指していない |
| ログインが毎回切れる | 同上(セッションは`auth/sessions/*`としてディスクに保存される) |
| 画面が真っ白 / APIのJSONが直接見える | `STATIC_DIR`が未設定。`dist`を設定して再デプロイする |
| サーバーが起動せず`SECURE_COOKIES must be one of ...` | `SECURE_COOKIES`の値がタイプミス。受け付けるのは`true`/`false`・`1`/`0`・`yes`/`no`・`on`/`off`(大文字小文字は不問)。Secureが黙って無効化されるのを防ぐため起動時に停止する仕様 |
| APIのURLでHTMLが返る | SPAフォールバックの除外条件から外れている。`/api/`・`/auth/`配下は除外される(`server/index.js`) |
| テキスト生成が`ai_service_unavailable`で失敗 | `GEMINI_TEXT_API_KEY`が未設定。画像用キーとは別に設定する |
| テキスト生成が「AIサービス側の利用枠」で失敗 | Geminiプロジェクト側のクォータ・請求設定・前払いクレジット・モデル別レート制限を確認する。ユーザー単位の日次上限とは別枠なので、新規ユーザー作成や日付変更では解消しない |
| サーバーが起動せず`GEMINI_TEXT_MODEL must be configured`で失敗 | `GEMINI_TEXT_API_KEY`に対応する`GEMINI_TEXT_MODEL`が未設定 |
| サーバーが起動せず`GEMINI_IMAGE_MODEL must be configured`で失敗 | `GEMINI_IMAGE_API_KEY`に対応する`GEMINI_IMAGE_MODEL`が未設定 |
| 画像生成のUIが出ない | `GEMINI_IMAGE_API_KEY`が未設定(`GET /api/config`が`imageGen:false`を返す) |

## 関連

- 環境変数の一覧: [`.env.example`](../.env.example)
- 永続化の設計: [04-persistence.md](04-persistence.md)
- システム構成: [01-architecture.md](01-architecture.md)
