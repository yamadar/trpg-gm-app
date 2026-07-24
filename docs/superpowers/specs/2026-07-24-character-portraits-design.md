# セッション内自動ポートレート+参照画像一貫性 設計 (08-feature-ideas.md 1.1 サブプロジェクト3)

2026-07-24 承認済み。サブプロジェクト1の見た目レジストリ(`session.appearances`、テキスト方式)を参照画像方式へ拡張し、キャラの見た目をセッション横断で**強く**一貫させる。

## 決定事項(ブレインストーミング結果)

- スコープ: **(a) セッション内自動ポートレート**。挿絵生成時に初登場キャラのポートレートを自動生成してレジストリに保存し、以降の挿絵生成に参照画像として渡す。ライブラリCharacterタブのポートレート(b)はスコープ外(将来候補)。
- 新規UIなし。ポートレートは挿絵一貫性の裏方として働く(保存先は既存のセッション画像と同じ`imageStore`)。

## 現状(前提)

- `session.appearances: { name: { name, description } }`(SP1)。設計時から `imageId?` 追加を想定済み。
- `POST /api/sessions/:id/images`(`server/routes/sceneImages.js`): analyzeScene → buildImagePrompt → generateImage → PNG保存 → `{ imageId, newAppearances }`。クライアント(`Play.jsx` の `illustrate`)がレジストリへマージし永続化。
- `generateImage`(`server/imageProvider.js`)はテキストプロンプトのみ。Gemini `generateContent` は `contents[0].parts` に `inlineData`(base64画像)を並べることで参照画像入力に対応する。
- 日次上限 `images`: 現状POST 1回=1ユニット。

## 変更設計

### 1. `server/imageProvider.js`

`generateImage({ prompt, apiKey, model, fetchImpl, referenceImages = [] })`。`referenceImages: [{ base64, mimeType }]` を `parts` の**先頭**に `{ inlineData: { data, mimeType } }` として並べ、最後にテキストpart。既存呼び出し(参照なし)は挙動不変。

### 2. `server/imagePrompt.js`

- `buildPortraitPrompt({ name, description, moods })` を追加: 「character portrait, bust shot, plain background」+ mood画風(既存 `MOOD_STYLE` を共用)+ `人物: name=description`。空入力で例外なし。
- `buildImagePrompt({ narrative, moods, appearances, hasReferences })`: `hasReferences: true` のとき「参照画像の人物の外見(顔・髪・服装)を厳密に維持すること。」を追記。既定falseで従来出力と同一。

### 3. `server/routes/sceneImages.js`(POSTフロー拡張)

analyzeScene後:

1. **新キャラのポートレート生成**(newAppearancesの各項目):
   - `usage.consume(userId, 'images')` を1枚ごとに消費。上限到達ならその時点で残りのポートレートをスキップ(シーン生成は続行=非致命)。
   - `buildPortraitPrompt` → `generateImage`(参照なし)→ `imageStore.write`(既存のimageId形式・保存先)。
   - 失敗(生成エラー)も非致命: その項目は `imageId` なしで返す。
   - 成功時: newAppearances項目を `{ name, description, imageId }` に拡張。
2. **シーン挿絵生成**:
   - 登場キャラ(presentNames)のレジストリ項目(マージ後)から `imageId` を持つものを集め、`imageStore.read` でBuffer→base64化し `referenceImages` として渡す(**最大3枚**、ペイロード抑制。超過分は先頭から3名)。
   - `buildImagePrompt(..., hasReferences: referenceImages.length > 0)`。
   - シーン本体の `usage.consume` は従来どおり1ユニット(手順を維持: シーン分を先に消費し、その後ポートレート分を消費する順でもよいが、**シーン分の429はエラー**・ポートレート分の429はスキップ、という区別を保つこと)。
3. レスポンス: `{ imageId, newAppearances }`(newAppearancesに `imageId?` が加わる)。

### 4. `src/screens/Play.jsx`

`illustrate` のマージを `appearances[a.name] = { name: a.name, description: a.description, ...(a.imageId ? { imageId: a.imageId } : {}) }` に変更(imageId保持)。他は不変。

## 互換性

- 既存セッションのレジストリ項目(imageIdなし)はそのまま=参照なしのテキスト方式で動作。
- ポートレートは通常のセッション画像なので、既存の配信GET・削除カスケードがそのまま適用される。

## エラー処理

- ポートレート生成失敗/上限: 非致命。当該キャラはimageIdなし(テキストのみ)で続行。
- 参照画像の読み込み失敗(ファイル欠落): その参照をスキップ。
- シーン生成の失敗系(502/429/400/404/501)は従来どおり。

## テスト方針

- `imageProvider.test.js`(追記): referenceImagesがinlineData partsとして先頭に並ぶ、参照なしは従来のボディ。
- `imagePrompt.test.js`(追記): portraitプロンプト(bust/背景/mood/人物)、`hasReferences` の指示文有無。
- `sceneImages.test.js`(追記): 新キャラありPOSTでGeminiが2回呼ばれ(ポートレート+シーン)、newAppearances[0].imageIdが返りファイルが保存される。既知キャラ(imageId持ち)ありPOSTでシーン呼び出しに参照inlineDataが含まれる。ポートレート生成失敗でもシーンは200。ポートレート分の429スキップ(シーンは成功)。usage消費回数(1+新キャラ数)。
- `Play.test.jsx`(追記): マージでimageIdが保存される。

## スコープ外

- ライブラリCharacterタブのポートレート生成・表示。
- ポートレートのUI表示(登場人物パネル等)。
- 参照画像を挿絵付き小説やポートレート再生成に使う応用。
