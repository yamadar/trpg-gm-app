# セッション内自動ポートレート+参照画像一貫性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 挿絵生成時に初登場キャラのポートレートを自動生成してレジストリ(`session.appearances`)へ保存し、以降のシーン挿絵生成にGeminiの参照画像として渡してキャラの見た目を強く一貫させる。

**Architecture:** `generateImage` に参照画像入力(`referenceImages`→`inlineData` parts)を追加し、`sceneImages` ルートが「新キャラのポートレート生成(非致命・1枚1ユニット)→レジストリ拡張(`imageId`)→登場キャラのポートレートを参照画像にしてシーン生成」を行う。新規UIなし、Playはマージで `imageId` を保持するだけ。

**Tech Stack:** 既存構成のまま(Node/Express + vitest + supertest、React 18)。新規依存なし。

## Global Constraints

- 参照画像は**最大3枚**(presentNames順の先頭3名)。mimeType既定 `image/png`。
- ポートレート: 「character portrait, bust shot, plain background」+ 既存 `MOOD_STYLE` 画風。
- 参照あり時のシーンプロンプト追記: 「参照画像の人物の外見(顔・髪・服装)を厳密に維持すること。」
- 日次上限: 画像1枚=1ユニット。シーン分の429は従来どおりエラー、**ポートレート分の429・生成失敗は非致命スキップ**(imageIdなしで続行)。
- imageId形式・保存先は既存(`img_...`、`sessionImagePath`)を流用。
- UI文言・コメントは日本語。コミット末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

---

### Task 1: imageProvider の参照画像入力

**Files:**
- Modify: `server/imageProvider.js`
- Test: `server/imageProvider.test.js`(追記)

**Interfaces:**
- Produces: `generateImage({ prompt, apiKey, model, fetchImpl, referenceImages = [] })`。`referenceImages: [{ base64, mimeType? }]` を parts の先頭に `inlineData` として並べる。Task 3 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`server/imageProvider.test.js` に追記:

```js
  it('sends referenceImages as leading inlineData parts before the text prompt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ candidates: [{ content: { parts: [{ inlineData: { data: 'B' } }] } }] }));
    await generateImage({
      prompt: 'scene',
      apiKey: 'k',
      model: 'm',
      fetchImpl,
      referenceImages: [{ base64: 'REF1', mimeType: 'image/png' }, { base64: 'REF2' }],
    });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.contents[0].parts).toEqual([
      { inlineData: { data: 'REF1', mimeType: 'image/png' } },
      { inlineData: { data: 'REF2', mimeType: 'image/png' } },
      { text: 'scene' },
    ]);
  });
  it('sends only the text part when no referenceImages are given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ candidates: [{ content: { parts: [{ inlineData: { data: 'B' } }] } }] }));
    await generateImage({ prompt: 'scene', apiKey: 'k', model: 'm', fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.contents[0].parts).toEqual([{ text: 'scene' }]);
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/imageProvider.test.js`
Expected: 追記2件FAIL

- [ ] **Step 3: 実装**

`server/imageProvider.js` の `generateImage` を変更:

```js
export async function generateImage({ prompt, apiKey, model, fetchImpl = fetch, referenceImages = [] }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  // 参照画像(キャラポートレート等)を先頭に並べ、最後にテキスト指示を置く
  const parts = [
    ...referenceImages.map((r) => ({ inlineData: { data: r.base64, mimeType: r.mimeType || 'image/png' } })),
    { text: prompt },
  ];
  const upstream = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  // (以降は既存のまま)
```

- [ ] **Step 4: テスト確認 → Commit**

Run: `npx vitest run server/imageProvider.test.js` → PASS

```bash
git add server/imageProvider.js server/imageProvider.test.js
git commit -m "feat(server): Gemini呼び出しに参照画像(inlineData)入力を追加"
```

---

### Task 2: imagePrompt(ポートレート+参照維持指示)

**Files:**
- Modify: `server/imagePrompt.js`
- Test: `server/imagePrompt.test.js`(追記)

**Interfaces:**
- Produces: `buildPortraitPrompt({ name, description, moods }) -> string`、`buildImagePrompt({ narrative, moods, appearances, hasReferences }) -> string`。Task 3 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`server/imagePrompt.test.js` に追記(importに `buildPortraitPrompt` を追加):

