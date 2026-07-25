# スターターコンテンツ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公式サンプルの世界観7パック(世界観・シナリオ・PC2体・NPC2体)をリポジトリに収録し、公式アカウント名義で公開ギャラリーへシードして、Homeの空状態から1クリックで一括インポート→Setupへ直行できるようにする。

**Architecture:** 素材の正本は `content/starters/` に Markdown + `pack.json` で置く(`server/data/` は gitignore 済みのため)。`server/starters/loadPacks.js` が読み込みと検証を行い、`server/starters/seed.js` が公式ユーザー `usr_official` のライブラリへ保存したうえで既存の `publishWorld` / `publishScenario` / `publishCharacter` で公開し、採番された `publicId` をマニフェスト `public/starters` に書く。API は `GET /api/starters`(認証不要)と `POST /api/starters/:packId/import`(認証必須)の2本だけを既存ルーターに足し、インポート本体は既存の `importWorld` / `importScenario` / `importCharacter` を再利用する。

**Tech Stack:** React 18(ビルドツールなしの inline style)、Express 4、vitest + @testing-library/react + supertest、fs ベースの `dataStore` / `textStore`。

**設計spec:** [docs/superpowers/specs/2026-07-25-starter-content-design.md](../specs/2026-07-25-starter-content-design.md)

## Global Constraints

- ブランチは `feat/starter-content`。main へ直接コミットしない。
- テスト: 単一ファイルは `npx vitest run <path>`、全体は `npm test`。**着手時点のベースラインは 110 files / 1145 tests, all pass**。これを壊さない。
- `server/routes/characters.test.js` の「lists characters scoped to world and kind」は並列実行時にタイムアウトする既知のフレーク。落ちたら単体で再実行して確認する。
- UI文言・素材本文はすべて日本語。コメントも既存に倣い日本語で、「なぜ」を書く(「何を」はコードが語る)。
- スタイルは inline style + `src/theme.js` の `COLORS` / `F_DISPLAY` / `F_BODY` / `F_MONO`。CSSファイルは追加しない。
- テストファイルは実装ファイルと同じディレクトリに `<name>.test.js(x)`。**サーバー側のテストは冒頭に `// @vitest-environment node` が必要。**
- **サーバーは `src/` を import できない**(既存の制約)。`server/starters/` から `src/` を参照しない。
- **キャラクターの `name` は `^[A-Za-z0-9._-]+$` のみ**(`server/routes/validateId.js` の `isValidId`、`characters.js` の `router.param('name', idParamGuard)`)。日本語名を `name` にすると保存は通るが以後の GET が 400 になる。**日本語表記はシート本文の `PC名:` / `NPC名:` 行に持つ。**
- `moods` は `server/storage/moods.js` の8語彙(`ホラー`/`冒険`/`ミステリー`/`日常`/`SF`/`ファンタジー`/`コメディ`/`シリアス`)のみ。
- `recommendedRuleset` は `simple` / `coc7e` / `dnd5e` / `gurps` のみ。
- **既存の `slugify` と `isValidId` は変更しない。** Task 1 の `preferredId` で回避する。
- 権利方針: PD作品に基づくパックは `pack.json` の `source` に出典を書く。オリジナルは `source: null`。**「バルスーム」「ジョン・カーター」は商標なので使わない**(パック名は「死にゆく火星」、登場人物もオリジナル)。

---

## File Structure

**新規作成**

| ファイル | 責務 |
|---|---|
| `content/starters/index.json` | パックIDの表示順 |
| `content/starters/{packId}/pack.json` | パックのメタ(タイトル・tagline・出典・moods・推奨Ruleset・収録物のid) |
| `content/starters/{packId}/world.md` | 世界観本文 |
| `content/starters/{packId}/scenario.md` | シナリオ本文 |
| `content/starters/{packId}/pc/{name}.md` | PCシート ×2 |
| `content/starters/{packId}/npc/{name}.md` | NPCシート ×2 |
| `server/starters/loadPacks.js` | `content/starters/` の読み込みと検証 |
| `server/starters/seed.js` | 公式ユーザーのライブラリへ保存 → 公開 → マニフェスト書き出し |
| `scripts/seedStarters.js` | `npm run seed` 用の薄いCLIラッパ |
| `src/api/starterClient.js` | スターターAPIのクライアント |
| `src/components/share/StarterPackList.jsx` | パックカードの取得・描画・一括インポート(Home と Gallery で共用) |

`server/starters/*.js` と `src/api/starterClient.js`、`StarterPackList.jsx` は同ディレクトリに `.test.js(x)` を伴う。

**変更**

| ファイル | 変更内容 |
|---|---|
| `server/storage/importLibrary.js` | `importWorld` に任意の `{ preferredId }` を追加 |
| `server/storage/paths.js` | `starterManifestKey()` を追加 |
| `server/routes/publicContent.js` | `GET /api/starters` を追加(認証不要) |
| `server/routes/imports.js` | `POST /api/starters/:packId/import` を追加(認証必須) |
| `server/index.js` | 起動時(`NODE_ENV !== 'test'` ブロック)に `seedStarters` を await |
| `package.json` | `"seed": "node scripts/seedStarters.js"` |
| `src/constants/publicContent.js` | `PUBLIC_TABS` の先頭に `{ key: 'starters', label: 'おすすめ' }` |
| `src/screens/Gallery.jsx` | `starters` タブのとき `StarterPackList` を描画 |
| `src/screens/Home.jsx` | セッション0件のとき「はじめての冒険を選ぶ」セクション |
| `src/screens/Setup.jsx` | `starterContext` prop、空状態文言 |
| `src/App.jsx` | `starterContext` state と Setup への受け渡し |
| `docs/02-data-model.md` / `05-ui-ux.md` / `06-content-generation.md` | 追記 |

---

## Task 1: `importWorld` に `preferredId` を追加

日本語タイトルの World は `slugify` が `[^a-z0-9-]` を全除去するため id が `untitled` に潰れる(`slugify('百鬼夜行 — 平安京')` → `'untitled'`)。7パックを順に取り込むと `untitled` / `untitled-2` / … と並ぶ。スターター側から明示的に id を渡せるようにする。

**Files:**
- Modify: `server/storage/importLibrary.js:17-31`
- Test: `server/storage/importLibrary.test.js`

**Interfaces:**
- Consumes: なし
- Produces: `importWorld(dataStore, textStore, userId, publicId, { preferredId } = {}) -> { ok: true, meta } | { ok: false, reason }`。`preferredId` が非空文字列ならそれを id の基底に使い、そうでなければ従来どおり `slugify(pub.title)` を使う。

- [ ] **Step 1: ブランチを作る**

```bash
git checkout -b feat/starter-content
```

- [ ] **Step 2: 失敗するテストを書く**

`server/storage/importLibrary.test.js` の末尾(最後の `});` の直前、`describe('importLibrary', …)` の内側)に追記する:

```js
  describe('importWorld preferredId', () => {
    it('uses preferredId as the base id when given', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: '百鬼夜行 — 平安京', raw: '# 本文' });
      const { meta: pub } = await publishWorld(dataStore, textStore, OWNER.id, 'w1', OWNER);

      const res = await importWorld(dataStore, textStore, 'usr_b', pub.publicId, { preferredId: 'hyakki-yagyo' });

      expect(res.ok).toBe(true);
      expect(res.meta.id).toBe('hyakki-yagyo');
      expect(res.meta.title).toBe('百鬼夜行 — 平安京');
    });

    it('suffixes preferredId on collision', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: '百鬼夜行 — 平安京', raw: '# 本文' });
      const { meta: pub } = await publishWorld(dataStore, textStore, OWNER.id, 'w1', OWNER);

      await importWorld(dataStore, textStore, 'usr_b', pub.publicId, { preferredId: 'hyakki-yagyo' });
      const second = await importWorld(dataStore, textStore, 'usr_b', pub.publicId, { preferredId: 'hyakki-yagyo' });

      expect(second.meta.id).toBe('hyakki-yagyo-2');
    });

    it('falls back to slugify(title) when preferredId is absent or empty', async () => {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'w1', title: 'Ruins Of Alden', raw: '# 本文' });
      const { meta: pub } = await publishWorld(dataStore, textStore, OWNER.id, 'w1', OWNER);

      const noArg = await importWorld(dataStore, textStore, 'usr_b', pub.publicId);
      expect(noArg.meta.id).toBe('ruinsofalden');

      const empty = await importWorld(dataStore, textStore, 'usr_c', pub.publicId, { preferredId: '' });
      expect(empty.meta.id).toBe('ruinsofalden');
    });
  });
```

既存ファイル冒頭の import に `saveWorld` / `publishWorld` / `importWorld` が無ければ足す。既存のテストが使っている変数名(`dataStore` / `textStore` / `OWNER`)をそのまま使うこと。ファイル冒頭を読んで実際の名前に合わせる。

- [ ] **Step 3: テストが失敗することを確認する**

```bash
npx vitest run server/storage/importLibrary.test.js
```

Expected: FAIL — `res.meta.id` が `'untitled'` になり `'hyakki-yagyo'` と一致しない。

- [ ] **Step 4: 実装する**

`server/storage/importLibrary.js` の `importWorld` を差し替える:

```js
// preferredId: 呼び出し側が id を指定できる。slugify は非ASCIIを全除去するため、
// 日本語タイトルのWorldは何を入れても 'untitled' に潰れてしまう。スターターパックの
// ように id が意味を持つ経路のための逃げ道であり、未指定なら従来どおり title から作る。
export async function importWorld(dataStore, textStore, userId, publicId, { preferredId } = {}) {
  const pub = await getPublicWorld(dataStore, textStore, publicId);
  if (!pub) return { ok: false, reason: 'not_found' };
  const base = typeof preferredId === 'string' && preferredId.length > 0 ? preferredId : slugify(pub.title);
  const id = await findAvailable(base, async (c) => (await dataStore.get(worldMetaKey(userId, c))) !== null);
  const world = await saveWorld(dataStore, textStore, userId, {
    id,
    title: pub.title,
    raw: pub.raw,
    moods: pub.moods ?? [],
  });
  for (const region of pub.regions) await saveRegion(textStore, userId, id, region.name, region.raw);
  for (const category of pub.categories) await saveCategory(textStore, userId, id, category.name, category.raw);
  return { ok: true, meta: world };
}
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
npx vitest run server/storage/importLibrary.test.js server/routes/imports.test.js
```

Expected: PASS(既存の `expect(res.body).toMatchObject({ id: 'untitled', … })` も引き続き通ること)

- [ ] **Step 6: コミット**

```bash
git add server/storage/importLibrary.js server/storage/importLibrary.test.js
git commit -m "feat(server): importWorldにpreferredIdを追加し日本語タイトルのid潰れを回避できるようにする"
```

---

## Task 2: パックローダーと1つ目のパック(`arkham-1920s`)

**Files:**
- Create: `content/starters/index.json`
- Create: `content/starters/arkham-1920s/pack.json`
- Create: `content/starters/arkham-1920s/world.md`
- Create: `content/starters/arkham-1920s/scenario.md`
- Create: `content/starters/arkham-1920s/pc/howard-kane.md`
- Create: `content/starters/arkham-1920s/pc/mabel-thorne.md`
- Create: `content/starters/arkham-1920s/npc/elias-witcham.md`
- Create: `content/starters/arkham-1920s/npc/agnes-reed.md`
- Create: `server/starters/loadPacks.js`
- Test: `server/starters/loadPacks.test.js`

**Interfaces:**
- Consumes: `MOODS`(`server/storage/moods.js`)
- Produces:
  - `STARTERS_DIR` — `content/starters` の絶対パス
  - `loadStarterPacks(dir = STARTERS_DIR) -> Promise<Pack[]>`。検証に失敗したら `Error` を throw する(メッセージにパックIDを含める)
  - `Pack = { id, title, tagline, source: string|null, moods: string[], recommendedRuleset: string, worldRaw: string, scenario: { id, title, raw }, pc: [{ name, raw }, { name, raw }], npc: [{ name, raw }, { name, raw }] }`

- [ ] **Step 1: 失敗するテストを書く**

`server/starters/loadPacks.test.js`(新規):

