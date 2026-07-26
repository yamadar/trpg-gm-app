# 場面挿絵の生成 設計 (08-feature-ideas.md 1.1) — サブプロジェクト1

2026-07-24 承認済み。[08-feature-ideas.md](../../08-feature-ideas.md) 1.1「場面挿絵の生成」の**サブプロジェクト1: 画像生成基盤 + Playシーン挿絵 + キャラ見た目の一貫性(テキスト方式)**。

1.1は複数サブシステムを含むため分割する。本specの範囲は基盤(Geminiプロバイダ・バイナリ画像ストア・シーン解析・プロンプト構築・生成/配信ルート)とPlay画面での表示・生成トリガー、および登場人物の見た目をセッション横断で一貫させるテキストベースの仕組み。**スコープ外**: 挿絵付き小説化(サブプロジェクト2)、キャラポートレート生成+参照画像による強い一貫性(サブプロジェクト3)。後続は本specの基盤を再利用する。特に画像を**GMログエントリ毎の`imageId`参照**として持つデータモデルは次サイクルの挿絵付き小説化を、**見た目レジストリ**は参照画像方式(レジストリ項目に`imageId`を足す)を見据えた設計である。

## 決定事項(ブレインストーミング結果)

- 生成タイミング: **既定は手動ボタン**。加えて `session.autoIllustrate` トグルで「シーン変化時に自動生成」をON可能。
- 挿絵の紐付け: **GMログエントリ毎**。地の文の上に表示し、スクロールしても各場面に残る。
- 画像プロバイダ: **Google Gemini**。ネイティブAPI `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`、`responseModalities: ["TEXT","IMAGE"]` 指定、レスポンスの `inlineData`(base64 PNG)を受領。既定モデル `gemini-2.5-flash-image`(env で差し替え可)。
- 画像バイト列はサーバーのファイルに保存し、セッションJSONには参照(`imageId`)のみ持たせる。
- **キャラの見た目の一貫性**: セッション専用の**見た目レジストリ** `session.appearances`(名前→見た目文)を持ち、登場キャラの見た目を画像プロンプトに毎回差し込むテキスト方式。PCはシート記載を優先、NPC等の未記載キャラは初登場時に生成して固定。**シナリオ本文は書き換えない**(公開・インポートされる共有素材のため)。

## 現状(前提)

- 認証は導入済み。`/api/*` は `createRequireAuth` 後に `req.userId` が付く(`server/index.js`)。
- セッションはクライアントのIndexedDB(`src/storage/index.js`)→ `PUT /api/sessions/:id`(`server/routes/sessions.js`)でサーバーにJSON保存(`users/{userId}/sessions/{sessionId}`)。**セッションはクライアントが真実源**で、サーバーはクライアントのPUTを保存するのみ。
- 小説は `textStore`(UTF-8専用、`server/storage/textStore.js`)で `novel.md` 保存。**バイナリ保存の仕組みは無い**。
- Anthropicプロキシ `/api/messages` は `usage.consume(req.userId, 'messages')` で日次制限。`usage` 機構は `server/auth/usage.js`、上限は `server/index.js` の `createUsage({ limits })` で定義。構造化出力の前例は `TURN_OUTPUT_FORMAT`(`src/api/prompts.js`)。
- `express.json({ limit: '2mb' })`。画像バイトはリクエストJSONに載せない(クライアントは `logIndex` のみ送る)ため上限に触れない。
- `moods` は固定8種(`src/constants/moods.js` の `MOODS`)。`session.moods` はセッションに継承済み。PCシートは `session.pc.raw`。

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

### 2. `server/sceneAnalysis.js`(登場人物特定+見た目生成、Anthropic呼び出し)

```
analyzeScene({ narrative, registry, pcRaw, apiKey, fetchImpl = fetch }) -> { presentNames: string[], newAppearances: [{ name, description }] }
```

