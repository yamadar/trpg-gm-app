# 場面挿絵の生成(サブプロジェクト1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gemini画像生成でPlay画面のGMログエントリ毎にシーン挿絵を生成・表示し、登場人物の見た目をセッション横断で一貫させる(テキスト方式)。

**Architecture:** サーバーに隔離モジュール(`imageProvider`=Gemini / `sceneAnalysis`=Anthropicで登場人物の見た目抽出・生成 / `imagePrompt`=プロンプト構築 / `imageStore`=バイナリ保存)を追加し、`sceneImages`ルートが「解析→プロンプト→画像生成→PNG保存」を行う。画像バイトはサーバーのファイル、セッションJSONには`imageId`参照と`appearances`レジストリのみ。クライアントはPlayでボタン/自動トグルから生成を呼び、結果をセッションへ永続化する。

**Tech Stack:** Node/Express + vitest + supertest(サーバー)、React 18 + vitest + @testing-library/react(クライアント)。新規npm依存なし。画像プロバイダは Google Gemini ネイティブAPI。

## Global Constraints

- Geminiエンドポイント: `POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`、ヘッダ `x-goog-api-key`、ボディに `generationConfig: { responseModalities: ['TEXT','IMAGE'] }`。
- 既定モデル: `gemini-2.5-flash-image`(env `GEMINI_IMAGE_MODEL` で差し替え)。Geminiキーは env `GEMINI_API_KEY`(Anthropicキーとは別)。
- 日次上限: env `LIMIT_IMAGES_PER_DAY`(既定30)、`usage` 機構の `images` 種別。
- imageId形式: `img_<Date.now()>-<rand4>`、検証正規表現 `/^img_[A-Za-z0-9-]+$/`。
- プロンプトのトリム: narrative 先頭400字、pcRaw 先頭600字。
- 画像プロンプトには**その場面に登場する人物の見た目のみ**を差し込む(全キャスト不可)。
- セッションはクライアントが真実源。サーバーは`entry.image`・`appearances`を書き換えない(クライアントが返り値を永続化)。
- UI文言・コメントは日本語。既存のインラインstyle+`theme.js`方式を踏襲。新規npm依存禁止。
- テスト: 全体 `npm test` / 個別 `npx vitest run <path>`。コミットは既存の日本語 `feat:`/`fix:` スタイル、末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。

## ファイル構成

- Create: `server/imageProvider.js`, `server/sceneAnalysis.js`, `server/imagePrompt.js`, `server/storage/imageStore.js`, `server/routes/sceneImages.js`, `server/routes/config.js`, `src/api/sceneImageClient.js`(+各テスト)
- Modify: `server/storage/paths.js`(画像パス定数), `server/index.js`(結線), `.env.example`, `src/screens/Play.jsx`(表示・生成), `src/screens/Play.test.jsx`, docs 4本

---

### Task 1: バイナリ画像ストア + パス定数

**Files:**
- Create: `server/storage/imageStore.js`
- Create: `server/storage/imageStore.test.js`
- Modify: `server/storage/paths.js`(末尾に追加)
- Test: `server/storage/paths.test.js`(追記)

**Interfaces:**
- Produces: `createFsImageStore(rootDir)` → `{ write(p, buffer), read(p)→Buffer|null, delete(p), deleteDir(prefix) }`。`sessionImagePath(userId, sessionId, imageId)`, `sessionImageDir(userId, sessionId)`。Task 6 が使用。

- [ ] **Step 1: imageStore の失敗するテストを書く**

`server/storage/imageStore.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsImageStore } from './imageStore.js';

let dir, store;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'imagestore-test-'));
  store = createFsImageStore(dir);
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('createFsImageStore', () => {
  it('writes and reads back binary bytes', async () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    await store.write('users/u/sessions/s/images/img_1.png', buf);
    const out = await store.read('users/u/sessions/s/images/img_1.png');
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.equals(buf)).toBe(true);
  });
  it('returns null for a missing file', async () => {
    expect(await store.read('nope.png')).toBeNull();
  });
  it('deletes a file and ignores a missing one', async () => {
    await store.write('a.png', Buffer.from([1]));
    await store.delete('a.png');
    expect(await store.read('a.png')).toBeNull();
    await expect(store.delete('a.png')).resolves.toBeUndefined();
  });
  it('deleteDir removes a whole directory', async () => {
    await store.write('users/u/sessions/s/images/x.png', Buffer.from([1]));
    await store.deleteDir('users/u/sessions/s/images');
    expect(await store.read('users/u/sessions/s/images/x.png')).toBeNull();
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/storage/imageStore.test.js`
Expected: FAIL — モジュールが存在しない

- [ ] **Step 3: imageStore を実装**

`server/storage/imageStore.js`:

