# AI-GM型TRPGアプリ 設計ドキュメント

ユーザーとAI(GM)がインタラクティブに物語を紡ぐTRPG型アプリ。
入力: キャラクターシート・世界観・シナリオ。
AI-GMがシナリオに沿って進行、プレイヤーはPCの行動・選択を入力して物語を分岐させる。

## 目的

- 既存TRPGシステムの手動GM負荷をAIで代替
- シナリオ・キャラシートさえ用意すれば誰でもGM役なしでプレイ可能に

## スコープ(MVP)

- 1人プレイヤー、1AI-GM
- テキストベース入出力(自由記述主体、GM側からの二択/Yes-No問いかけを補助的に使用)
- ダイス判定あり(ルールシステム非依存、アダプタ方式)
- シナリオ既存読み込み / AI自動生成の両対応
- Vite+Reactのフロントエンドと軽量プロキシサーバー(Express)から成るWebアプリとして動作

## 目次

- [01-architecture.md](01-architecture.md) — システム構成・デプロイ形態
- [02-data-model.md](02-data-model.md) — データモデル(キャラクターシート/世界観/state/ストレージ構造)
- [03-gm-logic.md](03-gm-logic.md) — GMロジック(ターン処理フロー)・判定システム
- [04-persistence.md](04-persistence.md) — 状態管理・永続化
- [05-ui-ux.md](05-ui-ux.md) — UI/UX方針・演出方針・起動直後のUI
- [06-content-generation.md](06-content-generation.md) — シナリオ自動生成・世界観分割/インポート・活用方針
- [07-risks-and-roadmap.md](07-risks-and-roadmap.md) — 留意点・リスク一覧・実装フェーズ計画・設計決定事項