```js
describe('buildPortraitPrompt', () => {
  it('バストアップ・無地背景・mood画風・人物記述を含む', () => {
    const p = buildPortraitPrompt({ name: 'カイ', description: '赤髪の猟師', moods: ['ホラー'] });
    expect(p).toContain('bust shot');
    expect(p).toContain('plain background');
    expect(p).toContain('horror');
    expect(p).toContain('人物: カイ=赤髪の猟師');
  });
  it('空入力で例外を投げない', () => {
    expect(() => buildPortraitPrompt({})).not.toThrow();
  });
});

describe('buildImagePrompt hasReferences', () => {
  it('hasReferences時のみ参照維持の指示を含む', () => {
    const base = { narrative: 'x', moods: [], appearances: [] };
    expect(buildImagePrompt({ ...base, hasReferences: true })).toContain('厳密に維持');
    expect(buildImagePrompt(base)).not.toContain('厳密に維持');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/imagePrompt.test.js` → 追記分FAIL

- [ ] **Step 3: 実装**

`server/imagePrompt.js`:

1. `buildImagePrompt` のシグネチャを `({ narrative = '', moods = [], appearances = [], hasReferences = false })` に変更し、`lines` 構築の末尾(return直前)に追加:

```js
  if (hasReferences) lines.push('参照画像の人物の外見(顔・髪・服装)を厳密に維持すること。');
```

2. 末尾に追加:

```js
// キャラポートレート用プロンプト。シーン挿絵の参照画像として使うため
// バストアップ・無地背景に固定し、画風はシーンと同じmoodマッピングを共用する。
export function buildPortraitPrompt({ name = '', description = '', moods = [] }) {
  const moodKey = Array.isArray(moods) ? moods.find((m) => MOOD_STYLE[m]) : undefined;
  const style = moodKey ? MOOD_STYLE[moodKey] : 'neutral tone';
  const lines = [`character portrait, bust shot, plain background, ${BASE_STYLE}, ${style}.`];
  if (name || description) lines.push(`人物: ${name}=${description}`);
  return lines.join('\n');
}
```

- [ ] **Step 4: テスト確認 → Commit**

Run: `npx vitest run server/imagePrompt.test.js` → PASS

```bash
git add server/imagePrompt.js server/imagePrompt.test.js
git commit -m "feat(server): ポートレートプロンプトと参照維持指示を追加"
```

---

### Task 3: sceneImagesルートのポートレート生成+参照渡し

**Files:**
- Modify: `server/routes/sceneImages.js`
- Test: `server/routes/sceneImages.test.js`(追記)

**Interfaces:**
- Consumes: Task 1/2 の関数群。
- Produces: `POST` レスポンスの `newAppearances` 項目に `imageId?: string`。Task 4 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`server/routes/sceneImages.test.js` に追記。ヘルパー追加(既存ヘルパーの近く):

```js
function analysisWithNew(name, description) {
  return {
    ok: true,
    json: async () => ({
      content: [
        { type: 'text', text: JSON.stringify({ present_names: [name], new_appearances: [{ name, description }] }) },
      ],
    }),
  };
}
```

テスト追記:

