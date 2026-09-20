# 状態管理・永続化

## クライアント

ソロセッションは IndexedDB に保存する。未ログインでも保存済みの内容を閲覧できる。進行にはログインが必要。ログイン時はサーバーのセッション一覧と照合し、取得した更新をローカルへ反映する。競合した保存は競合モーダルで扱う。

## サーバー

`createPersistence` が以下の組み合わせを構成する。

| 領域 | filesystem | SQLite |
| --- | --- | --- |
| 構造化・テキストデータ | `DATA_DIR` 配下のストア | SQLite リポジトリ |
| 画像 | `MEDIA_DIR` の filesystem | filesystem または S3 |
| 容量・メディア台帳・ジョブ | ファイルストア | SQLite リポジトリ |

`OBJECT_STORAGE_DRIVER=s3` は durable なメディア台帳が必要なため `DATABASE_DRIVER=sqlite` と組み合わせる。SQLite のスキーマは起動時に適用され、`/ready` が適用状態を報告する。

## 保護と整合性

- 認証済みユーザーを所有者として、保存容量と空き容量をリクエスト前に確認する
- SQLite ではトランザクションとメディア台帳でデータ・画像の整合性を管理する
- Party はサーバーでリビジョン管理し、読み取り時に参加者向けへ投影する
- `MAINTENANCE_MODE=read-only` は OAuth callback 以外の書き込みを 503 で停止する

## 管理コマンド

- `npm run backup:sqlite`: SQLite の整合性確認付きバックアップ
- `npm run migrate:sqlite`: filesystem データを SQLite へ移す
- `npm run migrate:media:s3`: filesystem 画像を S3 へ移す
- `npm run seed`: スターターコンテンツを登録する

各移行は対象環境のバックアップを取得してから一度だけ実行する。通常運用で繰り返さない。

## 同期と読み取り量

ホームの定期同期は`GET /api/sessions?summary=1`でID・タイトル・更新時刻・同期リビジョンだけを取得し、新規または更新のあるセッションだけ個別取得する。SQLiteでは本文をJavaScriptへ展開せずSQLで一覧項目を投影する。既存クライアント向けの通常一覧APIは全文取得を維持する。

保存するソロセッションは12 MiBまで。JSONリクエストの受信上限は16 MiB。AI呼び出しでは全ログ・画像情報・pendingTurnを送らず、プロンプトに必要な設定とstateだけを送る。AI入力のセッション上限1 MiBは維持する。

小説ジョブ一覧は`textStore.exists()`で本文の存在を確認する。filesystemではファイルの存在確認、SQLiteでは内容を読み込まない存在照会を行う。
