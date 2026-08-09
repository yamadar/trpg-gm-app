# 開発・デプロイ

## 開発

```sh
npm ci
cp .env.example .env
npm run dev
```

Vite は `http://localhost:5173`、Express は `http://localhost:8787`。テストは `npm test`、本番用ビルドは `npm run build`、ローカル本番起動は `STATIC_DIR=dist npm start`。

`.env.example` を設定値の正本とする。ローカルの `.env` と本番の秘密情報は Git に入れない。

## 必須設定

- `BASE_URL`: 外部公開 URL。OAuth callback と Origin 検査の基準
- `GEMINI_TEXT_API_KEY` と `GEMINI_TEXT_MODEL`: テキスト生成を使う場合
- 認証・サーバー同期を使う場合は、少なくとも一つの OAuth プロバイダの Client ID / Secret
- `DATA_DIR`: 永続データの保存先

任意設定:

- `GEMINI_IMAGE_API_KEY` と `GEMINI_IMAGE_MODEL`: 場面挿絵
- `DATABASE_DRIVER=filesystem|sqlite`、`SQLITE_PATH`
- `OBJECT_STORAGE_DRIVER=filesystem|s3` と S3 接続情報
- `SECURE_COOKIES`、`MAINTENANCE_MODE`、各 `LIMIT_*`、容量制限

HTTPS では `SECURE_COOKIES=true` を使う。S3 は SQLite と組み合わせる。

## Render

`render.yaml` は Node 24.15.0、`npm ci && npm run build`、`NODE_ENV=production npm start`、`/ready` health check を設定する。永続ディスクを使う構成は 1 インスタンスで動かす。Render の環境変数欄に `BASE_URL`、Gemini、OAuth、必要なストレージ設定を入力する。

デプロイ後は以下を確認する。

```sh
curl -fsS https://<host>/live
curl -fsS https://<host>/ready
```

`/ready` は保守モード中または永続化が未準備なら 503 を返す。SQLite 運用では定期的に `npm run backup:sqlite` を実行し、出力の整合性結果を保管する。
