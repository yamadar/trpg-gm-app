# 共有機能 (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 世界観/キャラクター/シナリオ/小説の公開(スナップショット方式)、認証不要の公開ギャラリー、共有素材の自ライブラリへのコピーインポートを実装する。

**Architecture:** 公開時に内容を `public/` ツリーへ複製(スナップショット)。公開読み取りは `public/` のみを読む認証不要ルーター。私的側は `users/{userId}/publish/...` のmappingで自アイテム→publicIdを対応付け、公開/再公開/解除とインポートはすべて既存の dataStore/textStore + ライブラリ関数を再利用する。

**Tech Stack:** 既存スタックのみ(Express / React / vitest / supertest)。新規依存なし。

**Spec:** `docs/superpowers/specs/2026-07-23-sharing-phase2-design.md`

## Global Constraints

- インポートはコピー(スナップショット)。インポート後は元の変更/削除の影響を受けない
- 公開ID: `pub_{12hex}`(crypto乱数)。再公開は同一publicIdへ上書き、`publishedAt` 維持・`updatedAt` 更新
- 公開読み取り(`GET /api/public/*`)は認証不要。公開/解除/インポートはログイン必須(既存requireAuth)
- 世界観スナップショット = world.md + 全region + 全category。`source.md` と `.parsed` は公開しない
- 公開メタ共通: `{ publicId, title, ownerId, ownerName, publishedAt, updatedAt }`。characters追加: `kind`, `name`。scenarios追加: `recommendedRuleset`。worlds追加: `regions: string[]`, `categories: string[]`
- 私的アイテム削除時は公開も連動解除(ルート層カスケード)。`deleteWorld` は配下の公開キャラ/シナリオも解除
- 小説公開は novel.md 未生成なら `409 { error: 'novelize first' }`。小説はインポート対象外
- 公開一覧は `publishedAt` 降順・全件
- ID/名前の衝突時は `-2`, `-3`… サフィックス
- サーバーテストは `// @vitest-environment node` + supertest + スタブ認証(`req.userId`)、クライアントは testing-library + `renderWithAuth` + fireEvent(userEventは依存に無い)
- UI文言は日本語。コミットは各タスク末尾、既存の `feat:`/`fix:`/`docs:` 規約

## 実行前の注意

- 前提: Phase 1 マージ済みの `main`(`d5e0d3a` 以降)から作業ブランチを切る
- 受け入れ: 全タスク完了後 `npx vitest run` 全パス

---

### Task 1: paths.js に public/publish キー生成関数を追加

**Files:**
- Modify: `server/storage/paths.js`(末尾に追記。既存関数は不変)
- Test: `server/storage/paths.test.js`(追記)

**Interfaces:**
- Produces(全て新規エクスポート):

```js
publicListPrefix(type)                  // `public/${type}`    type: 'worlds'|'characters'|'scenarios'|'novels'
publicMetaKey(type, publicId)           // `public/${type}/${publicId}`
publicWorldDocsPrefix(publicId)         // `public/worlds/${publicId}`          (deleteDir用)
publicWorldDocPath(publicId)            // `public/worlds/${publicId}/world.md`
publicRegionDocPath(publicId, region)   // `public/worlds/${publicId}/regions/${region}.md`
publicCategoryDocPath(publicId, category) // `public/worlds/${publicId}/categories/${category}.md`
publicCharacterDocsPrefix(publicId)     // `public/characters/${publicId}`
publicCharacterDocPath(publicId)        // `public/characters/${publicId}/sheet.md`
publicScenarioDocsPrefix(publicId)      // `public/scenarios/${publicId}`
publicScenarioDocPath(publicId)         // `public/scenarios/${publicId}/scenario.md`
publicNovelDocsPrefix(publicId)         // `public/novels/${publicId}`
publicNovelDocPath(publicId)            // `public/novels/${publicId}/novel.md`
publishWorldMapKey(userId, worldId)     // `users/${userId}/publish/worlds/${worldId}`
publishWorldListPrefix(userId)          // `users/${userId}/publish/worlds`
publishCharacterMapKey(userId, worldId, kind, name)   // `users/${userId}/publish/worlds/${worldId}/characters/${kind}/${name}`
publishCharacterListPrefix(userId, worldId, kind)     // `users/${userId}/publish/worlds/${worldId}/characters/${kind}`
publishScenarioMapKey(userId, worldId, scenarioId)    // `users/${userId}/publish/worlds/${worldId}/scenarios/${scenarioId}`
publishScenarioListPrefix(userId, worldId)            // `users/${userId}/publish/worlds/${worldId}/scenarios`
publishNovelMapKey(userId, sessionId)   // `users/${userId}/publish/sessions/${sessionId}`
publishNovelListPrefix(userId)          // `users/${userId}/publish/sessions`
```

- [ ] **Step 1: 失敗するテストを追記**

`server/storage/paths.test.js` に追加(既存describeと同スタイル):

```js
describe('public/publish paths', () => {
  it('builds public tree keys', () => {
    expect(publicListPrefix('worlds')).toBe('public/worlds');
    expect(publicMetaKey('novels', 'pub_abc')).toBe('public/novels/pub_abc');
    expect(publicWorldDocsPrefix('pub_abc')).toBe('public/worlds/pub_abc');
    expect(publicWorldDocPath('pub_abc')).toBe('public/worlds/pub_abc/world.md');
    expect(publicRegionDocPath('pub_abc', 'north')).toBe('public/worlds/pub_abc/regions/north.md');
    expect(publicCategoryDocPath('pub_abc', 'magic')).toBe('public/worlds/pub_abc/categories/magic.md');
    expect(publicCharacterDocPath('pub_abc')).toBe('public/characters/pub_abc/sheet.md');
    expect(publicScenarioDocPath('pub_abc')).toBe('public/scenarios/pub_abc/scenario.md');
    expect(publicNovelDocPath('pub_abc')).toBe('public/novels/pub_abc/novel.md');
  });

  it('builds publish mapping keys under the user namespace', () => {
    expect(publishWorldMapKey('usr_1', 'w1')).toBe('users/usr_1/publish/worlds/w1');
    expect(publishWorldListPrefix('usr_1')).toBe('users/usr_1/publish/worlds');
    expect(publishCharacterMapKey('usr_1', 'w1', 'pc', 'alice')).toBe('users/usr_1/publish/worlds/w1/characters/pc/alice');
    expect(publishCharacterListPrefix('usr_1', 'w1', 'npc')).toBe('users/usr_1/publish/worlds/w1/characters/npc');
    expect(publishScenarioMapKey('usr_1', 'w1', 's1')).toBe('users/usr_1/publish/worlds/w1/scenarios/s1');
    expect(publishScenarioListPrefix('usr_1', 'w1')).toBe('users/usr_1/publish/worlds/w1/scenarios');
    expect(publishNovelMapKey('usr_1', 'sess1')).toBe('users/usr_1/publish/sessions/sess1');
    expect(publishNovelListPrefix('usr_1')).toBe('users/usr_1/publish/sessions');
  });
});
```