```js
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { loadStarterPacks, STARTERS_DIR } from './loadPacks.js';
import { MOODS } from '../storage/moods.js';

const RULESET_IDS = ['simple', 'coc7e', 'dnd5e', 'gurps'];
const ID_RE = /^[A-Za-z0-9._-]+$/;

describe('loadStarterPacks', () => {
  it('loads every pack listed in index.json', async () => {
    const packs = await loadStarterPacks();
    expect(packs.length).toBeGreaterThan(0);
    expect(packs.map((p) => p.id)).toContain('arkham-1920s');
  });

  it('gives each pack a title, tagline and a nullable source', async () => {
    for (const pack of await loadStarterPacks()) {
      expect(pack.title.length, pack.id).toBeGreaterThan(0);
      expect(pack.tagline.length, pack.id).toBeGreaterThan(0);
      expect(pack.source === null || typeof pack.source === 'string', pack.id).toBe(true);
    }
  });

  it('uses only known moods and rulesets', async () => {
    for (const pack of await loadStarterPacks()) {
      expect(pack.moods.length, pack.id).toBeGreaterThan(0);
      for (const m of pack.moods) expect(MOODS, pack.id).toContain(m);
      expect(RULESET_IDS, pack.id).toContain(pack.recommendedRuleset);
    }
  });

  // キャラクター名はそのままURLパスになり isValidId(^[A-Za-z0-9._-]+$) で弾かれる。
  // 日本語名を入れると保存は通るのに以後のGETが400になるため、ここで止める。
  it('uses ASCII-safe ids for scenario and characters', async () => {
    for (const pack of await loadStarterPacks()) {
      expect(pack.scenario.id, pack.id).toMatch(ID_RE);
      for (const c of [...pack.pc, ...pack.npc]) expect(c.name, pack.id).toMatch(ID_RE);
    }
  });

  it('ships exactly two PCs and two NPCs per pack, all non-empty', async () => {
    for (const pack of await loadStarterPacks()) {
      expect(pack.pc.length, pack.id).toBe(2);
      expect(pack.npc.length, pack.id).toBe(2);
      expect(pack.worldRaw.trim().length, pack.id).toBeGreaterThan(0);
      expect(pack.scenario.raw.trim().length, pack.id).toBeGreaterThan(0);
      for (const c of [...pack.pc, ...pack.npc]) expect(c.raw.trim().length, `${pack.id}/${c.name}`).toBeGreaterThan(0);
    }
  });

  // サンプルは初回ユーザーが読む「お手本」でもあるので、プレイヤー可視/GM専用の分割を必須にする
  it('splits every scenario into player-visible and GM-only sections', async () => {
    for (const pack of await loadStarterPacks()) {
      expect(pack.scenario.raw, pack.id).toContain('## シナリオ概要');
      expect(pack.scenario.raw, pack.id).toContain('## GM専用情報');
    }
  });

  it('gives every PC a goal and bonds (they feed the parse pipeline)', async () => {
    for (const pack of await loadStarterPacks()) {
      for (const c of pack.pc) {
        expect(c.raw, `${pack.id}/${c.name}`).toContain('goal:');
        expect(c.raw, `${pack.id}/${c.name}`).toContain('bonds:');
      }
    }
  });

  it('throws naming the pack when pack.json is invalid', async () => {
    await expect(loadStarterPacks('/nonexistent/starters')).rejects.toThrow();
  });

  it('exports the content directory path', () => {
    expect(STARTERS_DIR).toMatch(/content[/\\]starters$/);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run server/starters/loadPacks.test.js
```

Expected: FAIL — `Cannot find module './loadPacks.js'`

- [ ] **Step 3: ローダーを実装する**

`server/starters/loadPacks.js`(新規):

```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOODS } from '../storage/moods.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const STARTERS_DIR = path.join(__dirname, '..', '..', 'content', 'starters');

const RULESET_IDS = new Set(['simple', 'coc7e', 'dnd5e', 'gurps']);
// server/routes/validateId.js の isValidId と同じ集合。ここで弾いておかないと、
// 保存は通るのに GET /worlds/:id/characters/:kind/:name が400になる状態で出荷される。
const ID_RE = /^[A-Za-z0-9._-]+$/;

function fail(packId, message) {
  throw new Error(`starter pack "${packId}": ${message}`);
}

async function readDoc(packId, file) {
  const raw = await fs.readFile(file, 'utf-8').catch(() => null);
  if (raw === null || raw.trim().length === 0) fail(packId, `missing or empty document: ${file}`);
  return raw;
}

function requireNonEmptyString(packId, value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(packId, `${field} must be a non-empty string`);
  return value;
}

async function loadCharacters(packId, dir, kind, names) {
  if (!Array.isArray(names) || names.length !== 2) fail(packId, `${kind} must list exactly 2 characters`);
  const out = [];
  for (const name of names) {
    if (typeof name !== 'string' || !ID_RE.test(name)) fail(packId, `${kind} name "${name}" must match ${ID_RE}`);
    const raw = await readDoc(packId, path.join(dir, kind, `${name}.md`));
    if (kind === 'pc' && (!raw.includes('goal:') || !raw.includes('bonds:'))) {
      fail(packId, `pc/${name}.md must declare goal: and bonds:`);
    }
    out.push({ name, raw });
  }
  return out;
}

async function loadPack(rootDir, packId) {
  const dir = path.join(rootDir, packId);
  const metaRaw = await fs.readFile(path.join(dir, 'pack.json'), 'utf-8').catch(() => null);
  if (metaRaw === null) fail(packId, 'pack.json not found');

  let meta;
  try {
    meta = JSON.parse(metaRaw);
  } catch (e) {
    fail(packId, `pack.json is not valid JSON: ${e.message}`);
  }

  if (meta.id !== packId) fail(packId, `pack.json id "${meta.id}" does not match its directory name`);
  requireNonEmptyString(packId, meta.title, 'title');
  requireNonEmptyString(packId, meta.tagline, 'tagline');
  if (meta.source !== null && typeof meta.source !== 'string') fail(packId, 'source must be a string or null');
  if (!Array.isArray(meta.moods) || meta.moods.length === 0) fail(packId, 'moods must be a non-empty array');
  for (const m of meta.moods) if (!MOODS.includes(m)) fail(packId, `unknown mood "${m}"`);
  if (!RULESET_IDS.has(meta.recommendedRuleset)) fail(packId, `unknown recommendedRuleset "${meta.recommendedRuleset}"`);
  if (!meta.scenario || !ID_RE.test(String(meta.scenario.id ?? ''))) fail(packId, `scenario.id must match ${ID_RE}`);
  requireNonEmptyString(packId, meta.scenario.title, 'scenario.title');

  const worldRaw = await readDoc(packId, path.join(dir, 'world.md'));
  const scenarioRaw = await readDoc(packId, path.join(dir, 'scenario.md'));
  if (!scenarioRaw.includes('## シナリオ概要') || !scenarioRaw.includes('## GM専用情報')) {
    fail(packId, 'scenario.md must contain both "## シナリオ概要" and "## GM専用情報"');
  }

  return {
    id: packId,
    title: meta.title,
    tagline: meta.tagline,
    source: meta.source ?? null,
    moods: meta.moods,
    recommendedRuleset: meta.recommendedRuleset,
    worldRaw,
    scenario: { id: meta.scenario.id, title: meta.scenario.title, raw: scenarioRaw },
    pc: await loadCharacters(packId, dir, 'pc', meta.pc),
    npc: await loadCharacters(packId, dir, 'npc', meta.npc),
  };
}

export async function loadStarterPacks(rootDir = STARTERS_DIR) {
  const indexRaw = await fs.readFile(path.join(rootDir, 'index.json'), 'utf-8').catch(() => null);
  if (indexRaw === null) throw new Error(`starter index not found: ${path.join(rootDir, 'index.json')}`);
  const ids = JSON.parse(indexRaw);
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('starter index.json must be a non-empty array of pack ids');
  const packs = [];
  for (const id of ids) packs.push(await loadPack(rootDir, id));
  return packs;
}
```

- [ ] **Step 4: `index.json` を書く**

`content/starters/index.json`(新規)。**Task 3・4 で残りのパックを足すまで、この配列には作成済みのパックだけを載せる。**

```json
["arkham-1920s"]
```

- [ ] **Step 5: `arkham-1920s` の `pack.json` を書く**

`content/starters/arkham-1920s/pack.json`(新規):

```json
{
  "id": "arkham-1920s",
  "title": "アーカム 1920s",
  "tagline": "禁書と魔女裁判の記憶が残る港町。写り込んではならないものが、乾板に写る。",
  "source": "H.P.ラヴクラフトのクトゥルフ神話作品に基づく(パブリックドメイン)",
  "moods": ["ホラー", "ミステリー"],
  "recommendedRuleset": "coc7e",
  "scenario": { "id": "photo-studio-on-the-hill", "title": "丘の上の写真館" },
  "pc": ["howard-kane", "mabel-thorne"],
  "npc": ["elias-witcham", "agnes-reed"]
}
```

- [ ] **Step 6: `world.md` を書く**

`content/starters/arkham-1920s/world.md`(新規):

```markdown
# アーカム — 1920年代 ニューイングランド

マサチューセッツ州北東部、ミスカトニック川をやや遡ったところにある古い町。造船で栄えた時代は過ぎ、いまは大学と、坂の多い住宅地と、傾いた切妻屋根の家々が残っている。

## 空気

- 表向きは静かな学園町。夜は早く、家々は早い時刻に灯を落とす
- 1692年の魔女裁判の記憶がまだ地名と家名に残っており、住民は特定の家系・特定の丘の話題を避ける
- 訛りの強い旧住民と、大学から来た余所者のあいだには見えない線が引かれている

## 場所

- **ミスカトニック大学** — 医学部と図書館で知られる。図書館の特別書庫には閲覧許可の要る蔵書があり、司書は許可の出所に厳しい
- **独立広場** — 町の中心。銀行、電話交換所、警察署
- **フレンチ・ヒル** — 町の北西の丘。空き家が多く、地価が理由もなく安い
- **アーカム鉄道駅** — ボストンまで二時間。町を出るいちばん確実な手段

## この世界の理

- 超自然は「起きない」のではなく「説明されない」。関わった者の記憶と記録は、あとから辻褄の合わない形で残る
- 知識は力ではなく損耗。真相に近づくほど、元の生活には戻りにくくなる
- 警察と大学当局は事件を穏当な形に整理したがる。公式記録は当てにならない

## GM向けの調子

派手な戦闘よりも、調査・聞き込み・文献にあたる場面を主にする。決着は「倒す」ことより「持ち帰る」「間に合わせる」ことに置く。
```

- [ ] **Step 7: `scenario.md` を書く**

`content/starters/arkham-1920s/scenario.md`(新規):

```markdown
# 丘の上の写真館

## シナリオ概要

フレンチ・ヒルの外れで四十年営業していた「ウィッチャム写真館」が、先月から閉ざされたままになっている。主人のエリアス・ウィッチャムは行方が知れない。

大家がミスカトニック大学に持ち込んだのは、店に残されていた乾板の一箱だった。家族写真、卒業記念、結婚式——どれもありふれた写真だが、そのうち十数枚に、撮影時にはいなかったはずの人影が写り込んでいる。写り込みは古い乾板ほど淡く、新しいものほど濃い。

PCたちは、この乾板と写真館の件を調べるよう頼まれる。

## 導入

大学の一室。テーブルに並べられた乾板。窓の外は霧。依頼人が最初に見せるのは1924年の卒業写真——後列の右端に、名簿にない男が立っている。

## 章1: 乾板

- 乾板を日付順に並べると、写り込みは1919年から始まり、年を追って濃くなっていく
- 図書館で調べると、写り込んだ男の背格好は1919年に「フレンチ・ヒルで転落死」と記録された人物と一致する
- 分岐条件: `flags.met_agnes == true` → 司書アグネスが特別書庫の閲覧を許し、写真術と「像の定着」に関する古い論文へ辿り着ける

## 章2: 写真館

- 店は施錠されているが裏口の錠が壊れている(誰かが先に入っている)
- 暗室には現像途中の乾板が残っており、まだ湿っている——一ヶ月前に閉まったはずの店で
- 分岐条件: `flags.searched_darkroom == true` → 主人の作業日誌が見つかり、彼が「写るもの」を消そうとして失敗した経緯が分かる

## 章3: 決着

- 写り込みが濃くなるのを止めるには、乾板そのものを処分するか、主人が始めた手順を最後まで進めるかのどちらか
- どちらを選んでも代償がある。処分すれば町の四十年分の記録が失われ、続ければ写す側になる

## GM専用情報

- **エリアス・ウィッチャムは死んでいない。** 彼は自分の像を乾板の側へ移すことで写り込みの主から逃げた。暗室に残っているのは彼が始めた手順であり、彼自身は乾板の中にいる
- **写り込んでいる男は1919年の転落死者ではない。** 転落死者はその男に「先に写された」被害者であり、写り込みは連鎖の記録である
- **アグネス・リードは経緯を知っている。** ウィッチャムから相談を受けていたが、大学の体面を理由に記録を伏せた。PCが信頼を得るまで彼女は認めない
- 開示の順序: 章1で「連鎖」の存在、章2でウィッチャムの意図、章3で初めて彼が生きているかどうか
- SANチェックの主な機会: 暗室の湿った乾板を見たとき / 写り込みの正体を理解したとき / ウィッチャムと「対面」したとき
```

- [ ] **Step 8: PCシート2枚を書く**

`content/starters/arkham-1920s/pc/howard-kane.md`(新規):

```markdown
PC名: ハワード・ケイン
役割: 調べる役

能力値: STR 45 CON 55 DEX 50 APP 55 SIZ 60 INT 80 POW 65 EDU 85
スキル: 図書館 70 / 目星 55 / 母国語(英語) 85 / オカルト 40 / 説得 50 / 歴史 60 / 回避 30
HP: 11/11
正気度: 65/99
持ち物: 万年筆、罫線入りの手帳(半分埋まっている)、図書館の閲覧証、懐中時計(父の形見)

来歴:
ミスカトニック大学の民俗学講師。三十四歳。ニューイングランドの民間伝承、特に「土地に貼りついた話」を集めている。学部内では真面目だが出世に興味がないと思われている。実際そのとおりで、彼が欲しいのは職位ではなく、誰も引用しない古い記録の続きである。

goal: 一度も活字にならなかった話を、少なくとも一つ、記録として残す。
bonds: 図書館司書アグネス・リードとは十年来の付き合いで、彼女の紹介がなければ特別書庫には入れない。彼女が何かを隠していると気づいたとき、追及できるかどうかは自分でも分からない。
```

`content/starters/arkham-1920s/pc/mabel-thorne.md`(新規):