```js
import fs from 'node:fs/promises';
import path from 'node:path';

let tmpCounter = 0;

export function createFsImageStore(rootDir) {
  function fullPath(p) {
    return path.join(rootDir, p);
  }
  return {
    async write(p, buffer) {
      const file = fullPath(p);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp-${process.pid}-${tmpCounter++}`;
      await fs.writeFile(tmp, buffer);
      await fs.rename(tmp, file);
    },
    async read(p) {
      try {
        return await fs.readFile(fullPath(p));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async delete(p) {
      try {
        await fs.unlink(fullPath(p));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    },
    async deleteDir(prefix) {
      await fs.rm(fullPath(prefix), { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 4: パス定数を追加(先にテスト)**

`server/storage/paths.test.js` に追記(既存の import { ... } from './paths.js' に2関数を足す。無ければ新規行でimport):

```js
import { sessionImageDir, sessionImagePath } from './paths.js';

describe('scene image paths', () => {
  it('builds the session image dir and file path', () => {
    expect(sessionImageDir('u', 's')).toBe('users/u/sessions/s/images');
    expect(sessionImagePath('u', 's', 'img_1')).toBe('users/u/sessions/s/images/img_1.png');
  });
});
```

`server/storage/paths.js` の末尾に追加:

```js
export function sessionImageDir(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}/images`;
}

export function sessionImagePath(userId, sessionId, imageId) {
  return `users/${userId}/sessions/${sessionId}/images/${imageId}.png`;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run server/storage/imageStore.test.js server/storage/paths.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/storage/imageStore.js server/storage/imageStore.test.js server/storage/paths.js server/storage/paths.test.js
git commit -m "feat(server): バイナリ画像ストアと画像パス定数を追加"
```

---

### Task 2: Gemini 画像プロバイダ

**Files:**
- Create: `server/imageProvider.js`
- Create: `server/imageProvider.test.js`

**Interfaces:**
- Produces: `generateImage({ prompt, apiKey, model, fetchImpl }) -> Promise<{ base64, mimeType }>`(失敗時throw)。Task 6 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`server/imageProvider.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { generateImage } from './imageProvider.js';

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

describe('generateImage', () => {
  it('posts the prompt to the model endpoint and returns the inline image', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      ok({ candidates: [{ content: { parts: [{ inlineData: { data: 'BASE64', mimeType: 'image/png' } }] } }] })
    );
    const out = await generateImage({ prompt: 'a castle', apiKey: 'k', model: 'gemini-2.5-flash-image', fetchImpl });
    expect(out).toEqual({ base64: 'BASE64', mimeType: 'image/png' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-goog-api-key': 'k' }) })
    );
  });
  it('defaults mimeType to image/png when absent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ candidates: [{ content: { parts: [{ inlineData: { data: 'B' } }] } }] }));
    const out = await generateImage({ prompt: 'x', apiKey: 'k', model: 'm', fetchImpl });
    expect(out.mimeType).toBe('image/png');
  });
  it('throws when the response has no image part', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ candidates: [{ content: { parts: [{ text: 'no image' }] } }] }));
    await expect(generateImage({ prompt: 'x', apiKey: 'k', model: 'm', fetchImpl })).rejects.toThrow(/no image/);
  });
  it('throws when the upstream status is not ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' });
    await expect(generateImage({ prompt: 'x', apiKey: 'k', model: 'm', fetchImpl })).rejects.toThrow(/400/);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/imageProvider.test.js`
Expected: FAIL — モジュールなし

- [ ] **Step 3: 実装**

`server/imageProvider.js`:

```js
const GEMINI_TIMEOUT_MS = 120000;

export async function generateImage({ prompt, apiKey, model, fetchImpl = fetch }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const upstream = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  if (!upstream.ok) {
    const t = await upstream.text().catch(() => '');
    throw new Error(`gemini image request failed: ${upstream.status} ${t.slice(0, 200)}`);
  }
  const data = await upstream.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p?.inlineData?.data);
  if (!imgPart) throw new Error('gemini response contained no image');
  return { base64: imgPart.inlineData.data, mimeType: imgPart.inlineData.mimeType || 'image/png' };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/imageProvider.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/imageProvider.js server/imageProvider.test.js
git commit -m "feat(server): Gemini画像生成プロバイダを追加"
```

---

### Task 3: シーン解析(登場人物の見た目抽出・生成)

**Files:**
- Create: `server/sceneAnalysis.js`
- Create: `server/sceneAnalysis.test.js`

**Interfaces:**
- Produces: `analyzeScene({ narrative, registry, pcRaw, apiKey, fetchImpl }) -> Promise<{ presentNames: string[], newAppearances: {name,description}[] }>`。失敗・キー無しは空返り(throwしない)。Task 6 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`server/sceneAnalysis.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { analyzeScene } from './sceneAnalysis.js';

function anthropicJson(obj) {
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] }) };
}

describe('analyzeScene', () => {
  it('returns empty without calling the API when no key is set', async () => {
    const fetchImpl = vi.fn();
    const out = await analyzeScene({ narrative: 'x', apiKey: undefined, fetchImpl });
    expect(out).toEqual({ presentNames: [], newAppearances: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('parses present names and newly generated appearances', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      anthropicJson({ present_names: ['カイ', 'ゴブリンの長'], new_appearances: [{ name: 'ゴブリンの長', description: '緑の肌、赤い眼帯' }] })
    );
    const out = await analyzeScene({ narrative: '戦い', registry: {}, pcRaw: '', apiKey: 'k', fetchImpl });
    expect(out.presentNames).toEqual(['カイ', 'ゴブリンの長']);
    expect(out.newAppearances).toEqual([{ name: 'ゴブリンの長', description: '緑の肌、赤い眼帯' }]);
  });
  it('filters malformed entries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      anthropicJson({ present_names: ['A', 5], new_appearances: [{ name: 'A' }, { name: 'B', description: 'ok' }] })
    );
    const out = await analyzeScene({ narrative: 'x', apiKey: 'k', fetchImpl });
    expect(out.presentNames).toEqual(['A']);
    expect(out.newAppearances).toEqual([{ name: 'B', description: 'ok' }]);
  });
  it('returns empty when the API responds not-ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await analyzeScene({ narrative: 'x', apiKey: 'k', fetchImpl })).toEqual({ presentNames: [], newAppearances: [] });
  });
  it('returns empty when the API throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    expect(await analyzeScene({ narrative: 'x', apiKey: 'k', fetchImpl })).toEqual({ presentNames: [], newAppearances: [] });
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/sceneAnalysis.test.js`
Expected: FAIL — モジュールなし

- [ ] **Step 3: 実装**

`server/sceneAnalysis.js`:

```js
const ANALYSIS_TIMEOUT_MS = 60000;
const MODEL = 'claude-sonnet-5';

const ANALYSIS_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['present_names', 'new_appearances'],
    properties: {
      present_names: { type: 'array', items: { type: 'string' } },
      new_appearances: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'description'],
          properties: { name: { type: 'string' }, description: { type: 'string' } },
        },
      },
    },
  },
};

