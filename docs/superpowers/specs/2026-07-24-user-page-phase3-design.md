# ユーザーページ (Phase 3) 設計書

作成日: 2026-07-24

## 背景

Phase 1(認証)・Phase 2(共有)完了を受けた最終フェーズ。「他の人から見えるページで、共有済みの小説/シナリオ/キャラクター/世界観を表示する」を実装する。公開アイテムのメタは既に `ownerId`/`ownerName` を持つ(Phase 2)。

## 確定した要件

- **共有可能なURL**: ハッシュルーティング `#/u/{userId}`。ルーターライブラリ・サーバーSPAフォールバックは導入しない
- **プロフィール**: 表示名 + アバター + 自己紹介文(bio、新規追加) + 共有物一覧
- 全登録ユーザーがページを持つ(公開アイテムのみ表示、なければ空一覧)。公開ON/OFFトグルは作らない(個人情報が出ないため)
- 未ログインでも閲覧可(Phase 1の方針を継承)。インポートはログイン必須(Phase 2の挙動を継承)

## アプローチ選定

- **ルーティング**: 軽量ハッシュルーターフック(`useHashRoute`)を自作。react-router等は1ルートにはオーバースペックのため不採用
- **一覧API**: 既存 `listPublic(type)` を `ownerId` でフィルタ。per-userの公開インデックス新設は早すぎる最適化のため不採用(必要になったら追加)

## 1. データモデル

- ユーザーモデルに `bio: string`(既定 `''`)を追加
  - `findOrCreateUser` の新規作成時に `bio: ''` を設定
  - 既存ユーザーは読み出し時に `bio ?? ''` で補完(マイグレーション不要)
- 新しい保存キーはなし

## 2. API

### 公開読み取り(認証不要 — 既存の公開ルーター群と同じ扱い)

```
GET /api/users/:userId         → 200 { id, displayName, avatarUrl, bio } / 404
GET /api/users/:userId/public  → 200 { worlds: [...], characters: [...], scenarios: [...], novels: [...] }
```

- `/public` は各typeの `listPublic` を `ownerId === userId` でフィルタ(publishedAt降順のまま)。プロフィール存在チェック後、公開物ゼロは空配列
- `:userId` は `idParamGuard`。未知ユーザーは両エンドポイントとも404
- 公開プロフィールは `{ id, displayName, avatarUrl, bio }` のみ返す(`createdAt`/`updatedAt` は露出しない)

### プロフィール編集(既存 PATCH /api/me を拡張)

- `bio` を受け付ける: 文字列、trim後500字まで(空文字OK)。型不正・超過は400
- `GET /api/me` のuserオブジェクトに `bio` が含まれる(モデル追加により自然に)

## 3. ハッシュルーティング

`src/router/useHashRoute.js`(新規):

- `useHashRoute(): { userId: string | null }` — `location.hash` を `#/u/{userId}` の正規表現でパースし、`hashchange` を購読して追従。マッチしなければ `userId: null`
- `navigateToUser(userId)` — `location.hash = '#/u/' + userId`
- `clearHash()` — ハッシュをリロードなしに除去し、購読者へ変更を通知する。注意: `history.pushState`/`replaceState` は `hashchange` を発火しないため、除去後に `hashchange` イベントを手動dispatchする(か、`location.hash = ''` 方式の場合はURL末尾に `#` が残る点を許容するかを実装時に選ぶ。前者を推奨)
- App: `userId` 非nullなら `<UserPage userId={userId} />` を最優先レンダリング。既存の `view` state は温存し、ユーザーページを閉じる(clearHash)と従来のviewへ戻る

## 4. ユーザーページ UI

`src/screens/UserPage.jsx`(新規):

- ヘッダー: アバター(なければ頭文字丸)+ 表示名 + bio(改行保持、whiteSpace: pre-wrap)。「← 戻る」ボタン(clearHash)
- 本体: Galleryと同じ4タブ(小説/世界観/キャラクター/シナリオ)。データは `GET /api/users/:userId/public` を1回取得し、タブ切替はクライアント側
- カードクリック → 公開詳細表示。詳細表示とインポートUIはGalleryから共有コンポーネント **`src/components/share/PublicItemDetail.jsx`** に抽出し、Gallery/UserPage両方が使う(Phase 2レビューで指摘された表示重複もこの抽出で整理する)
- 状態: ローディング / 未知ユーザー「ユーザーが見つかりません」 / 空一覧「まだ公開されたものがありません」 / 取得失敗表示
- 未ログイン閲覧可。「ライブラリに追加」はログイン案内(PublicItemDetailの既存挙動)

## 5. 導線

- **Gallery**: 一覧カードと詳細の作者名をリンク化 → `navigateToUser(item.ownerId)`(カード内クリックは `stopPropagation` で詳細遷移と分離)
- **AuthBar**: ログイン中メニューに「自分のページ」(`navigateToUser(user.id)`)。プロフィール編集モーダルに bio の textarea を追加(保存は `patchMe({ bio })`)
- **UserPage内**: 作者名リンクは出さない(本人のページのため)

## 6. エラーハンドリング

- 未知ユーザー: API 404 → UserPageは「ユーザーが見つかりません」+ 戻るボタン
- 公開物取得失敗: エラーメッセージ表示(既存 `apiFetch` の文言)
- 不正ハッシュ(`#/u/` の後が空・不正文字): `useHashRoute` はマッチさせず `null`(通常画面のまま)

## 7. テスト戦略(既存パターン踏襲)

- **サーバー**: `GET /api/users/:userId`(200のフィールド最小性・404)/ `/public`(他ユーザーの公開物が混ざらない・空配列・404)/ 認証不要で200(統合)/ `PATCH /api/me` のbioバリデーション(境界500字・型不正400)/ `findOrCreateUser` のbio既定値
- **クライアント**: `useHashRoute`(パース・hashchange・navigate・clear)/ UserPage(表示・タブ・空状態・未知ユーザー・未ログイン時のインポート案内)/ PublicItemDetail抽出後のGallery回帰(既存Galleryテストが通ること)/ AuthBarのbio編集・「自分のページ」導線 / Galleryの作者リンク

## スコープ外

- bio以外のプロフィール項目(SNSリンク、ヘッダー画像等)
- フォロー・通知機能
- ユーザー検索・ユーザー一覧
- 公開プロフィールのON/OFFトグル
- パスルーティング / サーバーSPAフォールバック