```js
describe('portrait generation and reference images', () => {
  it('新キャラがいるとポートレート+シーンの2回Geminiを呼び、newAppearancesにimageIdが付く', async () => {
    const fetchImpl = vi.fn(async (url) =>
      String(url).includes('anthropic') ? analysisWithNew('村長', '白髪の老人') : geminiResponse()
    );
    const consume = vi.fn().mockResolvedValue({ ok: true });
    buildApp({ fetchImpl, usage: { consume } });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    const geminiCalls = fetchImpl.mock.calls.filter(([u]) => !String(u).includes('anthropic'));
    expect(geminiCalls).toHaveLength(2); // ポートレート + シーン
    expect(res.body.newAppearances[0].imageId).toMatch(/^img_/);
    // ポートレートのプロンプトはbust shot
    const portraitBody = JSON.parse(geminiCalls[0][1].body);
    expect(portraitBody.contents[0].parts.at(-1).text).toContain('bust shot');
    // usage: シーン1 + ポートレート1 = 2回
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it('既知キャラがimageIdを持つ場合、シーン生成に参照inlineDataを渡す', async () => {
    // レジストリにimageId付きキャラをseedし、そのポートレートファイルを置く
    await dataStore.set(sessionKey('usr_test', 's1'), {
      id: 's1',
      moods: [],
      pc: { raw: '' },
      appearances: { カイ: { name: 'カイ', description: '赤髪', imageId: 'img_port1' } },
      log: [{ role: 'gm', text: 'カイが進む' }],
    });
    await imageStore.write(sessionImagePath('usr_test', 's1', 'img_port1'), Buffer.from([9, 9]));
    const fetchImpl = vi.fn(async (url) =>
      String(url).includes('anthropic')
        ? { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ present_names: ['カイ'], new_appearances: [] }) }] }) }
        : geminiResponse()
    );
    buildApp({ fetchImpl });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    const sceneCall = fetchImpl.mock.calls.filter(([u]) => !String(u).includes('anthropic')).at(-1);
    const body = JSON.parse(sceneCall[1].body);
    expect(body.contents[0].parts[0].inlineData.data).toBe(Buffer.from([9, 9]).toString('base64'));
    expect(body.contents[0].parts.at(-1).text).toContain('厳密に維持');
  });

  it('ポートレート生成が失敗してもシーンは200で、imageIdなしのnewAppearancesを返す', async () => {
    let geminiCount = 0;
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('anthropic')) return analysisWithNew('村長', '白髪の老人');
      geminiCount += 1;
      // 1回目(ポートレート)だけ失敗させ、2回目(シーン)は成功
      if (geminiCount === 1) return { ok: false, status: 500, text: async () => 'err' };
      return geminiResponse();
    });
    buildApp({ fetchImpl });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.newAppearances[0].imageId).toBeUndefined();
  });

  it('ポートレート分の上限超過はスキップし、シーン生成は成功する', async () => {
    const consume = vi
      .fn()
      .mockResolvedValueOnce({ ok: true }) // シーン分
      .mockResolvedValue({ ok: false, resetAt: 1 }); // ポートレート分
    const fetchImpl = vi.fn(async (url) =>
      String(url).includes('anthropic') ? analysisWithNew('村長', '白髪の老人') : geminiResponse()
    );
    buildApp({ fetchImpl, usage: { consume } });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.newAppearances[0].imageId).toBeUndefined();
    // Gemini呼び出しはシーンの1回のみ
    expect(fetchImpl.mock.calls.filter(([u]) => !String(u).includes('anthropic'))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/routes/sceneImages.test.js` → 追記分FAIL

- [ ] **Step 3: 実装**

`server/routes/sceneImages.js`:

1. import: `buildImagePrompt` の行に `buildPortraitPrompt` を追加。
2. imageId採番を関数化(ファイル冒頭、`IMAGE_ID_RE` の下):

```js
function newImageId() {
  return 'img_' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}
```

(既存のシーン用採番もこの関数に置き換える)

3. POST内、`analyzeScene` の後〜`merged` 構築の間を以下に置き換え:

```js
    // 新キャラのポートレートを自動生成(非致命)。1枚=1ユニット消費、上限到達・失敗はスキップ。
    const enrichedNew = [];
    for (const a of newAppearances) {
      let portraitId = null;
      let allowed = true;
      if (usage) {
        try {
          const check = await usage.consume(req.userId, 'images');
          allowed = check.ok;
        } catch {
          allowed = false;
        }
      }
      if (allowed) {
        try {
          const img = await generateImage({
            prompt: buildPortraitPrompt({ name: a.name, description: a.description, moods: session.moods }),
            apiKey: geminiApiKey,
            model: geminiModel,
            fetchImpl,
          });
          portraitId = newImageId();
          await imageStore.write(sessionImagePath(req.userId, req.params.id, portraitId), Buffer.from(img.base64, 'base64'));
        } catch {
          portraitId = null; // 非致命: テキストのみの一貫性へフォールバック
        }
      }
      enrichedNew.push(portraitId ? { ...a, imageId: portraitId } : a);
    }

    const merged = { ...registry };
    for (const a of enrichedNew) {
      merged[a.name] = { name: a.name, description: a.description, ...(a.imageId ? { imageId: a.imageId } : {}) };
    }
    const appearances = presentNames.map((n) => merged[n]).filter(Boolean);

    // 登場キャラのポートレートを参照画像として集める(最大3枚)
    const referenceImages = [];
    for (const a of appearances) {
      if (referenceImages.length >= 3) break;
      if (!a.imageId) continue;
      const buf = await imageStore.read(sessionImagePath(req.userId, req.params.id, a.imageId));
      if (buf) referenceImages.push({ base64: buf.toString('base64'), mimeType: 'image/png' });
    }
```