const SYSTEM = `この場面の地の文に登場する人物を特定せよ。既知キャラ一覧(名前と見た目)に載っていない人物が登場する場合のみ、世界観・文脈に沿った簡潔な見た目(髪・服装・目立つ特徴)を新規に考案せよ。既知キャラの見た目は変更しないこと。PCシートに見た目の記述があればそれを優先する。present_namesにはこの場面に登場する全人物名を、new_appearancesには新規に見た目を決めた人物のみを入れること。`;

export async function analyzeScene({ narrative, registry = {}, pcRaw = '', apiKey, fetchImpl = fetch }) {
  if (!apiKey) return { presentNames: [], newAppearances: [] };
  const known =
    Object.values(registry)
      .map((a) => `${a.name}: ${a.description}`)
      .join('\n') || '(なし)';
  const user = `# 地の文\n${narrative}\n\n# 既知キャラ\n${known}\n\n# PCシート(抜粋)\n${(pcRaw || '').slice(0, 600) || '(なし)'}`;
  try {
    const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: 'disabled' },
        system: SYSTEM,
        output_config: { format: ANALYSIS_FORMAT },
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
    });
    if (!upstream.ok) return { presentNames: [], newAppearances: [] };
    const data = await upstream.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    const parsed = JSON.parse(text);
    const presentNames = Array.isArray(parsed.present_names)
      ? parsed.present_names.filter((n) => typeof n === 'string')
      : [];
    const newAppearances = Array.isArray(parsed.new_appearances)
      ? parsed.new_appearances
          .filter((a) => a && typeof a.name === 'string' && typeof a.description === 'string')
          .map((a) => ({ name: a.name, description: a.description }))
      : [];
    return { presentNames, newAppearances };
  } catch {
    return { presentNames: [], newAppearances: [] };
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/sceneAnalysis.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/sceneAnalysis.js server/sceneAnalysis.test.js
git commit -m "feat(server): シーン解析で登場人物の見た目を抽出・生成"
```

---

### Task 4: 画像プロンプト構築(見た目差し込み)

**Files:**
- Create: `server/imagePrompt.js`
- Create: `server/imagePrompt.test.js`

**Interfaces:**
- Produces: `buildImagePrompt({ narrative, moods, appearances }) -> string`。`appearances` は `{name,description}[]`(登場者のみ)。Task 6 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`server/imagePrompt.test.js`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildImagePrompt } from './imagePrompt.js';

describe('buildImagePrompt', () => {
  it('includes the base style and a mood-specific keyword', () => {
    const p = buildImagePrompt({ narrative: '城', moods: ['ホラー'] });
    expect(p).toContain('digital illustration');
    expect(p).toContain('horror');
    expect(p).toContain('場面: 城');
  });
  it('falls back to a neutral tone for unknown/empty moods', () => {
    expect(buildImagePrompt({ narrative: 'x', moods: [] })).toContain('neutral');
    expect(buildImagePrompt({ narrative: 'x', moods: ['未知'] })).toContain('neutral');
  });
  it('injects only the provided character appearances', () => {
    const p = buildImagePrompt({ narrative: 'x', moods: [], appearances: [{ name: 'カイ', description: '赤髪の猟師' }] });
    expect(p).toContain('登場人物: カイ=赤髪の猟師');
  });
  it('trims long narrative to 400 chars', () => {
    const long = 'あ'.repeat(500);
    const p = buildImagePrompt({ narrative: long, moods: [] });
    expect(p).toContain('あ'.repeat(400));
    expect(p).not.toContain('あ'.repeat(401));
  });
  it('does not throw on empty inputs', () => {
    expect(() => buildImagePrompt({})).not.toThrow();
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/imagePrompt.test.js`
Expected: FAIL — モジュールなし

- [ ] **Step 3: 実装**

`server/imagePrompt.js`:

```js
const BASE_STYLE = 'atmospheric digital illustration, detailed, cinematic lighting, no text, no speech bubbles';

// キーは src/constants/moods.js / server/storage/moods.js の MOODS(固定8種)と対応。
const MOOD_STYLE = {
  ホラー: 'dark, ominous, unsettling horror mood',
  冒険: 'epic adventurous fantasy',
  ミステリー: 'moody noir, muted tones',
  日常: 'warm slice-of-life',
  SF: 'sci-fi, cool tones, futuristic',
  ファンタジー: 'high fantasy, painterly',
  コメディ: 'bright cheerful',
  シリアス: 'somber, desaturated',
};

const NARRATIVE_MAX = 400;

export function buildImagePrompt({ narrative = '', moods = [], appearances = [] }) {
  const moodKey = Array.isArray(moods) ? moods.find((m) => MOOD_STYLE[m]) : undefined;
  const style = moodKey ? MOOD_STYLE[moodKey] : 'neutral tone';
  const scene = String(narrative || '').slice(0, NARRATIVE_MAX).trim();
  const cast = (appearances || [])
    .filter((a) => a && a.name && a.description)
    .map((a) => `${a.name}=${a.description}`)
    .join(', ');
  const lines = [`${BASE_STYLE}, ${style}.`];
  if (cast) lines.push(`登場人物: ${cast}`);
  if (scene) lines.push(`場面: ${scene}`);
  return lines.join('\n');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/imagePrompt.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/imagePrompt.js server/imagePrompt.test.js
git commit -m "feat(server): 画像プロンプト構築(mood画風+登場人物の見た目)"
```

---

### Task 5: 機能検出ルート `/api/config`

**Files:**
- Create: `server/routes/config.js`
- Create: `server/routes/config.test.js`

**Interfaces:**
- Produces: `createConfigRouter({ imageGenEnabled }) -> Router`(`GET /config` → `{ imageGen: boolean }`)。Task 6(結線)・Task 7(クライアント)が使用。

- [ ] **Step 1: 失敗するテストを書く**

`server/routes/config.test.js`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createConfigRouter } from './config.js';

