# デプロイ手順(Render)

Renderの **Web Service + Persistent Disk** で公開する手順。所要時間は初回で30〜60分程度。

## なぜこの構成か

このアプリは以下の制約を持つため、永続ディスクを1インスタンスに接続できるPaaSが必要になる。

- サーバー側の永続化(`server/storage/dataStore.js` / `textStore.js` / `imageStore.js`)は**ローカルファイルシステム実装**で、`rename`によるアトミック書き込みと`readdir`による一覧に依存している。ユーザー添付画像とプロフィール画像も同じ永続ディスクへ保存する。オブジェクトストレージへ直接置き換えることはできない。
- ユーザー添付画像は`sharp`でWebP変換する。`npm ci`が対象環境向けネイティブバイナリを導入するため、依存を本番で省略しない。
- ディスクを共有する複数インスタンス構成は想定していない(ロック機構なし)。**必ず1インスタンスで運用する**。
- `POST /api/messages`はGemini APIの応答を非ストリーミングで待つ(`server/routes/messages.js`・`server/textProvider.js`)ため、1リクエストが数十秒に達する。短いリクエストタイムアウトを持つ実行環境では動作しない。
- OAuthのredirect_uri(`${BASE_URL}/auth/{provider}/callback`)とCSRF目的のOrigin検証が`BASE_URL`基準のため、**固定ドメイン**が必要。

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
| Health Check Path | `/api/config` |

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
| `BASE_URL` | `https://<サービス名>.onrender.com`(末尾スラッシュなし) | ✅ |
| `GEMINI_TEXT_API_KEY` | Google AI Studioのテキスト生成用キー | ✅ |
| `GEMINI_TEXT_MODEL` | 使用するテキスト生成モデルID | ✅ |
| `GEMINI_IMAGE_API_KEY` | Google AI Studioの画像生成用キー | 任意(挿絵機能) |
| `GEMINI_IMAGE_MODEL` | 使用する画像生成モデルID | `GEMINI_IMAGE_API_KEY`設定時に必須 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuthアプリの資格情報 | プロバイダごとに任意(合計1つ以上必須) |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | 同上 | 同上 |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | 同上 | 同上 |
| `LIMIT_MESSAGES_PER_DAY` | 既定`200` | 任意 |
| `LIMIT_NOVELIZE_PER_DAY` | 既定`10` | 任意 |
| `LIMIT_IMAGES_PER_DAY` | 既定`30` | 任意 |

`PORT`はRenderが自動で注入するので設定しない(`server/index.js`が`process.env.PORT`を読む)。

> **コスト上の注意**: AI APIの利用料は**サーバーの鍵で全ユーザー分がオーナーに課金される**。上記3つの`LIMIT_*`はユーザー単位・日次(UTC)の上限で、`登録ユーザー数 × 上限`が理論上の最大支出になる。公開範囲に応じて既定値を下げること。

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
# 1. ヘルスチェック(認証不要)
curl https://<ドメイン>/api/config
# => {"imageGen":true} または {"imageGen":false}

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

**`DATA_DIR`が失われるとユーザー・セッション・素材データがすべて失われる。** ディスクは自動でバックアップされない。

- Renderの **Disks → Snapshots** で定期スナップショットを有効にする(プランにより可否・保持期間が異なる)
- 併せて、Shellから手動でアーカイブを取り、外部に退避する運用を推奨する

```bash
# Renderダッシュボードの Shell タブから
tar czf /tmp/gmdesk-$(date +%Y%m%d).tar.gz -C /data .
```

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
| テキスト生成が`GEMINI_TEXT_API_KEY is not configured`で失敗 | `GEMINI_TEXT_API_KEY`が未設定。画像用キーとは別に設定する |
| テキスト生成が「AIサービス側の利用枠」で失敗 | Geminiプロジェクト側のクォータ・請求設定・前払いクレジット・モデル別レート制限を確認する。ユーザー単位の日次上限とは別枠なので、新規ユーザー作成や日付変更では解消しない |
| サーバーが起動せず`GEMINI_TEXT_MODEL must be configured`で失敗 | `GEMINI_TEXT_API_KEY`に対応する`GEMINI_TEXT_MODEL`が未設定 |
| サーバーが起動せず`GEMINI_IMAGE_MODEL must be configured`で失敗 | `GEMINI_IMAGE_API_KEY`に対応する`GEMINI_IMAGE_MODEL`が未設定 |
| 画像生成のUIが出ない | `GEMINI_IMAGE_API_KEY`が未設定(`GET /api/config`が`imageGen:false`を返す) |

## 関連

- 環境変数の一覧: [`.env.example`](../.env.example)
- 永続化の設計: [04-persistence.md](04-persistence.md)
- システム構成: [01-architecture.md](01-architecture.md)