- Anthropicの `/v1/messages` を構造化出力(`output_format` の json_schema、`TURN_OUTPUT_FORMAT` に倣う)で呼ぶ。`model: 'claude-sonnet-5'`、`max_tokens` は小さめ(例2000)、`AbortSignal.timeout`。
- system: 「この場面の地の文に登場する人物を挙げよ。既知キャラ一覧(名前+見た目)に無い人物が登場する場合のみ、世界観・文脈に沿った簡潔な見た目(髪・服装・特徴)を新規に考案せよ。既知キャラの見た目は変更しない。PCシートに見た目の記述があればそれを優先。JSONで出力」。
- user: 地の文 + 既知レジストリ(`registry` の名前→見た目)+ トリムしたPCシート(`pcRaw` 先頭〜約600字)。
- 出力: `presentNames`(この場面に登場する人物名。既知/新規の両方)、`newAppearances`(レジストリ未登録で新たに固定した人物のみ)。
- **地の文はプレイヤー可視**でありGM秘匿漏れの懸念なし。見た目は視覚情報のみ。
- 失敗時: throwせず `{ presentNames: [], newAppearances: [] }` を返す(挿絵生成自体は止めず、見た目条件なしで続行=非致命)。呼び出し側はこの空返りを許容する。

### 3. `server/imagePrompt.js`(プロンプト構築、純関数)

```
buildImagePrompt({ narrative, moods, appearances }) -> string
```

- ベース画風(全挿絵で一貫): 例「atmospheric digital illustration, detailed, cinematic lighting, no text, no speech bubbles」。
- `moods[0]`(先頭の既知mood)を画風キーワードにマップ(8種 + 既定)。例: ホラー→"dark, ominous, unsettling horror mood" / 冒険→"epic adventurous fantasy" / ミステリー→"moody noir, muted tones" / 日常→"warm slice-of-life" / SF→"sci-fi, cool tones, futuristic" / ファンタジー→"high fantasy, painterly" / コメディ→"bright cheerful" / シリアス→"somber, desaturated"。未知/空は既定(ニュートラル)。
- `appearances`: この場面に**登場する人物の見た目文のみ**(`{ name, description }[]`)を「登場人物: 名前=見た目, ...」の形で差し込む。全キャストではなく登場者に絞りプロンプトを短く保つ。空配列でも可。
- `narrative` は先頭〜約400字にトリムして場面描写として与える。
- 空 narrative・空 appearances でも例外を投げず、ベース画風のみのプロンプトを返す。

### 4. `server/storage/imageStore.js`(バイナリストア、新設)

textStoreがUTF-8専用のため、Buffer入出力の小さなストアを追加する(fs、tmp+renameでアトミック書き込み)。

```
createFsImageStore(rootDir) -> {
  write(p, buffer): Promise<void>   // mkdir -p, tmp+rename
  read(p): Promise<Buffer|null>     // ENOENT時はnull
  delete(p): Promise<void>          // ENOENTは無視
  deleteDir(prefix): Promise<void>  // rm -rf(セッション削除カスケード用)
}
```

- `server/index.js` の `createApp` 内で `createFsImageStore(dataDir)` を生成。
- パス定数を `server/storage/paths.js` に追加:
  - `sessionImageDir(userId, sessionId)` → `users/${userId}/sessions/${sessionId}/images`
  - `sessionImagePath(userId, sessionId, imageId)` → `users/${userId}/sessions/${sessionId}/images/${imageId}.png`

### 5. `server/routes/sceneImages.js`(生成・配信)

`createSceneImagesRouter({ dataStore, imageStore, anthropicApiKey, geminiApiKey, geminiModel, fetchImpl = fetch, usage })`

- `router.param('id', idParamGuard)`。
- **`POST /api/sessions/:id/images`** — body `{ logIndex: number }`
  1. `geminiApiKey` 未設定 → 501 `{ error: 'image generation is not configured' }`。
  2. セッション取得(`dataStore.get(sessionKey(userId, id))`)、無ければ404。
  3. `logIndex` 検証: 整数かつ `session.log[logIndex]?.role === 'gm'` でなければ400。
  4. `usage.consume(userId, 'images')`。`!ok` → 429 `{ error: 'daily limit reached', resetAt }`。
  5. `analyzeScene({ narrative: log[logIndex].text, registry: session.appearances || {}, pcRaw: session.pc?.raw, apiKey: anthropicApiKey })`(キー未設定や失敗時は空返り=見た目条件なし)。
  6. 現レジストリ + `newAppearances` から `presentNames` に該当する見た目のみ集めて `buildImagePrompt({ narrative, moods: session.moods, appearances })`。
  7. `generateImage({ prompt, apiKey: geminiApiKey, model: geminiModel, fetchImpl })` を try/catch。失敗 → 502。
  8. `imageId = 'img_' + Date.now() + '-' + rand4`。base64をBufferにデコードし `imageStore.write(sessionImagePath(...), buf)`。
  9. `res.json({ imageId, newAppearances })`。**セッションJSON(`entry.image`・`appearances`)の更新はクライアントが行う**(セッションはクライアントが真実源。サーバーが書き換えるとクライアントのPUTと競合する)。