function buildApp(opts) {
  const app = express();
  app.use('/api', createConfigRouter(opts));
  return app;
}

describe('GET /config', () => {
  it('reports imageGen true when enabled', async () => {
    const res = await request(buildApp({ imageGenEnabled: true })).get('/api/config');
    expect(res.body).toEqual({ imageGen: true });
  });
  it('reports imageGen false when disabled', async () => {
    const res = await request(buildApp({ imageGenEnabled: false })).get('/api/config');
    expect(res.body).toEqual({ imageGen: false });
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/routes/config.test.js`
Expected: FAIL — モジュールなし

- [ ] **Step 3: 実装**

`server/routes/config.js`:

```js
import { Router } from 'express';

export function createConfigRouter({ imageGenEnabled = false } = {}) {
  const router = Router();
  router.get('/config', (req, res) => {
    res.json({ imageGen: !!imageGenEnabled });
  });
  return router;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/config.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/config.js server/routes/config.test.js
git commit -m "feat(server): 機能検出用 GET /api/config を追加"
```

---

### Task 6: 挿絵生成・配信ルート + サーバー結線

**Files:**
- Create: `server/routes/sceneImages.js`
- Create: `server/routes/sceneImages.test.js`
- Modify: `server/index.js`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `analyzeScene`(Task 3), `buildImagePrompt`(Task 4), `generateImage`(Task 2), `createFsImageStore`/`sessionImagePath`(Task 1), `createConfigRouter`(Task 5)。
- Produces: `POST /api/sessions/:id/images` → `{ imageId, newAppearances }`、`GET /api/sessions/:id/images/:imageId` → PNG。Task 7/8 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`server/routes/sceneImages.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createSceneImagesRouter } from './sceneImages.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsImageStore } from '../storage/imageStore.js';
import { sessionKey } from '../storage/paths.js';

let dir, dataStore, imageStore, app;
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');

function analysisResponse() {
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ present_names: [], new_appearances: [] }) }] }) };
}
function geminiResponse() {
  return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: PNG_B64, mimeType: 'image/png' } }] } }] }) };
}
function routedFetch() {
  return vi.fn(async (url) => (String(url).includes('anthropic') ? analysisResponse() : geminiResponse()));
}

function buildApp(opts = {}) {
  const {
    geminiApiKey = 'gem', anthropicApiKey = 'anth', geminiModel = 'gemini-2.5-flash-image',
    fetchImpl = routedFetch(), usage,
  } = opts;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.userId = 'usr_test'; next(); });
  app.use('/api', createSceneImagesRouter({ dataStore, imageStore, anthropicApiKey, geminiApiKey, geminiModel, fetchImpl, usage }));
}

async function seedSession() {
  await dataStore.set(sessionKey('usr_test', 's1'), {
    id: 's1', moods: ['ホラー'], pc: { raw: 'PC名: カイ' }, log: [{ role: 'gm', text: '廃坑の入口' }],
  });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-images-test-'));
  dataStore = createFsDataStore(dir);
  imageStore = createFsImageStore(dir);
  buildApp();
  await seedSession();
});
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('POST /sessions/:id/images', () => {
  it('generates an image and returns an imageId', async () => {
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.imageId).toMatch(/^img_/);
  });
  it('returns 501 when the gemini key is not configured', async () => {
    buildApp({ geminiApiKey: undefined });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(501);
  });
  it('returns 404 for a missing session', async () => {
    const res = await request(app).post('/api/sessions/missing/images').send({ logIndex: 0 });
    expect(res.status).toBe(404);
  });
  it('returns 400 when logIndex does not reference a gm entry', async () => {
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 5 });
    expect(res.status).toBe(400);
  });
  it('returns 429 when the daily image limit is reached', async () => {
    buildApp({ usage: { consume: async () => ({ ok: false, resetAt: 9 }) } });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(429);
  });
  it('still returns an image when scene analysis fails', async () => {
    const fetchImpl = vi.fn(async (url) => (String(url).includes('anthropic') ? { ok: false, json: async () => ({}) } : geminiResponse()));
    buildApp({ fetchImpl });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(200);
    expect(res.body.imageId).toMatch(/^img_/);
  });
  it('returns 502 when image generation fails', async () => {
    const fetchImpl = vi.fn(async (url) => (String(url).includes('anthropic') ? analysisResponse() : { ok: false, status: 500, text: async () => 'err' }));
    buildApp({ fetchImpl });
    const res = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    expect(res.status).toBe(502);
  });
});

