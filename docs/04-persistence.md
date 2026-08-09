# 状態管理・永続化

## クライアント

ソロセッションは IndexedDB に保存する。未ログインでも継続できる。ログイン時はサーバーのセッション一覧と照合し、取得した更新をローカルへ反映する。競合した保存は競合モーダルで扱う。

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