- **`GET /api/sessions/:id/images/:imageId`**
  1. `:imageId` に専用guard: `/^img_[A-Za-z0-9-]+$/` でなければ400(パストラバーサル防止)。
  2. `imageStore.read(sessionImagePath(userId, id, imageId))`。null → 404。
  3. `Content-Type: image/png`、`Cache-Control: private, max-age=31536000, immutable`(imageIdは不変)でBuffer送信。
  4. 所有者のみ: パスに `userId` が含まれるため他者の画像は取得不可。

### 6. `GET /api/config`(公開、機能検出)

`createConfigRouter({ imageGenEnabled })` → `GET /api/config` → `{ imageGen: <boolean> }`。認証不要(requireAuth より前にマウント)。`imageGenEnabled = !!geminiApiKey`。

### 7. サーバー結線(`server/index.js`)

- env: `geminiApiKey = env.GEMINI_API_KEY`、`geminiModel = env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image'`。
- `createUsage` の `limits` に `images: parseLimit(env.LIMIT_IMAGES_PER_DAY, 30)` を追加。
- `app.use('/api', createConfigRouter({ imageGenEnabled: !!geminiApiKey }))` を requireAuth の**前**。
- `app.use('/api', createSceneImagesRouter({ dataStore, imageStore, anthropicApiKey: apiKey, geminiApiKey, geminiModel, fetchImpl, usage }))` を requireAuth の**後**。
- `.env.example` に `GEMINI_API_KEY=`、`GEMINI_IMAGE_MODEL=gemini-2.5-flash-image`、`LIMIT_IMAGES_PER_DAY=30` を追記。

### 8. クライアント

- `src/api/sceneImageClient.js`:
  - `generateSceneImage(sessionId, logIndex)` → `POST /api/sessions/:id/images`、`{ imageId, newAppearances }` を返す(`apiFetch` 使用)。
  - `sceneImageUrl(sessionId, imageId)` → `/api/sessions/${enc}/images/${enc}`(同一オリジン・httpOnly cookieで自動認証されるため `<img src>` で直接使える)。
  - `getConfig()` → `GET /api/config`。
- `src/screens/Play.jsx`:
  - マウント時に一度 `getConfig()` を呼び `imageGen` を保持(不可なら挿絵UIを一切出さない)。
  - GMログエントリ描画に挿絵ブロックを追加。`entry.image?.imageId` があれば `<img src={sceneImageUrl(...)}>` を地の文の**上**に表示(`max-width:100%`, 角丸, `theme.js` の枠色, `onError` で非表示)。
  - 未生成のGMエントリに「この場面を描く」ボタン(`imageGen` 時のみ)。押下で当該エントリを生成。生成中は当該エントリにスピナー。成功で `entry.image = { imageId }` を書き込み、`newAppearances` を `session.appearances` にマージし、`saveSession` + `putSessionToServer`。失敗時は当該エントリにインラインエラー(429は上限メッセージ、それ以外は汎用)。imageId・appearancesは失敗時保存しない。
  - 自動トグル: ヘッダ付近に `autoIllustrate` トグル(`imageGen` 時のみ)。ON+`current_scene` が前ターンから変化したターンで、新GMエントリの生成を自動発火(手動と同じ経路)。トグル状態は `session.autoIllustrate` に保存しPUT同期。
  - 自動発火の最小間隔: `current_scene` はGMが毎ターン自由記述するため、同じ場面でも言い回しが揺れて「変化」と判定されうる。プロンプト側で「場面が続く間は同じシーン名をそのまま返す」ことを指示したうえで、クライアントでも直近の自動発火から `AUTO_ILLUSTRATE_MIN_TURNS`(3ターン)空くまでは再発火しない。手動ボタンはこの制限を受けない。
  - サーバー同期の先行: 画像APIは**サーバーに保存済み**のログで `logIndex` を検証する。ターン完了時の `putSessionToServer` は投げっぱなしのため、直後に画像を要求すると新GMエントリが未着で400になる。生成経路(手動・自動とも)は `putSessionToServer` の完了を待ってから `POST /images` を呼ぶ。
  - 同時実行防止: エントリ単位の生成中フラグ(`generatingIndex` 等)で二重発火を防ぐ。挿絵生成はクライアント側で直列化されるため、`session.appearances` を読むサーバー解析が前回結果を反映済みであることが保たれる。