describe('GET /sessions/:id/images/:imageId', () => {
  it('serves the stored PNG bytes', async () => {
    const gen = await request(app).post('/api/sessions/s1/images').send({ logIndex: 0 });
    const res = await request(app).get(`/api/sessions/s1/images/${gen.body.imageId}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
  });
  it('returns 404 for a missing image', async () => {
    const res = await request(app).get('/api/sessions/s1/images/img_missing');
    expect(res.status).toBe(404);
  });
  it('returns 400 for a malformed imageId', async () => {
    const res = await request(app).get('/api/sessions/s1/images/badid');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/routes/sceneImages.test.js`
Expected: FAIL — モジュールなし

- [ ] **Step 3: ルートを実装**

`server/routes/sceneImages.js`:

```js
import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { sessionKey, sessionImagePath } from '../storage/paths.js';
import { analyzeScene } from '../sceneAnalysis.js';
import { buildImagePrompt } from '../imagePrompt.js';
import { generateImage } from '../imageProvider.js';

const IMAGE_ID_RE = /^img_[A-Za-z0-9-]+$/;

export function createSceneImagesRouter({ dataStore, imageStore, anthropicApiKey, geminiApiKey, geminiModel, fetchImpl = fetch, usage }) {
  const router = Router();
  router.param('id', idParamGuard);

  router.post('/sessions/:id/images', asyncHandler(async (req, res) => {
    if (!geminiApiKey) {
      res.status(501).json({ error: 'image generation is not configured' });
      return;
    }
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    const logIndex = Number(req.body?.logIndex);
    const entry = Number.isInteger(logIndex) ? session.log?.[logIndex] : undefined;
    if (!entry || entry.role !== 'gm') {
      res.status(400).json({ error: 'logIndex must reference a gm log entry' });
      return;
    }
    if (usage) {
      const check = await usage.consume(req.userId, 'images');
      if (!check.ok) {
        res.status(429).json({ error: 'daily limit reached', resetAt: check.resetAt });
        return;
      }
    }
    const registry = session.appearances || {};
    const { presentNames, newAppearances } = await analyzeScene({
      narrative: entry.text,
      registry,
      pcRaw: session.pc?.raw || '',
      apiKey: anthropicApiKey,
      fetchImpl,
    });
    const merged = { ...registry };
    for (const a of newAppearances) merged[a.name] = { name: a.name, description: a.description };
    const appearances = presentNames.map((n) => merged[n]).filter(Boolean);

    const prompt = buildImagePrompt({ narrative: entry.text, moods: session.moods, appearances });
    let image;
    try {
      image = await generateImage({ prompt, apiKey: geminiApiKey, model: geminiModel, fetchImpl });
    } catch (e) {
      res.status(502).json({ error: `image generation failed: ${e.message}` });
      return;
    }
    const imageId = 'img_' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const buf = Buffer.from(image.base64, 'base64');
    await imageStore.write(sessionImagePath(req.userId, req.params.id, imageId), buf);
    res.json({ imageId, newAppearances });
  }));

  router.get('/sessions/:id/images/:imageId', asyncHandler(async (req, res) => {
    if (!IMAGE_ID_RE.test(req.params.imageId)) {
      res.status(400).json({ error: 'invalid imageId' });
      return;
    }
    const buf = await imageStore.read(sessionImagePath(req.userId, req.params.id, req.params.imageId));
    if (buf === null) {
      res.status(404).json({ error: 'image not found' });
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(buf);
  }));

  return router;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/sceneImages.test.js`
Expected: PASS

- [ ] **Step 5: サーバーに結線**

`server/index.js` を編集:

1. import 追加(既存のルートimport群の近くに):

```js
import { createFsImageStore } from './storage/imageStore.js';
import { createConfigRouter } from './routes/config.js';
import { createSceneImagesRouter } from './routes/sceneImages.js';
```

2. `createApp` 内、`const textStore = createFsTextStore(dataDir);` の直後に:

```js
  const imageStore = createFsImageStore(dataDir);
  const geminiApiKey = env.GEMINI_API_KEY;
  const geminiModel = env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
```

3. `createUsage` の `limits` に1行追加:

```js
      images: parseLimit(env.LIMIT_IMAGES_PER_DAY, 30),
```

4. `app.use('/api', createPublicContentRouter(...))` の直後(requireAuth より前)に:

```js
  app.use('/api', createConfigRouter({ imageGenEnabled: !!geminiApiKey }));
```

5. `app.use('/api', createSessionsRouter(...))` の直後(requireAuth より後の領域)に:

```js
  app.use('/api', createSceneImagesRouter({ dataStore, imageStore, anthropicApiKey: apiKey, geminiApiKey, geminiModel, fetchImpl, usage }));
```

`.env.example` の末尾に追加:

```
# 場面挿絵生成(Google Gemini)。未設定なら挿絵機能はUIごと無効化される。
GEMINI_API_KEY=
GEMINI_IMAGE_MODEL=gemini-2.5-flash-image
LIMIT_IMAGES_PER_DAY=30
```

- [ ] **Step 6: サーバー全体テストが壊れないことを確認**

Run: `npx vitest run server/index.test.js server/routes/sceneImages.test.js server/routes/config.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/routes/sceneImages.js server/routes/sceneImages.test.js server/index.js .env.example
git commit -m "feat(server): 挿絵生成・配信ルートを追加しサーバーへ結線"
```

---

### Task 7: クライアント画像APIクライアント

**Files:**
- Create: `src/api/sceneImageClient.js`
- Create: `src/api/sceneImageClient.test.js`

**Interfaces:**
- Consumes: `POST/GET /api/sessions/:id/images`(Task 6)、`GET /api/config`(Task 5)。
- Produces: `generateSceneImage(sessionId, logIndex) -> Promise<{imageId, newAppearances}>`、`sceneImageUrl(sessionId, imageId) -> string`、`getConfig() -> Promise<{imageGen}>`。Task 8/9 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`src/api/sceneImageClient.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSceneImage, sceneImageUrl, getConfig } from './sceneImageClient.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ imageId: 'img_1', newAppearances: [] }) }));
});

describe('sceneImageClient', () => {
  it('POSTs logIndex to the images endpoint', async () => {
    await generateSceneImage('s 1', 2);
    expect(fetch).toHaveBeenCalledWith(
      '/api/sessions/s%201/images',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ logIndex: 2 }) })
    );
  });
  it('builds an encoded image URL', () => {
    expect(sceneImageUrl('s 1', 'img_x')).toBe('/api/sessions/s%201/images/img_x');
  });
  it('GETs the config endpoint', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ imageGen: true }) });
    expect(await getConfig()).toEqual({ imageGen: true });
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/api/sceneImageClient.test.js`
Expected: FAIL — モジュールなし

- [ ] **Step 3: 実装**

`src/api/sceneImageClient.js`:

```js
import { apiFetch } from './apiFetch.js';

export async function generateSceneImage(sessionId, logIndex) {
  return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ logIndex }),
  });
}

export function sceneImageUrl(sessionId, imageId) {
  return `/api/sessions/${encodeURIComponent(sessionId)}/images/${encodeURIComponent(imageId)}`;
}

export async function getConfig() {
  return apiFetch('/api/config');
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/sceneImageClient.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/sceneImageClient.js src/api/sceneImageClient.test.js
git commit -m "feat(ui): 挿絵生成・機能検出のAPIクライアントを追加"
```

---

### Task 8: Play画面 — 挿絵の表示と手動生成

**Files:**
- Modify: `src/screens/Play.jsx`
- Test: `src/screens/Play.test.jsx`

**Interfaces:**
- Consumes: `generateSceneImage`/`sceneImageUrl`/`getConfig`(Task 7)、`session.log[i].image`/`session.appearances`(データモデル)。
- Produces: Play内 `illustrate(baseSession, i)` と表示ブロック。Task 9(自動)が `illustrate` を再利用。

- [ ] **Step 1: 既存テストへ sceneImageClient のモックを追加(前提)**

`src/screens/Play.test.jsx` の import 群の直後(`beforeEach` より前)に追加。既定 `imageGen:false` なので既存テストは挿絵UIを描画せず、`getConfig` も global fetch を呼ばないため既存の fetch 呼び出し回数アサーションは不変:

```jsx
vi.mock('../api/sceneImageClient.js', () => ({
  getConfig: vi.fn().mockResolvedValue({ imageGen: false }),
  generateSceneImage: vi.fn(),
  sceneImageUrl: (sessionId, imageId) => `/api/sessions/${sessionId}/images/${imageId}`,
}));
```

`src/screens/Play.test.jsx` の先頭付近に、この後のテストで使うため import を追加:

```jsx
import * as sceneImageClient from '../api/sceneImageClient.js';
```

- [ ] **Step 2: 挿絵表示・手動生成の失敗するテストを書く**

`src/screens/Play.test.jsx` の `describe('Play', ...)` 内に追加:

```jsx
  it('imageGenが有効なら未生成GMエントリに「この場面を描く」ボタンを出す', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
  });

  it('imageGenが無効なら挿絵ボタンを出さない', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: false });
    const session = makeSession({ log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    // getConfig解決を待ってからボタン非在を確認
    await waitFor(() => expect(sceneImageClient.getConfig).toHaveBeenCalled());
    expect(screen.queryByText('この場面を描く')).not.toBeInTheDocument();
  });

  it('ボタン押下で画像を生成し、entry.imageとして表示する', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    sceneImageClient.generateSceneImage.mockResolvedValueOnce({ imageId: 'img_1', newAppearances: [] });
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: '既存のログ' }] });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
    fireEvent.click(screen.getByText('この場面を描く'));
    await waitFor(() => {
      const img = document.querySelector('img[src*="img_1"]');
      expect(img).toBeTruthy();
    });
  });

  it('既にimageを持つエントリは画像を表示しボタンを出さない', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: 'ログ', image: { imageId: 'img_9' } }] });
    renderWithAuth(<Play session={session} setSession={vi.fn()} onExit={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('img[src*="img_9"]')).toBeTruthy());
    expect(screen.queryByText('この場面を描く')).not.toBeInTheDocument();
  });

  it('生成失敗時はエラーを表示しimageIdを保存しない', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    sceneImageClient.generateSceneImage.mockRejectedValueOnce(new Error('boom'));
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: 'ログ' }] });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('この場面を描く')).toBeInTheDocument());
    fireEvent.click(screen.getByText('この場面を描く'));
    await waitFor(() => expect(screen.getByText(/挿絵の生成に失敗/)).toBeInTheDocument());
    expect(document.querySelector('img')).toBeFalsy();
  });
```

注意: `makeSession` の既定 log は空で初回自動ターンが走る。上記テストは `log` に既存GMエントリを与え自動ターンを止めている(既存 `does not request an opening scene...` と同じ手法)。`Harness` は既存のstateful wrapper。

- [ ] **Step 3: 失敗を確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: FAIL(ボタン・img・エラーが未実装)

- [ ] **Step 4: Play に実装**

`src/screens/Play.jsx` を編集:

1. import 追加(`useTypewriter` import の下):

```jsx
import { generateSceneImage, sceneImageUrl, getConfig } from '../api/sceneImageClient.js';
```

2. Play本体、`const [narrating, setNarrating] = useState(false);` の下に state 追加:

```jsx
  const [imageGen, setImageGen] = useState(false);
  const [generatingIndex, setGeneratingIndex] = useState(null);
  const [imageError, setImageError] = useState(null); // { index, message } | null
```

3. マウント時に機能検出(`useEffect` 群のいずれかの近く、`runTurn` 定義の後あたり):

```jsx
  useEffect(() => {
    getConfig()
      .then((c) => setImageGen(!!c.imageGen))
      .catch(() => setImageGen(false));
  }, []);
```

4. 生成関数を **`runTurn` の `useCallback` 定義より前**(state宣言の直後)に追加する。`illustrate` は `runTurn` に依存しないため前方に置いてよく、Task 9 が `runTurn` から参照するのを容易にする。`baseSession` を引数に取り自動生成でも再利用する:

```jsx
  const illustrate = useCallback(
    async (baseSession, i) => {
      if (generatingIndex !== null) return;
      setGeneratingIndex(i);
      setImageError(null);
      try {
        const { imageId, newAppearances } = await generateSceneImage(baseSession.id, i);
        const appearances = { ...(baseSession.appearances || {}) };
        for (const a of newAppearances || []) appearances[a.name] = { name: a.name, description: a.description };
        const updated = {
          ...baseSession,
          log: baseSession.log.map((e, idx) => (idx === i ? { ...e, image: { imageId } } : e)),
          appearances,
          updatedAt: Date.now(),
        };
        setSession(updated);
        await saveSession(updated);
        putSessionToServer(updated).catch((e) => console.error('session server sync failed', e));
      } catch (e) {
        setImageError({ index: i, message: '挿絵の生成に失敗した: ' + e.message });
      } finally {
        setGeneratingIndex(null);
      }
    },
    [generatingIndex, setSession]
  );
```

5. GMログエントリ描画(`<Card key={i}>` 内、`<Stamp ... />` の直前)に挿絵ブロックを追加:

```jsx
                {entry.image?.imageId && (
                  <img
                    src={sceneImageUrl(session.id, entry.image.imageId)}
                    alt="場面の挿絵"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      maxWidth: '100%',
                      borderRadius: 6,
                      border: `1px solid ${COLORS.line}`,
                      marginBottom: 10,
                    }}
                  />
                )}
                {imageGen && !entry.image?.imageId && (
                  <div style={{ marginBottom: 8 }}>
                    {generatingIndex === i ? (
                      <span style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>挿絵を描いています…</span>
                    ) : (
                      <Button variant="ghost" onClick={() => illustrate(session, i)} disabled={generatingIndex !== null}>
                        この場面を描く
                      </Button>
                    )}
                    {imageError && imageError.index === i && (
                      <div style={{ color: COLORS.stamp, fontSize: 12, marginTop: 4 }}>{imageError.message}</div>
                    )}
                  </div>
                )}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS(既存テスト含む)

- [ ] **Step 6: Commit**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "feat(ui): Play画面にシーン挿絵の表示と手動生成を追加"
```

---

### Task 9: Play画面 — シーン変化時の自動生成トグル

**Files:**
- Modify: `src/screens/Play.jsx`
- Test: `src/screens/Play.test.jsx`

**Interfaces:**
- Consumes: `illustrate(baseSession, i)`(Task 8)、`session.autoIllustrate`(データモデル)。

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Play.test.jsx` に追加:

```jsx
  it('autoIllustrate ON かつシーン変化ターンで新GMエントリの生成を自動発火する', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    sceneImageClient.generateSceneImage.mockResolvedValue({ imageId: 'img_a', newAppearances: [] });
    // 開始ターンのレースを避けるため既存ログ付き(=自動開始ターンは走らない)。
    // getConfig解決でimageGen=true確定後にプレイヤー入力ターンを発火する。
    const session = makeSession({ id: 's1', autoIllustrate: true, log: [{ role: 'gm', text: '最初の場面' }] });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(sceneImageClient.getConfig).toHaveBeenCalled());
    // 送信ターンのGM応答: シーンを「冒頭」から「森」へ変える
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ narrative: '森へ入った', state_update: { current_scene: '森' }, choices: [] }) }],
      }),
    });
    const box = screen.getByPlaceholderText('PCの行動を自由に書く…');
    fireEvent.change(box, { target: { value: '森へ' } });
    fireEvent.click(screen.getByText('送る'));
    await waitFor(() => expect(screen.getByText('森へ入った')).toBeInTheDocument());
    await waitFor(() => expect(sceneImageClient.generateSceneImage).toHaveBeenCalledWith('s1', expect.any(Number)));
  });

  it('自動トグルの切り替えをsessionへ保存する', async () => {
    sceneImageClient.getConfig.mockResolvedValueOnce({ imageGen: true });
    const saveSpy = vi.spyOn(storage, 'saveSession');
    const session = makeSession({ id: 's1', log: [{ role: 'gm', text: 'ログ' }] });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('挿絵を自動生成')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('挿絵を自動生成'));
    await waitFor(() => {
      const lastCall = saveSpy.mock.calls.at(-1);
      expect(lastCall?.[0]?.autoIllustrate).toBe(true);
    });
  });