```markdown
PC名: メイベル・ソーン
役割: 動く役

能力値: STR 55 CON 65 DEX 70 APP 60 SIZ 50 INT 65 POW 55 EDU 60
スキル: 目星 60 / 聞き耳 55 / 隠密 50 / 拳銃 45 / 心理学 55 / 言いくるめ 60 / 運転(自動車) 50 / 回避 40
HP: 11/11
正気度: 55/99
持ち物: .32口径リボルバー(装弾6)、鍵開けの道具一式、名刺(「M.ソーン 調査」)、フォードのキー、煙草

来歴:
アーカムで一人でやっている私立探偵。二十九歳。ボストンの探偵事務所に三年勤めたあと、雇い主が依頼人の弱みを売っていたことに気づいて辞めた。以来、割の悪い仕事ばかり選んで受けている。鍵の開いていない扉を前にして立ち止まらない。

goal: 割に合わない仕事を、それでも最後まで引き受けきる。誰も追わない件を追う。
bonds: 三年前、行方不明の少女の捜索を途中で打ち切った。依頼人が金を払えなくなったからだ。以来、行方不明という言葉に対して冷静でいられない。
```

- [ ] **Step 9: NPCシート2枚を書く**

`content/starters/arkham-1920s/npc/elias-witcham.md`(新規):

```markdown
NPC名: エリアス・ウィッチャム
立場: ウィッチャム写真館の主人(行方不明)
revealed: false

外見:
七十代。痩せて背が高く、指先が薬品で変色している。写真の中では常に画面の端にいて、正面を向いたものが一枚もない。

表向きの情報:
フレンチ・ヒルの外れで四十年、写真館を営んでいた。町の家族写真、卒業写真、葬儀の記録写真の大半は彼が撮った。先月から店を閉ざしたまま姿を見せない。

goal: (GM専用) 写り込みの主から逃れること。彼はそのために、自分の像を乾板の側へ移した。
bonds: (GM専用) 司書アグネス・リードに一度だけ相談したが、取り合ってもらえなかった。恨みはない——ただ、聞いてもらえなかったという事実だけが残っている。

開示の目安:
- 章1: 名前と行方不明の事実のみ
- 章2: 暗室の作業日誌から「何かを消そうとしていた」ことが分かる
- 章3: 彼が乾板の中にいると判明する。声だけで会話できる
```

`content/starters/arkham-1920s/npc/agnes-reed.md`(新規):

```markdown
NPC名: アグネス・リード
立場: ミスカトニック大学図書館 司書
revealed: true

外見:
五十代。灰色の髪をきつく結い、閲覧証の日付を必ず二度確かめる。声は小さいが、断るときだけはっきり喋る。

表向きの情報:
特別書庫の管理を任されて十八年になる。閲覧許可の出所に異常に厳しく、教授であっても手続きを飛ばせない。ハワード・ケインとは十年来の付き合いで、彼にだけは例外的に融通することがある。

goal: (GM専用) 大学の体面を守ること。より正確には、十八年前に自分が伏せた記録が表に出ないようにすること。
bonds: (GM専用) エリアス・ウィッチャムから相談を受けたが、記録に残せば大学が巻き込まれると判断して黙殺した。彼が行方不明になってから、その判断を毎日思い出している。

開示の目安:
- 信頼を得るまでは「そういう相談は受けていない」と言い続ける
- PCが乾板の連鎖を証拠として示したとき、初めてウィッチャムの相談内容を認める
```

- [ ] **Step 10: テストが通ることを確認する**

```bash
npx vitest run server/starters/loadPacks.test.js
```

Expected: PASS(10 tests)

- [ ] **Step 11: コミット**

```bash
git add content/starters server/starters
git commit -m "feat(content): スターターパックのローダーとアーカム1920sを追加"
```

---

## Task 3: パック2〜4(アルデン辺境領 / ミッドガルド / 百鬼夜行)

Task 2 の `arkham-1920s` と**まったく同じファイル構成・同じ書式**で3パックを書く。`loadPacks.test.js` は `index.json` の全パックを検証するので、追加したパックは自動的に検査対象になる。

**Files:**
- Modify: `content/starters/index.json`
- Create: `content/starters/alden-frontier/{pack.json,world.md,scenario.md,pc/gareth-dowe.md,pc/ilmina-vess.md,npc/tobias.md,npc/serika.md}`
- Create: `content/starters/midgard-eve/{pack.json,world.md,scenario.md,pc/skadi.md,pc/grima.md,npc/the-messenger.md,npc/one-eyed-traveler.md}`
- Create: `content/starters/hyakki-yagyo/{pack.json,world.md,scenario.md,pc/abe-shigure.md,pc/fujiwara-tsunechika.md,npc/rajomon-no-rojin.md,npc/kita-no-tai-no-hime.md}`
- Test: `server/starters/loadPacks.test.js`(既存のまま。追加のテストは不要)

**Interfaces:**
- Consumes: Task 2 の `loadStarterPacks` と `Pack` 形状
- Produces: なし(データのみ)

**文書テンプレート(全パック共通・Task 2 の実物を見本にすること)**

- `world.md` — `# タイトル` → 導入2〜4文 → `## 空気`(箇条書き3項目) → `## 場所`(箇条書き4項目、太字の名前＋説明) → `## この世界の理`(箇条書き3項目) → `## GM向けの調子`(2〜3文)
- `scenario.md` — `# タイトル` → `## シナリオ概要` → `## 導入` → `## 章1:` `## 章2:` `## 章3:`(各3項目、うち1つは `flags.xxx == true` の分岐条件) → `## GM専用情報`(太字の秘密3つ＋開示の順序＋判定の見どころ)
- `pc/*.md` — `PC名:` / `役割:` / `能力値:` / `スキル:` / `HP:` /(CoC7eのみ `正気度:`)/ `持ち物:` / `来歴:`(3〜4文) / `goal:` / `bonds:`
- `npc/*.md` — `NPC名:` / `立場:` / `revealed:` / `外見:` / `表向きの情報:` / `goal: (GM専用)` / `bonds: (GM専用)` / `開示の目安:`

能力値・スキルの記法は推奨Rulesetに合わせる(`coc7e` は技能%表記、`dnd5e` はSTR/DEX/CON/INT/WIS/CHAの数値とAC/HP、`simple` は自由記述寄り、`gurps` は技能レベル表記)。**判定式アダプタは能力値表記を読まないので厳密さより読みやすさを優先する。**

- [ ] **Step 1: `alden-frontier` を書く**

`pack.json`:

```json
{
  "id": "alden-frontier",
  "title": "アルデン辺境領",
  "tagline": "街道の途切れた先に古代帝国が沈んでいる。村の井戸が、一夜で涸れた。",
  "source": null,
  "moods": ["ファンタジー", "冒険"],
  "recommendedRuleset": "dnd5e",
  "scenario": { "id": "the-dry-well", "title": "涸れた井戸の底" },
  "pc": ["gareth-dowe", "ilmina-vess"],
  "npc": ["tobias", "serika"]
}
```

各文書に盛り込む事実:

- **世界**: 王国アルデンの最果て。街道が途切れた先に「先代帝国」の遺構が地面ごと沈んでいる。場所は 交易町ケルンフォード / 冒険者ギルド「銀の秤」 / 沈んだ帝国道 / 辺境守備隊の砦。理は「魔法は帝国の遺物で、新しく作られたものではない」「ギルドは遺構からの回収品に値を付けるが、危険度は買い取らない」「多種族が混ざるが、帝国期の血筋だけは別扱いされる」
- **シナリオ**: 村ハロウ・ディーンの井戸が一夜で涸れた。底に帝国期の封印石。章1=村での聞き込みと井戸の下降(`flags.talked_to_tobias`)、章2=封印室と帝国語の刻文(`flags.read_the_seal`)、章3=封印を開けるか、水を諦めて村を移すか
- **GM専用**: 封印されているのは怪物ではなく「水を集める装置」で、帝国が周辺一帯の水を一箇所へ引くために置いた/ 井戸守りセリカは人ではなく装置の管理者で、三百年ここにいる / 村長トバイアスはそれを知っていて黙っていた(村の存立が装置に依存しているため)
- **PC**: `gareth-dowe` ガレス・ダウ(流れの傭兵剣士、戦う役。goal=雇い主を選べる身分になる / bonds=前の隊を見捨てて生き延びた)、`ilmina-vess` イルミナ・ヴェス(放浪の呪印術士、調べる役。goal=自分の腕の呪印が何語なのか突き止める / bonds=呪印を刻んだ師がどこかで生きている)
- **NPC**: `tobias` 村長トバイアス(`revealed: true`、装置を知りながら黙っている)、`serika` 井戸守りセリカ(`revealed: false`、正体は装置の管理者)

- [ ] **Step 2: `midgard-eve` を書く**

`pack.json`:

```json
{
  "id": "midgard-eve",
  "title": "ミッドガルド 終焉前夜",
  "tagline": "終わりは予言されている。角笛が鳴るまでに、果たすべき誓いがある。",
  "source": "北欧神話(パブリックドメイン)",
  "moods": ["ファンタジー", "シリアス"],
  "recommendedRuleset": "simple",
  "scenario": { "id": "the-horn-of-heimdall", "title": "ヘイムダルの角笛" },
  "pc": ["skadi", "grima"],
  "npc": ["the-messenger", "one-eyed-traveler"]
}
```

各文書に盛り込む事実:

- **世界**: ラグナロクの予言が知れ渡った後のミッドガルド。神も人も終わりを知りながら日々を生きている。場所は 冬の長い辺境の集落 / 世界樹の根に近い泉 / 虹の橋の見える岬 / 誓いを立てる石。理は「予言は外れない。だが『いつ』は誰も知らない」「誓いは口にした瞬間に効力を持ち、破れば運命の側が取り立てに来る」「神々は助けない。彼らも同じ終わりを待っている」
- **シナリオ**: ヘイムダルの角笛が盗まれた。角笛が鳴らないラグナロクは、来ないのではなく「予告なしに来る」。章1=盗みの噂と足取り(`flags.heard_the_rumor`)、章2=泉での視(`flags.saw_the_vision`)、章3=角笛を返すか、鳴らないままにするか
- **GM専用**: 角笛を盗んだのは神々の敵ではなく、終わりを一日でも先延ばしにしたかった人間 / 使者を名乗る者はロキの手の者だが、嘘は一つもついていない(全て本当のことだけを言って誘導する) / 隻眼の旅人はオーディンで、PCが角笛をどうするかを見に来ているだけで介入しない
- **PC**: `skadi` スカジ・ヒャルムスドッティル(誓いを破った戦士、戦う役。goal=破った誓いの取り立てより先に、別の誓いを果たす / bonds=見捨てた弟がまだ生きているという噂)、`grima` グリーマ(予言を視るヴォルヴァ、調べる役。goal=自分自身の終わりだけは視えないので、それを視る / bonds=視た未来を告げたせいで滅んだ集落がある)
- **NPC**: `the-messenger` 名を告げぬ使者(`revealed: false`、ロキの手の者)、`one-eyed-traveler` 隻眼の旅人(`revealed: false`、オーディン)

- [ ] **Step 3: `hyakki-yagyo` を書く**

`pack.json`:

```json
{
  "id": "hyakki-yagyo",
  "title": "百鬼夜行 — 平安京",
  "tagline": "夜の大路を異形が渡る。その列に、生きた人間が一人混ざっている。",
  "source": "日本の古典・民間伝承(パブリックドメイン)",
  "moods": ["ホラー", "ファンタジー"],
  "recommendedRuleset": "coc7e",
  "scenario": { "id": "hyakki-on-suzaku-oji", "title": "朱雀大路の百鬼" },
  "pc": ["abe-shigure", "fujiwara-tsunechika"],
  "npc": ["rajomon-no-rojin", "kita-no-tai-no-hime"]
}
```

各文書に盛り込む事実:

- **世界**: 平安京。夜になると大路を異形の行列が渡り、遭った者は死ぬか、連れて行かれる。場所は 陰陽寮 / 検非違使庁 / 羅城門 / 朱雀大路。理は「怪異は貴族の家の事情と結びついている。祓うには家の恥を暴くことになる」「昼の秩序と夜の秩序は別物で、どちらも本物」「名を知られると術が通る。だから誰も本名を軽々しく名乗らない」
- **シナリオ**: 百鬼夜行の列に生きた人間が混ざって歩いている。章1=目撃者の証言と行列の経路(`flags.heard_the_witness`)、章2=羅城門での夜明かし(`flags.watched_at_rajomon`)、章3=列から引き戻すか、行かせるか
- **GM専用**: 列を歩いているのは北の対の姫で、自分から加わった(家に戻される方が耐えられなかった) / 羅城門の老爺は人ではなく、門そのものが姿を取っている。嘘はつかないが、聞かれないことは答えない / 姫を引き戻すと、代わりに誰かが列に加わらなければならない
- **PC**: `abe-shigure` 安倍時雨(陰陽寮の見習い、調べる役。goal=一人前と認められる式を一つ完成させる / bonds=師が「見るな」と言った巻子を見てしまった)、`fujiwara-tsunechika` 藤原恒近(検非違使の下級官人、戦う役。goal=家柄でなく働きで昇る / bonds=昨年の火事で助けられなかった家がある)
- **NPC**: `rajomon-no-rojin` 羅城門の老爺(`revealed: false`、門の化身)、`kita-no-tai-no-hime` 北の対の姫(`revealed: false`、自ら列に加わった)

- [ ] **Step 4: `index.json` を更新する**

```json
["arkham-1920s", "alden-frontier", "midgard-eve", "hyakki-yagyo"]
```

- [ ] **Step 5: 検証テストが通ることを確認する**

```bash
npx vitest run server/starters/loadPacks.test.js
```

Expected: PASS。失敗したらエラーメッセージがパックIDと違反内容を名指しするので、その文書を直す。

- [ ] **Step 6: コミット**

```bash
git add content/starters
git commit -m "feat(content): スターターパックにアルデン辺境領・ミッドガルド・百鬼夜行を追加"
```

---

## Task 4: パック5〜7(ネオヨコハマ / 死にゆく火星 / 宇宙戦争)

Task 3 と同じ手順・同じテンプレート。

