# TRPG GM App — 現行設計

このディレクトリは、現在の実装を説明する短い参照資料だけを置く。過去の設計判断、実装計画、ロードマップ、レビュー記録は保持しない。正本はコードとテスト。

## アプリ概要

AI が GM として進行する Web TRPG アプリ。ソロセッションと複数人の Party セッション、素材ライブラリ、公開ギャラリー、キャンペーン、エンディング・実績を提供する。テキスト生成は Google Gemini を利用し、場面挿絵は設定時だけ画像モデルを利用する。

## 読む順序

- [01-architecture.md](01-architecture.md) — 実行構成と責務境界
- [02-data-model.md](02-data-model.md) — 保存する主要エンティティと状態
- [03-gm-logic.md](03-gm-logic.md) — ソロ／Party の進行と判定
- [04-persistence.md](04-persistence.md) — IndexedDB、サーバー永続化、同期
- [05-ui-ux.md](05-ui-ux.md) — 画面とナビゲーション
- [06-content-generation.md](06-content-generation.md) — 生成機能とコンテンツ処理
- [12-deployment.md](12-deployment.md) — 開発・本番運用

## 正本

- 挙動: `src/`、`server/`
- 設定値: `.env.example`、`render.yaml`、`package.json`
- 仕様確認: 対応する `*.test.*`