```

注意: 既存の `beforeEach` は `global.fetch` を「物語が始まった。」で解決するようスタブ済み。1つ目のテストは送信直前に `mockResolvedValue` で上書きする。`getByLabelText('挿絵を自動生成')` は、チェックボックスを内包する `<label>` のテキストをアクセシブル名として引く。

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: FAIL(トグル未実装・自動発火なし)

- [ ] **Step 3: Play に実装**

`src/screens/Play.jsx` を編集:

1. `runTurn` 内、`setSession(updated);` と保存処理の後(`return true;` の直前)にシーン変化時の自動生成を追加:

```jsx
        const sceneChanged =
          !!norm.stateUpdate.current_scene && norm.stateUpdate.current_scene !== session.state.current_scene;
        if (imageGen && updated.autoIllustrate && sceneChanged) {
          const gmIndex = updated.log.length - 1;
          illustrate(updated, gmIndex);
        }
```

`runTurn` の `useCallback` 依存配列に `imageGen` と `illustrate` を追加する(既存 `[session, setSession, user]` → `[session, setSession, user, imageGen, illustrate]`)。`illustrate` は Task 8 で既に `runTurn` より前に定義済みのため、そのまま参照できる(移動不要)。

2. トグルUI。ヘッダ部の「ホームへ」ボタン(`<Button variant="ghost" onClick={onExit}>`)の直前に追加:

```jsx
        {imageGen && (
          <label
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, marginRight: 12 }}
          >
            <input
              type="checkbox"
              checked={!!session.autoIllustrate}
              onChange={(e) => {
                const updated = { ...session, autoIllustrate: e.target.checked, updatedAt: Date.now() };
                setSession(updated);
                saveSession(updated);
                putSessionToServer(updated).catch((err) => console.error('session server sync failed', err));
              }}
            />
            挿絵を自動生成
          </label>
        )}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS(既存含む)