importも追記すること。

- [ ] **Step 2: RED確認** — Run: `npx vitest run server/storage/paths.test.js` / Expected: FAIL
- [ ] **Step 3: paths.jsへInterfaces欄のとおりの関数を追記(1行return形式、既存スタイル)**
- [ ] **Step 4: GREEN確認** — Run: `npx vitest run server/storage/paths.test.js` / Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add server/storage/paths.js server/storage/paths.test.js
git commit -m "feat(storage): 公開ツリー/公開mappingのキー生成関数"
```

---

### Task 2: shareLibrary 書き込み側(publish/unpublish/カスケード)

**Files:**
- Create: `server/storage/shareLibrary.js`
- Test: `server/storage/shareLibrary.test.js`

**Interfaces:**
- Consumes: Task 1のpathsヘルパー、既存 `getWorld`/`getCharacter`/`getScenario`/`listRegions`/`getRegion`/`listCategories`/`getCategory`
- Produces(publish系はすべて `{ ok: true, meta } | { ok: false, reason }` を返す。unpublish系は冪等でvoid):

```js
publishWorld(dataStore, textStore, userId, worldId, owner)            // reason: 'not_found'
publishCharacter(dataStore, textStore, userId, worldId, kind, name, owner)
publishScenario(dataStore, textStore, userId, worldId, scenarioId, owner)
publishNovel(dataStore, textStore, userId, sessionId, owner)          // reason: 'not_found' | 'novel_not_generated'
unpublishWorld(dataStore, textStore, userId, worldId)
unpublishCharacter(dataStore, textStore, userId, worldId, kind, name)
unpublishScenario(dataStore, textStore, userId, worldId, scenarioId)
unpublishNovel(dataStore, textStore, userId, sessionId)
unpublishWorldCascade(dataStore, textStore, userId, worldId)          // 配下の公開キャラ/シナリオ→世界の順に解除
// owner = { id, displayName }
```

- [ ] **Step 1: 失敗するテストを書く**(要点。同スタイルで全ケース書くこと)

```js
// server/storage/shareLibrary.test.js
// @vitest-environment node
// beforeEach/afterEach は既存ストレージテストと同じ mkdtemp パターン
// 準備ヘルパ: seedWorld(userId) — saveWorld + saveRegion('north') + saveCategory('magic') + saveWorldSource
const OWNER = { id: 'usr_1', displayName: '太郎' };

it('publishWorld snapshots world.md, regions and categories but not source.md', async () => {
  await seedWorld('usr_1'); // worldId 'w1', title 'テスト世界', raw '# 本文'
  const { ok, meta } = await publishWorld(dataStore, textStore, 'usr_1', 'w1', OWNER);
  expect(ok).toBe(true);
  expect(meta.publicId).toMatch(/^pub_[0-9a-f]{12}$/);
  expect(meta).toMatchObject({ title: 'テスト世界', ownerId: 'usr_1', ownerName: '太郎', regions: ['north'], categories: ['magic'] });
  expect(await textStore.read(publicWorldDocPath(meta.publicId))).toBe('# 本文');
  expect(await textStore.read(publicRegionDocPath(meta.publicId, 'north'))).toBe('北の地方');
  expect(await textStore.list(`public/worlds/${meta.publicId}`)).not.toContain(expect.stringContaining('source'));
  expect(await dataStore.get(publishWorldMapKey('usr_1', 'w1'))).toEqual({ publicId: meta.publicId });
});

it('republish keeps publicId and publishedAt, bumps updatedAt, and drops removed regions', async () => {
  // 公開 → region削除+world.md変更 → 再公開 → 同一publicId / publishedAt同値 / 旧regionのファイルが消えている
});

it('publishWorld returns not_found for a missing world', async () => {
  expect(await publishWorld(dataStore, textStore, 'usr_1', 'nope', OWNER)).toEqual({ ok: false, reason: 'not_found' });
});

it('publishCharacter/publishScenario snapshot content with type fields', async () => {
  // characters: meta.kind==='pc', meta.name==='alice', title===name, sheet.mdに本文
  // scenarios: meta.recommendedRuleset を含む
});

it('publishNovel requires the novel to exist', async () => {
  // セッションなし → not_found / セッションあり+novel.mdなし → novel_not_generated
  // novel.mdあり → ok, novel.md複製, meta.title===session.title
});

it('unpublish removes snapshot, meta and mapping and is idempotent', async () => {
  // 公開→解除→ meta null / docs消滅 / mapping null。もう一度解除してもthrowしない
});

it('unpublishWorldCascade unpublishes children then the world', async () => {
  // world + pcキャラ + シナリオを公開 → cascade → 3つとも public/ から消えmappingも消える
});
```

- [ ] **Step 2: RED確認** — Run: `npx vitest run server/storage/shareLibrary.test.js`
- [ ] **Step 3: 実装**

```js
// server/storage/shareLibrary.js
import crypto from 'node:crypto';
import {
  publicMetaKey, publicWorldDocsPrefix, publicWorldDocPath, publicRegionDocPath, publicCategoryDocPath,
  publicCharacterDocsPrefix, publicCharacterDocPath, publicScenarioDocsPrefix, publicScenarioDocPath,
  publicNovelDocsPrefix, publicNovelDocPath,
  publishWorldMapKey, publishCharacterMapKey, publishCharacterListPrefix,
  publishScenarioMapKey, publishScenarioListPrefix, publishNovelMapKey,
  sessionKey, sessionNovelDocPath,
} from './paths.js';
import { getWorld } from './worldLibrary.js';
import { getCharacter } from './characterLibrary.js';
import { getScenario } from './scenarioLibrary.js';
import { listRegions, getRegion, listCategories, getCategory } from './worldContentLibrary.js';

function newPublicId() {
  return `pub_${crypto.randomBytes(6).toString('hex')}`;
}

// mappingがあれば同じpublicIdへ上書き(再公開)、なければ採番
async function resolvePublicId(dataStore, mapKey) {
  const map = await dataStore.get(mapKey);
  return map?.publicId ?? newPublicId();
}

// publishedAtは初回公開時刻を維持する
async function buildMeta(dataStore, type, publicId, owner, fields) {
  const existing = await dataStore.get(publicMetaKey(type, publicId));
  const now = Date.now();
  return {
    publicId,
    ownerId: owner.id,
    ownerName: owner.displayName,
    publishedAt: existing?.publishedAt ?? now,
    updatedAt: now,
    ...fields,
  };
}

async function finishPublish(dataStore, type, mapKey, meta) {
  await dataStore.set(publicMetaKey(type, meta.publicId), meta);
  await dataStore.set(mapKey, { publicId: meta.publicId });
  return { ok: true, meta };
}

