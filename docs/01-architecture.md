# アーキテクチャ

## 実行構成

```text
React + Vite (src/)  ── HTTP ──>  Express (server/)
       │                                │
 IndexedDB                         Gemini / Gemini Image
       │                                │
       └──── ログイン時の同期 ──── 永続化層 ─── filesystem または SQLite
                                                画像: filesystem または S3
```

- 開発時は Vite が画面を配信し、`/api` と `/auth` を Express へプロキシする。
- 本番時は Express が `STATIC_DIR` のビルド済み画面を同一オリジンで配信する。
- `src/App.jsx` が hash ルート、認証状態、ローカルセッションとサーバー同期を統合する。

## クライアント

- `src/screens/`: ホーム、素材、公開ギャラリー、記録、セットアップ、ソロ／Party プレイ
- `src/api/`: API クライアント、生成プロンプト、構造化出力の正規化、同期
- `src/engine/`: ダイス、Ruleset アダプタ、実績
- `src/storage/`: ソロセッションの IndexedDB キャッシュ

## サーバー

- `server/index.js`: ミドルウェアと各 API ルーターの組み立て
- `server/routes/`: 認証済み API。セッション、Party、素材、公開、添付、挿絵、生成を扱う
- `server/auth/`: OAuth、セッション Cookie、利用量制限
- `server/persistence/`: ドライバー非依存のリポジトリ契約
- `server/storage/` と `server/infrastructure/`: filesystem、SQLite、S3 実装

未認証で読めるのは認証プロバイダ情報、公開コンテンツ、機能設定だけ。他の `/api` は認証、Origin 検査、容量保護の後に処理する。

## 外部サービス

- Gemini テキストモデル: GM ターン、シナリオ分析・生成、キャンペーン、ノベル化
- Gemini 画像モデル: 場面挿絵。画像用 API キーとモデル未設定時は機能を公開しない
- OAuth: Google、Discord、X。設定済みプロバイダだけを有効化する

## 稼働確認

- `GET /live`: プロセスの liveness
- `GET /ready`: 永続化ドライバー、マイグレーション状態、保守モードを含む readiness
