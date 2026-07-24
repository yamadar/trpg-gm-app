# 場面挿絵の生成 設計 (08-feature-ideas.md 1.1) — サブプロジェクト1

2026-07-24 承認済み。[08-feature-ideas.md](../../08-feature-ideas.md) 1.1「場面挿絵の生成」の**サブプロジェクト1: 画像生成基盤 + Playシーン挿絵**。

1.1は複数サブシステムを含むため分割する。本specの範囲は基盤(Geminiプロバイダ・バイナリ画像ストア・プロンプト構築・生成/配信ルート)とPlay画面での表示・生成トリガー。**スコープ外**: 挿絵付き小説化(サブプロジェクト2)、キャラポートレート生成(サブプロジェクト3)。両者は本specの基盤(`imageProvider`/`imageStore`/`imagePrompt`)を再利用する。特に画像を**GMログエントリ毎の`imageId`参照**として持つデータモデルは、次サイクルの挿絵付き小説化(ログ→本文書き直し時に対応場面へ画像を差し込む)を見据えた設計である。

## 決定事項(ブレインストーミング結果)

- 生成タイミング: **既定は手動ボタン**。加えて `session.autoIllustrate` トグルで「シーン変化時に自動生成」をON可能。
- 挿絵の紐付け: **GMログエントリ毎**。地の文の上に表示し、スクロールしても各場面に残る。
- 画像プロバイダ: **Google Gemini**。ネイティブAPI `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`、`responseModalities: ["TEXT","IMAGE"]` 指定、レスポンスの `inlineData`(base64 PNG)を受領。既定モデル `gemini-2.5-flash-image`(env で差し替え可)。
- 画像バイト列はサーバーのファイルに保存し、セッションJSONには参照(`imageId`)のみ持たせる。

## 現状(前提)

- 認証は導入済み。`/api/*` は `createRequireAuth` 後に `req.userId` が付く(`server/index.js`)。
- セッションはクライアントのIndexedDB(`src/storage/index.js`)→ `PUT /api/sessions/:id`(`server/routes/sessions.js`)でサーバーにJSON保存(`users/{userId}/sessions/{sessionId}`)。
- 小説は `textStore`(UTF-8専用、`server/storage/textStore.js`)で `novel.md` 保存。**バイナリ保存の仕組みは無い**。
- Anthropicプロキシ `/api/messages` は `usage.consume(req.userId, 'messages')` で日次制限。`usage` 機構は `server/auth/usage.js`、上限は `server/index.js` の `createUsage({ limits })` で定義。
- `express.json({ limit: '2mb' })`。画像バイトはリクエストJSONに載せない(クライアントは `logIndex` のみ送る)ため上限に触れない。
- `moods` は固定8種(`src/constants/moods.js` の `MOODS`)。`session.moods` はサブプロジェクト直前の実装でセッションに継承済み。

## コンポーネント

### 1. `server/imageProvider.js`(Gemini呼び出しの隔離)

```
generateImage({ prompt, apiKey, model, fetchImpl = fetch }) -> { base64, mimeType }
```