export async function publishWorld(dataStore, textStore, userId, worldId, owner) {
  const world = await getWorld(dataStore, textStore, userId, worldId);
  if (!world) return { ok: false, reason: 'not_found' };
  const mapKey = publishWorldMapKey(userId, worldId);
  const publicId = await resolvePublicId(dataStore, mapKey);
  const regions = await listRegions(textStore, userId, worldId);
  const categories = await listCategories(textStore, userId, worldId);
  // 再公開で消えたregion/categoryの残骸を残さないため、ドキュメント一式を作り直す
  await textStore.deleteDir(publicWorldDocsPrefix(publicId));
  await textStore.write(publicWorldDocPath(publicId), world.raw);
  for (const region of regions) {
    await textStore.write(publicRegionDocPath(publicId, region), (await getRegion(textStore, userId, worldId, region)) ?? '');
  }
  for (const category of categories) {
    await textStore.write(publicCategoryDocPath(publicId, category), (await getCategory(textStore, userId, worldId, category)) ?? '');
  }
  const meta = await buildMeta(dataStore, 'worlds', publicId, owner, { title: world.title, regions, categories });
  return finishPublish(dataStore, 'worlds', mapKey, meta);
}

export async function publishCharacter(dataStore, textStore, userId, worldId, kind, name, owner) {
  const character = await getCharacter(dataStore, textStore, userId, worldId, kind, name);
  if (!character) return { ok: false, reason: 'not_found' };
  const mapKey = publishCharacterMapKey(userId, worldId, kind, name);
  const publicId = await resolvePublicId(dataStore, mapKey);
  await textStore.write(publicCharacterDocPath(publicId), character.raw);
  const meta = await buildMeta(dataStore, 'characters', publicId, owner, { title: name, kind, name });
  return finishPublish(dataStore, 'characters', mapKey, meta);
}

export async function publishScenario(dataStore, textStore, userId, worldId, scenarioId, owner) {
  const scenario = await getScenario(dataStore, textStore, userId, worldId, scenarioId);
  if (!scenario) return { ok: false, reason: 'not_found' };
  const mapKey = publishScenarioMapKey(userId, worldId, scenarioId);
  const publicId = await resolvePublicId(dataStore, mapKey);
  await textStore.write(publicScenarioDocPath(publicId), scenario.raw);
  const meta = await buildMeta(dataStore, 'scenarios', publicId, owner, {
    title: scenario.title,
    recommendedRuleset: scenario.recommendedRuleset ?? null,
  });
  return finishPublish(dataStore, 'scenarios', mapKey, meta);
}

export async function publishNovel(dataStore, textStore, userId, sessionId, owner) {
  const session = await dataStore.get(sessionKey(userId, sessionId));
  if (!session) return { ok: false, reason: 'not_found' };
  const text = await textStore.read(sessionNovelDocPath(userId, sessionId));
  if (text === null) return { ok: false, reason: 'novel_not_generated' };
  const mapKey = publishNovelMapKey(userId, sessionId);
  const publicId = await resolvePublicId(dataStore, mapKey);
  await textStore.write(publicNovelDocPath(publicId), text);
  const meta = await buildMeta(dataStore, 'novels', publicId, owner, { title: session.title ?? 'セッション' });
  return finishPublish(dataStore, 'novels', mapKey, meta);
}

async function unpublishByMap(dataStore, textStore, type, mapKey, docsPrefixFn) {
  const map = await dataStore.get(mapKey);
  if (!map) return;
  await textStore.deleteDir(docsPrefixFn(map.publicId));
  await dataStore.delete(publicMetaKey(type, map.publicId));
  await dataStore.delete(mapKey);
}

export async function unpublishWorld(dataStore, textStore, userId, worldId) {
  await unpublishByMap(dataStore, textStore, 'worlds', publishWorldMapKey(userId, worldId), publicWorldDocsPrefix);
}

export async function unpublishCharacter(dataStore, textStore, userId, worldId, kind, name) {
  await unpublishByMap(dataStore, textStore, 'characters', publishCharacterMapKey(userId, worldId, kind, name), publicCharacterDocsPrefix);
}

export async function unpublishScenario(dataStore, textStore, userId, worldId, scenarioId) {
  await unpublishByMap(dataStore, textStore, 'scenarios', publishScenarioMapKey(userId, worldId, scenarioId), publicScenarioDocsPrefix);
}

export async function unpublishNovel(dataStore, textStore, userId, sessionId) {
  await unpublishByMap(dataStore, textStore, 'novels', publishNovelMapKey(userId, sessionId), publicNovelDocsPrefix);
}

// deleteWorld用: 配下の公開キャラ/シナリオ→世界本体の順に解除
export async function unpublishWorldCascade(dataStore, textStore, userId, worldId) {
  for (const kind of ['pc', 'npc']) {
    for (const key of await dataStore.list(publishCharacterListPrefix(userId, worldId, kind))) {
      await unpublishCharacter(dataStore, textStore, userId, worldId, kind, key.split('/').pop());
    }
  }
  for (const key of await dataStore.list(publishScenarioListPrefix(userId, worldId))) {
    await unpublishScenario(dataStore, textStore, userId, worldId, key.split('/').pop());
  }
  await unpublishWorld(dataStore, textStore, userId, worldId);
}
```

- [ ] **Step 4: GREEN確認** — Run: `npx vitest run server/storage/shareLibrary.test.js` → PASS。続けて `npx vitest run server/storage/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add server/storage/shareLibrary.js server/storage/shareLibrary.test.js
git commit -m "feat(share): 公開スナップショットの作成/上書き/解除とカスケード解除"
```

---

### Task 3: shareLibrary 読み取り側(公開一覧・詳細・公開状態マップ)

**Files:**
- Modify: `server/storage/shareLibrary.js`(追記)
- Test: `server/storage/shareLibrary.test.js`(追記)

**Interfaces:**
- Produces(追記エクスポート):

```js
listPublic(dataStore, type)                              // メタ配列、publishedAt降順
getPublicWorld(dataStore, textStore, publicId)           // { ...meta, raw, regions: [{name, raw}], categories: [{name, raw}] } | null
getPublicItem(dataStore, textStore, type, publicId)      // type: 'characters'|'scenarios'|'novels' → { ...meta, raw } | null
getPublishedWorlds(dataStore, userId)                    // { [worldId]: publicId }
getPublishedCharacters(dataStore, userId, worldId, kind) // { [name]: publicId }
getPublishedScenarios(dataStore, userId, worldId)        // { [scenarioId]: publicId }
getPublishedNovels(dataStore, userId)                    // { [sessionId]: publicId }
```

- [ ] **Step 1: 失敗するテストを追記**(要点)

```js
it('listPublic returns metas sorted by publishedAt desc', async () => {
  // 2ユーザー分のworldを時間差で公開(vi.spyOn(Date,'now')等は使わずpublishedAtを直接比較) → 新しい順
});

it('getPublicWorld returns meta with region/category bodies', async () => {
  // regions: [{name:'north', raw:'北の地方'}] を検証。未知publicIdはnull
});

it('getPublicItem reads the per-type doc', async () => {
  // characters/scenarios/novels 各1件。未知publicIdはnull
});

