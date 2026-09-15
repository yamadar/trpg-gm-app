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


## アプリケーションログ

`server/observability.js` から1行1JSONで標準出力へ記録する。RenderではサービスのLogs画面を利用する。ローカルで保存する場合は例えば `npm start > /tmp/gmdesk.log 2>&1`。永続ファイルへリダイレクトする運用では、ホスト側でローテーションと保持期間を設定する。

- `http.completed` / `http.disconnected` / `http.failed`: リクエストID、ルートテンプレート、HTTPステータス、所要時間。レスポンスの `X-Request-ID` と照合できる
- `ai.started` / `ai.completed` / `ai.failed`: モデル、段階、所要時間、入力・出力・思考トークン数（プロバイダが返した場合）、例外型・エラーコード・HTTPステータス
- `party.*`: ラウンドの受付・確定・停止・再開・保存時間。`party.lock_wait` は100ms以上の保存処理待ち
- `party.resolution_started` / `party.resolution_finished` / `party.resolution_failed`: AI GM処理全体。`sessionId`、`roundId`、`resolutionId` を使って各段階の記録を追う

本文、プロンプト、AI応答、Cookie、APIキー、招待トークンを含むクエリ文字列、例外message/stackは記録しない。状態取得から見える問い合わせIDは `resolutionId`。シナリオ本文や他PCの秘密を問い合わせへ添付する必要はない。

例（`jq` がある場合、npm起動メッセージなどJSON以外の行を除外）:

```sh
jq -R 'fromjson? | select(.sessionId == "party_...")' /tmp/gmdesk.log
jq -R 'fromjson? | select(.resolutionId == "resolution_...")' /tmp/gmdesk.log
jq -R 'fromjson? | select(.event == "ai.failed" or .event == "party.resolution_failed")' /tmp/gmdesk.log
```

`ai.completed.durationMs` を planning / narrating ごとに比較してAI待ちを特定する。`party.lock_wait.waitMs` と各遷移の `durationMs` は保存待ちの切り分けに使う。`PARTY_TRUNCATED` は出力上限、`PARTY_INVALID_JSON` は不正JSON、`PARTY_MISSING_PC_VIEW` は個別描写不足、`PARTY_INVALID_RESOLUTION` はPC・Scene等の不正な更新（`reason`で内訳）、`PARTY_SECRET_LEAK_BLOCKED` は秘密境界での拒否。TimeoutErrorや503などは `ai.failed` 側で確認する。

Partyの実行中ジョブとロックは1プロセス内で管理する。複数インスタンスへの水平分割には共有ジョブキューと分散ロックの追加が必要。再起動で中断した処理は次回アクセス時に停止表示へ移し、ホストが保存済みcheckpointから再試行できる。