4. シーン生成部を変更:

```js
    const prompt = buildImagePrompt({
      narrative: entry.text,
      moods: session.moods,
      appearances,
      hasReferences: referenceImages.length > 0,
    });
    let image;
    try {
      image = await generateImage({ prompt, apiKey: geminiApiKey, model: geminiModel, fetchImpl, referenceImages });
    } catch (e) {
      res.status(502).json({ error: `image generation failed: ${e.message}` });
      return;
    }
    const imageId = newImageId();
    const buf = Buffer.from(image.base64, 'base64');
    await imageStore.write(sessionImagePath(req.userId, req.params.id, imageId), buf);
    res.json({ imageId, newAppearances: enrichedNew });
```

- [ ] **Step 4: テスト確認 → Commit**

Run: `npx vitest run server/routes/sceneImages.test.js` → PASS(既存含む)

```bash
git add server/routes/sceneImages.js server/routes/sceneImages.test.js
git commit -m "feat(server): 初登場キャラのポートレート自動生成と参照画像によるシーン一貫性"
```

---

### Task 4: PlayのimageId保持マージ + docs更新

**Files:**
- Modify: `src/screens/Play.jsx`(`illustrate` 内マージ1行)
- Test: `src/screens/Play.test.jsx`(追記)
- Modify: `docs/06-content-generation.md`, `docs/08-feature-ideas.md`, `docs/07-risks-and-roadmap.md`

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Play.test.jsx` に追記:

```jsx
  it('生成結果のnewAppearancesのimageIdをレジストリへ保持して保存する', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    sceneImageClient.generateSceneImage.mockResolvedValueOnce({
      imageId: 'img_1',
      newAppearances: [{ name: '村長', description: '白髪の老人', imageId: 'img_port1' }],
    });
    const saveSpy = vi.spyOn(storage, 'saveSession');
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: 'ログ' }] });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
    fireEvent.click(screen.getByText('この場面を描く'));
    await waitFor(() => {
      const saved = saveSpy.mock.calls.at(-1)?.[0];
      expect(saved?.appearances?.['村長']).toEqual({ name: '村長', description: '白髪の老人', imageId: 'img_port1' });
    });
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/screens/Play.test.jsx` → 追記分FAIL

- [ ] **Step 3: 実装**

`src/screens/Play.jsx` の `illustrate` 内:

```js
        for (const a of newAppearances || []) appearances[a.name] = { name: a.name, description: a.description };
```

を:

```js
        for (const a of newAppearances || [])
          appearances[a.name] = { name: a.name, description: a.description, ...(a.imageId ? { imageId: a.imageId } : {}) };
```

- [ ] **Step 4: docs更新**

- `docs/06-content-generation.md` 10.5節: 「未実装(後続)」のキャラポートレート行を実装済みへ更新。1〜2文で: 初登場キャラのポートレートを自動生成してレジストリ(`session.appearances[].imageId`)に保存し、以降のシーン生成でGeminiの参照画像(最大3枚)として渡して外見を強く一貫させる。ポートレート分の失敗・上限超過は非致命(テキストのみへフォールバック)。ライブラリCharacterタブのポートレート表示は未実装の将来候補。
- `docs/08-feature-ideas.md` 1.1: 「サブプロジェクト3 実装済み(2026-07-24)」を追記し、1.1全体が完了である旨に整理。
- `docs/07-risks-and-roadmap.md` Phase 3の画像生成連携の行を「1.1全サブプロジェクト実装済み(2026-07-24)」へ更新。

- [ ] **Step 5: テスト確認 → 全体テスト → Commit**

Run: `npx vitest run src/screens/Play.test.jsx` → PASS
Run: `npm test` → 全suite PASS

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx docs/06-content-generation.md docs/08-feature-ideas.md docs/07-risks-and-roadmap.md
git commit -m "feat(ui): ポートレートimageIdのレジストリ保持とdocs更新"
```
