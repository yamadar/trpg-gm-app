# 挿絵付き小説化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セッションの挿絵(GMログエントリの `image.imageId`)を小説化Markdownへ `〈挿絵N〉` マーカー方式で差し込み、base64埋め込みの挿絵付き `.md` をダウンロードできるようにする。

**Architecture:** 純関数2モジュール(`novelMarkers`=マーカー入りトランスクリプト生成/除去、`illustratedNovel`=マーカー→data URI置換+取りこぼし救済)を土台に、novelizeルートがマーカー入り `novel.md` とメタ `imageIds` を保存。`GET /novel` はマーカー除去、`GET /novel/illustrated` が挿絵付きMarkdownを返す。公開小説はコピー時にマーカー除去。Homeに「挿絵付き」ボタン(挿絵ありセッションのみ)。

**Tech Stack:** Node/Express + vitest + supertest、React 18 + testing-library。新規依存なし。

## Global Constraints

- マーカー形式: `〈挿絵N〉`(N=1始まり)、正規表現 `/〈挿絵(\d+)〉/g`。
- 挿絵位置: 挿絵を持つGMエントリの**直前**行。`imageIds[N-1]` が対応imageId。
- プレーン `.md`(`GET /novel`)と公開小説はマーカー除去済みを返す/保存する。
- 挿絵付きダウンロードのファイル名: `${sanitizeFilename(title)}-挿絵付き.md`。
- UI文言・コメントは日本語。新規npm依存禁止。コミット末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- テスト: 個別 `npx vitest run <path>`、全体 `npm test`。

## ファイル構成

- Create: `server/novelMarkers.js`(+test), `server/illustratedNovel.js`(+test)
- Modify: `server/routes/sessions.js`(novelize/GET /novel/新GET illustrated、`imageStore` 受け取り), `server/index.js`(sessionsルーターへ `imageStore` を渡す), `server/storage/shareLibrary.js`(publishNovelでstrip), `src/api/sessionSyncClient.js`, `src/screens/Home.jsx`(+各test)

---

### Task 1: novelMarkers(マーカー入りトランスクリプト+除去)

**Files:**
- Create: `server/novelMarkers.js`
- Create: `server/novelMarkers.test.js`

**Interfaces:**
- Produces: `buildTranscriptWithMarkers(log) -> { transcript, imageIds }` / `stripImageMarkers(text) -> string`。Task 3, 4 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`server/novelMarkers.test.js`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildTranscriptWithMarkers, stripImageMarkers } from './novelMarkers.js';

describe('buildTranscriptWithMarkers', () => {
  it('挿絵を持つGMエントリの直前にマーカー行を挿入し、imageIdsを出現順で返す', () => {
    const log = [
      { role: 'player', text: '進む' },
      { role: 'gm', text: '森だ', image: { imageId: 'img_a' } },
      { role: 'gm', text: '奥へ' },
      { role: 'gm', text: '洞窟だ', image: { imageId: 'img_b' } },
    ];
    const { transcript, imageIds } = buildTranscriptWithMarkers(log);
    expect(imageIds).toEqual(['img_a', 'img_b']);
    expect(transcript).toBe('PL: 進む\n〈挿絵1〉\nGM: 森だ\nGM: 奥へ\n〈挿絵2〉\nGM: 洞窟だ');
  });
  it('挿絵が無ければ従来のトランスクリプトと同一でimageIdsは空', () => {
    const log = [{ role: 'gm', text: 'a' }, { role: 'player', text: 'b' }];
    const { transcript, imageIds } = buildTranscriptWithMarkers(log);
    expect(imageIds).toEqual([]);
    expect(transcript).toBe('GM: a\nPL: b');
  });
  it('空・未定義logで例外を投げない', () => {
    expect(buildTranscriptWithMarkers([]).transcript).toBe('');
    expect(buildTranscriptWithMarkers(undefined).imageIds).toEqual([]);
  });
});