**Files:**
- Modify: `content/starters/index.json`
- Create: `content/starters/neo-yokohama/{pack.json,world.md,scenario.md,pc/kuroda.md,pc/doc-shiba.md,npc/mimi.md,npc/hunt.md}`
- Create: `content/starters/dying-mars/{pack.json,world.md,scenario.md,pc/john-everett.md,pc/tara-solan.md,npc/orvak.md,npc/zedar.md}`
- Create: `content/starters/war-of-the-worlds/{pack.json,world.md,scenario.md,pc/hargreaves.md,pc/samuel-bly.md,npc/nathan.md,npc/the-artilleryman.md}`

**Interfaces:**
- Consumes: Task 2 の `loadStarterPacks` と `Pack` 形状、Task 3 の文書テンプレート
- Produces: なし(データのみ)

- [ ] **Step 1: `neo-yokohama` を書く**

`pack.json`:

```json
{
  "id": "neo-yokohama",
  "title": "臨海特区ネオヨコハマ",
  "tagline": "闇市に流れた中古の義手が、持ち主でない誰かの記憶を再生する。",
  "source": null,
  "moods": ["SF", "シリアス"],
  "recommendedRuleset": "gurps",
  "scenario": { "id": "memory-of-a-prosthetic", "title": "義体の記憶" },
  "pc": ["kuroda", "doc-shiba"],
  "npc": ["mimi", "hunt"]
}
```

各文書に盛り込む事実:

- **世界**: 202X年、自治権を持つ埋立特区。企業が行政を代行し、義体化が日常。場所は 特区高架下の闇市 / 蒼洋重工の本社タワー / 認可外のリップドク診療所 / 特区境界の検問。理は「特区の法は企業間協定で、住民は署名していない」「義体は買った瞬間からログを取られている」「情報は貨幣より流動的で、消せない」
- **シナリオ**: 闇市に流れた中古の義手が、前の持ち主でない誰かの記憶を再生する。章1=義手の出所を辿る(`flags.traced_the_arm`)、章2=診療所での分解と読み出し(`flags.read_the_log`)、章3=記憶の主を探すか、ログを消して手を引くか
- **GM専用**: 記憶は前の持ち主のものではなく、義体の製造ラインで書き込まれたテスト用データ。実在の人物のもので、その人物は本人の同意なくスキャンされた / 情報屋ミミはその人物の身内で、義手を意図的に闇市へ流した / 特区警備ハントは企業側の回収担当だが、この件については上に報告していない
- **PC**: `kuroda` クロダ(フリーの潜入屋、動く役。goal=特区の外に出られる身分証を手に入れる / bonds=かつて組んでいた相方が企業に取り込まれた)、`doc-shiba` ドク・シバ(元企業医のリップドク、調べる役。goal=自分が承認した術式で壊れた患者の記録を全部見つける / bonds=そのうち一人がまだ生きていて、特区のどこかにいる)
- **NPC**: `mimi` 情報屋ミミ(`revealed: false`、記憶の主の身内)、`hunt` 特区警備ハント(`revealed: false`、報告を握り潰している)

- [ ] **Step 2: `dying-mars` を書く**

**商標に注意**: 「バルスーム」「ジョン・カーター」は Edgar Rice Burroughs, Inc. の登録商標。**使わない。** 世界設定(死にゆく火星・運河都市・複数の異種族・飛空艇)はPDの小説本文に由来するものとして使い、登場人物はすべてオリジナルにする。

`pack.json`:

```json
{
  "id": "dying-mars",
  "title": "死にゆく火星",
  "tagline": "海は干上がり、大気は薄れていく。墜ちた飛空艇の乗員が、館の「客人」にされている。",
  "source": "E.R.バローズの火星シリーズに基づく(パブリックドメイン)。登場人物・地名は本作独自のもの",
  "moods": ["SF", "冒険"],
  "recommendedRuleset": "simple",
  "scenario": { "id": "guests-of-the-canal-city", "title": "運河都市の囚われ人" },
  "pc": ["john-everett", "tara-solan"],
  "npc": ["orvak", "zedar"]
}
```

各文書に盛り込む事実:

- **世界**: 海が干上がり大気が薄れゆく火星。生存は運河沿いに限られる。場所は 運河都市サル・エシュ / 干上がった海底の平原 / 大気工場の中継塔 / 遊牧する緑色火星人の野営。理は「大気は工場が作っている。工場を止められる者が最も強い」「決闘の作法が法より重い」「異種族間の条約は個人の名誉に紐づいており、当人が死ねば消える」
- **シナリオ**: 墜ちた飛空艇の乗員が司政官の館に「客人」として留め置かれている。章1=館への招待と歓待(`flags.entered_the_palace`)、章2=中継塔での発見(`flags.saw_the_relay`)、章3=乗員を連れ出すか、司政官の目的に加担するか
- **GM専用**: 司政官ゼダールは乗員を人質にしているのではなく、大気工場の中継塔を動かせる技師を探していた / 中継塔はすでに七割が停止しており、都市はあと二十年しかもたない。ゼダールはそれを市民に伏せている / 族長オルヴァクはそれを知っていて、都市の崩壊を待っている
- **PC**: `john-everett` ジョン・エヴァレット(地球から来た剣士、戦う役。goal=帰る方法を探す、あるいは帰らない理由を見つける / bonds=最初に助けてくれた火星人に借りがある)、`tara-solan` タラ・ソラン(赤色火星人の航行士、調べる役。goal=父の飛空艇が落ちた場所を突き止める / bonds=司政官の家に仕えていた過去がある)
- **NPC**: `orvak` オルヴァク(緑色火星人の族長、`revealed: false`)、`zedar` ゼダール(運河都市の司政官、`revealed: false`)

- [ ] **Step 3: `war-of-the-worlds` を書く**

`pack.json`:

```json
{
  "id": "war-of-the-worlds",
  "title": "宇宙戦争 — 1898年ロンドン",
  "tagline": "火星の円筒が落ちた。三脚機と黒煙に囲まれた町から、生きて川まで辿り着く。",
  "source": "H.G.ウェルズ『宇宙戦争』に基づく(パブリックドメイン)",
  "moods": ["SF", "ホラー"],
  "recommendedRuleset": "gurps",
  "scenario": { "id": "escape-from-woking", "title": "ウォーキングからの脱出" },
  "pc": ["hargreaves", "samuel-bly"],
  "npc": ["nathan", "the-artilleryman"]
}
```

各文書に盛り込む事実:

- **世界**: 1898年、南イングランド。火星から円筒が次々に落下し、三脚機と黒煙が町を潰していく。場所は ウォーキングの町外れ / ホーセルの共有地(最初の円筒) / 潰れた鉄道の線路 / テムズ河畔。理は「軍は勝てない。砲撃は当たるが数が足りない」「情報は届かない。新聞も電信も止まっている」「群衆は三脚機より早く人を殺す」
- **シナリオ**: 三脚機に包囲された町から生きて川まで辿り着く。章1=最初の円筒と避難の始まり(`flags.saw_the_cylinder`)、章2=潰れた線路沿いの移動(`flags.crossed_the_rails`)、章3=河へ出るか、地下に潜って留まるか
- **GM専用**: 牧師ネイサンは町の井戸に隣人を置き去りにした。それを認めるまで、彼はPCを危険な方向へ引っ張り続ける / 工兵の男が語る「地下に人類の社会を作る」計画は本気だが、彼自身は掘る気がない。合流すると時間を失う / 黒煙は水に触れると沈む。この事実に気づいた PC だけが河のルートを安全に選べる
- **PC**: `hargreaves` E.M.ハーグリーヴズ(科学ジャーナリスト、調べる役。goal=起きたことを記録して、誰かに読ませる / bonds=妻をレザーヘッドに残してきた)、`samuel-bly` 伍長サミュエル・ブライ(王立砲兵、戦う役。goal=解散した部隊の残りを集める / bonds=自分の砲が最初に外したせいで小隊が全滅した)
- **NPC**: `nathan` 牧師ネイサン(`revealed: false`、隣人を置き去りにした)、`the-artilleryman` 工兵の男(`revealed: false`、計画は語るが掘らない)

- [ ] **Step 4: `index.json` を更新する**

```json
[
  "arkham-1920s",
  "alden-frontier",
  "midgard-eve",
  "hyakki-yagyo",
  "neo-yokohama",
  "dying-mars",
  "war-of-the-worlds"
]
```

- [ ] **Step 5: 検証テストが通ることを確認する**

```bash
npx vitest run server/starters/loadPacks.test.js
```

Expected: PASS。7パックすべてが検証を通る。

- [ ] **Step 6: 推奨Rulesetの配分を目視で確認する**

```bash
grep -h recommendedRuleset content/starters/*/pack.json | sort | uniq -c
```

Expected: `coc7e` 2件 / `dnd5e` 1件 / `gurps` 2件 / `simple` 2件。ずれていたら `pack.json` を直す(判定式の違いを遊び比べで体感させるための配分)。

- [ ] **Step 7: コミット**

```bash
git add content/starters
git commit -m "feat(content): スターターパックにネオヨコハマ・死にゆく火星・宇宙戦争を追加"
```

---

## Task 5: シード(公式ユーザーへ保存 → 公開 → マニフェスト)

**Files:**
- Modify: `server/storage/paths.js`(末尾に追記)
- Create: `server/starters/seed.js`
- Test: `server/starters/seed.test.js`
- Test: `server/storage/paths.test.js`(既存に1件追記)

**Interfaces:**
- Consumes: `loadStarterPacks`(Task 2)、`saveWorld` / `saveScenario` / `saveCharacter`、`publishWorld` / `publishScenario` / `publishCharacter`、`userProfileKey`(`server/auth/users.js`)
- Produces:
  - `starterManifestKey() -> 'public/starters'`(`server/storage/paths.js`)
  - `OFFICIAL_USER_ID = 'usr_official'`、`OFFICIAL_DISPLAY_NAME = '公式サンプル'`
  - `seedStarters(dataStore, textStore, { packs } = {}) -> Promise<Manifest>`
  - `Manifest = { packs: StarterEntry[], seededAt: number }`
  - `StarterEntry = { packId, title, tagline, source, moods, recommendedRuleset, scenarioTitle, worldPublicId, scenarioPublicId, pcPublicIds: string[], npcPublicIds: string[] }`

- [ ] **Step 1: 失敗するテストを書く**

`server/starters/seed.test.js`(新規):

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedStarters, OFFICIAL_USER_ID } from './seed.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { starterManifestKey, worldMetaKey, characterMetaKey } from '../storage/paths.js';
import { getPublicWorld, getPublicItem } from '../storage/shareLibrary.js';
import { userProfileKey } from '../auth/users.js';

const PACKS = [
  {
    id: 'test-pack',
    title: 'テストの世界',
    tagline: '一行紹介',
    source: null,
    moods: ['ホラー'],
    recommendedRuleset: 'coc7e',
    worldRaw: '# 世界本文',
    scenario: { id: 'test-scenario', title: 'テストシナリオ', raw: '## シナリオ概要\n本文\n## GM専用情報\n秘密' },
    pc: [
      { name: 'pc-one', raw: 'PC名: 一人目\ngoal: A\nbonds: B' },
      { name: 'pc-two', raw: 'PC名: 二人目\ngoal: C\nbonds: D' },
    ],
    npc: [
      { name: 'npc-one', raw: 'NPC名: 甲' },
      { name: 'npc-two', raw: 'NPC名: 乙' },
    ],
  },
];