it('getPublished* maps local ids to publicIds', async () => {
  // world w1 公開/w2 非公開 → { w1: 'pub_...' } のみ
  // characters は kind ごと、novels は sessionId → publicId
});
```

- [ ] **Step 2: RED確認** — Run: `npx vitest run server/storage/shareLibrary.test.js`
- [ ] **Step 3: 実装(shareLibrary.jsへ追記)**

```js
// import に publicListPrefix, publicWorldDocPath ほか必要分と
// publishWorldListPrefix, publishNovelListPrefix を追加

export async function listPublic(dataStore, type) {
  const keys = await dataStore.list(publicListPrefix(type));
  const metas = (await Promise.all(keys.map((k) => dataStore.get(k)))).filter(Boolean);
  return metas.sort((a, b) => b.publishedAt - a.publishedAt);
}

export async function getPublicWorld(dataStore, textStore, publicId) {
  const meta = await dataStore.get(publicMetaKey('worlds', publicId));
  if (!meta) return null;
  const raw = (await textStore.read(publicWorldDocPath(publicId))) ?? '';
  const regions = await Promise.all(
    (meta.regions ?? []).map(async (name) => ({ name, raw: (await textStore.read(publicRegionDocPath(publicId, name))) ?? '' }))
  );
  const categories = await Promise.all(
    (meta.categories ?? []).map(async (name) => ({ name, raw: (await textStore.read(publicCategoryDocPath(publicId, name))) ?? '' }))
  );
  return { ...meta, raw, regions, categories };
}

const ITEM_DOC_PATH = {
  characters: publicCharacterDocPath,
  scenarios: publicScenarioDocPath,
  novels: publicNovelDocPath,
};

export async function getPublicItem(dataStore, textStore, type, publicId) {
  const meta = await dataStore.get(publicMetaKey(type, publicId));
  if (!meta) return null;
  const raw = (await textStore.read(ITEM_DOC_PATH[type](publicId))) ?? '';
  return { ...meta, raw };
}

async function mapFromPrefix(dataStore, prefix) {
  const out = {};
  for (const key of await dataStore.list(prefix)) {
    const map = await dataStore.get(key);
    if (map?.publicId) out[key.split('/').pop()] = map.publicId;
  }
  return out;
}

export async function getPublishedWorlds(dataStore, userId) {
  return mapFromPrefix(dataStore, publishWorldListPrefix(userId));
}

export async function getPublishedCharacters(dataStore, userId, worldId, kind) {
  return mapFromPrefix(dataStore, publishCharacterListPrefix(userId, worldId, kind));
}

export async function getPublishedScenarios(dataStore, userId, worldId) {
  return mapFromPrefix(dataStore, publishScenarioListPrefix(userId, worldId));
}

export async function getPublishedNovels(dataStore, userId) {
  return mapFromPrefix(dataStore, publishNovelListPrefix(userId));
}
```

- [ ] **Step 4: GREEN確認** — Run: `npx vitest run server/storage/shareLibrary.test.js` → PASS
- [ ] **Step 5: Commit**

```bash
git add server/storage/shareLibrary.js server/storage/shareLibrary.test.js
git commit -m "feat(share): 公開一覧・公開詳細・公開状態マップの読み取り"
```

---

### Task 4: importLibrary(コピーインポート)

**Files:**
- Create: `server/storage/importLibrary.js`
- Create: `server/storage/slugify.js`(クライアント`src/utils/slugify.js`と同一実装のサーバー用コピー。コメントで由来を明記)
- Test: `server/storage/importLibrary.test.js`

**Interfaces:**
- Consumes: Task 3の `getPublicWorld`/`getPublicItem`、既存 `saveWorld`/`saveRegion`/`saveCategory`/`saveCharacter`/`saveScenario`、`worldMetaKey`/`characterMetaKey`/`scenarioMetaKey`
- Produces:

```js
importWorld(dataStore, textStore, userId, publicId)
  // { ok: true, meta } | { ok: false, reason: 'not_found' }。metaは作成された世界(新id入り)
importCharacter(dataStore, textStore, userId, publicId, targetWorldId)
  // { ok: true, meta } | { ok: false, reason: 'not_found' | 'target_not_found' }
importScenario(dataStore, textStore, userId, publicId, targetWorldId)  // 同上
// slugify.js: export function slugify(value)  … src/utils/slugify.js と同一
```

- [ ] **Step 1: 失敗するテストを書く**(要点)

```js
it('importWorld copies world.md, regions and categories under a new id', async () => {
  // usr_a が公開('テスト世界' → slugifyで'untitled'になる日本語タイトルも許容) → usr_b がインポート
  // usr_b のライブラリに meta/world.md/regions/categories が複製される
  // usr_a 側のデータと public/ 側は不変
});

it('importWorld suffixes the id on collision', async () => {
  // usr_b に同idの世界を先に作っておく → インポートで `-2` が付く。もう一度 → `-3`
});

it('importWorld returns not_found for unknown publicId', async () => {});

it('importCharacter copies into the target world with name collision suffix', async () => {
  // targetWorldId不在 → target_not_found / npcはrevealed=falseで入る
});

it('importScenario copies with recommendedRuleset preserved', async () => {});

it('import is a snapshot: source unpublish後もインポート済みコピーは残る', async () => {});
```

- [ ] **Step 2: RED確認** — Run: `npx vitest run server/storage/importLibrary.test.js`
- [ ] **Step 3: 実装**

```js
// server/storage/slugify.js
// src/utils/slugify.js と同一実装(サーバーはクライアントのソースを import しない方針のため複製)
export function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64) || 'untitled';
}
```

```js
// server/storage/importLibrary.js
import { slugify } from './slugify.js';
import { worldMetaKey, characterMetaKey, scenarioMetaKey } from './paths.js';
import { saveWorld } from './worldLibrary.js';
import { saveRegion, saveCategory } from './worldContentLibrary.js';
import { saveCharacter } from './characterLibrary.js';
import { saveScenario } from './scenarioLibrary.js';
import { getPublicWorld, getPublicItem } from './shareLibrary.js';

async function findAvailable(base, exists) {
  if (!(await exists(base))) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
}

export async function importWorld(dataStore, textStore, userId, publicId) {
  const pub = await getPublicWorld(dataStore, textStore, publicId);
  if (!pub) return { ok: false, reason: 'not_found' };
  const id = await findAvailable(slugify(pub.title), async (c) => (await dataStore.get(worldMetaKey(userId, c))) !== null);
  const world = await saveWorld(dataStore, textStore, userId, { id, title: pub.title, raw: pub.raw });
  for (const region of pub.regions) await saveRegion(textStore, userId, id, region.name, region.raw);
  for (const category of pub.categories) await saveCategory(textStore, userId, id, category.name, category.raw);
  return { ok: true, meta: world };
}

export async function importCharacter(dataStore, textStore, userId, publicId, targetWorldId) {
  const pub = await getPublicItem(dataStore, textStore, 'characters', publicId);
  if (!pub) return { ok: false, reason: 'not_found' };
  if ((await dataStore.get(worldMetaKey(userId, targetWorldId))) === null) return { ok: false, reason: 'target_not_found' };
  const name = await findAvailable(pub.name, async (c) => (await dataStore.get(characterMetaKey(userId, targetWorldId, pub.kind, c))) !== null);
  const character = await saveCharacter(dataStore, textStore, userId, {
    worldId: targetWorldId,
    kind: pub.kind,
    name,
    raw: pub.raw,
    revealed: false, // インポート先ではNPC秘匿情報を未開示に戻す
  });
  return { ok: true, meta: character };
}

