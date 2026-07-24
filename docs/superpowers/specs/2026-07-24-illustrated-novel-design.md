# 挿絵付き小説化 設計 (08-feature-ideas.md 1.1 サブプロジェクト2)

2026-07-24 承認済み。サブプロジェクト1(場面挿絵生成、[2026-07-24-scene-illustration-design.md](2026-07-24-scene-illustration-design.md))で各GMログエントリに紐づいた挿絵(`log[i].image.imageId`)を、既存の小説化に差し込む。

## 決定事項(ブレインストーミング結果)

- 出力形式: **Markdown + 埋め込みbase64画像**(`![挿絵N](data:image/png;base64,…)`)。1ファイルで自己完結し、既存の `.md` ダウンロード形式と揃える。
- UI: 既存の「小説化」(プレーン `.md`)は不変。**セッションに挿絵が1枚以上ある場合のみ「挿絵付き」ボタンを別途表示**し、押下で挿絵付きMarkdownをダウンロード。
- 挿絵の配置: **マーカー方式**。小説化は地の文を書き直すため元ログと段落の1:1対応が崩れる。挿絵位置を `〈挿絵N〉` マーカーとしてトランスクリプトに埋め込み、モデルに「対応する場面の切れ目に行独立でそのまま残せ」と指示し、生成後に画像へ置換する。

## 現状(前提)

- 小説化: `POST /api/sessions/:id/novelize`(`server/routes/sessions.js`)が `logToTranscript(session.log)` でトランスクリプトを作り、Anthropicで小説化して `textStore` に `novel.md` 保存、メタ(`sessionNovelMetaKey`)に `{ turnCount, updatedAt }` 保存。`GET /api/sessions/:id/novel` が `{ text, stale }` を返す。
- Home画面(`src/screens/Home.jsx` の `handleNovelize`): novelize → getNovel → Blobで `.md` ダウンロード。
- 公開小説: publishルートが `novel.md` を `public/novels/{publicId}/novel.md` へコピーする(該当箇所は実装時に確認)。
- 画像: `imageStore.read(sessionImagePath(userId, sessionId, imageId))` → PNG Buffer。

## コンポーネント

### 1. `server/novelMarkers.js`(純関数、新規)

```
buildTranscriptWithMarkers(log) -> { transcript, imageIds }
```
- `logToTranscript` 相当の PL/GM 行に加え、挿絵を持つGMエントリの**直前**に `〈挿絵N〉` 行(N=1始まりの出現順)を挿入。`imageIds[N-1]` が対応imageId。
- 挿絵が1枚も無ければ `imageIds: []` で従来と同一のトランスクリプト。

```
stripImageMarkers(text) -> string
```
- `/〈挿絵\d+〉/g` を除去し、マーカー行が独立行だった場合は行ごと除去(連続空行は1つに畳む)。

### 2. `server/illustratedNovel.js`(純関数、新規)

```
buildIllustratedMarkdown({ novelText, imageIds, images }) -> string
```
- `images` は `Map<imageId, Buffer|null>`(呼び出し側が事前ロード)。
- 本文中の `〈挿絵N〉` を `![挿絵N](data:image/png;base64,…)` に置換(行独立)。Nが範囲外・画像がnullのマーカーは除去。
- 本文に現れなかったマーカー番号のうちBufferがある画像は、末尾の `## 挿絵` 節にまとめて付す(**取りこぼしゼロ**のフォールバック)。

### 3. `server/routes/sessions.js` 改修

- novelize: `buildTranscriptWithMarkers(session.log)` を使用。`imageIds.length > 0` のときのみシステムプロンプトに追記: 「トランスクリプト中の `〈挿絵N〉` は対応する場面の挿絵挿入位置である。小説本文の対応する場面の切れ目に、各マーカーを一度だけ行独立でそのまま残すこと。」
- 保存: `novel.md` は**マーカー入り**のまま保存。メタに `imageIds` を追加保存(`{ turnCount, updatedAt, imageIds }`)。
- `GET /api/sessions/:id/novel`: `stripImageMarkers` を適用して返す(プレーン `.md` はクリーン)。
- 新規 `GET /api/sessions/:id/novel/illustrated`: novel.md(無ければ404)+ メタ `imageIds` + `imageStore` から `buildIllustratedMarkdown` を組み立て `{ markdown }` を返す。ルーターに `imageStore` を渡す(結線変更)。

### 4. 公開小説のクリーン化

publishルートの小説コピー箇所で、コピー前に `stripImageMarkers` を適用(公開ギャラリーにマーカーを漏らさない)。公開小説への挿絵埋め込みは**スコープ外**。

### 5. クライアント

- `src/api/sessionSyncClient.js`: `getIllustratedNovel(id)` → `GET /api/sessions/:id/novel/illustrated`。
- `src/screens/Home.jsx`: セッションカードに、`s.log?.some(e => e.role === 'gm' && e.image?.imageId)` のときのみ「挿絵付き」ボタンを追加。押下で `novelizeSession → getIllustratedNovel → ダウンロード`(ファイル名 `${sanitizeFilename(title)}-挿絵付き.md`)。既存の二重実行防止(`novelizing`)とエラー表示(`novelizeError`)を共用。stale警告も既存と同様。

## データモデル変更

- 小説メタ(`sessionNovelMetaKey`)に `imageIds?: string[]`。additive、旧メタは空配列扱い。

## エラー処理

- 画像不在(ファイル欠落): そのマーカーは除去、末尾フォールバックにも含めない。
- 小説未生成で illustrated 取得: 404(UIは先にnovelizeを呼ぶため通常発生しない)。
- マーカー欠落・重複: 欠落は末尾フォールバックで救済。重複は最初の1つだけ置換し以降は除去。
- 小説化の既存エラー系(max_tokens打ち切り・空出力・429)は不変。

## テスト方針

- `server/novelMarkers.test.js`: マーカー挿入位置・番号順・imageIds対応、挿絵なしログは従来同等、strip(行除去・本文中置換)。
- `server/illustratedNovel.test.js`: 置換(data URI生成)、範囲外/画像null除去、欠落マーカーの末尾フォールバック、重複マーカー、マーカーなし本文は不変。
- `server/routes/sessions.test.js`(追記): novelizeがマーカー入りnovel.mdとメタimageIdsを保存、GET /novelがマーカー除去済みを返す、GET /novel/illustratedがdata URI入りmarkdownを返す/404。
- publishテスト(追記): 公開小説にマーカーが含まれない。
- `src/api/sessionSyncClient.test.js`(追記): URL/メソッド。
- `src/screens/Home.test.jsx`(追記): 挿絵ありセッションのみ「挿絵付き」ボタン表示、押下でダウンロード経路。

## スコープ外

- 公開ギャラリーでの挿絵付き小説表示(公開はマーカー除去のプレーン本文のまま)。
- キャラポートレート+参照画像(サブプロジェクト3)。