let dir;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starters-seed-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('seedStarters', () => {
  it('creates the official user without a login identity', async () => {
    await seedStarters(dataStore, textStore, { packs: PACKS });
    const profile = await dataStore.get(userProfileKey(OFFICIAL_USER_ID));
    expect(profile).toMatchObject({ id: OFFICIAL_USER_ID, displayName: '公式サンプル' });
    expect(await dataStore.list('auth/identities/google')).toEqual([]);
  });

  it('stores the pack in the official library using the pack id as the world id', async () => {
    await seedStarters(dataStore, textStore, { packs: PACKS });
    expect(await dataStore.get(worldMetaKey(OFFICIAL_USER_ID, 'test-pack'))).toMatchObject({ title: 'テストの世界', moods: ['ホラー'] });
    expect(await dataStore.get(characterMetaKey(OFFICIAL_USER_ID, 'test-pack', 'npc', 'npc-one'))).toMatchObject({ revealed: false });
  });

  it('writes a manifest with a publicId for every document', async () => {
    const manifest = await seedStarters(dataStore, textStore, { packs: PACKS });
    expect(manifest).toEqual(await dataStore.get(starterManifestKey()));
    expect(manifest.seededAt).toBeGreaterThan(0);
    const [entry] = manifest.packs;
    expect(entry).toMatchObject({
      packId: 'test-pack',
      title: 'テストの世界',
      tagline: '一行紹介',
      source: null,
      moods: ['ホラー'],
      recommendedRuleset: 'coc7e',
      scenarioTitle: 'テストシナリオ',
    });
    expect(entry.worldPublicId).toMatch(/^pub_/);
    expect(entry.scenarioPublicId).toMatch(/^pub_/);
    expect(entry.pcPublicIds).toHaveLength(2);
    expect(entry.npcPublicIds).toHaveLength(2);
  });

  it('publishes documents that can be read back through the public accessors', async () => {
    const manifest = await seedStarters(dataStore, textStore, { packs: PACKS });
    const [entry] = manifest.packs;
    expect(await getPublicWorld(dataStore, textStore, entry.worldPublicId)).toMatchObject({ title: 'テストの世界', raw: '# 世界本文' });
    expect(await getPublicItem(dataStore, textStore, 'scenarios', entry.scenarioPublicId)).toMatchObject({
      title: 'テストシナリオ',
      recommendedRuleset: 'coc7e',
    });
    expect(await getPublicItem(dataStore, textStore, 'characters', entry.pcPublicIds[0])).toMatchObject({ kind: 'pc', name: 'pc-one' });
  });

  // 再シードでpublicIdが変わると、ギャラリーのリンクとマニフェストが割れる
  it('keeps the same publicIds when run twice', async () => {
    const first = await seedStarters(dataStore, textStore, { packs: PACKS });
    const second = await seedStarters(dataStore, textStore, { packs: PACKS });
    expect(second.packs[0].worldPublicId).toBe(first.packs[0].worldPublicId);
    expect(second.packs[0].scenarioPublicId).toBe(first.packs[0].scenarioPublicId);
    expect(second.packs[0].pcPublicIds).toEqual(first.packs[0].pcPublicIds);
  });

  it('updates the published text when the source content changes', async () => {
    const first = await seedStarters(dataStore, textStore, { packs: PACKS });
    const edited = [{ ...PACKS[0], worldRaw: '# 書き直した本文' }];
    await seedStarters(dataStore, textStore, { packs: edited });
    const pub = await getPublicWorld(dataStore, textStore, first.packs[0].worldPublicId);
    expect(pub.raw).toBe('# 書き直した本文');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run server/starters/seed.test.js
```

Expected: FAIL — `Cannot find module './seed.js'`

- [ ] **Step 3: `starterManifestKey` を足す**

`server/storage/paths.js` の末尾に追記:

```js
// スターターパックのマニフェスト。publicIdはシード時に採番されるためクライアント側の
// 静的な定数表では持てず、シードの出力としてここに置く。
export function starterManifestKey() {
  return 'public/starters';
}
```

`server/storage/paths.test.js` に1件追記(既存の `describe` の中):

```js
  it('keeps the starter manifest under the public namespace', () => {
    expect(starterManifestKey()).toBe('public/starters');
  });
```

ファイル冒頭の import に `starterManifestKey` を足すこと。

- [ ] **Step 4: シードを実装する**

`server/starters/seed.js`(新規):

```js
import { loadStarterPacks } from './loadPacks.js';
import { saveWorld } from '../storage/worldLibrary.js';
import { saveScenario } from '../storage/scenarioLibrary.js';
import { saveCharacter } from '../storage/characterLibrary.js';
import { publishWorld, publishScenario, publishCharacter } from '../storage/shareLibrary.js';
import { starterManifestKey } from '../storage/paths.js';
import { userProfileKey } from '../auth/users.js';

export const OFFICIAL_USER_ID = 'usr_official';
export const OFFICIAL_DISPLAY_NAME = '公式サンプル';

// auth/identities/* を作らないので、このアカウントには誰もログインできない。
// 公開ギャラリーの作者リンク(GET /api/users/:userId)からは通常どおり参照できる。
async function ensureOfficialUser(dataStore) {
  const existing = await dataStore.get(userProfileKey(OFFICIAL_USER_ID));
  if (existing) return existing;
  const now = Date.now();
  const user = {
    id: OFFICIAL_USER_ID,
    displayName: OFFICIAL_DISPLAY_NAME,
    avatarUrl: null,
    bio: 'はじめて遊ぶ人向けの世界観・シナリオ・キャラクターを配布しているアカウント。',
    createdAt: now,
    updatedAt: now,
  };
  await dataStore.set(userProfileKey(OFFICIAL_USER_ID), user);
  return user;
}

function publicIdOf(result, what) {
  if (!result.ok) throw new Error(`starter seed failed to publish ${what}: ${result.reason}`);
  return result.meta.publicId;
}

async function seedPack(dataStore, textStore, owner, pack) {
  await saveWorld(dataStore, textStore, OFFICIAL_USER_ID, {
    id: pack.id,
    title: pack.title,
    raw: pack.worldRaw,
    moods: pack.moods,
  });
  await saveScenario(dataStore, textStore, OFFICIAL_USER_ID, {
    worldId: pack.id,
    id: pack.scenario.id,
    title: pack.scenario.title,
    raw: pack.scenario.raw,
    recommendedRuleset: pack.recommendedRuleset,
    moods: pack.moods,
  });
  for (const kind of ['pc', 'npc']) {
    for (const c of pack[kind]) {
      await saveCharacter(dataStore, textStore, OFFICIAL_USER_ID, {
        worldId: pack.id,
        kind,
        name: c.name,
        raw: c.raw,
        revealed: false,
      });
    }
  }

  const worldPublicId = publicIdOf(await publishWorld(dataStore, textStore, OFFICIAL_USER_ID, pack.id, owner), `world ${pack.id}`);
  const scenarioPublicId = publicIdOf(
    await publishScenario(dataStore, textStore, OFFICIAL_USER_ID, pack.id, pack.scenario.id, owner),
    `scenario ${pack.scenario.id}`
  );
  const characterIds = {};
  for (const kind of ['pc', 'npc']) {
    characterIds[kind] = [];
    for (const c of pack[kind]) {
      characterIds[kind].push(
        publicIdOf(await publishCharacter(dataStore, textStore, OFFICIAL_USER_ID, pack.id, kind, c.name, owner), `${kind} ${c.name}`)
      );
    }
  }

  return {
    packId: pack.id,
    title: pack.title,
    tagline: pack.tagline,
    source: pack.source,
    moods: pack.moods,
    recommendedRuleset: pack.recommendedRuleset,
    scenarioTitle: pack.scenario.title,
    worldPublicId,
    scenarioPublicId,
    pcPublicIds: characterIds.pc,
    npcPublicIds: characterIds.npc,
  };
}

export async function seedStarters(dataStore, textStore, { packs } = {}) {
  const loaded = packs ?? (await loadStarterPacks());
  const owner = await ensureOfficialUser(dataStore);
  const entries = [];
  for (const pack of loaded) entries.push(await seedPack(dataStore, textStore, owner, pack));
  const manifest = { packs: entries, seededAt: Date.now() };
  await dataStore.set(starterManifestKey(), manifest);
  return manifest;
}
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
npx vitest run server/starters/seed.test.js server/storage/paths.test.js
```

Expected: PASS

- [ ] **Step 6: 実際の7パックでシードが通ることを一度だけ手で確かめる**

```bash
node -e "
import('./server/starters/seed.js').then(async ({ seedStarters }) => {
  const { createFsDataStore } = await import('./server/storage/dataStore.js');
  const { createFsTextStore } = await import('./server/storage/textStore.js');
  const dir = '/tmp/starter-seed-check';
  const m = await seedStarters(createFsDataStore(dir), createFsTextStore(dir));
  console.log(m.packs.map(p => p.packId + ' -> ' + p.worldPublicId).join('\n'));
})
"
```

Expected: 7行、すべて `pub_` で始まる publicId が出る。確認後 `rm -rf /tmp/starter-seed-check`。

- [ ] **Step 7: コミット**

```bash
git add server/starters/seed.js server/starters/seed.test.js server/storage/paths.js server/storage/paths.test.js
git commit -m "feat(server): スターターパックを公式アカウント名義で公開するシードを追加"
```

---

## Task 6: 起動時シードと `npm run seed`

`server/data/` は gitignore 済みで、デプロイ先で消える可能性がある。起動のたびに冪等なシードを走らせて復元する。

**Files:**
- Create: `scripts/seedStarters.js`
- Modify: `server/index.js`(末尾の `NODE_ENV !== 'test'` ブロック)
- Modify: `package.json`(`scripts` に1行)

**Interfaces:**
- Consumes: `seedStarters`(Task 5)、`createFsDataStore` / `createFsTextStore`
- Produces: なし(実行経路のみ)

- [ ] **Step 1: CLI ラッパを書く**

`scripts/seedStarters.js`(新規):

```js
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedStarters } from '../server/starters/seed.js';
import { createFsDataStore } from '../server/storage/dataStore.js';
import { createFsTextStore } from '../server/storage/textStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'server', 'data');

const manifest = await seedStarters(createFsDataStore(dataDir), createFsTextStore(dataDir));
console.log(`seeded ${manifest.packs.length} starter packs into ${dataDir}`);
```

- [ ] **Step 2: `package.json` にスクリプトを足す**

`"scripts"` の `"start"` の次の行に追記:

```json
    "seed": "node scripts/seedStarters.js",
```

- [ ] **Step 3: 起動時にシードする**

`server/index.js` 末尾のブロックを差し替える:

```js
if (process.env.NODE_ENV !== 'test') {
  const port = process.env.PORT || 8787;
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  // server/data/ はgitignore対象でデプロイ先では空から始まりうる。冪等なので毎回走らせて復元する。
  // 失敗してもアプリ自体は動くべきなので、ログだけ出して起動を続ける。
  seedStarters(createFsDataStore(dataDir), createFsTextStore(dataDir))
    .then((m) => console.log(`seeded ${m.packs.length} starter packs`))
    .catch((e) => console.error('starter seed failed', e))
    .finally(() => {
      createApp().listen(port, () => {
        console.log(`server listening on port ${port}`);
      });
    });
}
```

冒頭の import に追記:

```js
import { seedStarters } from './starters/seed.js';
```

`createFsDataStore` / `createFsTextStore` は既に import 済み。

- [ ] **Step 4: シードを実行して確認する**

```bash
npm run seed
```

Expected: `seeded 7 starter packs into …/server/data`

```bash
node -e "console.log(Object.keys(require('fs').readFileSync('server/data/public/starters.json','utf8') ? JSON.parse(require('fs').readFileSync('server/data/public/starters.json','utf8')) : {}))"
```

Expected: `[ 'packs', 'seededAt' ]`

- [ ] **Step 5: 既存テストが壊れていないことを確認する**

```bash
npm test
```

Expected: 全パス(`createApp` はシードしないので `server/index.test.js` に影響しない)

- [ ] **Step 6: コミット**

```bash
git add scripts/seedStarters.js server/index.js package.json
git commit -m "feat(server): 起動時とnpm run seedでスターターパックをシードする"
```

---

## Task 7: `GET /api/starters`

**Files:**
- Modify: `server/routes/publicContent.js`
- Test: `server/routes/publicContent.test.js`

**Interfaces:**
- Consumes: `starterManifestKey`(Task 5)
- Produces: `GET /api/starters -> 200 { packs, seededAt }`。未シードなら `{ packs: [], seededAt: null }`。認証不要。

- [ ] **Step 1: 失敗するテストを書く**

`server/routes/publicContent.test.js` の既存 `describe` の中に追記:

```js
  describe('GET /api/starters', () => {
    it('returns an empty manifest before seeding (not a 404)', async () => {
      const res = await request(app).get('/api/starters');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ packs: [], seededAt: null });
    });

    it('returns the seeded manifest', async () => {
      await dataStore.set('public/starters', { packs: [{ packId: 'p1', title: 'パック1' }], seededAt: 123 });
      const res = await request(app).get('/api/starters');
      expect(res.status).toBe(200);
      expect(res.body.packs).toEqual([{ packId: 'p1', title: 'パック1' }]);
      expect(res.body.seededAt).toBe(123);
    });
  });
```

既存ファイルの `app` / `dataStore` の組み立て方をそのまま使う(ファイル冒頭を読むこと)。`createPublicContentRouter` は認証ミドルウェアなしでマウントされているので、このテストがそのまま「未ログインでも 200」の確認になる。

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run server/routes/publicContent.test.js
```

Expected: FAIL — 404(ルート未定義)

- [ ] **Step 3: ルートを足す**

`server/routes/publicContent.js` の import に追記:

```js
import { starterManifestKey } from '../storage/paths.js';
```

`const router = Router();` の直後(`/public/:type` より前)に追記:

```js
  // 未シードは正常系。404にすると「まだ無い」を UI がエラーとして扱わざるを得なくなる。
  router.get('/starters', asyncHandler(async (req, res) => {
    res.json((await dataStore.get(starterManifestKey())) ?? { packs: [], seededAt: null });
  }));
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run server/routes/publicContent.test.js
```

Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add server/routes/publicContent.js server/routes/publicContent.test.js
git commit -m "feat(server): GET /api/startersでスターターマニフェストを公開する"
```

---

## Task 8: `POST /api/starters/:packId/import`

**Files:**
- Modify: `server/routes/imports.js`
- Test: `server/routes/imports.test.js`

**Interfaces:**
- Consumes: `importWorld` の `preferredId`(Task 1)、`starterManifestKey`(Task 5)
- Produces: `POST /api/starters/:packId/import -> 201 { world, scenario, pcs: [], npcs: [] }`。`world` / `scenario` / 各キャラは各 `save*` の戻り値(`{ id, title, raw, … }`)。未知の packId は 404。

- [ ] **Step 1: 失敗するテストを書く**

`server/routes/imports.test.js` の既存 `describe('imports routes', …)` の中に追記:

```js
  describe('starter packs', () => {
    async function seedOnePack() {
      await saveWorld(dataStore, textStore, OWNER.id, { id: 'src-world', title: '百鬼夜行 — 平安京', raw: '# 世界', moods: ['ホラー'] });
      await saveScenario(dataStore, textStore, OWNER.id, {
        worldId: 'src-world', id: 'sc', title: 'シナリオ', raw: '# 本文', recommendedRuleset: 'coc7e', moods: ['ホラー'],
      });
      await saveCharacter(dataStore, textStore, OWNER.id, { worldId: 'src-world', kind: 'pc', name: 'pc-one', raw: 'PC1' });
      await saveCharacter(dataStore, textStore, OWNER.id, { worldId: 'src-world', kind: 'npc', name: 'npc-one', raw: 'NPC1', revealed: false });

      const world = await publishWorld(dataStore, textStore, OWNER.id, 'src-world', OWNER);
      const scenario = await publishScenario(dataStore, textStore, OWNER.id, 'src-world', 'sc', OWNER);
      const pc = await publishCharacter(dataStore, textStore, OWNER.id, 'src-world', 'pc', 'pc-one', OWNER);
      const npc = await publishCharacter(dataStore, textStore, OWNER.id, 'src-world', 'npc', 'npc-one', OWNER);

      await dataStore.set('public/starters', {
        packs: [{
          packId: 'hyakki-yagyo',
          title: '百鬼夜行 — 平安京',
          recommendedRuleset: 'coc7e',
          worldPublicId: world.meta.publicId,
          scenarioPublicId: scenario.meta.publicId,
          pcPublicIds: [pc.meta.publicId],
          npcPublicIds: [npc.meta.publicId],
        }],
        seededAt: 1,
      });
    }

    it('imports the whole pack in one call', async () => {
      await seedOnePack();
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.status).toBe(201);
      expect(res.body.world).toMatchObject({ id: 'hyakki-yagyo', title: '百鬼夜行 — 平安京', moods: ['ホラー'] });
      expect(res.body.scenario).toMatchObject({ worldId: 'hyakki-yagyo', title: 'シナリオ', recommendedRuleset: 'coc7e' });
      expect(res.body.pcs).toHaveLength(1);
      expect(res.body.npcs).toHaveLength(1);
      expect(res.body.pcs[0]).toMatchObject({ kind: 'pc', name: 'pc-one', worldId: 'hyakki-yagyo' });
      // NPCの秘匿情報はインポート先で未開示に戻る
      expect(res.body.npcs[0]).toMatchObject({ kind: 'npc', revealed: false });
    });

    // slugify は非ASCIIを全除去するので、preferredId 無しだと 'untitled' になる
    it('uses the packId as the world id instead of slugify(title)', async () => {
      await seedOnePack();
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.body.world.id).toBe('hyakki-yagyo');
    });

    it('suffixes the world id when the same pack is imported twice', async () => {
      await seedOnePack();
      await request(app).post('/api/starters/hyakki-yagyo/import');
      const second = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(second.status).toBe(201);
      expect(second.body.world.id).toBe('hyakki-yagyo-2');
      expect(second.body.scenario.worldId).toBe('hyakki-yagyo-2');
    });

    it('404s for an unknown pack id', async () => {
      await seedOnePack();
      const res = await request(app).post('/api/starters/nope/import');
      expect(res.status).toBe(404);
    });

    it('404s when nothing has been seeded', async () => {
      const res = await request(app).post('/api/starters/hyakki-yagyo/import');
      expect(res.status).toBe(404);
    });
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run server/routes/imports.test.js
```

Expected: FAIL — 404(ルート未定義)。「404s for an unknown pack id」だけは偶然通るが、それ以外は落ちる。

- [ ] **Step 3: ルートを足す**

`server/routes/imports.js` の import に追記:

```js
import { starterManifestKey } from '../storage/paths.js';
```

`router.param('publicId', idParamGuard);` の直後に追記:

```js
  router.param('packId', idParamGuard);
```

`return router;` の直前に追記:

```js
  // 一括インポート。クライアントから /api/import/* を7回叩くと途中で失敗したときに
  // 「Worldだけできて中身が無い」状態が残り、リトライで -2 付きの重複が生える。
  // サーバー側の1呼び出しにまとめて、失敗はエラー1つで返す。
  router.post('/starters/:packId/import', asyncHandler(async (req, res) => {
    const manifest = await dataStore.get(starterManifestKey());
    const pack = (manifest?.packs ?? []).find((p) => p.packId === req.params.packId);
    if (!pack) {
      res.status(404).json({ error: 'unknown starter pack' });
      return;
    }

    // preferredId には manifest 側の packId を渡す(パスパラメータではなく、
    // 自分が書いたマニフェストの値を使う)
    const world = await importWorld(dataStore, textStore, req.userId, pack.worldPublicId, { preferredId: pack.packId });
    if (!world.ok) {
      res.status(500).json({ error: 'starter world is missing; re-run the seed' });
      return;
    }
    const worldId = world.meta.id;

    const scenario = await importScenario(dataStore, textStore, req.userId, pack.scenarioPublicId, worldId);
    if (!scenario.ok) {
      res.status(500).json({ error: 'starter scenario is missing; re-run the seed' });
      return;
    }

    const imported = { pcs: [], npcs: [] };
    for (const [field, ids] of [['pcs', pack.pcPublicIds ?? []], ['npcs', pack.npcPublicIds ?? []]]) {
      for (const publicId of ids) {
        const result = await importCharacter(dataStore, textStore, req.userId, publicId, worldId);
        if (!result.ok) {
          res.status(500).json({ error: 'starter character is missing; re-run the seed' });
          return;
        }
        imported[field].push(result.meta);
      }
    }

    res.status(201).json({ world: world.meta, scenario: scenario.meta, ...imported });
  }));
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run server/routes/imports.test.js
```

Expected: PASS

- [ ] **Step 5: 全体テストで回帰がないことを確認する**

```bash
npm test
```

Expected: 全パス

- [ ] **Step 6: コミット**

```bash
git add server/routes/imports.js server/routes/imports.test.js
git commit -m "feat(server): スターターパックの一括インポートAPIを追加"
```

---

## Task 9: `src/api/starterClient.js`

**Files:**
- Create: `src/api/starterClient.js`
- Test: `src/api/starterClient.test.js`

**Interfaces:**
- Consumes: `apiFetch`(`src/api/apiFetch.js`)
- Produces:
  - `listStarters() -> Promise<{ packs, seededAt }>`
  - `importStarterPack(packId) -> Promise<{ world, scenario, pcs, npcs }>`

- [ ] **Step 1: 失敗するテストを書く**

`src/api/starterClient.test.js`(新規):

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listStarters, importStarterPack } from './starterClient.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('starterClient', () => {
  it('fetches the manifest', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ packs: [], seededAt: null }) });
    await expect(listStarters()).resolves.toEqual({ packs: [], seededAt: null });
    expect(fetch).toHaveBeenCalledWith('/api/starters', undefined);
  });

  it('posts to the import endpoint with the pack id encoded', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ world: { id: 'w' } }) });
    await importStarterPack('arkham-1920s');
    expect(fetch).toHaveBeenCalledWith('/api/starters/arkham-1920s/import', { method: 'POST' });
  });

  it('surfaces API errors', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(importStarterPack('arkham-1920s')).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/api/starterClient.test.js
```

Expected: FAIL — `Cannot find module './starterClient.js'`

- [ ] **Step 3: 実装する**

`src/api/starterClient.js`(新規):

```js
import { apiFetch } from './apiFetch.js';

export async function listStarters() {
  return apiFetch('/api/starters');
}

export async function importStarterPack(packId) {
  return apiFetch(`/api/starters/${encodeURIComponent(packId)}/import`, { method: 'POST' });
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/api/starterClient.test.js
```

Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/api/starterClient.js src/api/starterClient.test.js
git commit -m "feat(ui): スターターAPIのクライアントを追加"
```

---

## Task 10: `StarterPackList` コンポーネント

**Files:**
- Create: `src/components/share/StarterPackList.jsx`
- Test: `src/components/share/StarterPackList.test.jsx`

**Interfaces:**
- Consumes: `listStarters` / `importStarterPack`(Task 9)、`RULESETS`(`src/data/rulesets.js`)、`Card` / `Button` / `Badge`(`src/components/ui/`)、`COLORS` / `F_DISPLAY` / `F_BODY` / `F_MONO`(`src/theme.js`)
- Produces: `<StarterPackList onImported={(starterContext) => void} />`
  - `starterContext = { world, scenario, rulesetId }`
  - `world` はインポートAPIの `world`(`{ id, title, moods, updatedAt, raw }`)
  - `scenario` はインポートAPIの `scenario`(`{ id, worldId, title, recommendedRuleset, moods, updatedAt, raw }`)
  - `rulesetId` はパックの `recommendedRuleset`
  - 取得失敗時・`packs` が空のときは `null` を返して何も描画しない

- [ ] **Step 1: 失敗するテストを書く**

`src/components/share/StarterPackList.test.jsx`(新規):

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StarterPackList from './StarterPackList.jsx';
import * as starterClient from '../../api/starterClient.js';

const PACKS = [
  {
    packId: 'arkham-1920s',
    title: 'アーカム 1920s',
    tagline: '禁書と魔女裁判の記憶が残る港町。',
    source: 'H.P.ラヴクラフト作品に基づく',
    moods: ['ホラー', 'ミステリー'],
    recommendedRuleset: 'coc7e',
    scenarioTitle: '丘の上の写真館',
  },
  {
    packId: 'alden-frontier',
    title: 'アルデン辺境領',
    tagline: '街道の途切れた先に古代帝国が沈んでいる。',
    source: null,
    moods: ['ファンタジー', '冒険'],
    recommendedRuleset: 'dnd5e',
    scenarioTitle: '涸れた井戸の底',
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('StarterPackList', () => {
  it('renders a card per pack with tagline, moods, ruleset label and source', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
    render(<StarterPackList onImported={vi.fn()} />);

    expect(await screen.findByText('アーカム 1920s')).toBeInTheDocument();
    expect(screen.getByText(/禁書と魔女裁判/)).toBeInTheDocument();
    expect(screen.getByText('ホラー')).toBeInTheDocument();
    expect(screen.getByText('CoC7e風')).toBeInTheDocument();
    expect(screen.getByText(/ラヴクラフト作品に基づく/)).toBeInTheDocument();
    expect(screen.getByText('アルデン辺境領')).toBeInTheDocument();
    expect(screen.getByText('丘の上の写真館')).toBeInTheDocument();
  });

  // 未シードの環境でもHome/Galleryが壊れないよう、「無い」は親ではなくここで吸収する
  it('renders nothing when the manifest is empty', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: [], seededAt: null });
    const { container } = render(<StarterPackList onImported={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders nothing when the manifest cannot be fetched', async () => {
    vi.spyOn(starterClient, 'listStarters').mockRejectedValue(new Error('offline'));
    const { container } = render(<StarterPackList onImported={vi.fn()} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('imports the pack and hands the caller a starterContext', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
    vi.spyOn(starterClient, 'importStarterPack').mockResolvedValue({
      world: { id: 'arkham-1920s', title: 'アーカム 1920s', moods: ['ホラー'], raw: '# 世界' },
      scenario: { id: 'photo-studio', worldId: 'arkham-1920s', title: '丘の上の写真館', recommendedRuleset: 'coc7e', moods: ['ホラー'], raw: '# シナリオ' },
      pcs: [{ name: 'howard-kane' }, { name: 'mabel-thorne' }],
      npcs: [],
    });
    const onImported = vi.fn();
    render(<StarterPackList onImported={onImported} />);

    fireEvent.click((await screen.findAllByText('この冒険を始める'))[0]);

    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(starterClient.importStarterPack).toHaveBeenCalledWith('arkham-1920s');
    expect(onImported).toHaveBeenCalledWith({
      world: { id: 'arkham-1920s', title: 'アーカム 1920s', moods: ['ホラー'], raw: '# 世界' },
      scenario: { id: 'photo-studio', worldId: 'arkham-1920s', title: '丘の上の写真館', recommendedRuleset: 'coc7e', moods: ['ホラー'], raw: '# シナリオ' },
      rulesetId: 'coc7e',
    });
  });

  it('shows the error on the failing card and leaves the other card usable', async () => {
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
    vi.spyOn(starterClient, 'importStarterPack').mockRejectedValue(new Error('boom'));
    render(<StarterPackList onImported={vi.fn()} />);

    const buttons = await screen.findAllByText('この冒険を始める');
    fireEvent.click(buttons[0]);

    expect(await screen.findByText(/取り込みに失敗した/)).toBeInTheDocument();
    expect(screen.getAllByText('この冒険を始める')[1].closest('button')).not.toBeDisabled();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/components/share/StarterPackList.test.jsx
```

Expected: FAIL — `Cannot find module './StarterPackList.jsx'`

- [ ] **Step 3: 実装する**

`src/components/share/StarterPackList.jsx`(新規):

```jsx
import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';
import Card from '../ui/Card.jsx';
import Button from '../ui/Button.jsx';
import Badge from '../ui/Badge.jsx';
import { RULESETS } from '../../data/rulesets.js';
import { listStarters, importStarterPack } from '../../api/starterClient.js';

function rulesetLabel(id) {
  return RULESETS.find((r) => r.id === id)?.label ?? id;
}

export default function StarterPackList({ onImported }) {
  const [packs, setPacks] = useState([]);
  const [busy, setBusy] = useState(null); // インポート中の packId
  const [errors, setErrors] = useState({}); // packId -> メッセージ

  useEffect(() => {
    let alive = true;
    listStarters()
      .then((m) => alive && setPacks(m?.packs ?? []))
      // 取得できないことは「まだ無い」と同じ扱いにする。ここでエラーを出すと、
      // スターター未シードの環境で Home / Gallery に無関係な赤字が出続ける。
      .catch(() => alive && setPacks([]))
      .finally(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function start(pack) {
    setBusy(pack.packId);
    setErrors((prev) => ({ ...prev, [pack.packId]: '' }));
    try {
      const result = await importStarterPack(pack.packId);
      onImported({
        world: result.world,
        scenario: result.scenario,
        rulesetId: pack.recommendedRuleset,
      });
    } catch (e) {
      setErrors((prev) => ({ ...prev, [pack.packId]: '取り込みに失敗した: ' + e.message }));
    } finally {
      setBusy(null);
    }
  }

  if (packs.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {packs.map((pack) => (
        <Card key={pack.packId}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>{pack.title}</div>
            <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, whiteSpace: 'nowrap' }}>
              {rulesetLabel(pack.recommendedRuleset)}
            </div>
          </div>

          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft, marginTop: 6 }}>{pack.tagline}</div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            {(pack.moods ?? []).map((m) => (
              <Badge key={m}>{m}</Badge>
            ))}
            <span style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>{pack.scenarioTitle}</span>
          </div>

          {pack.source && (
            <div style={{ fontFamily: F_MONO, fontSize: 10, color: COLORS.faint, marginTop: 8 }}>{pack.source}</div>
          )}

          <div style={{ marginTop: 12 }}>
            <Button variant="brass" onClick={() => start(pack)} disabled={busy === pack.packId}>
              {busy === pack.packId ? '取り込み中…' : 'この冒険を始める'}
            </Button>
          </div>

          {errors[pack.packId] && (
            <div style={{ color: COLORS.stamp, fontSize: 12, marginTop: 8 }}>{errors[pack.packId]}</div>
          )}
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
npx vitest run src/components/share/StarterPackList.test.jsx
```

Expected: PASS(5 tests)。`Card` が `onClick` 必須などで落ちる場合は `src/components/ui/Card.jsx` を読んで props を合わせる。

- [ ] **Step 5: コミット**

```bash
git add src/components/share/StarterPackList.jsx src/components/share/StarterPackList.test.jsx
git commit -m "feat(ui): スターターパックのカード一覧コンポーネントを追加"
```

---

## Task 11: Setup の `starterContext`

インポート直後の Setup を「World / Scenario / Ruleset は選択済み、PC はこれから選ぶ」状態で開く。PCまで自動選択しないのは、どちらを演じるかが初回ユーザーの最初の選択であり、同時に「PCはWorldに属していて選ぶもの」という構造を最短で伝えるため。

**Files:**
- Modify: `src/screens/Setup.jsx:19`(props)、`:20`(step 初期値)、`:26-51`(state 初期値)、`:76-96`(2つの useEffect)
- Test: `src/screens/Setup.test.jsx`

**Interfaces:**
- Consumes: `starterContext = { world, scenario, rulesetId }`(Task 10)
- Produces: `<Setup onStart onCancel campaignContext starterContext />`

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Setup.test.jsx` の既存 `describe` の中に追記(既存テストのモック方法 — `worldLibraryClient` / `scenarioLibraryClient` / `characterLibraryClient` / `rulesetLibraryClient` の spy — をそのまま踏襲すること):

```jsx
  describe('starterContext', () => {
    const STARTER = {
      world: { id: 'arkham-1920s', title: 'アーカム 1920s', moods: ['ホラー'], raw: '# 世界本文' },
      scenario: {
        id: 'photo-studio-on-the-hill', worldId: 'arkham-1920s', title: '丘の上の写真館',
        recommendedRuleset: 'coc7e', moods: ['ホラー'], raw: '# シナリオ本文',
      },
      rulesetId: 'coc7e',
    };

    it('opens on the PC step with world, scenario and ruleset already chosen', async () => {
      vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([
        { name: 'howard-kane' }, { name: 'mabel-thorne' },
      ]);
      render(<Setup onStart={vi.fn()} onCancel={vi.fn()} starterContext={STARTER} />);

      // ステップ表示が「4. PC」を選択中にしている
      expect(await screen.findByText('4. PC')).toBeInTheDocument();
      // PC一覧が選択済みWorldから取れている
      await waitFor(() => expect(characterLibraryClient.listCharacters).toHaveBeenCalledWith('arkham-1920s', 'pc'));
      expect(await screen.findByText('howard-kane')).toBeInTheDocument();
    });

    // worldId が最初から埋まっているので、マウント時に走る useEffect が選択を消してはいけない
    it('keeps the preselected scenario after mount', async () => {
      vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([]);
      render(<Setup onStart={vi.fn()} onCancel={vi.fn()} starterContext={STARTER} />);

      fireEvent.click(await screen.findByText('戻る')); // → ルール
      fireEvent.click(screen.getByText('戻る')); // → シナリオ
      expect(await screen.findByText('丘の上の写真館')).toBeInTheDocument();
    });

    it('starts a session carrying the starter world, scenario, moods and ruleset', async () => {
      vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([{ name: 'howard-kane' }]);
      vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({ name: 'howard-kane', raw: 'PC名: ハワード' });
      const onStart = vi.fn();
      render(<Setup onStart={onStart} onCancel={vi.fn()} starterContext={STARTER} />);

      fireEvent.click(await screen.findByText('howard-kane'));
      fireEvent.click(screen.getByText('次へ')); // → 確認
      fireEvent.click(await screen.findByText('ゲーム開始'));

      await waitFor(() => expect(onStart).toHaveBeenCalled());
      const session = onStart.mock.calls[0][0];
      expect(session.worldId).toBe('arkham-1920s');
      expect(session.world.summary).toBe('# 世界本文');
      expect(session.scenario.raw).toBe('# シナリオ本文');
      expect(session.moods).toEqual(['ホラー']);
      expect(session.rulesetId).toBe('coc7e');
      expect(session.title).toContain('丘の上の写真館');
    });

    it('behaves exactly as before when starterContext is absent', () => {
      render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
      expect(screen.getByText('1. 世界観')).toBeInTheDocument();
    });
  });
```

セッション名は `starterContext.scenario.title` を初期値にするので `session.title` にシナリオ題が入る。既存テストの render ヘルパ・spy 対象名はファイル冒頭を読んで合わせること。

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/screens/Setup.test.jsx
```

Expected: FAIL — step 0(「1. 世界観」)から始まってしまう。

- [ ] **Step 3: props と state の初期値を変える**

`src/screens/Setup.jsx:19` の宣言:

```jsx
export default function Setup({ onStart, onCancel, campaignContext = null, starterContext = null }) {
  // starterContext はスターターパックを一括インポートした直後の状態。World/Scenario/Ruleset を
  // 選択済みにして PC 選択(step 3)から開く。PCまで自動選択しないのは、どちらを演じるかが
  // 初回ユーザーの最初の選択であり、「PCはWorldに属していて選ぶもの」を最短で伝えるため。
  const [step, setStep] = useState(starterContext ? 3 : 0);
```

World の state:

```jsx
  const [worldMode, setWorldMode] = useState(campaignContext || starterContext ? 'existing' : 'skip'); // existing | new | skip
```

```jsx
  const [selectedWorld, setSelectedWorld] = useState(
    campaignContext
      ? { id: campaignContext.worldId, raw: campaignContext.world.summary }
      : starterContext
      ? starterContext.world
      : null
  ); // { id, title, raw } | null
```

Scenario の state:

```jsx
  const [scenarioMode, setScenarioMode] = useState(starterContext ? 'existing' : 'paste'); // existing | paste | generate
```

```jsx
  const [selectedScenario, setSelectedScenario] = useState(starterContext ? starterContext.scenario : null); // { id, title, raw, recommendedRuleset } | null
```

Ruleset:

```jsx
  const [rulesetId, setRulesetId] = useState(
    campaignContext ? campaignContext.rulesetId || 'simple' : starterContext ? starterContext.rulesetId : 'simple'
  );
```

PC:

```jsx
  const [pcMode, setPcMode] = useState(starterContext ? 'existing' : 'new'); // existing | new
```

セッション名:

```jsx
  const [title, setTitle] = useState(starterContext ? starterContext.scenario.title : '');
```

- [ ] **Step 4: マウント時に選択を消さないようにする**

`src/screens/Setup.jsx:76-96` の2つの `useEffect` を差し替える。`worldTokenRef` などの宣言の下に ref を1つ足す:

```jsx
  // worldId が変わったときだけ従属する選択をリセットする。starterContext のように
  // 最初から worldId が埋まっている場合、マウント時のリセットで選択が消えてしまうため。
  const prevWorldIdRef = useRef(worldId);
```

```jsx
  useEffect(() => {
    if (prevWorldIdRef.current !== worldId) {
      setSelectedScenario(null);
      setSelectedPC(null);
      prevWorldIdRef.current = worldId;
    }
    if (!worldId) {
      setExistingScenarios([]);
      return;
    }
    listScenarios(worldId)
      .then(setExistingScenarios)
      .catch((e) => setError('Scenario一覧の取得に失敗した: ' + e.message));
  }, [worldId]);

  useEffect(() => {
    if (!worldId) {
      setExistingPCs([]);
      return;
    }
    listCharacters(worldId, 'pc')
      .then(setExistingPCs)
      .catch((e) => setError('PC一覧の取得に失敗した: ' + e.message));
  }, [worldId]);
```

`setSelectedPC(null)` を1つ目の effect に寄せたので、2つ目の effect からは消えている。両方が同じ `[worldId]` に依存しているため挙動は変わらない。

- [ ] **Step 5: テストが通ることを確認する**

```bash
npx vitest run src/screens/Setup.test.jsx
```

Expected: PASS(既存テストも含めて全パス。World を切り替えたとき Scenario / PC の選択が消える既存の挙動が保たれていること)

- [ ] **Step 6: コミット**

```bash
git add src/screens/Setup.jsx src/screens/Setup.test.jsx
git commit -m "feat(ui): Setupにstarter Contextを追加しPC選択から開始できるようにする"
```

---

## Task 12: Home の空状態と App の配線

**Files:**
- Modify: `src/screens/Home.jsx:44`(props)、`:557`付近(ボタン列の直前)
- Modify: `src/App.jsx:143-175`
- Test: `src/screens/Home.test.jsx`
- Test: `src/App.test.jsx`

**Interfaces:**
- Consumes: `StarterPackList`(Task 10)、`Setup` の `starterContext`(Task 11)
- Produces: `<Home … onStartStarter={(starterContext) => void} />`

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Home.test.jsx` の既存 `describe('Home', …)` の中に追記:

```jsx
  describe('starter packs', () => {
    const PACKS = [{
      packId: 'arkham-1920s', title: 'アーカム 1920s', tagline: '港町。', source: null,
      moods: ['ホラー'], recommendedRuleset: 'coc7e', scenarioTitle: '丘の上の写真館',
    }];

    it('offers starter packs when there are no sessions', async () => {
      vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
      renderWithAuth(<Home sessions={[]} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} onStartStarter={vi.fn()} />);
      expect(await screen.findByText('はじめての冒険を選ぶ')).toBeInTheDocument();
      expect(await screen.findByText('アーカム 1920s')).toBeInTheDocument();
    });

    it('does not offer starter packs once a session exists', async () => {
      vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
      const sessions = [{ id: 's1', title: 'セッションA', updatedAt: 1, state: { current_scene: '森', turn_count: 1 }, log: [] }];
      renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} onStartStarter={vi.fn()} />);
      await waitFor(() => expect(screen.getByText('セッションA')).toBeInTheDocument());
      expect(screen.queryByText('はじめての冒険を選ぶ')).not.toBeInTheDocument();
    });

    it('still renders the action buttons when the manifest cannot be fetched', async () => {
      vi.spyOn(starterClient, 'listStarters').mockRejectedValue(new Error('offline'));
      renderWithAuth(<Home sessions={[]} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} onStartStarter={vi.fn()} />);
      expect(await screen.findByText('+ 新規プレイ')).toBeInTheDocument();
    });

    it('passes the starterContext up when a pack is started', async () => {
      vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: PACKS, seededAt: 1 });
      vi.spyOn(starterClient, 'importStarterPack').mockResolvedValue({
        world: { id: 'arkham-1920s', title: 'アーカム 1920s', moods: ['ホラー'], raw: '# 世界' },
        scenario: { id: 'sc', worldId: 'arkham-1920s', title: '丘の上の写真館', recommendedRuleset: 'coc7e', moods: ['ホラー'], raw: '# シナリオ' },
        pcs: [], npcs: [],
      });
      const onStartStarter = vi.fn();
      renderWithAuth(<Home sessions={[]} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} onStartStarter={onStartStarter} />);

      fireEvent.click(await screen.findByText('この冒険を始める'));

      await waitFor(() => expect(onStartStarter).toHaveBeenCalled());
      expect(onStartStarter.mock.calls[0][0].rulesetId).toBe('coc7e');
    });
  });