export async function importScenario(dataStore, textStore, userId, publicId, targetWorldId) {
  const pub = await getPublicItem(dataStore, textStore, 'scenarios', publicId);
  if (!pub) return { ok: false, reason: 'not_found' };
  if ((await dataStore.get(worldMetaKey(userId, targetWorldId))) === null) return { ok: false, reason: 'target_not_found' };
  const id = await findAvailable(slugify(pub.title), async (c) => (await dataStore.get(scenarioMetaKey(userId, targetWorldId, c))) !== null);
  const scenario = await saveScenario(dataStore, textStore, userId, {
    worldId: targetWorldId,
    id,
    title: pub.title,
    raw: pub.raw,
    recommendedRuleset: pub.recommendedRuleset ?? null,
  });
  return { ok: true, meta: scenario };
}
```

- [ ] **Step 4: GREEN確認** — `npx vitest run server/storage/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add server/storage/importLibrary.js server/storage/importLibrary.test.js server/storage/slugify.js
git commit -m "feat(share): 公開素材のコピーインポート(衝突サフィックス付き)"
```

---

### Task 5: 公開読み取りルーター(認証不要)

**Files:**
- Create: `server/routes/publicContent.js`
- Test: `server/routes/publicContent.test.js`

**Interfaces:**
- Consumes: Task 3の `listPublic`/`getPublicWorld`/`getPublicItem`、既存 `asyncHandler`/`idParamGuard`
- Produces: `createPublicContentRouter({ dataStore, textStore })` — `GET /public/:type`、`GET /public/:type/:publicId`(typeは worlds/characters/scenarios/novels 以外404)

- [ ] **Step 1: 失敗するテストを書く**(スタブ認証**なし**でマウント — 認証不要であることがこのルーターの本質)

```js
// buildApp: express() + createPublicContentRouter のみ(req.userIdを設定しない)
it('lists public items without auth, sorted desc', async () => {});
it('returns world detail with regions/categories', async () => {});
it('returns item detail for characters/scenarios/novels', async () => {});
it('404 for unknown type and unknown publicId', async () => {
  expect((await request(app).get('/api/public/rulesets')).status).toBe(404);
  expect((await request(app).get('/api/public/worlds/pub_nothere000')).status).toBe(404);
});
it('rejects malformed publicId via idParamGuard', async () => {
  expect((await request(app).get('/api/public/worlds/..evil')).status).toBe(400);
});
```

- [ ] **Step 2: RED確認** — Run: `npx vitest run server/routes/publicContent.test.js`
- [ ] **Step 3: 実装**

```js
// server/routes/publicContent.js
import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { listPublic, getPublicWorld, getPublicItem } from '../storage/shareLibrary.js';

const TYPES = new Set(['worlds', 'characters', 'scenarios', 'novels']);

export function createPublicContentRouter({ dataStore, textStore }) {
  const router = Router();
  router.param('publicId', idParamGuard);

  router.get('/public/:type', asyncHandler(async (req, res) => {
    if (!TYPES.has(req.params.type)) {
      res.status(404).json({ error: 'unknown type' });
      return;
    }
    res.json(await listPublic(dataStore, req.params.type));
  }));

  router.get('/public/:type/:publicId', asyncHandler(async (req, res) => {
    const { type, publicId } = req.params;
    if (!TYPES.has(type)) {
      res.status(404).json({ error: 'unknown type' });
      return;
    }
    const item = type === 'worlds'
      ? await getPublicWorld(dataStore, textStore, publicId)
      : await getPublicItem(dataStore, textStore, type, publicId);
    if (!item) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(item);
  }));

  return router;
}
```

- [ ] **Step 4: GREEN確認** → PASS
- [ ] **Step 5: Commit**

```bash
git add server/routes/publicContent.js server/routes/publicContent.test.js
git commit -m "feat(routes): 認証不要の公開ギャラリー読み取りAPI"
```

---

### Task 6: 公開/解除ルーター(+公開状態マップGET)

**Files:**
- Create: `server/routes/publish.js`
- Test: `server/routes/publish.test.js`

**Interfaces:**
- Consumes: Task 2/3のshareLibrary全関数、`server/auth/users.js` の `getUser`
- Produces: `createPublishRouter({ dataStore, textStore })`
  - `POST /publish/worlds/:worldId` ほか計4本 → `200 { publicId }`(404/409は設計どおり)
  - `DELETE` 同4パス → 204(冪等)
  - `GET /publish/worlds` → `{ [worldId]: publicId }` / `GET /publish/worlds/:worldId/characters/:kind` / `GET /publish/worlds/:worldId/scenarios` / `GET /publish/sessions`
  - `:kind` は pc/npc 以外400(既存characters.jsのkindガードと同じ方式 — 実装前にcharacters.jsを読んで合わせる)

- [ ] **Step 1: 失敗するテストを書く**(スタブ認証`req.userId='usr_test'`をルーターより前に。要点)

```js
it('publishes a world and returns its publicId; GET map reflects it', async () => {});
it('404 when publishing a missing item', async () => {});
it('409 when publishing a novel before novelize', async () => {});
it('DELETE unpublishes and is idempotent (204 twice)', async () => {});
it('rejects invalid kind with 400', async () => {});
it('owner displayName is snapshotted into the public meta', async () => {
  // usersにfindOrCreateUserで実ユーザーを作りstub userIdを合わせる → 公開後 public meta の ownerName を検証
});
```

- [ ] **Step 2: RED確認**
- [ ] **Step 3: 実装**

```js
// server/routes/publish.js
import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { getUser } from '../auth/users.js';
import {
  publishWorld, publishCharacter, publishScenario, publishNovel,
  unpublishWorld, unpublishCharacter, unpublishScenario, unpublishNovel,
  getPublishedWorlds, getPublishedCharacters, getPublishedScenarios, getPublishedNovels,
} from '../storage/shareLibrary.js';

