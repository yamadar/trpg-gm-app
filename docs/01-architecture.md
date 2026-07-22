# アーキテクチャ

## システム構成

```
┌─────────────────────────────────────────┐
│              UI (React)                  │
│  - 入力欄 / 選択肢ボタン / ログ表示エリア   │
│  - 成長ポイント表示(growthUnit/xp)         │
│  (キャラシート表示パネルは未実装。素材      │
│   ライブラリ画面で別途キャラシートを閲覧)   │
└───────────────┬───────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│           Game Engine (JS, ローカル)       │
│  - state管理 (真実源)                       │
│  - ダイスロール実行・判定計算(全Ruleset共通  │
│    のd100成功率%判定。ルール別アダプタは     │
│    未実装・将来案)                          │
│  - AI応答のパース・state反映                 │
│  - 直近ログ(recent_log)は最大12件保持のみ。  │
│    閾値超過での自動圧縮トリガーは未実装      │
│  - IndexedDBへのセッション永続化             │
└───────────────┬───────────────────────────┘
                │ prompt (state + 履歴要約 + プレイヤー入力)
                ▼
┌─────────────────────────────────────────┐
│      プロキシサーバー (Express)             │
│  - Anthropic APIキーの保持・付与             │
│  - /api/messagesは単純な中継のみ             │
│  - 小説化(novelize)は独自プロンプトを組んで   │
│    Anthropicを直接呼び出し、結果を保存する    │
│    ビジネスロジックを持つ                    │
│  - World/Character/Scenario/RulesetのCRUD    │
│    ロジックを持つ(素材ライブラリAPI)         │
│  - dataStore/textStoreによるサーバー側永続化  │
└───────────────┬───────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│         Claude API (GM役)                 │
│  - 地の文生成                              │
│  - NPC発言生成                             │
│  - 判定要求 (tool_use: roll_check)          │
│  - state更新案 (JSON)                       │
└───────────────┬───────────────────────────┘
                │ response (narrative + state_update + choices)
                ▼
        Game Engineがstate確定・UIへ反映
```

**設計原則**: 判定結果・state更新の「確定」は必ずコード側。AIは提案のみ。真実源はAIの中ではなくローカルstate。

## デプロイ形態

- フロントエンド: Vite + ReactによるSPA。ブラウザのIndexedDBにセッションを永続化する(詳細は[04-persistence.md](04-persistence.md))。
- バックエンド: Expressサーバー。Anthropic APIキーをサーバー環境変数として保持し、`/api/messages`はフロントエンドの代わりにAPIを呼び出す単純な中継だが、小説化(novelize)と素材ライブラリ(World/Character/Scenario/Ruleset)のCRUDは独自のビジネスロジックを持つ。サーバー側の永続化抽象化(dataStore/textStore)も担う。
- 開発時は単一の`package.json`から`concurrently`でフロントエンド(Vite dev server)とバックエンド(Express)を同時起動する。