```

ファイル冒頭の import に追記:

```jsx
import * as starterClient from '../api/starterClient.js';
```

既存の Home テストは `listStarters` をモックしていないので、`vi.restoreAllMocks()` 後は本物の `fetch` が呼ばれる。`StarterPackList` は取得失敗を握り潰して `null` を返すので既存テストは壊れないが、念のため既存テストが赤くなったら各テストで `listStarters` を `mockResolvedValue({ packs: [], seededAt: null })` にする。

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/screens/Home.test.jsx
```

Expected: FAIL — 「はじめての冒険を選ぶ」が見つからない。

- [ ] **Step 3: Home にセクションを足す**

`src/screens/Home.jsx:44` の props に `onStartStarter` を足す:

```jsx
export default function Home({ sessions, storageOk, onNew, onContinue, onOpenLibrary, onOpenGallery, onNextChapter, onStartStarter }) {
```

import に追記:

```jsx
import StarterPackList from '../components/share/StarterPackList.jsx';
```

ボタン列(`<div style={{ display: 'flex', gap: 10, marginBottom: user ? 32 : 8 }}>`)の**直前**に挿入:

```jsx
      {user && sessions.length === 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 16, color: COLORS.ink, marginBottom: 4 }}>
            はじめての冒険を選ぶ
          </div>
          <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft, marginBottom: 12 }}>
            世界観・シナリオ・登場人物が揃った一式を取り込んで、そのまま遊び始められる。取り込んだ素材は素材ライブラリに入るので、あとから自由に書き換えられる。
          </div>
          <StarterPackList onImported={onStartStarter} />
        </div>
      )}
```