export function createPublishRouter({ dataStore, textStore }) {
  const router = Router();
  for (const p of ['worldId', 'name', 'scenarioId', 'sessionId']) router.param(p, idParamGuard);
  router.param('kind', (req, res, next, value) => {
    if (value !== 'pc' && value !== 'npc') {
      res.status(400).json({ error: 'kind must be pc or npc' });
      return;
    }
    next();
  });

  async function ownerOf(req) {
    const user = await getUser(dataStore, req.userId);
    return { id: req.userId, displayName: user?.displayName ?? 'ユーザー' };
  }

  function send(res, result) {
    if (result.ok) {
      res.json({ publicId: result.meta.publicId });
      return;
    }
    if (result.reason === 'novel_not_generated') {
      res.status(409).json({ error: 'novelize first' });
      return;
    }
    res.status(404).json({ error: 'not found' });
  }

  router.post('/publish/worlds/:worldId', asyncHandler(async (req, res) => {
    send(res, await publishWorld(dataStore, textStore, req.userId, req.params.worldId, await ownerOf(req)));
  }));
  router.post('/publish/worlds/:worldId/characters/:kind/:name', asyncHandler(async (req, res) => {
    send(res, await publishCharacter(dataStore, textStore, req.userId, req.params.worldId, req.params.kind, req.params.name, await ownerOf(req)));
  }));
  router.post('/publish/worlds/:worldId/scenarios/:scenarioId', asyncHandler(async (req, res) => {
    send(res, await publishScenario(dataStore, textStore, req.userId, req.params.worldId, req.params.scenarioId, await ownerOf(req)));
  }));
  router.post('/publish/sessions/:sessionId/novel', asyncHandler(async (req, res) => {
    send(res, await publishNovel(dataStore, textStore, req.userId, req.params.sessionId, await ownerOf(req)));
  }));

  router.delete('/publish/worlds/:worldId', asyncHandler(async (req, res) => {
    await unpublishWorld(dataStore, textStore, req.userId, req.params.worldId);
    res.status(204).end();
  }));
  router.delete('/publish/worlds/:worldId/characters/:kind/:name', asyncHandler(async (req, res) => {
    await unpublishCharacter(dataStore, textStore, req.userId, req.params.worldId, req.params.kind, req.params.name);
    res.status(204).end();
  }));
  router.delete('/publish/worlds/:worldId/scenarios/:scenarioId', asyncHandler(async (req, res) => {
    await unpublishScenario(dataStore, textStore, req.userId, req.params.worldId, req.params.scenarioId);
    res.status(204).end();
  }));
  router.delete('/publish/sessions/:sessionId/novel', asyncHandler(async (req, res) => {
    await unpublishNovel(dataStore, textStore, req.userId, req.params.sessionId);
    res.status(204).end();
  }));

  router.get('/publish/worlds', asyncHandler(async (req, res) => {
    res.json(await getPublishedWorlds(dataStore, req.userId));
  }));
  router.get('/publish/worlds/:worldId/characters/:kind', asyncHandler(async (req, res) => {
    res.json(await getPublishedCharacters(dataStore, req.userId, req.params.worldId, req.params.kind));
  }));
  router.get('/publish/worlds/:worldId/scenarios', asyncHandler(async (req, res) => {
    res.json(await getPublishedScenarios(dataStore, req.userId, req.params.worldId));
  }));
  router.get('/publish/sessions', asyncHandler(async (req, res) => {
    res.json(await getPublishedNovels(dataStore, req.userId));
  }));

  return router;
}
```

- [ ] **Step 4: GREEN確認** → PASS
- [ ] **Step 5: Commit**

```bash
git add server/routes/publish.js server/routes/publish.test.js
git commit -m "feat(routes): 公開/公開解除と公開状態マップAPI"
```

---

### Task 7: インポートルーター

**Files:**
- Create: `server/routes/imports.js`
- Modify: `server/routes/validateId.js`(純関数 `isValidId(value): boolean` を切り出しエクスポート。`idParamGuard` はそれを使う形にリファクタ — 挙動不変)
- Test: `server/routes/imports.test.js`、`server/routes/validateId.test.js`(isValidIdの直接テスト追記)

**Interfaces:**
- Consumes: Task 4の `importWorld`/`importCharacter`/`importScenario`
- Produces: `createImportsRouter({ dataStore, textStore })`
  - `POST /import/worlds/:publicId` → `201 meta`
  - `POST /import/characters/:publicId` body `{ targetWorldId }` → `201 meta`
  - `POST /import/scenarios/:publicId` body `{ targetWorldId }` → `201 meta`
  - `targetWorldId` はbodyパラメータなので `isValidId` で手動検証(不正400)。publicId 404 / targetWorldId 404

- [ ] **Step 1: 失敗するテストを書く**(要点: 201で作成メタが返る/衝突サフィックス/targetWorldId未指定・不正400/404群/認証はスタブ)
- [ ] **Step 2: RED確認**
- [ ] **Step 3: 実装**

```js
// server/routes/imports.js
import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard, isValidId } from './validateId.js';
import { importWorld, importCharacter, importScenario } from '../storage/importLibrary.js';

export function createImportsRouter({ dataStore, textStore }) {
  const router = Router();
  router.param('publicId', idParamGuard);

  function sendImport(res, result) {
    if (result.ok) {
      res.status(201).json(result.meta);
      return;
    }
    res.status(404).json({ error: result.reason === 'target_not_found' ? 'target world not found' : 'not found' });
  }

  router.post('/import/worlds/:publicId', asyncHandler(async (req, res) => {
    sendImport(res, await importWorld(dataStore, textStore, req.userId, req.params.publicId));
  }));

  function targetWorldIdOf(req, res) {
    const target = req.body?.targetWorldId;
    if (typeof target !== 'string' || !isValidId(target)) {
      res.status(400).json({ error: 'targetWorldId is required' });
      return null;
    }
    return target;
  }

  router.post('/import/characters/:publicId', asyncHandler(async (req, res) => {
    const target = targetWorldIdOf(req, res);
    if (target === null) return;
    sendImport(res, await importCharacter(dataStore, textStore, req.userId, req.params.publicId, target));
  }));

  router.post('/import/scenarios/:publicId', asyncHandler(async (req, res) => {
    const target = targetWorldIdOf(req, res);
    if (target === null) return;
    sendImport(res, await importScenario(dataStore, textStore, req.userId, req.params.publicId, target));
  }));

  return router;
}
```

`validateId.js` のリファクタ: 既存の検証条件(空/128超/`..`/先頭ドット/許可文字集合)をそのまま `export function isValidId(value)` に移し、`idParamGuard` は `isValidId` を呼ぶだけにする。**既存テストが全て通ること**(挙動不変の確認)。

- [ ] **Step 4: GREEN確認** — `npx vitest run server/routes/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add server/routes/imports.js server/routes/imports.test.js server/routes/validateId.js server/routes/validateId.test.js
git commit -m "feat(routes): 公開素材のインポートAPI(isValidId切り出し)"
```

---

### Task 8: 配線 + 削除カスケード + 統合テスト

**Files:**
- Modify: `server/index.js`(3ルーター配線)
- Modify: `server/routes/worlds.js` / `characters.js` / `scenarios.js`(DELETEハンドラにカスケード解除)
- Test: `server/index.test.js`(統合)、`server/routes/worlds.test.js` ほか(カスケード)

**Interfaces:**
- Consumes: Task 2の `unpublishWorldCascade`/`unpublishCharacter`/`unpublishScenario`、Task 5-7のcreate関数、既存 `createTestUserSession`
- Produces: マウント順 — `createPublicContentRouter` は **authRouterの直後・requireAuthの前**。`createPublishRouter`/`createImportsRouter` は requireAuth の後(既存ルーター群と同列)

- [ ] **Step 1: 統合テストを書いて失敗を確認**(`server/index.test.js` 追記)

```js
it('serves the public gallery without auth', async () => {
  expect((await request(app).get('/api/public/worlds')).status).toBe(200);
});