- [ ] **Step 5: Commit**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "feat(ui): シーン変化での挿絵自動生成トグルを追加"
```

---

### Task 10: ドキュメント更新

**Files:**
- Modify: `docs/05-ui-ux.md`, `docs/06-content-generation.md`, `docs/07-risks-and-roadmap.md`, `docs/08-feature-ideas.md`

- [ ] **Step 1: ドキュメントを更新**

- `docs/05-ui-ux.md` 7章に追記(実装済み 2026-07-24):
  「シーン挿絵: GMログエントリ毎に、地の文の上に生成挿絵を表示(`src/screens/Play.jsx` + `src/api/sceneImageClient.js`)。未生成エントリの『この場面を描く』ボタンで手動生成、ヘッダの『挿絵を自動生成』トグルでシーン変化時に自動生成。Geminiキー未設定(`GET /api/config` の `imageGen:false`)時は挿絵UIを一切出さない。生成失敗・上限はインラインエラー表示。」
- `docs/06-content-generation.md` に節を追加(場面挿絵生成):
  「Gemini(`gemini-2.5-flash-image`、`server/imageProvider.js`)で挿絵を生成する。プロンプトは `server/imagePrompt.js` が地の文+`session.moods`の画風+登場人物の見た目から構築。登場人物の見た目は `server/sceneAnalysis.js`(Anthropicで地の文から登場人物を特定し未登録者の見た目を生成)がセッション専用レジストリ `session.appearances`(名前→見た目)に蓄積し、以降の挿絵で再利用してキャラの一貫性を保つ。シナリオ本文は書き換えない。画像バイトは `server/storage/imageStore.js` がファイル保存し、`GET /api/sessions/:id/images/:imageId` で配信。セッションJSONには `imageId` 参照のみ。日次上限は `LIMIT_IMAGES_PER_DAY`。**未実装(後続)**: 挿絵付き小説化、キャラポートレート+参照画像による強い一貫性。」
- `docs/07-risks-and-roadmap.md` Phase 3 の「画像生成連携(シーン挿絵)」を「サブプロジェクト1(基盤+Playシーン挿絵+テキスト方式の見た目一貫性)実装済み(2026-07-24)。挿絵付き小説化・キャラポートレートは後続」に更新。
- `docs/08-feature-ideas.md` 1.1 の冒頭に「**サブプロジェクト1 実装済み(2026-07-24)**: 基盤+Playシーン挿絵+見た目レジストリ。挿絵付き小説化(3)・ポートレート(4)は後続」を追記。

- [ ] **Step 2: 全体テスト**

Run: `npm test`
Expected: 全suite PASS

- [ ] **Step 3: Commit**

```bash
git add docs/05-ui-ux.md docs/06-content-generation.md docs/07-risks-and-roadmap.md docs/08-feature-ideas.md
git commit -m "docs: 場面挿絵生成(サブプロジェクト1)を実装済みとして反映"
```