- [ ] **Step 4: App を配線する**

`src/App.jsx` の Home / Setup 部分を差し替える。まず state を足す(既存の `campaignContext` の宣言の隣):

```jsx
  const [starterContext, setStarterContext] = useState(null);
```

Home:

```jsx
          <Home
            sessions={sessions}
            storageOk={storageOk}
            // 「+ 新規プレイ」から入ったSetupが直前のスターター選択を引きずると、
            // World/Scenarioが勝手に選択済みになる
            onNew={() => {
              setStarterContext(null);
              setView('setup');
            }}
            onContinue={handleContinue}
            onOpenLibrary={() => setView('library')}
            onOpenGallery={() => setView('gallery')}
            onNextChapter={(ctx) => {
              setCampaignContext(ctx);
              setView('setup');
            }}
            onStartStarter={(ctx) => {
              setStarterContext(ctx);
              setView('setup');
            }}
          />
```

Setup:

```jsx
      {view === 'setup' && (
        <Setup
          onStart={(s) => {
            setCampaignContext(null);
            setStarterContext(null);
            handleStart(s);
          }}
          onCancel={() => {
            setCampaignContext(null);
            setStarterContext(null);
            setView('home');
          }}
          campaignContext={campaignContext}
          starterContext={starterContext}
        />
      )}
```