it('requires auth for publish and import', async () => {
  expect((await request(app).post('/api/publish/worlds/w1')).status).toBe(401);
  expect((await request(app).post('/api/import/worlds/pub_x')).status).toBe(401);
});

it('end to end: A publishes, anonymous reads, B imports a copy', async () => {
  const a = await createTestUserSession(app.locals.dataStore);
  const b = await createTestUserSession(app.locals.dataStore);
  await request(app).put('/api/worlds/w1').set('Cookie', a.cookie).send({ title: 'Aの世界', raw: '# 本文' });
  const pub = await request(app).post('/api/publish/worlds/w1').set('Cookie', a.cookie);
  const { publicId } = pub.body;
  // 未認証で読める
  expect((await request(app).get(`/api/public/worlds/${publicId}`)).body.title).toBe('Aの世界');
  // Bがインポート → Bのライブラリに入る
  const imported = await request(app).post(`/api/import/worlds/${publicId}`).set('Cookie', b.cookie);
  expect(imported.status).toBe(201);
  const bWorld = await request(app).get(`/api/worlds/${imported.body.id}`).set('Cookie', b.cookie);
  expect(bWorld.body.raw).toBe('# 本文');
  // Aのデータは不変・Bのインポート後にAが解除してもBのコピーは残る
  await request(app).delete('/api/publish/worlds/w1').set('Cookie', a.cookie);
  expect((await request(app).get(`/api/public/worlds/${publicId}`)).status).toBe(404);
  expect((await request(app).get(`/api/worlds/${imported.body.id}`).set('Cookie', b.cookie)).status).toBe(200);
});