- `POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
- ヘッダ: `Content-Type: application/json`, `x-goog-api-key: ${apiKey}`
- ボディ: `{ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } }`
- `AbortSignal.timeout(120000)`。
- レスポンス解析: `data.candidates[0].content.parts` を走査し、`part.inlineData?.data`(base64)を持つ最初のpartを採用。`mimeType` は `part.inlineData.mimeType`(既定 `image/png`)。
- 画像partが無い/`!upstream.ok` はthrow(呼び出し側が502へ変換)。

### 2. `server/imagePrompt.js`(プロンプト構築、純関数)

```
buildImagePrompt({ narrative, moods }) -> string
```

- ベース画風(全挿絵で一貫): 例「atmospheric digital illustration, detailed, cinematic lighting, no text, no speech bubbles」。
- `moods[0]`(先頭の既知mood)を画風キーワードにマップ(8種 + 既定)。例: ホラー→"dark, ominous, unsettling horror mood" / 冒険→"epic adventurous fantasy" / ミステリー→"moody noir, muted tones" / 日常→"warm slice-of-life" / SF→"sci-fi, cool tones, futuristic" / ファンタジー→"high fantasy, painterly" / コメディ→"bright cheerful" / シリアス→"somber, desaturated"。未知/空は既定(ニュートラル)。
- `narrative` は先頭〜約400字にトリムして場面描写として与える(地の文はプレイヤー可視でありGM秘匿漏れの懸念なし)。
- 空 narrative でも例外を投げず、ベース画風のみのプロンプトを返す。

### 3. `server/storage/imageStore.js`(バイナリストア、新設)

textStoreがUTF-8専用のため、Buffer入出力の小さなストアを追加する(fs、tmp+renameでアトミック書き込み)。

```
createFsImageStore(rootDir) -> {
  write(p, buffer): Promise<void>   // mkdir -p, tmp+rename
  read(p): Promise<Buffer|null>     // ENOENT時はnull
  delete(p): Promise<void>          // ENOENTは無視
  deleteDir(prefix): Promise<void>  // rm -rf(セッション削除カスケード用)
}
```

- `server/index.js` の `createApp` 内で `createFsImageStore(dataDir)` を生成し `app.locals.imageStore` にも入れる。
- パス定数を `server/storage/paths.js` に追加:
  - `sessionImageDir(userId, sessionId)` → `users/${userId}/sessions/${sessionId}/images`
  - `sessionImagePath(userId, sessionId, imageId)` → `users/${userId}/sessions/${sessionId}/images/${imageId}.png`

### 4. `server/routes/sceneImages.js`(生成・配信)

`createSceneImagesRouter({ dataStore, imageStore, apiKey, model, fetchImpl = fetch, usage })`

- `router.param('id', idParamGuard)`。
- **`POST /api/sessions/:id/images`** — body `{ logIndex: number }`
  1. `apiKey` 未設定 → 501 `{ error: 'image generation is not configured' }`。
  2. セッション取得(`dataStore.get(sessionKey(userId, id))`)、無ければ404。
  3. `logIndex` 検証: 整数かつ `session.log[logIndex]?.role === 'gm'` でなければ400。
  4. `usage.consume(userId, 'images')`。`!ok` → 429 `{ error: 'daily limit reached', resetAt }`。
  5. `buildImagePrompt({ narrative: session.log[logIndex].text, moods: session.moods })`。
  6. `generateImage({ prompt, apiKey, model, fetchImpl })` を try/catch。失敗 → 502。
  7. `imageId = 'img_' + Date.now() + '-' + rand4`。base64をBufferにデコードし `imageStore.write(sessionImagePath(...), buf)`。
  8. `res.json({ imageId })`。**セッションJSONへの `image` 付与はクライアントが行う**(サーバーは画像バイトのみ管理。セッションはクライアントが真実源としてPUTするため、サーバー側で書き換えると競合しうる)。
- **`GET /api/sessions/:id/images/:imageId`**
  1. `imageId` 形式検証: `/^img_[A-Za-z0-9-]+$/` でなければ400(パストラバーサル防止。`:imageId` にも専用guardを付ける)。
  2. `imageStore.read(sessionImagePath(userId, id, imageId))`。null → 404。
  3. `Content-Type: image/png`、`Cache-Control: private, max-age=31536000, immutable`(imageIdは不変)でBuffer送信。
  4. 所有者のみ: パスに `userId` が含まれるため他者の画像は取得不可。

### 5. `GET /api/config`(公開、機能検出)

`createConfigRouter({ imageGenEnabled })` → `GET /api/config` → `{ imageGen: <boolean> }`。認証不要(`publicContentRouter` と同様 requireAuth より前にマウント)。`imageGenEnabled = !!apiKey`(GeminiキーはAnthropicキーと別）。

### 6. サーバー結線(`server/index.js`)

- env: `geminiApiKey = env.GEMINI_API_KEY`、`geminiModel = env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'`。
- `createUsage` の `limits` に `images: parseLimit(env.LIMIT_IMAGES_PER_DAY, 30)` を追加。
- `app.use('/api', createConfigRouter({ imageGenEnabled: !!geminiApiKey }))` を requireAuth の**前**に。
- `app.use('/api', createSceneImagesRouter({ dataStore, imageStore, apiKey: geminiApiKey, model: geminiModel, fetchImpl, usage }))` を requireAuth の**後**に。
- `.env.example` に `GEMINI_API_KEY=`、`GEMINI_IMAGE_MODEL=gemini-2.5-flash-image`、`LIMIT_IMAGES_PER_DAY=30` を追記。

### 7. クライアント