- [ ] **Step 5: App のテストを足す**

`src/App.test.jsx` の既存 `describe` に追記(既存の render ヘルパとモック方針に合わせること):

```jsx
  it('clears the starter context when the plain new-session button is used', async () => {
    // 「+ 新規プレイ」から入った Setup が、直前のスターター選択を引きずらないこと
    // (引きずると World/Scenario が勝手に選択済みになる)
    vi.spyOn(starterClient, 'listStarters').mockResolvedValue({ packs: [], seededAt: null });
    renderApp();
    fireEvent.click(await screen.findByText('+ 新規プレイ'));
    expect(await screen.findByText('1. 世界観')).toBeInTheDocument();
  });
```

`renderApp` はファイル既存のヘルパ名に合わせること。存在しなければ既存テストと同じ render 呼び出しを使う。

- [ ] **Step 6: テストが通ることを確認する**

```bash
npx vitest run src/screens/Home.test.jsx src/App.test.jsx src/screens/Setup.test.jsx
```

Expected: PASS

- [ ] **Step 7: コミット**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx src/App.jsx src/App.test.jsx
git commit -m "feat(ui): Homeの空状態にスターターパックの導線を追加"
```

---

## Task 13: Gallery のタブ・Setup 空状態の文言・ドキュメント

**Files:**
- Modify: `src/constants/publicContent.js`
- Modify: `src/screens/Gallery.jsx`
- Modify: `src/screens/Setup.jsx:354`付近 / `:449`付近 / `:562`付近(空状態の3文言)
- Modify: `src/App.jsx`(Gallery の `onStartStarter` 配線)
- Modify: `docs/02-data-model.md` / `docs/05-ui-ux.md` / `docs/06-content-generation.md`
- Test: `src/screens/Gallery.test.jsx`
- Test: `src/screens/Setup.test.jsx`

**Interfaces:**
- Consumes: `StarterPackList`(Task 10)、`onStartStarter`(Task 12)
- Produces: `<Gallery onClose onStartStarter />`

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Gallery.test.jsx` に追記:

```jsx
  describe('starters tab', () => {
    it('shows the starters tab first and renders pack cards there', async () => {
      vi.spyOn(starterClient, 'listStarters').mockResolvedValue({
        packs: [{ packId: 'arkham-1920s', title: 'アーカム 1920s', tagline: '港町。', source: null, moods: ['ホラー'], recommendedRuleset: 'coc7e', scenarioTitle: '丘の上の写真館' }],
        seededAt: 1,
      });
      render(<Gallery onClose={vi.fn()} onStartStarter={vi.fn()} />);
      expect(screen.getByText('おすすめ')).toBeInTheDocument();
      expect(await screen.findByText('アーカム 1920s')).toBeInTheDocument();
    });

    it('swaps the pack cards for the public item list when another tab is chosen', async () => {
      vi.spyOn(starterClient, 'listStarters').mockResolvedValue({
        packs: [{ packId: 'arkham-1920s', title: 'アーカム 1920s', tagline: '港町。', source: null, moods: ['ホラー'], recommendedRuleset: 'coc7e', scenarioTitle: '丘の上の写真館' }],
        seededAt: 1,
      });
      render(<Gallery onClose={vi.fn()} onStartStarter={vi.fn()} />);
      expect(await screen.findByText('この冒険を始める')).toBeInTheDocument();

      fireEvent.click(screen.getByText('小説'));

      await waitFor(() => expect(screen.queryByText('この冒険を始める')).not.toBeInTheDocument());
      expect(screen.queryByText('アーカム 1920s')).not.toBeInTheDocument();
    });
  });
```

`src/screens/Setup.test.jsx` に追記:

```jsx
  it('points the empty world state at the gallery', async () => {
    vi.spyOn(worldLibraryClient, 'listWorlds').mockResolvedValue([]);
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ'));
    expect(await screen.findByText(/公開ギャラリーの「おすすめ」/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
npx vitest run src/screens/Gallery.test.jsx src/screens/Setup.test.jsx
```

Expected: FAIL — 「おすすめ」タブが無い / 空状態の文言が一致しない。

- [ ] **Step 3: タブ定義を足す**

`src/constants/publicContent.js`:

```js
export const PUBLIC_TABS = [
  { key: 'starters', label: 'おすすめ' },
  { key: 'novels', label: '小説' },
  { key: 'worlds', label: '世界観' },
  { key: 'characters', label: 'キャラクター' },
  { key: 'scenarios', label: 'シナリオ' },
];
```

- [ ] **Step 4: Gallery を分岐させる**

`src/screens/Gallery.jsx`:

```jsx
export default function Gallery({ onClose, onStartStarter }) {
  const [tab, setTab] = useState('starters');
```

import に追記:

```jsx
import StarterPackList from '../components/share/StarterPackList.jsx';
```

タブ行の直後、`<PublicItemList … />` を含むブロック全体を条件分岐で包む:

```jsx
      {/* starters は公開アイテムの一覧/詳細ではなく「まとめて取り込む単位」なので、
          /api/public/:type の TYPES にも属さない。ここだけ別コンポーネントを描画する。 */}
      {tab === 'starters' ? (
        <StarterPackList onImported={onStartStarter} />
      ) : (
        <>
          <PublicItemList
            key={tab}
            type={tab}
            active={viewMode === 'list'}
            onOpenDetail={openDetail}
            onAuthorClick={(ownerId) => navigateToUser(ownerId)}
          />

          {viewMode !== 'list' &&
            (detailLoading ? (
              <div>
                <Button variant="ghost" onClick={backToList} style={{ marginBottom: 16 }}>
                  ← 一覧に戻る
                </Button>
                <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.faint }}>読み込み中…</div>
              </div>
            ) : detailError ? (
              <div>
                <Button variant="ghost" onClick={backToList} style={{ marginBottom: 16 }}>
                  ← 一覧に戻る
                </Button>
                <div style={{ color: COLORS.stamp, fontSize: 13 }}>{detailError}</div>
              </div>
            ) : (
              detail && (
                <PublicItemDetail
                  type={tab}
                  item={detail}
                  onBack={backToList}
                  onAuthorClick={(ownerId) => navigateToUser(ownerId)}
                />
              )
            ))}
        </>
      )}
```

- [ ] **Step 5: App から Gallery に配線する**

`src/App.jsx`:

```jsx
      {view === 'gallery' && (
        <Gallery
          onClose={() => setView('home')}
          onStartStarter={(ctx) => {
            setStarterContext(ctx);
            setView('setup');
          }}
        />
      )}
```

- [ ] **Step 6: Setup の空状態文言を書き換える**

`src/screens/Setup.jsx` の3箇所を差し替える。

World(`:354`付近):

```jsx
                      素材ライブラリにWorldがまだ無い。公開ギャラリーの「おすすめ」から一式を取り込むか、「新規に用意する」で自分で書く。
```

Scenario(`:449`付近):

```jsx
                      このWorldにはScenarioがまだ無い。「自分で用意する」で貼り付けるか、「AIに生成させる」を選ぶ。
```

PC(`:562`付近):

```jsx
                      このWorldにはPCがまだ無い。「自由記述で新規作成」で書くか、素材ライブラリのCharacterタブで先に作る。
```

- [ ] **Step 7: テストが通ることを確認する**

```bash
npm test
```

Expected: 全パス。ベースライン 1145 + 新規テストの合計。

- [ ] **Step 8: ドキュメントを更新する**

`docs/02-data-model.md` の「フォルダ構造」ブロックに追記:

```
public/starters                      スターターパックのマニフェスト({ packs[], seededAt })。
                                     シード(server/starters/seed.js)が書き、GET /api/startersが返す
```

同じ節に、既存実装の制約として次を追記する:

> **キャラクターの `name` はASCIIに限られる**: `server/routes/characters.js` が `router.param('name', idParamGuard)` を持ち、`isValidId` が `^[A-Za-z0-9._-]+$` を要求する(`name` がそのままファイルパスになるため)。日本語名を `saveCharacter` で直接保存することは可能だが、その後の `GET /worlds/:worldId/characters/:kind/:name` が400を返す。スターターパックはローマ字スラッグを `name` にし、日本語表記をシート本文の `PC名:` 行に持つ。
>
> **`importWorld` の `preferredId`**: `slugify` は `[^a-z0-9-]` を全除去するため、日本語タイトルのWorldをインポートすると id が `untitled` に潰れる。`importWorld(…, publicId, { preferredId })` で id を明示でき、スターターの一括インポートは `packId` を渡す。未指定なら従来どおり `slugify(title)`。

`docs/05-ui-ux.md` の「起動直後のUI」の節に追記:

> **スターターパック(実装済み 2026-07-25)**: ログイン済みでセッションが0件のとき、Homeのボタン列の上に「はじめての冒険を選ぶ」セクションが出る(`src/components/share/StarterPackList.jsx`)。カードは公式サンプル7パックで、「この冒険を始める」で World / Scenario / PC2体 / NPC2体 を一括インポートし、World・Scenario・Rulesetが選択済みのSetup(PC選択のstep 3)へ遷移する。PCまで自動選択しないのは、どちらを演じるかが初回ユーザーの最初の選択であり、「PCはWorldに属していて選ぶもの」という構造を最短で伝えるため。マニフェストが取得できない/空のときはセクションごと描画しない。公開ギャラリーの先頭タブ「おすすめ」からも同じカードに到達でき、2周目以降のユーザーが別の世界観を取りに行ける。

`docs/06-content-generation.md` に新しい節を追加:

> ## スターターコンテンツ
>
> 素材の正本は `content/starters/{packId}/` に Markdown + `pack.json` で置く(`server/data/` はgitignore対象のため)。`server/starters/loadPacks.js` が読み込みと検証を行い(moods語彙・ruleset・ASCII id・PC2体NPC2体・`## シナリオ概要`と`## GM専用情報`の両方・PCの`goal:`/`bonds:`)、`server/starters/seed.js` が公式ユーザー `usr_official`(表示名「公式サンプル」、`auth/identities/*` を持たないためログイン不可)のライブラリへ保存したうえで既存の `publishWorld` / `publishScenario` / `publishCharacter` で公開する。採番された `publicId` はマニフェスト `public/starters` に集約される。
>
> シードは冪等(`resolvePublicId` がマッピングを見て既存 `publicId` を再利用する)で、サーバー起動時(`server/index.js`)と `npm run seed` で実行される。素材の文面を直して再シードすると公開済みの内容だけが更新され、既にインポート済みのユーザーの手元は変わらない(コピーであるため)。
>
> 権利方針: 実在の世界観はパブリックドメイン作品のみ(クトゥルフ神話・北欧神話・日本の伝承・バローズの火星シリーズ・H.G.ウェルズ『宇宙戦争』)。フェイルーン・中つ国・既存のサイバーパンク作品は権利者があるため、同ジャンルのオリジナル世界観で代替している。PD由来のパックは `pack.json` の `source` に出典を持ちUIに表示する。「バルスーム」「ジョン・カーター」は商標のため使わず、パック名は「死にゆく火星」とし登場人物もオリジナルにしている。

- [ ] **Step 9: 実際に動かして確認する**

```bash
npm run seed
```

Expected: `seeded 7 starter packs into …`

`.claude/launch.json` に dev 用の設定が無ければ作り、preview を起動して確認する。ログイン後に Home へ「はじめての冒険を選ぶ」が出ること、カードを押すと Setup が「4. PC」から開き World / Scenario / Ruleset が選択済みであること、公開ギャラリーの先頭タブが「おすすめ」であることを目視する。

- [ ] **Step 10: 最終確認とコミット**

```bash
npm test
```

Expected: 全パス

```bash
git add src/constants/publicContent.js src/screens/Gallery.jsx src/screens/Gallery.test.jsx src/screens/Setup.jsx src/screens/Setup.test.jsx src/App.jsx docs/
git commit -m "feat(ui): 公開ギャラリーにおすすめタブを追加しSetupの空状態から導線を張る"
```

---

## 完了条件

- `npm test` が全パス(ベースライン 1145 tests を下回らない)
- `npm run seed` が7パックをシードする
- ログイン直後・セッション0件の Home に7枚のパックカードが出る
- 「この冒険を始める」→ Setup が「4. PC」から開き、World / Scenario / Ruleset が選択済み
- PCを選んで「ゲーム開始」すると、選んだ世界観・シナリオ・Rulesetでセッションが始まる
- 公開ギャラリーの先頭タブが「おすすめ」で、同じカードから同じ導線に入れる
- `server/data/` を消して再起動しても、スターターが復元される