it('deleting a private item unpublishes it (cascade)', async () => {
  // world公開→DELETE /api/worlds/w1 → GET /api/public/worlds/:publicId が404
});
```

ルーターテスト側: `worlds.test.js` に「公開中world削除で公開も消える」、`characters.test.js`/`scenarios.test.js` に同種のケースを追記(ルーターの buildApp は公開系ルーターもマウントするか、shareLibrary関数で直接検証)。

- [ ] **Step 2: RED確認** — Run: `npx vitest run server/index.test.js`
- [ ] **Step 3: 実装**

`server/index.js` — importを追加し、コメントの直後の配線ブロックを次の順に:

```js
app.use(createOriginCheck({ baseUrl }));
app.use(createAuthRouter({ dataStore, providers, baseUrl, fetchImpl, secureCookies }));
app.use('/api', createPublicContentRouter({ dataStore, textStore })); // 公開ギャラリーは認証不要
app.use('/api', createRequireAuth({ dataStore, cookieOptions }));
// …既存ルーター群…
app.use('/api', createPublishRouter({ dataStore, textStore }));
app.use('/api', createImportsRouter({ dataStore, textStore }));
```

削除カスケード(各DELETEハンドラの先頭に1行追加):

```js
// worlds.js
router.delete('/worlds/:id', asyncHandler(async (req, res) => {
  await unpublishWorldCascade(dataStore, textStore, req.userId, req.params.id);
  await deleteWorld(dataStore, textStore, req.userId, req.params.id);
  res.status(204).end();
}));
// characters.js の DELETE → unpublishCharacter(dataStore, textStore, req.userId, worldId, kind, name) を先に
// scenarios.js の DELETE → unpublishScenario(...) を先に
```

(characters.js/scenarios.jsの実DELETEハンドラを読んで同じ形で挿入。importの追加を忘れない)

- [ ] **Step 4: GREEN確認** — `npx vitest run server/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add server/index.js server/index.test.js server/routes/worlds.js server/routes/characters.js server/routes/scenarios.js server/routes/worlds.test.js server/routes/characters.test.js server/routes/scenarios.test.js
git commit -m "feat(server): 共有APIの配線と削除時の公開解除カスケード"
```

---

### Task 9: クライアント shareClient

**Files:**
- Create: `src/api/shareClient.js`
- Test: `src/api/shareClient.test.js`

**Interfaces:**
- Consumes: 既存 `apiFetch`(`src/api/apiFetch.js`)
- Produces:

```js
listPublic(type)                          // GET /api/public/{type}
getPublic(type, publicId)                 // GET /api/public/{type}/{publicId}
publishWorld(worldId)                     // POST /api/publish/worlds/{worldId} → { publicId }
unpublishWorld(worldId)                   // DELETE 同上(apiFetchは204でjson()に失敗するため、下記rawFetch方式)
publishCharacter(worldId, kind, name)     unpublishCharacter(worldId, kind, name)
publishScenario(worldId, scenarioId)      unpublishScenario(worldId, scenarioId)
publishNovel(sessionId)                   unpublishNovel(sessionId)
publishedWorlds()                         // GET /api/publish/worlds → { [worldId]: publicId }
publishedCharacters(worldId, kind)        publishedScenarios(worldId)        publishedNovels()
importWorld(publicId)                     // POST /api/import/worlds/{publicId} → meta
importCharacter(publicId, targetWorldId)  importScenario(publicId, targetWorldId)
```

**204対応の注意**: 既存 `apiFetch` は常に `res.json()` するため204で失敗する。既存の削除系クライアント(`src/api/worldLibraryClient.js` の `deleteWorld` 等)が204をどう扱っているかを**先に読み**、同じ方式に合わせる(既存に前例があるならそれを使う。なければ `apiFetch` に「204は`null`を返す」分岐を追加し、`apiFetch.test.js` にそのケースを足す)。

- [ ] **Step 1: 失敗するテストを書く**(fetchをvi.stubGlobalし、URL/メソッド/ボディを検証 — `authClient.test.js` と同スタイルで全関数分)
- [ ] **Step 2: RED確認** — `npx vitest run src/api/shareClient.test.js`
- [ ] **Step 3: 実装**(パスは上記Interfaces欄のとおり。`encodeURIComponent` をパスセグメントに適用 — 既存クライアントの慣習に合わせる)
- [ ] **Step 4: GREEN確認** — `npx vitest run src/api/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add src/api/shareClient.js src/api/shareClient.test.js
# apiFetchを変更した場合はそれも
git commit -m "feat(client): 共有API(公開/解除/ギャラリー/インポート)クライアント"
```

---

### Task 10: 公開ギャラリー画面(Gallery.jsx)+ App/Home 導線

**Files:**
- Create: `src/screens/Gallery.jsx`
- Modify: `src/App.jsx`(view 'gallery' 追加)、`src/screens/Home.jsx`(「公開ギャラリー」ボタン)
- Test: `src/screens/Gallery.test.jsx`、`src/App.test.jsx`/`src/screens/Home.test.jsx` 追記

**実装前に読む**: `src/screens/Library.jsx`(タブUIの既存パターン)、`src/screens/library/WorldTab.jsx`(一覧+詳細の切替パターン)、`src/components/library/ConfirmModal.jsx`、`src/api/worldLibraryClient.js`(`listWorlds`)、`src/theme.js`、`src/test/renderWithAuth.jsx`

**挙動仕様**:
- `Gallery({ onClose })` — Libraryと同じ画面骨格。タブ: 小説/世界観/キャラクター/シナリオ(既定は小説)。タブ切替で `listPublic(type)` を取得
- 一覧カード: タイトル/作者名(`ownerName`)/公開日(`new Date(publishedAt).toLocaleDateString('ja-JP')`)。キャラはkindバッジ、シナリオは推奨ルール表示
- カードクリック → 詳細(同画面内state切替): メタ + 本文`<pre>`相当の読み物表示。worldsはregions/categoriesも見出し付きで表示。「← 一覧に戻る」
- 詳細に「ライブラリに追加」ボタン(小説タブでは出さない):
  - 未ログイン(`useAuth().user`がnull): ボタンの代わりに「追加にはログインが必要です(右上からログイン)」
  - worlds: 押すと `importWorld(publicId)` → 成功で「ライブラリに追加しました」表示
  - characters/scenarios: 押すと行き先選択モーダル(`listWorlds()` で自分の世界一覧を取得しリスト表示、選択→`importCharacter`/`importScenario`)。世界が0件なら「先に世界観を作成してください」
  - 失敗は `err.message` を表示
- ローディング/空状態(「まだ公開されたものがありません」)/取得失敗表示
- `App.jsx`: `view === 'gallery' && <Gallery onClose={() => setView('home')} />`。`Home` に `onOpenGallery` propを追加し「公開ギャラリー」ボタン(素材ライブラリの隣、**未ログインでも押せる**)

**テスト(要点 — renderWithAuth利用、fetchはstub)**:
- タブ切替で対応typeのAPIが呼ばれ一覧が出る/空状態表示
- 詳細表示に本文とregions見出しが出る
- 未ログインで追加ボタンがログイン案内になる
- worldsの追加成功メッセージ/charactersの行き先モーダル→選択でimportCharacterが正しい引数で呼ばれる
- Homeに公開ギャラリーボタンが出て`onOpenGallery`が呼ばれる(未ログインでもdisabledでない)

- [ ] **Step 1: テストを書いてRED確認**
- [ ] **Step 2: 実装してGREEN確認** — `npx vitest run src/screens/Gallery.test.jsx src/App.test.jsx src/screens/Home.test.jsx`
- [ ] **Step 3: フルスイート** — `npx vitest run` → 全PASS
- [ ] **Step 4: Commit**

```bash
git add src/screens/Gallery.jsx src/screens/Gallery.test.jsx src/App.jsx src/App.test.jsx src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "feat(ui): 公開ギャラリー画面(一覧/詳細/インポート)"
```

---

### Task 11: 素材ライブラリの公開ボタン(World/Character/Scenarioタブ)

**Files:**
- Modify: `src/screens/library/WorldTab.jsx` / `CharacterTab.jsx` / `ScenarioTab.jsx`
- Test: 各`.test.jsx` 追記

**実装前に読む**: 3タブの実ファイル(一覧アイテムの描画箇所・既存ボタン群・stateパターン)と各テスト

**挙動仕様**(3タブ共通):
- タブ表示時(CharacterTab/ScenarioTabは対象world変更時)に `publishedWorlds()` / `publishedCharacters(worldId, kind)` / `publishedScenarios(worldId)` を取得し `{ [id]: publicId }` をstateに保持。未ログイン時は取得しない(useAuthで判定)
- 各アイテム行: 公開中なら「公開中」バッジ(F_MONO 11px, COLORS.brassDark)+「再公開」「公開解除」ボタン。未公開なら「公開」ボタン
- 「公開」/「再公開」→ 対応する `publish*` を呼び成功でマップ更新。「公開解除」→ `unpublish*` 後マップから削除
- 失敗時は既存のエラー表示パターンに合わせメッセージ表示
- 未ログイン時は公開系ボタンを表示しない(ライブラリ自体がログインゲート済みだが、防御的に `user` 判定)

**テスト(要点)**: 公開中バッジ表示/公開ボタン押下で正しい引数のAPI呼び出し+バッジ反映/解除でバッジ消滅

- [ ] **Step 1: テスト追記 → RED確認**
- [ ] **Step 2: 実装 → GREEN確認** — `npx vitest run src/screens/library/`
- [ ] **Step 3: Commit**

```bash
git add src/screens/library/
git commit -m "feat(ui): ライブラリ各タブに公開/再公開/公開解除"
```

---

### Task 12: ホームの小説公開ボタン

**Files:**
- Modify: `src/screens/Home.jsx`
- Test: `src/screens/Home.test.jsx` 追記

**実装前に読む**: `src/screens/Home.jsx` の現セッションカード(小説化ボタン周辺)と既存テスト

**挙動仕様**:
- ログイン時、マウント時に `publishedNovels()` → `{ [sessionId]: publicId }` をstate保持
- 各セッションカードに「小説を公開」(未公開時)/「公開中」バッジ+「公開解除」(公開済み時)を小説化ボタンの隣に追加。未ログイン時は非表示
- 「小説を公開」→ `publishNovel(session.id)`。409(apiFetchのerr.status===409)なら「先に小説化してください」をそのカードのエラー領域に表示
- 「公開解除」→ `unpublishNovel(session.id)` → バッジ解除

**テスト(要点)**: 公開成功でバッジが出る/409で案内メッセージ/解除でバッジが消える/未ログインで非表示

- [ ] **Step 1: テスト追記 → RED確認**
- [ ] **Step 2: 実装 → GREEN確認** — `npx vitest run src/screens/Home.test.jsx`
- [ ] **Step 3: Commit**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "feat(ui): セッションカードから小説の公開/公開解除"
```

---

### Task 13: ドキュメント更新と受け入れ確認

**Files:**
- Modify: `docs/04-persistence.md`(公開ツリー/publish mappingのキー構造、APIサーフェスに `/api/public/*`・`/api/publish/*`・`/api/import/*` を追記。認証要否を明記)
- Modify: `docs/01-architecture.md`(プロキシサーバーの責務に「公開スナップショットストアと公開ギャラリーAPI」を追記)
- Modify: `docs/05-ui-ux.md`(存在すれば画面一覧にギャラリーを追記 — 実ファイルを読んで構成に合わせる。該当節がなければ変更不要)

- [ ] **Step 1: 実コード(paths.js/index.js/各ルーター)と突き合わせて docs を更新**(記述は実装に対して正確であること)
- [ ] **Step 2: 受け入れ** — Run: `npx vitest run` / Expected: 全PASS(1つでも落ちたら直してから完了)
- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: 共有機能(公開ツリー/ギャラリー/インポートAPI)を反映"
```

---

## 完了条件

- `npx vitest run` 全パス
- 手動確認(開発環境・2アカウント): Aで世界観を公開 → ログアウトしてもギャラリーで閲覧できる → Bでログインしインポート → Bのライブラリに入る → Aが公開解除してもBのコピーが残る