describe('stripImageMarkers', () => {
  it('独立行のマーカーは行ごと除去し、連続空行を畳む', () => {
    expect(stripImageMarkers('前\n〈挿絵1〉\n後')).toBe('前\n後');
  });
  it('本文中に紛れたマーカーも除去する', () => {
    expect(stripImageMarkers('これは〈挿絵2〉テスト')).toBe('これはテスト');
  });
  it('マーカーが無ければ不変', () => {
    expect(stripImageMarkers('そのまま')).toBe('そのまま');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/novelMarkers.test.js`
Expected: FAIL — モジュールなし

- [ ] **Step 3: 実装**

`server/novelMarkers.js`:

```js
// 小説化トランスクリプトへの挿絵マーカーの埋め込みと除去。
// マーカーは「〈挿絵N〉」(N=1始まり)で、imageIds[N-1] が対応する imageId。
export const IMAGE_MARKER_RE = /〈挿絵(\d+)〉/g;

export function buildTranscriptWithMarkers(log) {
  const lines = [];
  const imageIds = [];
  for (const entry of log || []) {
    if (entry.role === 'gm' && entry.image?.imageId) {
      imageIds.push(entry.image.imageId);
      lines.push(`〈挿絵${imageIds.length}〉`);
    }
    lines.push(`${entry.role === 'player' ? 'PL' : 'GM'}: ${entry.text}`);
  }
  return { transcript: lines.join('\n'), imageIds };
}

export function stripImageMarkers(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(IMAGE_MARKER_RE, ''))
    .filter((line, i, arr) => {
      // マーカー除去で空になった行は除去(元から空の行は保持)
      const wasMarkerOnly = line === '' && /〈挿絵\d+〉/.test((text.split('\n'))[i] ?? '');
      return !wasMarkerOnly;
    })
    .join('\n');
}
```

注意: `stripImageMarkers` の実装は「マーカーだけの行は行ごと消え、本文中のマーカーは文字列としてだけ消える」ことがテストで担保されればよい。上記が煩雑になる場合は、`text.replace(/^〈挿絵\d+〉$\n?/gm, '').replace(IMAGE_MARKER_RE, '')` のような2段replaceに単純化してよい(テストが通ることが基準)。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/novelMarkers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/novelMarkers.js server/novelMarkers.test.js
git commit -m "feat(server): 小説化トランスクリプトの挿絵マーカー埋め込み・除去を追加"
```

---

### Task 2: illustratedNovel(マーカー→data URI置換)

**Files:**
- Create: `server/illustratedNovel.js`
- Create: `server/illustratedNovel.test.js`

**Interfaces:**
- Consumes: `IMAGE_MARKER_RE`(Task 1)
- Produces: `buildIllustratedMarkdown({ novelText, imageIds, images }) -> string`(`images: Map<imageId, Buffer|null>`)。Task 3 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`server/illustratedNovel.test.js`:

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildIllustratedMarkdown } from './illustratedNovel.js';

const bufA = Buffer.from([1, 2, 3]);
const bufB = Buffer.from([4, 5]);
const uriA = `data:image/png;base64,${bufA.toString('base64')}`;

describe('buildIllustratedMarkdown', () => {
  it('本文中のマーカーをdata URIのMarkdown画像に置換する', () => {
    const out = buildIllustratedMarkdown({
      novelText: '冒頭\n〈挿絵1〉\n本文',
      imageIds: ['img_a'],
      images: new Map([['img_a', bufA]]),
    });
    expect(out).toBe(`冒頭\n![挿絵1](${uriA})\n本文`);
  });
  it('範囲外番号・画像nullのマーカーは除去する', () => {
    const out = buildIllustratedMarkdown({
      novelText: 'x〈挿絵9〉y\n〈挿絵1〉',
      imageIds: ['img_a'],
      images: new Map([['img_a', null]]),
    });
    expect(out).not.toContain('挿絵9');
    expect(out).not.toContain('data:');
  });
  it('本文に現れなかった画像は末尾の「## 挿絵」節にまとめる', () => {
    const out = buildIllustratedMarkdown({
      novelText: '本文のみ',
      imageIds: ['img_a', 'img_b'],
      images: new Map([['img_a', bufA], ['img_b', bufB]]),
    });
    expect(out).toContain('## 挿絵');
    expect(out).toContain(`![挿絵1](${uriA})`);
    expect(out).toContain('![挿絵2](data:image/png;base64,');
  });
  it('重複マーカーは最初だけ置換し以降は除去する', () => {
    const out = buildIllustratedMarkdown({
      novelText: '〈挿絵1〉\n中\n〈挿絵1〉',
      imageIds: ['img_a'],
      images: new Map([['img_a', bufA]]),
    });
    expect(out.match(/data:image\/png/g)).toHaveLength(1);
  });
  it('マーカーも画像も無ければ本文は不変', () => {
    expect(buildIllustratedMarkdown({ novelText: 'plain', imageIds: [], images: new Map() })).toBe('plain');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/illustratedNovel.test.js`
Expected: FAIL — モジュールなし

- [ ] **Step 3: 実装**

`server/illustratedNovel.js`:

```js
import { IMAGE_MARKER_RE } from './novelMarkers.js';

function toDataUri(buf) {
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// novelText中の〈挿絵N〉を data URI 画像に置換する。
// - 範囲外番号・画像なし(null)は除去
// - 同じ番号の2回目以降は除去
// - 本文に現れなかった番号で画像があるものは末尾「## 挿絵」節に救済(取りこぼしゼロ)
export function buildIllustratedMarkdown({ novelText, imageIds = [], images = new Map() }) {
  const used = new Set();
  const body = String(novelText ?? '').replace(IMAGE_MARKER_RE, (match, numStr) => {
    const n = Number(numStr);
    const imageId = imageIds[n - 1];
    if (!imageId || used.has(n)) return '';
    const buf = images.get(imageId);
    if (!buf) return '';
    used.add(n);
    return `![挿絵${n}](${toDataUri(buf)})`;
  });
  const leftovers = imageIds
    .map((imageId, idx) => ({ n: idx + 1, buf: images.get(imageId) }))
    .filter(({ n, buf }) => !used.has(n) && buf);
  if (leftovers.length === 0) return body;
  const tail = leftovers.map(({ n, buf }) => `![挿絵${n}](${toDataUri(buf)})`).join('\n\n');
  return `${body}\n\n## 挿絵\n\n${tail}\n`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/illustratedNovel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/illustratedNovel.js server/illustratedNovel.test.js
git commit -m "feat(server): 挿絵マーカーをbase64画像へ置換するMarkdown組み立てを追加"
```

---

### Task 3: sessionsルート改修(マーカー保存・strip・illustrated)

**Files:**
- Modify: `server/routes/sessions.js`
- Modify: `server/index.js`(1行)
- Test: `server/routes/sessions.test.js`(追記)

**Interfaces:**
- Consumes: `buildTranscriptWithMarkers`/`stripImageMarkers`(Task 1)、`buildIllustratedMarkdown`(Task 2)、`imageStore`/`sessionImagePath`(SP1)。
- Produces: `createSessionsRouter({ dataStore, textStore, imageStore, apiKey, fetchImpl, usage })`(`imageStore` 追加)。`GET /api/sessions/:id/novel/illustrated` → `{ markdown }`。Task 5 が使用。

- [ ] **Step 1: 失敗するテストを書く**

`server/routes/sessions.test.js` に追記。まず `buildApp`/import を拡張:

1. import追加: `import { createFsImageStore } from '../storage/imageStore.js';` と `import { sessionImagePath } from '../storage/paths.js';`
2. `let imageStore;` を追加し、`beforeEach` で `imageStore = createFsImageStore(dir);`、`buildApp` の `createSessionsRouter({...})` に `imageStore` を渡す。

テスト追記(既存describe内、novelize系テストの近く。novelize系既存テストの `fetchImpl` モック形式に合わせる):

```js
  it('挿絵付きセッションのnovelizeはマーカー入りnovel.mdとメタimageIdsを保存する', async () => {
    await request(app).put('/api/sessions/s1').send({
      title: 'T',
      state: { turn_count: 1 },
      log: [{ role: 'gm', text: '森', image: { imageId: 'img_a' } }],
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '小説本文\n〈挿絵1〉\n続き' }] }),
    });
    buildApp({ fetchImpl });
    const res = await request(app).post('/api/sessions/s1/novelize').send({});
    expect(res.status).toBe(200);
    // upstreamへ渡したトランスクリプトにマーカーが含まれる
    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sentBody.messages[0].content).toContain('〈挿絵1〉');
    expect(sentBody.system).toContain('挿絵挿入位置');
    // novel.mdはマーカー入り、メタにimageIds
    const saved = await textStore.read('users/usr_test/sessions/s1/novel.md');
    expect(saved).toContain('〈挿絵1〉');
    const meta = await dataStore.get('users/usr_test/sessions/s1/novel');
    expect(meta.imageIds).toEqual(['img_a']);
  });

  it('挿絵なしセッションのnovelizeはシステムプロンプトにマーカー指示を含めない', async () => {
    await request(app).put('/api/sessions/s2').send({ title: 'T', state: {}, log: [{ role: 'gm', text: 'x' }] });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: 'text', text: '本文' }] }) });
    buildApp({ fetchImpl });
    await request(app).post('/api/sessions/s2/novelize').send({});
    const sentBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sentBody.system).not.toContain('挿絵挿入位置');
  });

  it('GET /novel はマーカーを除去したプレーン本文を返す', async () => {
    await request(app).put('/api/sessions/s3').send({ title: 'T', state: {}, log: [] });
    await textStore.write('users/usr_test/sessions/s3/novel.md', '前\n〈挿絵1〉\n後');
    const res = await request(app).get('/api/sessions/s3/novel');
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('前\n後');
  });

  it('GET /novel/illustrated は挿絵入りMarkdownを返す', async () => {
    await request(app).put('/api/sessions/s4').send({ title: 'T', state: {}, log: [] });
    await textStore.write('users/usr_test/sessions/s4/novel.md', '前\n〈挿絵1〉\n後');
    await dataStore.set('users/usr_test/sessions/s4/novel', { turnCount: 0, updatedAt: 1, imageIds: ['img_a'] });
    await imageStore.write(sessionImagePath('usr_test', 's4', 'img_a'), Buffer.from([1, 2]));
    const res = await request(app).get('/api/sessions/s4/novel/illustrated');
    expect(res.status).toBe(200);
    expect(res.body.markdown).toContain('![挿絵1](data:image/png;base64,');
    expect(res.body.markdown).not.toContain('〈挿絵1〉');
  });

  it('GET /novel/illustrated は小説未生成なら404', async () => {
    await request(app).put('/api/sessions/s5').send({ title: 'T', state: {}, log: [] });
    const res = await request(app).get('/api/sessions/s5/novel/illustrated');
    expect(res.status).toBe(404);
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/routes/sessions.test.js`
Expected: 追記分がFAIL(既存はPASS)

- [ ] **Step 3: 実装**

`server/routes/sessions.js`:

1. import追加:

```js
import { sessionKey, sessionNovelDocPath, sessionNovelMetaKey, sessionListPrefix, sessionImagePath } from '../storage/paths.js';
import { buildTranscriptWithMarkers, stripImageMarkers } from '../novelMarkers.js';
import { buildIllustratedMarkdown } from '../illustratedNovel.js';
```

(既存の paths import 行を置き換えて `sessionImagePath` を追加)

2. `logToTranscript` 関数は削除(novelMarkersに置き換え)。
3. シグネチャ変更: `createSessionsRouter({ dataStore, textStore, imageStore, apiKey, fetchImpl = fetch, usage })`。
4. novelize内 `const transcript = logToTranscript(session.log);` を:

```js
    const { transcript, imageIds } = buildTranscriptWithMarkers(session.log);
```

システムプロンプト: `system: buildNovelizeSystemPrompt(req.body?.pov === 'first' ? 'first' : 'third') + (imageIds.length > 0 ? MARKER_INSTRUCTION : ''),`

ファイル冒頭に追加:

```js
const MARKER_INSTRUCTION =
  '\nトランスクリプト中の〈挿絵N〉は対応する場面の挿絵挿入位置である。小説本文の対応する場面の切れ目に、各マーカーを一度だけ行独立でそのまま残すこと。';
```

メタ保存を変更:

```js
      await dataStore.set(sessionNovelMetaKey(req.userId, req.params.id), {
        turnCount: session.state?.turn_count ?? null,
        updatedAt: Date.now(),
        imageIds,
      });
```

5. `GET /sessions/:id/novel` の返却を `res.json({ text: stripImageMarkers(text), stale });` に変更。
6. 新ルート(GET /novel の後に追加):

```js
  router.get('/sessions/:id/novel/illustrated', asyncHandler(async (req, res) => {
    const text = await textStore.read(sessionNovelDocPath(req.userId, req.params.id));
    if (text === null) {
      res.status(404).json({ error: 'novel not found' });
      return;
    }
    const meta = await dataStore.get(sessionNovelMetaKey(req.userId, req.params.id));
    const imageIds = Array.isArray(meta?.imageIds) ? meta.imageIds : [];
    const images = new Map();
    for (const imageId of imageIds) {
      images.set(imageId, await imageStore.read(sessionImagePath(req.userId, req.params.id, imageId)));
    }
    res.json({ markdown: buildIllustratedMarkdown({ novelText: text, imageIds, images }) });
  }));
```

`server/index.js` の `createSessionsRouter({ dataStore, textStore, apiKey, fetchImpl, usage })` に `imageStore` を追加。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/sessions.test.js server/index.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/sessions.js server/routes/sessions.test.js server/index.js
git commit -m "feat(server): 小説化に挿絵マーカーを導入しillustratedエンドポイントを追加"
```

---

### Task 4: 公開小説のマーカー除去

**Files:**
- Modify: `server/storage/shareLibrary.js`(`publishNovel`、108-112行付近)
- Test: `server/storage/shareLibrary.test.js`(追記)

**Interfaces:**
- Consumes: `stripImageMarkers`(Task 1)

- [ ] **Step 1: 失敗するテストを書く**

`server/storage/shareLibrary.test.js` の既存 `publishNovel` 系テストに合わせて追記(セッション+novel.mdをseedする既存パターンを流用):

```js
  it('公開小説にはマーカーが含まれない', async () => {
    // 既存のpublishNovelテストと同じseed手順で、novel.mdに '前\n〈挿絵1〉\n後' を書いてから公開する
    // 公開後: textStore.read(publicNovelDocPath(publicId)) が '前\n後' であること
  });
```

(既存テストのseed関数名に合わせて具体化する。アサートの核心は `expect(publicText).toBe('前\n後')`)

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run server/storage/shareLibrary.test.js`
Expected: 追記分FAIL

- [ ] **Step 3: 実装**

`server/storage/shareLibrary.js`:

1. import追加: `import { stripImageMarkers } from '../novelMarkers.js';`
2. `publishNovel` 内 `await textStore.write(publicNovelDocPath(publicId), text);` を:

```js
  await textStore.write(publicNovelDocPath(publicId), stripImageMarkers(text));
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/storage/shareLibrary.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/storage/shareLibrary.js server/storage/shareLibrary.test.js
git commit -m "fix(server): 公開小説から挿絵マーカーを除去"
```

---

### Task 5: クライアント(getIllustratedNovel + Homeボタン)

**Files:**
- Modify: `src/api/sessionSyncClient.js`
- Modify: `src/screens/Home.jsx`
- Test: `src/api/sessionSyncClient.test.js`, `src/screens/Home.test.jsx`(追記)

**Interfaces:**
- Consumes: `GET /api/sessions/:id/novel/illustrated`(Task 3)
- Produces: `getIllustratedNovel(id) -> Promise<{ markdown }>`

- [ ] **Step 1: 失敗するテストを書く**

`src/api/sessionSyncClient.test.js` に追記(既存のfetchモックパターンに合わせる):

```js
  it('getIllustratedNovel は illustrated エンドポイントをGETする', async () => {
    await getIllustratedNovel('s 1');
    expect(fetch).toHaveBeenCalledWith('/api/sessions/s%201/novel/illustrated', { method: 'GET' });
  });
```

`src/screens/Home.test.jsx` に追記(既存のセッションseed・renderパターンに合わせる):

```jsx
  it('挿絵のあるセッションにのみ「挿絵付き」ボタンを表示する', async () => {
    // セッション2件をseed: 1件は log に image 付きGMエントリ、もう1件は挿絵なし
    // 描画後: 「挿絵付き」ボタンが1つだけ存在する
    // (既存テストのセッション作成ヘルパーに合わせて具体化。核心アサートは以下)
    // expect(screen.getAllByText('挿絵付き')).toHaveLength(1);
  });
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/api/sessionSyncClient.test.js src/screens/Home.test.jsx`
Expected: 追記分FAIL

- [ ] **Step 3: 実装**

`src/api/sessionSyncClient.js` に追加:

```js
export async function getIllustratedNovel(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/novel/illustrated`, { method: 'GET' });
}
```

`src/screens/Home.jsx`:

1. import変更: `import { novelizeSession, getNovel, getIllustratedNovel } from '../api/sessionSyncClient.js';`
2. ダウンロード共通化のため、`handleNovelize` 内のBlobダウンロード部を小関数に抽出:

```jsx
  function downloadMarkdown(filename, text) {
    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
```

(`handleNovelize` は `downloadMarkdown(`${sanitizeFilename(session.title)}.md`, text)` を呼ぶ形に置き換え)

3. 挿絵付きハンドラを追加(`handleNovelize` の下):

```jsx
  async function handleNovelizeIllustrated(e, session) {
    e.stopPropagation();
    setNovelizing((prev) => ({ ...prev, [session.id]: true }));
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      await novelizeSession(session.id);
      const { markdown } = await getIllustratedNovel(session.id);
      downloadMarkdown(`${sanitizeFilename(session.title)}-挿絵付き.md`, markdown);
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: '挿絵付き小説化に失敗した: ' + err.message }));
    } finally {
      setNovelizing((prev) => {
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
    }
  }
```

4. ボタン追加(既存「小説化」Buttonの直後):

```jsx
                      {s.log?.some((en) => en.role === 'gm' && en.image?.imageId) && (
                        <Button
                          variant="ghost"
                          onClick={(e) => handleNovelizeIllustrated(e, s)}
                          disabled={!!novelizing[s.id] || !user}
                          style={{ fontSize: 11, padding: '4px 8px' }}
                        >
                          挿絵付き
                        </Button>
                      )}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/sessionSyncClient.test.js src/screens/Home.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/sessionSyncClient.js src/screens/Home.jsx src/api/sessionSyncClient.test.js src/screens/Home.test.jsx
git commit -m "feat(ui): 挿絵付き小説のダウンロードボタンを追加"
```

---

### Task 6: ドキュメント更新 + 全体テスト

**Files:**
- Modify: `docs/06-content-generation.md`(10.5節の「未実装(後続)」を更新), `docs/05-ui-ux.md`(14.1 ホーム画面), `docs/08-feature-ideas.md`(1.1)

- [ ] **Step 1: docs更新**

- `docs/06-content-generation.md` 10.5節末尾の「**未実装(後続)**」行を更新: 挿絵付き小説化を実装済み(2026-07-24)へ移し、マーカー方式(`server/novelMarkers.js`・`server/illustratedNovel.js`、`GET /api/sessions/:id/novel/illustrated`、プレーン`.md`/公開小説はマーカー除去)を1〜2文で記載。キャラポートレート+参照画像は引き続き未実装(サブプロジェクト3)。
- `docs/05-ui-ux.md` 14.1節: セッションカードの「小説化」に加え、挿絵ありセッションのみ「挿絵付き」ボタン(base64埋め込みMarkdown)がある旨を追記。
- `docs/08-feature-ideas.md` 1.1: 「サブプロジェクト2(挿絵付き小説化)実装済み(2026-07-24)」を追記。

- [ ] **Step 2: 全体テスト**

Run: `npm test`
Expected: 全suite PASS

- [ ] **Step 3: Commit**

```bash
git add docs/06-content-generation.md docs/05-ui-ux.md docs/08-feature-ideas.md
git commit -m "docs: 挿絵付き小説化(サブプロジェクト2)を実装済みとして反映"
```