## データモデル変更

- GMログエントリ(`session.log[i]`、`role==='gm'`)に任意 `image?: { imageId: string }`。
- セッションに任意 `autoIllustrate?: boolean`。
- セッションに任意 `appearances?: { [name: string]: { name: string, description: string } }`(見た目レジストリ。将来 `imageId?` を追加して参照画像方式へ拡張)。
- いずれもadditive。旧セッションは各フィールド無し=挿絵なし/自動オフ/レジストリ空。移行不要。

## エラー処理・非機能

- Geminiキー未設定: `GET /api/config` が `imageGen:false` → Play は挿絵UIを出さない。直接 `POST` は501。
- シーン解析失敗(Anthropicエラー/キー無し): 非致命。見た目条件なしで画像生成を続行。
- 画像生成失敗/タイムアウト: 502、当該エントリにインラインエラー、imageId保存せず。
- 日次上限: 429(挿絵1回=解析1+画像1の計2 upstream呼び出しを1ユニットとして計上)。
- 画像不在(GET): 404。imgは `onError` で静かに欠落。
- パストラバーサル: `:id` は `idParamGuard`、`:imageId` は専用guard。
- 画像サイズ: 1024pxのPNGは概ね1〜2MB。サーバーがBufferにデコードしファイル保存、GETでストリーム。クライアント→サーバーJSONには載らない。

## テスト方針(既存 vitest + supertest パターン)

- `server/imageProvider.test.js`: mock fetch。正常(inlineData解析)、画像part無し→throw、`!ok`→throw、mimeType既定。
- `server/sceneAnalysis.test.js`: mock fetch。既知キャラは`newAppearances`に出さない、未知キャラの見た目生成、`presentNames`抽出、Anthropicエラー時に空返り(throwしない)、キー未設定で空返り。
- `server/imagePrompt.test.js`: 8種moodで画風キーワードを含む、未知/空mood=既定、appearances差し込み(登場者のみ)、narrativeトリム、空入力で例外なし。
- `server/storage/imageStore.test.js`: Buffer write/read往復、read不在=null、delete、deleteDir。
- `server/routes/sceneImages.test.js`(supertest): POST成功(mockプロバイダ/解析で`{imageId,newAppearances}`、ファイル生成)、キー未設定=501、logIndex不正=400、上限=429、解析失敗でも画像生成は成功、GETがPNG/正しいContent-Typeを返す、GET不在=404、不正imageId=400、他ユーザーの画像は取得不可。
- `server/routes/config.test.js`: `imageGen` フラグ反映。
- `src/api/sceneImageClient.test.js`: 各関数のURL・メソッド。
- `src/screens/Play.test.jsx`: `imageGen:false` で挿絵UI非表示、ボタン→POST→img描画、成功時に`appearances`マージ保存、生成失敗でエラー表示・非保存、`entry.image`済みエントリはimg表示、自動トグルのシーン変化時発火。既存の演出テスト(タイプライター/スタンプ)が壊れないこと。

## 実装順(概略)

1. `imageStore` + paths 定数
2. `imageProvider`
3. `sceneAnalysis`
4. `imagePrompt`(appearances対応)
5. `sceneImages` ルート + `config` ルート + `server/index.js` 結線 + `.env.example`
6. `sceneImageClient`
7. Play統合(表示→手動ボタン→appearancesマージ→自動トグル)
8. docs更新(05-ui-ux.md, 06-content-generation.md, 07-risks-and-roadmap.md Phase 3, 08-feature-ideas.md 1.1)
