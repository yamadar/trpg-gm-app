# 状態管理・永続化

## クライアント側(IndexedDB)

- ブラウザのIndexedDBでセッション跨ぎ保存する。`sessions`という1つのobject store(キー: session id)にセッション全体を保存する。
- localStorage/sessionStorageではなくIndexedDBを採用する理由:
  - localStorageとsessionStorageは容量上限がほぼ同じ(数MB程度)であり、sessionStorageに容量面の優位性はない
  - sessionStorageはタブを閉じると消えるため、「続きから再開」機能と両立しない
  - 将来的に画像等のバイナリデータを扱う計画があり、IndexedDBならBlobを直接扱え容量上限も大きい
- 一覧表示(ホーム画面の「続きから再開」)はIndexedDBの`getAll()`で全セッションを取得し`updatedAt`降順にソートして使う。専用の索引(旧`sessions_index`)は持たない。
- スキーマバージョン管理: session内に`schema_version`を持たせ、将来の移行に対応(未実装、Phase以降で必要になれば追加)。

## サーバー側(dataStore / textStore)

- サーバーはJSON向けの`dataStore`とテキスト(Markdown等)向けの`textStore`という2つの抽象インターフェースを持つ。現状はどちらもローカルファイルシステム実装。
  - `dataStore`: 将来Redis等のキーバリューストアへの差し替えを想定
  - `textStore`: 将来S3等のクラウドストレージへの差し替えを想定
- Sessionsは`dataStore`経由で`sessions/{id}`キーに保存され、`GET /api/sessions`・`GET /api/sessions/:id`・`PUT /api/sessions/:id`で読み書きできる。ただしフロントエンドから自動的にこのAPIへ同期する配線は現時点では行っていない(IndexedDBのみで完結)。
- World/Character/Scenario/Rulesetについては、`server/storage/paths.js`でキー生成関数のみ用意されており(データモデルは[02-data-model.md](02-data-model.md)の3.5節相当のフォルダ構造に対応)、実際の保存API配線は未実装。
