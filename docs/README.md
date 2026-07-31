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
- ダイス判定あり(判定式アダプタ(`getAdapter`)により`formula`ごとにsimple/coc7e/dnd5e/gurpsの判定式を切り替え。実装済み。CoC7e風はSAN(正気度)副作用も持つ。詳細は03-gm-logic.md・07-risks-and-roadmap.md 10.1節参照)
- シナリオ既存読み込み / AI自動生成の両対応
- Vite+Reactのフロントエンドと軽量プロキシサーバー(Express)から成るWebアプリとして動作
- 実装済み: 素材ライブラリ(World/Character/Scenario/Rulesetの保存・再利用)、成長ポイント(growthUnit/xp)、セッションログの小説化書き出し

## 目次

- [01-architecture.md](01-architecture.md) — システム構成・デプロイ形態
- [02-data-model.md](02-data-model.md) — データモデル(キャラクターシート/世界観/state/ストレージ構造)
- [03-gm-logic.md](03-gm-logic.md) — GMロジック(ターン処理フロー)・判定システム
- [04-persistence.md](04-persistence.md) — 状態管理・永続化
- [05-ui-ux.md](05-ui-ux.md) — UI/UX方針・演出方針・起動直後のUI
- [06-content-generation.md](06-content-generation.md) — シナリオ自動生成・世界観分割/インポート・活用方針
- [07-risks-and-roadmap.md](07-risks-and-roadmap.md) — 留意点・リスク一覧・実装フェーズ計画・設計決定事項
- [08-feature-ideas.md](08-feature-ideas.md) — 機能アイデア集(楽しさ向上・未着手候補の整理)
- [09-deployment.md](09-deployment.md) — デプロイ手順(Render)・本番運用メモ

## 設計草案

- [プレイ結果適応型キャンペーン継続・次話生成](superpowers/specs/2026-08-01-adaptive-campaign-continuation-design.md) — 章終了時の正史更新、次話候補、Scenario生成
- [同時参加型パーティセッション](superpowers/specs/2026-08-01-party-session-design.md) — 複数PC同時入力、PC別視点、離席・再接続、行動衝突