- `src/api/sceneImageClient.js`:
  - `generateSceneImage(sessionId, logIndex)` → `POST /api/sessions/:id/images`、`{ imageId }` を返す(`apiFetch` 使用)。
  - `sceneImageUrl(sessionId, imageId)` → `/api/sessions/${enc}/images/${enc}`(同一オリジン・httpOnly cookieで自動認証されるため `<img src>` で直接使える)。
  - `getConfig()` → `GET /api/config`。
- `src/screens/Play.jsx`:
  - マウント時に一度 `getConfig()` を呼び `imageGen` を保持(不可なら挿絵UIを一切出さない)。
  - GMログエントリ描画に挿絵ブロックを追加。`entry.image?.imageId` があれば `<img src={sceneImageUrl(...)}>` を地の文の**上**に表示(`max-width:100%`, `border-radius`, `theme.js` の枠色)。
  - 未生成のGMエントリには「この場面を描く」ボタン(`imageGen` 時のみ)。押下で当該エントリの生成を実行。生成中は当該エントリにスピナー、完了で `entry.image = { imageId }` を書き込み `saveSession` + `putSessionToServer`。失敗時は当該エントリにインラインエラー(429は上限メッセージ、それ以外は汎用)。imageIdは失敗時保存しない。
  - 自動トグル: ヘッダ付近に `autoIllustrate` トグル(`imageGen` 時のみ)。ON+`current_scene` が前ターンから変化したターンでは、新GMエントリの生成を自動発火(手動と同じ経路)。トグル状態は `session.autoIllustrate` に保存しPUT同期。
  - 生成の同時実行防止: エントリ単位で生成中フラグ(`generatingIndex` 等)を持ち、二重発火を防ぐ。

## データモデル変更

- GMログエントリ(`session.log[i]`、`role==='gm'`)に任意フィールド `image?: { imageId: string }` を追加。
- セッションに任意フィールド `autoIllustrate?: boolean`。
- いずれもadditive。旧セッションは `image` 無し=挿絵なし、`autoIllustrate` 無し=false。移行不要。

## エラー処理・非機能

- Geminiキー未設定: `GET /api/config` が `imageGen:false` → Play は挿絵UIを出さない。直接 `POST` されても501。
- 生成失敗/タイムアウト: 502、当該エントリにインラインエラー、imageId保存せず。
- 日次上限: 429、上限メッセージ表示。
- 画像不在(GET): 404。imgは静かに欠落(`onError` で非表示)。
- パストラバーサル: `:id` は `idParamGuard`、`:imageId` は専用guard(`/^img_[A-Za-z0-9-]+$/`)。
- 画像サイズ: 1024pxのPNGは概ね1〜2MB。サーバーがBufferにデコードしファイル保存、GETでストリーム。クライアント→サーバーのJSONには載らない。

## テスト方針(既存 vitest + supertest パターン)

- `server/imageProvider.test.js`: mock fetch。正常(inlineData解析)、画像part無し→throw、`!ok`→throw、mimeType既定。
- `server/imagePrompt.test.js`: 8種moodで画風キーワードを含む、未知/空mood=既定、narrativeトリム、空narrativeで例外なし。
- `server/storage/imageStore.test.js`: Buffer write/read往復、read不在=null、delete、deleteDir。
- `server/routes/sceneImages.test.js`(supertest): POST成功(mockプロバイダで`{imageId}`、ファイル生成)、キー未設定=501、logIndex不正=400、上限=429、GETがPNG/正しいContent-Typeを返す、GET不在=404、不正imageId=400、他ユーザーの画像は取得不可。
- `server/routes/config.test.js`: `imageGen` フラグ反映。
- `src/api/sceneImageClient.test.js`: 各関数のURL・メソッド。
- `src/screens/Play.test.jsx`: `imageGen:false` で挿絵UI非表示、ボタン→POST→img描画、生成失敗でエラー表示・imageId非保存、`entry.image` 済みエントリはimg表示、自動トグルのシーン変化時発火。既存の演出テスト(タイプライター/スタンプ)が壊れないこと。

## 実装順(概略)

1. `imageStore` + paths 定数
2. `imageProvider`
3. `imagePrompt`
4. `sceneImages` ルート + `config` ルート + `server/index.js` 結線 + `.env.example`
5. `sceneImageClient`
6. Play統合(表示→手動ボタン→自動トグル)
7. docs更新(05-ui-ux.md, 06-content-generation.md, 07-risks-and-roadmap.md Phase 3, 08-feature-ideas.md 1.1)
