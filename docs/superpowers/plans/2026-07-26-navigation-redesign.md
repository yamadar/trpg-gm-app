# ナビゲーション再設計 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `view` state と hash route の二重管理を廃し、全画面を hash route に統一したうえで、4タブのグローバルナビと URL 由来のパンくずを備えたアプリシェルを導入する。

**Architecture:** `src/navigation/routes.js` を副作用のない純関数群（`parseRoute` / `buildHash` / 派生ヘルパ）とし、ルーティングの正しさをここへ集約する。`useRoute.js` がブラウザ API との唯一の接点となり、パースできない hash や省略形は「パースして正準形を組み直し、異なれば `replaceState`」という単一の仕組みで正規化する（旧 URL のリダイレクトもこれで賄う）。`AppShell.jsx` が route からモード（回遊／集中）を判定し、ヘッダーを出し分ける。

**Tech Stack:** React 18 / Vite 5 / Vitest 2 + @testing-library/react / `lucide-react`（本計画で新規追加）

**設計書:** `docs/superpowers/specs/2026-07-26-navigation-redesign-design.md`

## Global Constraints

- React Router は導入しない。ルーティングは hash ベースの自前実装のままとする。
- 新規依存は `lucide-react` のみ。Game-icons.net は本計画の範囲外。
- 既存の公開 URL `#/u/:userId` は変更しない。
- 旧 URL `#/endings` `#/achievements` は `#/records/endings` `#/records/achievements` へリダイレクトする。
- ナビ項目は未ログイン時も消さない。押した先で「ログインが必要です」を案内する。
- タップ領域は 44×44px 以上。アクティブ状態を色だけで区別しない。タブは `<div onClick>` ではなく `<button>` を使う。
- 日本語コメント・日本語 UI 文言。既存コードのスタイル（インラインスタイル、`COLORS` / `F_MONO` / `F_BODY` / `F_DISPLAY`）に合わせる。
- 各タスクの終了時点で、そのタスクが対象とするテストファイルが通ること。`npm test` 全体の緑は Task 1〜9 と Task 17 で必須。Task 10〜16 は移行の中間状態として全体が赤くなることを許容する（`App.jsx` が新 props を渡す一方、各画面がまだ旧 props のため）。Task 16 の終了時点で全体が緑に戻る。
- 作業は `main` から作成したワークツリーで行う（`superpowers:using-git-worktrees` を実行時に使用）。

## File Structure

**新規作成**

| ファイル | 責務 |
|---|---|
| `src/constants/libraryTabs.js` | 素材ライブラリのタブ定義（`routes.js` と `Library.jsx` が共有する） |
| `src/navigation/routes.js` | ルート定義・`parseRoute`・`buildHash`・`navTabFor`・`isFocusRoute`・`crumbsFor`・`wantsDynamicCrumb`。副作用なし |
| `src/navigation/useRoute.js` | `hashchange` 購読、`navigate` / `navigateHash` / `replace`、正準形への正規化。ブラウザ API との唯一の接点 |
| `src/navigation/BreadcrumbContext.jsx` | パンくず末尾の動的ラベルの登録口 |
| `src/components/nav/GlobalNav.jsx` | 4タブ。PC=上部横並び／SP=下部固定。DOM は同一でスタイルのみ切替 |
| `src/components/nav/Breadcrumb.jsx` | crumbs 配列と動的ラベルの描画。SP では先頭側を視覚的に省略 |
| `src/components/nav/FocusHeader.jsx` | 集中モード用ヘッダー（離脱ボタン＋タイトル＋ステップ表示） |
| `src/components/nav/AccountMenu.jsx` | 現 `AuthBar.jsx` の移設先（`position: fixed` を廃止） |
| `src/components/nav/AppShell.jsx` | 骨格。モード判定してヘッダーを出し分ける。画面の中身は知らない |

**変更**

| ファイル | 変更内容 |
|---|---|
| `src/App.jsx` | `view` state を廃止し `useRoute()` へ。217 行の分岐塊を `AppShell` への委譲に縮める |
| `src/screens/Library.jsx` | タブ・`selectedWorldId` を URL 駆動に。`閉じる` を撤去 |
| `src/screens/Gallery.jsx` | タブ・詳細表示を URL 駆動に。`閉じる` と `← 一覧に戻る` を撤去 |
| `src/screens/EndingGallery.jsx` | `onClose` を撤去し、記録タブの内部タブを導入 |
| `src/screens/AchievementList.jsx` | 同上 |
| `src/screens/UserPage.jsx` | `← 戻る` を撤去。表示名をパンくずへ登録 |
| `src/screens/Play.jsx` | `onExit` を `FocusHeader` へ統合 |
| `src/screens/Setup.jsx` | `onCancel` を `FocusHeader` へ統合。ステップの `戻る` はフッターに残す |
| `src/components/auth/AuthBar.jsx` | 削除（`AccountMenu.jsx` へ移設） |
| `src/router/useHashRoute.js` | 削除（最終タスク） |

---

## Task 1: ルート定義とパーサ

`parseRoute` は「どんな hash を渡しても正準的な route オブジェクトか `null` を返す」純関数にする。`buildHash` と往復させることで、省略形・旧 URL・不正値の正規化がすべて同じ仕組みに乗る。

**Files:**
- Create: `src/constants/libraryTabs.js`
- Create: `src/navigation/routes.js`
- Test: `src/navigation/routes.test.js`

**Interfaces:**
- Consumes: `src/constants/publicContent.js` の `GALLERY_TABS`（`[{ key, label }]`、`key` は `starters`/`novels`/`worlds`/`characters`/`scenarios`）
- Produces:
  - `LIBRARY_TABS: Array<{key: string, label: string}>`
  - `NAV_TABS: Array<{key: 'home'|'library'|'browse'|'records', label: string, hash: string}>`
  - `parseRoute(hash: string): Route | null`
  - `buildHash(route: Route | null): string`
  - `Route` は次のいずれか:
    - `{ name: 'home' }`
    - `{ name: 'library', libraryTab: string, worldId: string | null }`
    - `{ name: 'browse', browseTab: string, publicId: string | null }`
    - `{ name: 'records', recordsTab: 'endings' | 'achievements' }`
    - `{ name: 'user', userId: string }`
    - `{ name: 'setup' }`
    - `{ name: 'play', sessionId: string }`

- [ ] **Step 1: タブ定義を切り出す**

`Library.jsx:12-18` の `TABS` と同じ内容を、`routes.js` からも参照できる場所へ移す。

`src/constants/libraryTabs.js`:

```js
// 素材ライブラリのタブ定義。URL の :tab セグメント(src/navigation/routes.js)と
// 画面のタブ列(src/screens/Library.jsx)が同じ定義を共有するためにここへ置く。
export const LIBRARY_TABS = [
  { key: 'world', label: 'World' },
  { key: 'character', label: 'Character' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'ruleset', label: 'Ruleset' },
];

// World に紐づくタブ。URL の3セグメント目に worldId を取る。
// world タブ自身も選択中の World を詳細/編集表示するため(src/screens/library/WorldTab.jsx)含める。
// ruleset だけが World に依存しない。
export const WORLD_SCOPED_LIBRARY_TABS = ['world', 'character', 'scenario', 'campaign'];
```

- [ ] **Step 2: 失敗するテストを書く**

`src/navigation/routes.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseRoute, buildHash, NAV_TABS, LIBRARY_TABS } from './routes.js';

describe('parseRoute', () => {
  it('parses the home route', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
  });

  it('parses library routes and defaults the tab', () => {
    expect(parseRoute('#/library')).toEqual({ name: 'library', libraryTab: 'world', worldId: null });
    expect(parseRoute('#/library/character')).toEqual({
      name: 'library',
      libraryTab: 'character',
      worldId: null,
    });
    expect(parseRoute('#/library/character/w1')).toEqual({
      name: 'library',
      libraryTab: 'character',
      worldId: 'w1',
    });
  });

  it('falls back to the default library tab for unknown tabs', () => {
    expect(parseRoute('#/library/nope')).toEqual({ name: 'library', libraryTab: 'world', worldId: null });
  });

  it('keeps a worldId on the world tab, which opens that world for editing', () => {
    expect(parseRoute('#/library/world/w1')).toEqual({ name: 'library', libraryTab: 'world', worldId: 'w1' });
  });

  it('ignores a worldId on the ruleset tab, which is not world-scoped', () => {
    expect(parseRoute('#/library/ruleset/w1')).toEqual({ name: 'library', libraryTab: 'ruleset', worldId: null });
  });

  it('parses browse routes', () => {
    expect(parseRoute('#/browse')).toEqual({ name: 'browse', browseTab: 'starters', publicId: null });
    expect(parseRoute('#/browse/worlds')).toEqual({ name: 'browse', browseTab: 'worlds', publicId: null });
    expect(parseRoute('#/browse/worlds/pub_1')).toEqual({
      name: 'browse',
      browseTab: 'worlds',
      publicId: 'pub_1',
    });
  });

  it('drops a publicId on the starters tab, which has no detail view', () => {
    expect(parseRoute('#/browse/starters/pub_1')).toEqual({
      name: 'browse',
      browseTab: 'starters',
      publicId: null,
    });
  });

  it('parses records routes', () => {
    expect(parseRoute('#/records')).toEqual({ name: 'records', recordsTab: 'endings' });
    expect(parseRoute('#/records/achievements')).toEqual({ name: 'records', recordsTab: 'achievements' });
  });

  it('maps the legacy endings and achievements hashes onto records', () => {
    expect(parseRoute('#/endings')).toEqual({ name: 'records', recordsTab: 'endings' });
    expect(parseRoute('#/achievements')).toEqual({ name: 'records', recordsTab: 'achievements' });
  });

  it('parses the user route and keeps rejecting malformed ones', () => {
    expect(parseRoute('#/u/usr_ab12')).toEqual({ name: 'user', userId: 'usr_ab12' });
    expect(parseRoute('#/u/')).toBeNull();
    expect(parseRoute('#/u/../evil')).toBeNull();
    expect(parseRoute('#/u/..')).toBeNull();
  });

  it('parses setup and play routes', () => {
    expect(parseRoute('#/setup')).toEqual({ name: 'setup' });
    expect(parseRoute('#/play/ses_1')).toEqual({ name: 'play', sessionId: 'ses_1' });
    expect(parseRoute('#/play')).toBeNull();
  });

  it('returns null for unknown hashes and for extra segments', () => {
    expect(parseRoute('#/foo')).toBeNull();
    expect(parseRoute('#/setup/extra')).toBeNull();
    expect(parseRoute('#/library/character/w1/extra')).toBeNull();
  });
});

describe('buildHash', () => {
  it('builds the canonical hash for every route', () => {
    expect(buildHash({ name: 'home' })).toBe('#/');
    expect(buildHash({ name: 'library', libraryTab: 'world', worldId: null })).toBe('#/library/world');
    expect(buildHash({ name: 'library', libraryTab: 'character', worldId: 'w1' })).toBe(
      '#/library/character/w1'
    );
    expect(buildHash({ name: 'browse', browseTab: 'starters', publicId: null })).toBe('#/browse/starters');
    expect(buildHash({ name: 'browse', browseTab: 'worlds', publicId: 'pub_1' })).toBe(
      '#/browse/worlds/pub_1'
    );
    expect(buildHash({ name: 'records', recordsTab: 'achievements' })).toBe('#/records/achievements');
    expect(buildHash({ name: 'user', userId: 'usr_1' })).toBe('#/u/usr_1');
    expect(buildHash({ name: 'setup' })).toBe('#/setup');
    expect(buildHash({ name: 'play', sessionId: 'ses_1' })).toBe('#/play/ses_1');
    expect(buildHash(null)).toBe('#/');
  });

  it('round-trips every canonical hash', () => {
    const hashes = [
      '#/',
      '#/library/world',
      '#/library/character/w1',
      '#/browse/starters',
      '#/browse/worlds/pub_1',
      '#/records/endings',
      '#/records/achievements',
      '#/u/usr_1',
      '#/setup',
      '#/play/ses_1',
    ];
    for (const h of hashes) expect(buildHash(parseRoute(h))).toBe(h);
  });

  it('rewrites abbreviated and legacy hashes to their canonical form', () => {
    expect(buildHash(parseRoute('#/library'))).toBe('#/library/world');
    expect(buildHash(parseRoute('#/browse'))).toBe('#/browse/starters');
    expect(buildHash(parseRoute('#/endings'))).toBe('#/records/endings');
    expect(buildHash(parseRoute('#/achievements'))).toBe('#/records/achievements');
  });
});

describe('NAV_TABS', () => {
  it('exposes exactly the four primary destinations with canonical hashes', () => {
    expect(NAV_TABS.map((t) => t.key)).toEqual(['home', 'library', 'browse', 'records']);
    expect(NAV_TABS.map((t) => t.label)).toEqual(['ホーム', '素材', 'さがす', '記録']);
    for (const t of NAV_TABS) expect(buildHash(parseRoute(t.hash))).toBe(t.hash);
  });

  it('re-exports the library tabs', () => {
    expect(LIBRARY_TABS.map((t) => t.key)).toEqual([
      'world',
      'character',
      'scenario',
      'campaign',
      'ruleset',
    ]);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npx vitest run src/navigation/routes.test.js`
Expected: FAIL — `Failed to resolve import "./routes.js"`

- [ ] **Step 4: 実装する**

`src/navigation/routes.js`:

```js
import { LIBRARY_TABS, WORLD_SCOPED_LIBRARY_TABS } from '../constants/libraryTabs.js';
import { GALLERY_TABS } from '../constants/publicContent.js';

export { LIBRARY_TABS };

const LIBRARY_TAB_KEYS = LIBRARY_TABS.map((t) => t.key);
const BROWSE_TAB_KEYS = GALLERY_TABS.map((t) => t.key);
const RECORDS_TAB_KEYS = ['endings', 'achievements'];

const ID_RE = /^[A-Za-z0-9._-]+$/;

// '.' と '..' は ID_RE を通ってしまうがパストラバーサルに見えるため明示的に弾く。
function isId(s) {
  return typeof s === 'string' && s !== '.' && s !== '..' && ID_RE.test(s);
}

// グローバルナビの4項目。hash は各行き先の正準形を指す。
export const NAV_TABS = [
  { key: 'home', label: 'ホーム', hash: '#/' },
  { key: 'library', label: '素材', hash: '#/library/world' },
  { key: 'browse', label: 'さがす', hash: '#/browse/starters' },
  { key: 'records', label: '記録', hash: '#/records/endings' },
];

// hash を route オブジェクトへ変換する。解釈できないものは null を返し、
// 呼び出し側(useRoute)がホームへフォールバックする。
// 省略形(#/library)や旧URL(#/endings)もここで正準形の route に寄せるため、
// buildHash と往復させるだけで正規化とリダイレクトが同時に成立する。
export function parseRoute(hash) {
  const segments = String(hash || '')
    .replace(/^#/, '')
    .split('/')
    .filter(Boolean);
  if (segments.length === 0) return { name: 'home' };

  const [head, a, b] = segments;
  switch (head) {
    case 'library': {
      if (segments.length > 3) return null;
      const libraryTab = LIBRARY_TAB_KEYS.includes(a) ? a : 'world';
      const worldScoped = WORLD_SCOPED_LIBRARY_TABS.includes(libraryTab);
      return { name: 'library', libraryTab, worldId: worldScoped && isId(b) ? b : null };
    }
    case 'browse': {
      if (segments.length > 3) return null;
      const browseTab = BROWSE_TAB_KEYS.includes(a) ? a : 'starters';
      // starters はパック一括取り込みの単位で /api/public/:type の対象外のため詳細を持たない。
      const hasDetail = browseTab !== 'starters';
      return { name: 'browse', browseTab, publicId: hasDetail && isId(b) ? b : null };
    }
    case 'records': {
      if (segments.length > 2) return null;
      return { name: 'records', recordsTab: RECORDS_TAB_KEYS.includes(a) ? a : 'endings' };
    }
    // 旧URL。ブックマーク済みの可能性があるため records 配下へ読み替える。
    case 'endings':
      return segments.length === 1 ? { name: 'records', recordsTab: 'endings' } : null;
    case 'achievements':
      return segments.length === 1 ? { name: 'records', recordsTab: 'achievements' } : null;
    case 'u':
      return segments.length === 2 && isId(a) ? { name: 'user', userId: a } : null;
    case 'setup':
      return segments.length === 1 ? { name: 'setup' } : null;
    case 'play':
      return segments.length === 2 && isId(a) ? { name: 'play', sessionId: a } : null;
    default:
      return null;
  }
}

export function buildHash(route) {
  if (!route) return '#/';
  switch (route.name) {
    case 'library':
      return route.worldId
        ? `#/library/${route.libraryTab}/${route.worldId}`
        : `#/library/${route.libraryTab}`;
    case 'browse':
      return route.publicId
        ? `#/browse/${route.browseTab}/${route.publicId}`
        : `#/browse/${route.browseTab}`;
    case 'records':
      return `#/records/${route.recordsTab}`;
    case 'user':
      return `#/u/${route.userId}`;
    case 'setup':
      return '#/setup';
    case 'play':
      return `#/play/${route.sessionId}`;
    case 'home':
    default:
      return '#/';
  }
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/navigation/routes.test.js`
Expected: PASS（10 tests in `parseRoute`、3 in `buildHash`、2 in `NAV_TABS`）

- [ ] **Step 6: コミット**

```bash
git add src/constants/libraryTabs.js src/navigation/routes.js src/navigation/routes.test.js
git commit -m "feat(nav): hash を route へ変換する純関数パーサを追加する"
```

---

## Task 2: route の派生ヘルパ

パンくずの段とナビのアクティブ判定を、route から機械的に導く。動的ラベル（World 名や公開アイテム名）はここでは扱わず、必要かどうかの判定だけを返す。

**Files:**
- Modify: `src/navigation/routes.js`
- Modify: `src/navigation/routes.test.js`

**Interfaces:**
- Consumes: Task 1 の `Route`、`LIBRARY_TABS`、`GALLERY_TABS`
- Produces:
  - `navTabFor(route: Route | null): 'home'|'library'|'browse'|'records'|null`
  - `isFocusRoute(route: Route | null): boolean`
  - `crumbsFor(route: Route | null): Array<{key: string, label: string, hash: string}>`
  - `wantsDynamicCrumb(route: Route | null): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`src/navigation/routes.test.js` の末尾に追記する:

```js
import { navTabFor, isFocusRoute, crumbsFor, wantsDynamicCrumb } from './routes.js';

describe('navTabFor', () => {
  it('maps browsing routes onto their nav tab', () => {
    expect(navTabFor(parseRoute('#/'))).toBe('home');
    expect(navTabFor(parseRoute('#/library/character'))).toBe('library');
    expect(navTabFor(parseRoute('#/browse/worlds'))).toBe('browse');
    expect(navTabFor(parseRoute('#/records/achievements'))).toBe('records');
  });

  it('returns null where no tab should be highlighted', () => {
    expect(navTabFor(parseRoute('#/setup'))).toBeNull();
    expect(navTabFor(parseRoute('#/play/ses_1'))).toBeNull();
    expect(navTabFor(parseRoute('#/u/usr_1'))).toBeNull();
    expect(navTabFor(null)).toBeNull();
  });
});

describe('isFocusRoute', () => {
  it('treats setup and play as focus mode', () => {
    expect(isFocusRoute(parseRoute('#/setup'))).toBe(true);
    expect(isFocusRoute(parseRoute('#/play/ses_1'))).toBe(true);
  });

  it('treats every other route as browsing mode', () => {
    expect(isFocusRoute(parseRoute('#/'))).toBe(false);
    expect(isFocusRoute(parseRoute('#/library/world'))).toBe(false);
    expect(isFocusRoute(parseRoute('#/u/usr_1'))).toBe(false);
    expect(isFocusRoute(null)).toBe(false);
  });
});

describe('crumbsFor', () => {
  it('returns a single home crumb on the home route', () => {
    expect(crumbsFor(parseRoute('#/'))).toEqual([{ key: 'home', label: 'ホーム', hash: '#/' }]);
  });

  it('builds library crumbs from the tab labels', () => {
    expect(crumbsFor(parseRoute('#/library/character/w1'))).toEqual([
      { key: 'home', label: 'ホーム', hash: '#/' },
      { key: 'library', label: '素材', hash: '#/library/world' },
      { key: 'libraryTab', label: 'Character', hash: '#/library/character' },
    ]);
  });

  it('builds browse crumbs from the gallery tab labels', () => {
    expect(crumbsFor(parseRoute('#/browse/worlds/pub_1'))).toEqual([
      { key: 'home', label: 'ホーム', hash: '#/' },
      { key: 'browse', label: 'さがす', hash: '#/browse/starters' },
      { key: 'browseTab', label: '世界観', hash: '#/browse/worlds' },
    ]);
  });

  it('builds records crumbs', () => {
    expect(crumbsFor(parseRoute('#/records/achievements'))).toEqual([
      { key: 'home', label: 'ホーム', hash: '#/' },
      { key: 'records', label: '記録', hash: '#/records/endings' },
      { key: 'recordsTab', label: '実績', hash: '#/records/achievements' },
    ]);
  });

  it('returns only the home crumb for the user route, whose name is supplied dynamically', () => {
    expect(crumbsFor(parseRoute('#/u/usr_1'))).toEqual([{ key: 'home', label: 'ホーム', hash: '#/' }]);
  });
});

describe('wantsDynamicCrumb', () => {
  it('is true exactly where a name must come from the screen', () => {
    expect(wantsDynamicCrumb(parseRoute('#/library/character/w1'))).toBe(true);
    expect(wantsDynamicCrumb(parseRoute('#/browse/worlds/pub_1'))).toBe(true);
    expect(wantsDynamicCrumb(parseRoute('#/u/usr_1'))).toBe(true);
  });

  it('is false where the URL already names the location', () => {
    expect(wantsDynamicCrumb(parseRoute('#/library/character'))).toBe(false);
    expect(wantsDynamicCrumb(parseRoute('#/browse/worlds'))).toBe(false);
    expect(wantsDynamicCrumb(parseRoute('#/records/endings'))).toBe(false);
    expect(wantsDynamicCrumb(null)).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/navigation/routes.test.js`
Expected: FAIL — `navTabFor is not a function`

- [ ] **Step 3: 実装する**

`src/navigation/routes.js` の末尾に追記する:

```js
const NAV_TAB_KEYS = NAV_TABS.map((t) => t.key);
const LIBRARY_LABELS = Object.fromEntries(LIBRARY_TABS.map((t) => [t.key, t.label]));
const BROWSE_LABELS = Object.fromEntries(GALLERY_TABS.map((t) => [t.key, t.label]));
const RECORDS_LABELS = { endings: 'エンディング図鑑', achievements: '実績' };

// パンくずの上位段はグローバルナビの項目そのもの。ラベルと遷移先が
// ナビバーと食い違わないよう NAV_TABS から引く。
const navCrumb = (key) => NAV_TABS.find((t) => t.key === key);

const HOME_CRUMB = navCrumb('home');

// グローバルナビでハイライトすべきタブ。該当しない画面(集中モード・ユーザーページ)は null。
export function navTabFor(route) {
  if (!route) return null;
  return NAV_TAB_KEYS.includes(route.name) ? route.name : null;
}

// 集中モード = 1つのタスクを完遂する画面。グローバルナビを出さない。
export function isFocusRoute(route) {
  return !!route && (route.name === 'setup' || route.name === 'play');
}

// URL だけから決まるパンくずの段。末尾の動的ラベル(World名・公開アイテム名・表示名)は
// 画面側が BreadcrumbContext へ登録するため、ここには含めない。
export function crumbsFor(route) {
  if (!route) return [HOME_CRUMB];
  switch (route.name) {
    case 'library':
      return [
        HOME_CRUMB,
        navCrumb('library'),
        {
          key: 'libraryTab',
          label: LIBRARY_LABELS[route.libraryTab],
          hash: `#/library/${route.libraryTab}`,
        },
      ];
    case 'browse':
      return [
        HOME_CRUMB,
        navCrumb('browse'),
        {
          key: 'browseTab',
          label: BROWSE_LABELS[route.browseTab],
          hash: `#/browse/${route.browseTab}`,
        },
      ];
    case 'records':
      return [
        HOME_CRUMB,
        navCrumb('records'),
        {
          key: 'recordsTab',
          label: RECORDS_LABELS[route.recordsTab],
          hash: `#/records/${route.recordsTab}`,
        },
      ];
    case 'home':
    case 'user':
    default:
      return [HOME_CRUMB];
  }
}

// 末尾に動的ラベルの段を持つ route かどうか。false のときは登録待ちの空段を出さない。
export function wantsDynamicCrumb(route) {
  if (!route) return false;
  if (route.name === 'library') return !!route.worldId;
  if (route.name === 'browse') return !!route.publicId;
  return route.name === 'user';
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/navigation/routes.test.js`
Expected: PASS（全 19 tests）

- [ ] **Step 5: コミット**

```bash
git add src/navigation/routes.js src/navigation/routes.test.js
git commit -m "feat(nav): route からナビ状態とパンくずを導く派生ヘルパを追加する"
```

---

## Task 3: hash 購読フックと遷移関数

ブラウザ API に触れるのはこのファイルだけにする。正規化は「パース結果を組み直して現在の hash と比べ、違えば `replaceState`」の1経路に統一する。

**Files:**
- Create: `src/navigation/useRoute.js`
- Test: `src/navigation/useRoute.test.jsx`

**Interfaces:**
- Consumes: Task 1 の `parseRoute` / `buildHash`
- Produces:
  - `useRoute(): Route` — 常に非 null。解釈できない hash はホームに正規化される
  - `navigate(route: Route): void` — 履歴を積む
  - `navigateHash(hash: string): void` — 履歴を積む（`NAV_TABS[].hash` や crumb の `hash` を直接渡す用）
  - `replace(route: Route): void` — 履歴を積まない

- [ ] **Step 1: 失敗するテストを書く**

`src/navigation/useRoute.test.jsx`:

```jsx
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRoute, navigate, navigateHash, replace } from './useRoute.js';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('useRoute', () => {
  it('reflects the current hash', () => {
    window.history.replaceState(null, '', '#/library/character/w1');
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'library', libraryTab: 'character', worldId: 'w1' });
  });

  it('returns the home route when there is no hash, without rewriting the URL', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'home' });
    expect(window.location.hash).toBe('');
  });

  it('follows hashchange', () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigateHash('#/browse/worlds'));
    expect(result.current).toEqual({ name: 'browse', browseTab: 'worlds', publicId: null });
  });

  it('normalizes an abbreviated hash to its canonical form', async () => {
    window.history.replaceState(null, '', '#/library');
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'library', libraryTab: 'world', worldId: null });
    await act(async () => {});
    expect(window.location.hash).toBe('#/library/world');
  });

  it('redirects the legacy endings hash to the records route', async () => {
    window.history.replaceState(null, '', '#/endings');
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'records', recordsTab: 'endings' });
    await act(async () => {});
    expect(window.location.hash).toBe('#/records/endings');
  });

  it('falls back to home for an unknown hash', async () => {
    window.history.replaceState(null, '', '#/nope');
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'home' });
    await act(async () => {});
    expect(window.location.hash).toBe('#/');
  });
});

describe('navigate', () => {
  it('pushes the canonical hash for a route', () => {
    navigate({ name: 'records', recordsTab: 'achievements' });
    expect(window.location.hash).toBe('#/records/achievements');
  });
});

describe('replace', () => {
  it('rewrites the hash without pushing a history entry', () => {
    const before = window.history.length;
    replace({ name: 'browse', browseTab: 'starters', publicId: null });
    expect(window.location.hash).toBe('#/browse/starters');
    expect(window.history.length).toBe(before);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/navigation/useRoute.test.jsx`
Expected: FAIL — `Failed to resolve import "./useRoute.js"`

- [ ] **Step 3: 実装する**

`src/navigation/useRoute.js`:

```js
import { useEffect, useState } from 'react';
import { parseRoute, buildHash } from './routes.js';

const HOME = { name: 'home' };

// jsdom や一部環境では hash 代入が hashchange を発火しないため明示的に通知する。
// (旧 useHashRoute.js と同じ理由)
function notify() {
  window.dispatchEvent(new Event('hashchange'));
}

function readRoute() {
  return parseRoute(window.location.hash) || HOME;
}

export function navigateHash(hash) {
  if (window.location.hash === hash) return;
  window.location.hash = hash;
  notify();
}

export function navigate(route) {
  navigateHash(buildHash(route));
}

export function replace(route) {
  const { pathname, search } = window.location;
  window.history.replaceState(null, '', pathname + search + buildHash(route));
  notify();
}

export function useRoute() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    // 購読開始までに hash が変わっていた場合に取りこぼさない。
    onChange();
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  // 省略形・旧URL・解釈できない hash を正準形へ寄せる。履歴は積まない。
  // hash 無しのホームだけは、URL を汚さないためそのまま許容する。
  useEffect(() => {
    if (route.name === 'home' && window.location.hash === '') return;
    const canonical = buildHash(route);
    if (window.location.hash !== canonical) replace(route);
  }, [route]);

  return route;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/navigation/useRoute.test.jsx`
Expected: PASS（8 tests）

- [ ] **Step 5: コミット**

```bash
git add src/navigation/useRoute.js src/navigation/useRoute.test.jsx
git commit -m "feat(nav): hash購読フックと正準形への正規化を追加する"
```

---

## Task 4: パンくず動的ラベルの登録口

**Files:**
- Create: `src/navigation/BreadcrumbContext.jsx`
- Test: `src/navigation/BreadcrumbContext.test.jsx`

**Interfaces:**
- Produces:
  - `BreadcrumbProvider({ children }): JSX.Element`
  - `useBreadcrumbLabel(label: string | null | undefined): void` — 画面が現在地の名前を登録する。アンマウント時に自動で解除される
  - `useBreadcrumbTail(): string | null` — `Breadcrumb` が読む

- [ ] **Step 1: 失敗するテストを書く**

`src/navigation/BreadcrumbContext.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BreadcrumbProvider, useBreadcrumbLabel, useBreadcrumbTail } from './BreadcrumbContext.jsx';

function Tail() {
  return <div data-testid="tail">{useBreadcrumbTail() ?? '(none)'}</div>;
}

function Screen({ label }) {
  useBreadcrumbLabel(label);
  return null;
}

describe('BreadcrumbContext', () => {
  it('starts with no label', () => {
    render(
      <BreadcrumbProvider>
        <Tail />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('(none)');
  });

  it('exposes a label registered by a screen', () => {
    render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アーカム 1920s" />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('アーカム 1920s');
  });

  it('updates when the screen changes its label', () => {
    const { rerender } = render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アーカム 1920s" />
      </BreadcrumbProvider>
    );
    rerender(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アルデン辺境領" />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('アルデン辺境領');
  });

  it('clears the label when the screen unmounts', () => {
    const { rerender } = render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アーカム 1920s" />
      </BreadcrumbProvider>
    );
    rerender(
      <BreadcrumbProvider>
        <Tail />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('(none)');
  });

  it('treats an undefined label as absent', () => {
    render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label={undefined} />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('(none)');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/navigation/BreadcrumbContext.test.jsx`
Expected: FAIL — `Failed to resolve import "./BreadcrumbContext.jsx"`

- [ ] **Step 3: 実装する**

`src/navigation/BreadcrumbContext.jsx`:

```jsx
import { createContext, useContext, useState, useEffect, useMemo } from 'react';

// パンくず末尾の動的ラベル(World名・公開アイテム名・ユーザー表示名)の受け渡し口。
// シェル側で再取得すると二重フェッチになるため、既にデータを持っている画面から登録させる。
const BreadcrumbContext = createContext({ label: null, setLabel: () => {} });

export function BreadcrumbProvider({ children }) {
  const [label, setLabel] = useState(null);
  const value = useMemo(() => ({ label, setLabel }), [label]);
  return <BreadcrumbContext.Provider value={value}>{children}</BreadcrumbContext.Provider>;
}

// 画面から現在地の名前を登録する。アンマウント時に自動で解除するため、
// 画面遷移で前の画面のラベルが残らない。
export function useBreadcrumbLabel(label) {
  const { setLabel } = useContext(BreadcrumbContext);
  useEffect(() => {
    const normalizedLabel = label ?? null;
    setLabel(normalizedLabel);
    // 後続の画面が先にマウントしてラベルを登録した後にこのクリーンアップが
    // 走るケースがあるため、自分が登録したラベルのままであるときだけ解除する。
    // 無条件にnullへ戻すと、後から来た画面のラベルまで消してしまう。
    return () => setLabel((current) => (current === normalizedLabel ? null : current));
  }, [label, setLabel]);
}

export function useBreadcrumbTail() {
  return useContext(BreadcrumbContext).label;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/navigation/BreadcrumbContext.test.jsx`
Expected: PASS（5 tests）

- [ ] **Step 5: コミット**

```bash
git add src/navigation/BreadcrumbContext.jsx src/navigation/BreadcrumbContext.test.jsx
git commit -m "feat(nav): パンくず末尾ラベルの登録コンテキストを追加する"
```

---

## Task 5: グローバルナビ

PC とスマホで **DOM を変えず、スタイルだけを切り替える**。`useMediaQuery` は `matchMedia` の無い jsdom で常に `false` を返すため、DOM を出し分けるとテストが片方の分岐しか見なくなる。同一 DOM にすることで、どの画面のテストからも同じラベルで要素を引ける。

**Files:**
- Create: `src/components/nav/GlobalNav.jsx`
- Test: `src/components/nav/GlobalNav.test.jsx`
- Modify: `package.json`（`lucide-react` を追加）

**Interfaces:**
- Consumes: Task 1 の `NAV_TABS`、Task 3 の `navigateHash`
- Produces: `GlobalNav({ activeTab: string | null })` — `activeTab` は `navTabFor(route)` の戻り値

- [ ] **Step 1: lucide-react を追加する**

```bash
npm install lucide-react@^0.460.0
```

Run: `node -e "import('lucide-react').then(m => console.log(typeof m.Home))"`
Expected: `function`

- [ ] **Step 2: 失敗するテストを書く**

`src/components/nav/GlobalNav.test.jsx`:

```jsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GlobalNav from './GlobalNav.jsx';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('GlobalNav', () => {
  it('renders all four destinations as buttons', () => {
    render(<GlobalNav activeTab="home" />);
    for (const label of ['ホーム', '素材', 'さがす', '記録']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('marks only the active tab with aria-current', () => {
    render(<GlobalNav activeTab="library" />);
    expect(screen.getByRole('button', { name: '素材' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'ホーム' })).not.toHaveAttribute('aria-current');
  });

  it('marks nothing when no tab is active', () => {
    render(<GlobalNav activeTab={null} />);
    for (const label of ['ホーム', '素材', 'さがす', '記録']) {
      expect(screen.getByRole('button', { name: label })).not.toHaveAttribute('aria-current');
    }
  });

  it('navigates to the canonical hash of the tab that was pressed', () => {
    render(<GlobalNav activeTab="home" />);
    fireEvent.click(screen.getByRole('button', { name: 'さがす' }));
    expect(window.location.hash).toBe('#/browse/starters');
  });

  it('keeps every tab present when signed out, so the layout does not shift', () => {
    render(<GlobalNav activeTab={null} />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('exposes the tabs inside a labelled nav landmark', () => {
    render(<GlobalNav activeTab="home" />);
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();
  });

  it('gives every tab a tap target of at least 44px', () => {
    render(<GlobalNav activeTab="home" />);
    for (const button of screen.getAllByRole('button')) {
      expect(parseInt(button.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
      expect(parseInt(button.style.minWidth, 10)).toBeGreaterThanOrEqual(44);
    }
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npx vitest run src/components/nav/GlobalNav.test.jsx`
Expected: FAIL — `Failed to resolve import "./GlobalNav.jsx"`

- [ ] **Step 4: 実装する**

`src/components/nav/GlobalNav.jsx`:

```jsx
import { Home, Library, Compass, Trophy } from 'lucide-react';
import { NAV_TABS } from '../../navigation/routes.js';
import { navigateHash } from '../../navigation/useRoute.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { COLORS, F_MONO } from '../../theme.js';

const ICONS = { home: Home, library: Library, browse: Compass, records: Trophy };

export default function GlobalNav({ activeTab }) {
  // PC は上部の横並び、スマホは下部固定。DOM は同一にしてスタイルだけ切り替える。
  const wide = useMediaQuery('(min-width: 768px)');

  const listStyle = wide
    ? { display: 'flex', gap: 4, alignItems: 'center' }
    : {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        justifyContent: 'space-around',
        background: COLORS.card,
        borderTop: `1px solid ${COLORS.line}`,
        padding: '4px 0 max(4px, env(safe-area-inset-bottom))',
        zIndex: 80,
      };

  return (
    <nav aria-label="メインメニュー">
      <div style={listStyle}>
        {NAV_TABS.map((tab) => {
          const Icon = ICONS[tab.key];
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => navigateHash(tab.hash)}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'flex',
                flexDirection: wide ? 'row' : 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: wide ? 6 : 2,
                minWidth: 44,
                minHeight: 44,
                padding: wide ? '8px 14px' : '4px 8px',
                background: 'transparent',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: F_MONO,
                fontSize: wide ? 13 : 10,
                letterSpacing: 0.5,
                // 色だけに頼らず太さと下線でも現在地を示す。
                color: active ? COLORS.ink : COLORS.faint,
                fontWeight: active ? 600 : 400,
                boxShadow: active ? `inset 0 -2px 0 ${COLORS.brass}` : 'none',
              }}
            >
              <Icon size={wide ? 16 : 20} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/components/nav/GlobalNav.test.jsx`
Expected: PASS（7 tests）

- [ ] **Step 6: コミット**

```bash
git add package.json package-lock.json src/components/nav/GlobalNav.jsx src/components/nav/GlobalNav.test.jsx
git commit -m "feat(nav): 4タブのグローバルナビを追加する"
```

---

## Task 6: パンくず

**Files:**
- Create: `src/components/nav/Breadcrumb.jsx`
- Test: `src/components/nav/Breadcrumb.test.jsx`

**Interfaces:**
- Consumes: Task 2 の `crumbsFor` / `wantsDynamicCrumb`、Task 3 の `navigateHash`、Task 4 の `useBreadcrumbTail`
- Produces: `Breadcrumb({ route })` — route から段を導き、動的ラベルを末尾に足して描画する

- [ ] **Step 1: 失敗するテストを書く**

`src/components/nav/Breadcrumb.test.jsx`:

```jsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Breadcrumb from './Breadcrumb.jsx';
import { BreadcrumbProvider, useBreadcrumbLabel } from '../../navigation/BreadcrumbContext.jsx';
import { parseRoute } from '../../navigation/routes.js';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

function Register({ label }) {
  useBreadcrumbLabel(label);
  return null;
}

function renderCrumbs(hash, dynamicLabel) {
  return render(
    <BreadcrumbProvider>
      {dynamicLabel !== undefined && <Register label={dynamicLabel} />}
      <Breadcrumb route={parseRoute(hash)} />
    </BreadcrumbProvider>
  );
}

describe('Breadcrumb', () => {
  it('renders the static crumbs of the route', () => {
    renderCrumbs('#/library/character');
    expect(screen.getByText('ホーム')).toBeInTheDocument();
    expect(screen.getByText('素材')).toBeInTheDocument();
    expect(screen.getByText('Character')).toBeInTheDocument();
  });

  it('appends the dynamic label registered by the screen', () => {
    renderCrumbs('#/library/character/w1', 'アーカム 1920s');
    expect(screen.getByText('アーカム 1920s')).toBeInTheDocument();
  });

  it('does not expose the raw id while the dynamic label is missing', () => {
    renderCrumbs('#/library/character/w1');
    expect(screen.queryByText('w1')).not.toBeInTheDocument();
  });

  it('marks the last crumb as the current page and leaves it unclickable', () => {
    renderCrumbs('#/library/character');
    const current = screen.getByText('Character');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).toBe('SPAN');
  });

  it('navigates when an ancestor crumb is pressed', () => {
    renderCrumbs('#/library/character');
    fireEvent.click(screen.getByRole('button', { name: '素材' }));
    expect(window.location.hash).toBe('#/library/world');
  });

  it('marks the dynamic crumb as current when it is present', () => {
    renderCrumbs('#/browse/worlds/pub_1', '丘の上の写真館');
    expect(screen.getByText('丘の上の写真館')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '世界観' })).toBeInTheDocument();
  });

  it('shows the user display name as the only crumb below home', () => {
    renderCrumbs('#/u/usr_1', 'Xavier');
    expect(screen.getByRole('button', { name: 'ホーム' })).toBeInTheDocument();
    expect(screen.getByText('Xavier')).toHaveAttribute('aria-current', 'page');
  });

  it('exposes the trail inside a labelled nav landmark', () => {
    renderCrumbs('#/library/character');
    expect(screen.getByRole('navigation', { name: '現在地' })).toBeInTheDocument();
  });

  it('reserves a fixed height so the row does not jump when the label arrives', () => {
    const { container } = renderCrumbs('#/library/character/w1');
    expect(container.querySelector('nav').style.minHeight).toBe('32px');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/nav/Breadcrumb.test.jsx`
Expected: FAIL — `Failed to resolve import "./Breadcrumb.jsx"`

- [ ] **Step 3: 実装する**

`src/components/nav/Breadcrumb.jsx`:

```jsx
import { ChevronRight } from 'lucide-react';
import { crumbsFor, wantsDynamicCrumb } from '../../navigation/routes.js';
import { navigateHash } from '../../navigation/useRoute.js';
import { useBreadcrumbTail } from '../../navigation/BreadcrumbContext.jsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { COLORS, F_MONO } from '../../theme.js';

// スマホで表示する末尾の段数。先頭側は DOM に残したまま非表示にする。
const NARROW_VISIBLE = 2;

export default function Breadcrumb({ route }) {
  const wide = useMediaQuery('(min-width: 768px)');
  const tail = useBreadcrumbTail();

  const crumbs = [...crumbsFor(route)];
  // 動的ラベルが未登録の間は段を足さない(IDを露出させないため)。
  if (wantsDynamicCrumb(route) && tail) {
    crumbs.push({ key: 'dynamic', label: tail, hash: null });
  }

  const firstVisible = wide ? 0 : Math.max(0, crumbs.length - NARROW_VISIBLE);

  return (
    <nav
      aria-label="現在地"
      // ラベル到着でレイアウトが跳ねないよう高さを固定する。
      style={{ minHeight: 32, display: 'flex', alignItems: 'center' }}
    >
      <ol
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          listStyle: 'none',
          margin: 0,
          padding: 0,
          fontFamily: F_MONO,
          fontSize: 12,
        }}
      >
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li
              key={crumb.key}
              style={{
                display: i < firstVisible ? 'none' : 'flex',
                alignItems: 'center',
                gap: 4,
                minWidth: 0,
              }}
            >
              {i > 0 && <ChevronRight size={12} color={COLORS.faint} aria-hidden="true" />}
              {isLast ? (
                <span
                  aria-current="page"
                  style={{
                    color: COLORS.ink,
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 240,
                  }}
                >
                  {crumb.label}
                </span>
              ) : (
                <button
                  onClick={() => navigateHash(crumb.hash)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    padding: '4px 2px',
                    cursor: 'pointer',
                    fontFamily: F_MONO,
                    fontSize: 12,
                    color: COLORS.faint,
                    textDecoration: 'underline',
                  }}
                >
                  {crumb.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/nav/Breadcrumb.test.jsx`
Expected: PASS（9 tests）

- [ ] **Step 5: コミット**

```bash
git add src/components/nav/Breadcrumb.jsx src/components/nav/Breadcrumb.test.jsx
git commit -m "feat(nav): URL由来のパンくずを追加する"
```

---

## Task 7: 集中モードのヘッダー

**Files:**
- Create: `src/components/nav/FocusHeader.jsx`
- Test: `src/components/nav/FocusHeader.test.jsx`

**Interfaces:**
- Consumes: Task 3 の `navigateHash`
- Produces: `FocusHeader({ title, steps, currentStep, exitLabel, onExit })`
  - `title: string` — 画面名（セッション名やシナリオ名）
  - `steps?: string[]` — ウィザードのステップ名。省略時はステップ表示を出さない
  - `currentStep?: number` — 0 始まり
  - `exitLabel?: string` — 既定 `'ホーム'`
  - `onExit?: () => void` — 省略時は `#/` へ遷移する

- [ ] **Step 1: 失敗するテストを書く**

`src/components/nav/FocusHeader.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FocusHeader from './FocusHeader.jsx';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('FocusHeader', () => {
  it('renders the title', () => {
    render(<FocusHeader title="丘の上の写真館" />);
    expect(screen.getByText('丘の上の写真館')).toBeInTheDocument();
  });

  it('navigates home when the exit button is pressed and no handler is given', () => {
    render(<FocusHeader title="丘の上の写真館" />);
    fireEvent.click(screen.getByRole('button', { name: 'ホーム' }));
    expect(window.location.hash).toBe('#/');
  });

  it('calls the supplied handler instead of navigating', () => {
    const onExit = vi.fn();
    render(<FocusHeader title="新規プレイ" exitLabel="やめる" onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
  });

  it('renders every step and marks the current one', () => {
    render(
      <FocusHeader title="新規プレイ" steps={['世界観', 'シナリオ', 'ルール', 'PC', '確認']} currentStep={3} />
    );
    for (const s of ['世界観', 'シナリオ', 'ルール', 'PC', '確認']) {
      expect(screen.getByText(s)).toBeInTheDocument();
    }
    expect(screen.getByText('PC')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('世界観')).not.toHaveAttribute('aria-current');
  });

  it('omits the step indicator when no steps are given', () => {
    render(<FocusHeader title="丘の上の写真館" />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('gives the exit button a tap target of at least 44px', () => {
    render(<FocusHeader title="丘の上の写真館" />);
    const button = screen.getByRole('button', { name: 'ホーム' });
    expect(parseInt(button.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/nav/FocusHeader.test.jsx`
Expected: FAIL — `Failed to resolve import "./FocusHeader.jsx"`

- [ ] **Step 3: 実装する**

`src/components/nav/FocusHeader.jsx`:

```jsx
import { ChevronLeft } from 'lucide-react';
import { navigateHash } from '../../navigation/useRoute.js';
import { COLORS, F_MONO, F_DISPLAY } from '../../theme.js';

// 集中モード(Play / Setup)のヘッダー。グローバルナビの代わりに
// 「離脱導線 + 現在地」だけを出す。回遊モードとの差はこの1点に限る。
// 画面側のログ等が下に伸びてもタイトルと離脱導線を見失わないよう sticky にする。
// 高さは離脱ボタンの最小タップ域+上下padding+下枠線から算出し、定数として公開する。
// 画面側が自分のスティッキー要素をこの下に追随させる際、実測値とズレて隙間や
// 重なりが生じないようにするため。以下の3定数はスタイルオブジェクト側でも
// そのまま使い、高さの数値とレイアウトが食い違わないようにする。
const EXIT_BUTTON_MIN_HEIGHT = 44; // 離脱ボタンの最小タップ域
const HEADER_VERTICAL_PADDING = 16; // 上下padding合計(8px×2)
const HEADER_BORDER_WIDTH = 1; // 下枠線
export const FOCUS_HEADER_HEIGHT = EXIT_BUTTON_MIN_HEIGHT + HEADER_VERTICAL_PADDING + HEADER_BORDER_WIDTH;

export default function FocusHeader({ title, steps, currentStep = 0, exitLabel = 'ホーム', onExit }) {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        // 画面側の追随バー(Play context bar, zIndex: 20)を常に上回るようにする。
        // ただしPC/セットアップのオーバーレイパネルとそのスクリムはモーダルとして
        // これより上に来る必要があるため、呼び出し側(Play.jsx等)でさらに上の
        // zIndexを割り当てて重ねる。
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        height: FOCUS_HEADER_HEIGHT,
        boxSizing: 'border-box',
        padding: `${HEADER_VERTICAL_PADDING / 2}px 16px`,
        borderBottom: `${HEADER_BORDER_WIDTH}px solid ${COLORS.line}`,
        // 下にスクロールするコンテンツが透けないよう不透明にする。
        background: COLORS.card,
      }}
    >
      <button
        onClick={() => (onExit ? onExit() : navigateHash('#/'))}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minHeight: EXIT_BUTTON_MIN_HEIGHT,
          padding: '0 8px',
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontFamily: F_MONO,
          fontSize: 12,
          color: COLORS.inkSoft,
          whiteSpace: 'nowrap',
        }}
      >
        <ChevronLeft size={14} aria-hidden="true" />
        {exitLabel}
      </button>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: F_DISPLAY,
          fontSize: 16,
          color: COLORS.ink,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </div>

      {steps && steps.length > 0 && (
        <ol
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            listStyle: 'none',
            margin: 0,
            padding: 0,
            fontFamily: F_MONO,
            fontSize: 11,
          }}
        >
          {steps.map((label, i) => (
            <li key={label}>
              <span
                aria-current={i === currentStep ? 'step' : undefined}
                style={{
                  // 色だけに頼らず太さでも現在地を示す。
                  color: i === currentStep ? COLORS.ink : COLORS.faint,
                  fontWeight: i === currentStep ? 600 : 400,
                }}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/nav/FocusHeader.test.jsx`
Expected: PASS（6 tests）

- [ ] **Step 5: コミット**

```bash
git add src/components/nav/FocusHeader.jsx src/components/nav/FocusHeader.test.jsx
git commit -m "feat(nav): 集中モード用ヘッダーを追加する"
```

---

## Task 8: アカウントメニューの移設

`AuthBar.jsx` を `AccountMenu.jsx` へ移し、`position: fixed` を外してシェルのヘッダーに収まるようにする。中身のロジック（メニュー開閉・プロフィール編集モーダル）は変更しない。

**Files:**
- Create: `src/components/nav/AccountMenu.jsx`
- Create: `src/components/nav/AccountMenu.test.jsx`
- Delete: `src/components/auth/AuthBar.jsx`
- Delete: `src/components/auth/AuthBar.test.jsx`
- Modify: `src/App.jsx`（改名の追随のみ）

**Interfaces:**
- Consumes: `src/auth/AuthContext.jsx` の `useAuth`、`src/api/authClient.js` の `patchMe`、Task 3 の `navigate`
- Produces: `AccountMenu()` — props なし

> **`App.jsx` の追随について。** `src/App.jsx` は `AuthBar` を import して4箇所で描画している。改名しておきながら参照を壊れたまま残すのは改名が未完了なだけなので、**このタスクで import 行と4つの JSX タグ名だけを直す**。`view` state・ルーティング・レイアウトには触れない（それは Task 10）。これを次タスク送りにすると `npm test` が中間状態で赤くなり、Task 1〜9 は全体緑という制約に反する。

- [ ] **Step 1: 既存テストを移設先の名前で写す**

`src/components/auth/AuthBar.test.jsx` の内容を `src/components/nav/AccountMenu.test.jsx` へコピーし、import を差し替える。

```bash
git mv src/components/auth/AuthBar.test.jsx src/components/nav/AccountMenu.test.jsx
```

`src/components/nav/AccountMenu.test.jsx` の先頭で、`AuthBar.jsx` を指す import を次に変える:

```jsx
import AccountMenu from './AccountMenu.jsx';
```

ファイル内の `<AuthBar` をすべて `<AccountMenu` に、`describe('AuthBar'` を `describe('AccountMenu'` に置換する。`../../auth/...` や `../../test/...` への相対パスは、`components/auth/` と `components/nav/` が同じ深さのため変更不要。

- [ ] **Step 2: 移設先が無いことでテストが失敗するのを確認する**

Run: `npx vitest run src/components/nav/AccountMenu.test.jsx`
Expected: FAIL — `Failed to resolve import "./AccountMenu.jsx"`

- [ ] **Step 3: 本体を移設する**

```bash
git mv src/components/auth/AuthBar.jsx src/components/nav/AccountMenu.jsx
```

`src/components/nav/AccountMenu.jsx` に次の4点の変更を加える。

1. import の差し替え（`navigateToUser` は `navigate` へ）:

```jsx
import { navigate } from '../../navigation/useRoute.js';
```

（`import { navigateToUser } from '../../router/useHashRoute.js';` の行を上記に置き換える）

**注意:** 相対パスは大半が `../../` で深さが同じため変更不要だが、**`LoginModal` だけは例外**。`LoginModal.jsx` は `src/components/auth/` に残るため、同階層参照から1つ上へ辿る形に変える:

```jsx
import LoginModal from '../auth/LoginModal.jsx';
```

（`import LoginModal from './LoginModal.jsx';` の行を置き換える）

2. コンポーネント名と、`position: fixed` の撤去:

```jsx
export default function AccountMenu() {
  const { user, loading, refresh, logout } = useAuth();
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const menuRef = useRef(null);
```

（`export default function AuthBar() {` を上記に置き換える）

`const wrapStyle = { position: 'fixed', top: 12, right: 16, zIndex: 90 };` を次に置き換える。シェルのヘッダー内へ収めるため浮かせない。

```jsx
  // シェルのヘッダー内に置くため浮かせない(旧AuthBarはposition:fixedで本文と無関係に浮いていた)。
  const wrapStyle = { position: 'relative' };
```

3. 「自分のページ」への遷移を新ルータに合わせる:

```jsx
                navigate({ name: 'user', userId: user.id });
```

（`navigateToUser(user.id);` の行を置き換える）

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/nav/AccountMenu.test.jsx`
Expected: PASS（既存の AuthBar テストと同数）

- [ ] **Step 5: コミット**

```bash
git add -A src/components/auth src/components/nav
git commit -m "refactor(nav): AuthBarをAccountMenuへ移しfixed配置をやめる"
```

---

## Task 9: アプリシェル

**Files:**
- Create: `src/components/nav/AppShell.jsx`
- Test: `src/components/nav/AppShell.test.jsx`

**Interfaces:**
- Consumes: Task 2 の `navTabFor` / `isFocusRoute`、Task 5〜8 の各コンポーネント、`src/components/ErrorBoundary.jsx`
- Produces: `AppShell({ route, children })` — 回遊モードではブランド＋`GlobalNav`＋`AccountMenu`＋`Breadcrumb` を、集中モードではヘッダーを一切出さず `children` のみを描画する

- [ ] **Step 1: 失敗するテストを書く**

`src/components/nav/AppShell.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import AppShell from './AppShell.jsx';
import { BreadcrumbProvider } from '../../navigation/BreadcrumbContext.jsx';
import { parseRoute } from '../../navigation/routes.js';
import { renderWithAuth } from '../../test/renderWithAuth.jsx';

function renderShell(hash, { user } = {}) {
  return renderWithAuth(
    <BreadcrumbProvider>
      <AppShell route={parseRoute(hash)}>
        <div>中身</div>
      </AppShell>
    </BreadcrumbProvider>,
    user === undefined ? {} : { user }
  );
}

describe('AppShell', () => {
  it('shows the global nav and breadcrumb on browsing routes', () => {
    renderShell('#/library/character');
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '現在地' })).toBeInTheDocument();
    expect(screen.getByText('中身')).toBeInTheDocument();
  });

  it('hides both navs on the play route', () => {
    renderShell('#/play/ses_1');
    expect(screen.queryByRole('navigation', { name: 'メインメニュー' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '現在地' })).not.toBeInTheDocument();
    expect(screen.getByText('中身')).toBeInTheDocument();
  });

  it('hides both navs on the setup route', () => {
    renderShell('#/setup');
    expect(screen.queryByRole('navigation', { name: 'メインメニュー' })).not.toBeInTheDocument();
    expect(screen.getByText('中身')).toBeInTheDocument();
  });

  it('highlights the nav tab that matches the route', () => {
    renderShell('#/browse/worlds');
    expect(screen.getByRole('button', { name: 'さがす' })).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the nav visible on the user page, with no tab highlighted', () => {
    renderShell('#/u/usr_1');
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ホーム' })).not.toHaveAttribute('aria-current');
  });

  it('shows the account menu on browsing routes', () => {
    renderShell('#/', { user: { id: 'usr_1', displayName: 'テスト', avatarUrl: null } });
    expect(screen.getByText('テスト')).toBeInTheDocument();
  });

  it('offers a skip link to the main content', () => {
    renderShell('#/');
    const skip = screen.getByRole('link', { name: '本文へスキップ' });
    expect(skip).toHaveAttribute('href', '#main');
  });

  it('gives the content region an id the skip link can target', () => {
    const { container } = renderShell('#/');
    expect(container.querySelector('#main')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/nav/AppShell.test.jsx`
Expected: FAIL — `Failed to resolve import "./AppShell.jsx"`

- [ ] **Step 3: 実装する**

`src/components/nav/AppShell.jsx`:

```jsx
import { navTabFor, isFocusRoute } from '../../navigation/routes.js';
import { navigateHash } from '../../navigation/useRoute.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import GlobalNav from './GlobalNav.jsx';
import Breadcrumb from './Breadcrumb.jsx';
import AccountMenu from './AccountMenu.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { COLORS, F_DISPLAY } from '../../theme.js';

// 集中モードではスマホの下部タブバーが無いので余白も要らない。
const NARROW_TABBAR_SPACE = 64;

export default function AppShell({ route, children }) {
  const wide = useMediaQuery('(min-width: 768px)');
  const focus = isFocusRoute(route);

  // 集中モード(Play / Setup)はヘッダーを画面側の FocusHeader に任せ、シェルは何も出さない。
  if (focus) {
    return (
      <main id="main">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    );
  }

  return (
    <>
      <a
        href="#main"
        style={{
          position: 'absolute',
          left: -9999,
          top: 0,
          background: COLORS.card,
          color: COLORS.ink,
          padding: 8,
          zIndex: 200,
        }}
        onFocus={(e) => {
          e.currentTarget.style.left = '8px';
        }}
        onBlur={(e) => {
          e.currentTarget.style.left = '-9999px';
        }}
      >
        本文へスキップ
      </a>

      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 90,
          background: COLORS.card,
          borderBottom: `1px solid ${COLORS.line}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '6px 16px',
            maxWidth: 1080,
            margin: '0 auto',
          }}
        >
          <button
            onClick={() => navigateHash('#/')}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: F_DISPLAY,
              fontSize: 16,
              letterSpacing: 1,
              color: COLORS.ink,
              padding: '8px 0',
              whiteSpace: 'nowrap',
            }}
          >
            GM's Desk
          </button>
          {/* スマホでは下部タブバーになるため、ヘッダー内のナビは幅が広いときだけ挟む */}
          {wide && <GlobalNav activeTab={navTabFor(route)} />}
          <div style={{ flex: 1 }} />
          <AccountMenu />
        </div>

        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 16px 6px' }}>
          <Breadcrumb route={route} />
        </div>
      </header>

      <main id="main" style={{ paddingBottom: wide ? 0 : NARROW_TABBAR_SPACE }}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>

      {/* 幅が狭いときは下部固定のタブバーとして描く */}
      {!wide && <GlobalNav activeTab={navTabFor(route)} />}
    </>
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/nav/AppShell.test.jsx`
Expected: PASS（8 tests）

- [ ] **Step 5: コミット**

```bash
git add src/components/nav/AppShell.jsx src/components/nav/AppShell.test.jsx
git commit -m "feat(nav): モードを出し分けるアプリシェルを追加する"
```

---

## Task 10: App.jsx をシェルへ載せ替える

`view` state を廃し、`useRoute()` を単一の情報源にする。Play のセッションは `sessionId` から読み直す。

**Files:**
- Modify: `src/App.jsx`（全面書き換え）
- Modify: `src/App.test.jsx`

**Interfaces:**
- Consumes: Task 3 の `useRoute` / `navigate` / `replace`、Task 4 の `BreadcrumbProvider`、Task 9 の `AppShell`
- Produces: 各画面へ渡す props が次に変わる
  - `Home`: `onOpenLibrary` / `onOpenGallery` を廃止（グローバルナビが担う）。`onNew` / `onContinue` / `onNextChapter` / `onStartStarter` は残す
  - `Library` / `Gallery` / `EndingGallery` / `AchievementList`: `onClose` を廃止し `route` を受け取る
  - `Play`: `onExit` を廃止
  - `Setup`: `onCancel` を廃止

- [ ] **Step 1: 失敗するテストを書く**

`src/App.test.jsx` の `navigates to the library screen and back` と `navigates to the public gallery screen and back...` を次の3件に差し替える（`閉じる` は存在しなくなるため）。他のテストはそのまま残す。

```jsx
  it('navigates to the library through the global nav and back home', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ user: { id: 'usr_test', displayName: 'テスト' } }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '素材' }));
    await waitFor(() => expect(window.location.hash).toBe('#/library/world'));
    expect(await screen.findByText('World一覧')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'ホーム' }));
    await waitFor(() => expect(window.location.hash).toBe('#/'));

    vi.unstubAllGlobals();
  });

  it('navigates to the public gallery without requiring login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).includes('/api/me')) {
          return Promise.resolve({ ok: true, json: async () => ({ user: null }) });
        }
        if (String(url).includes('/api/public/')) {
          return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0, hasMore: false }) });
        }
        return Promise.resolve({ ok: true, json: async () => [] });
      })
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'さがす' }));
    await waitFor(() => expect(window.location.hash).toBe('#/browse/starters'));

    fireEvent.click(await screen.findByRole('button', { name: '小説' }));
    await waitFor(() => expect(window.location.hash).toBe('#/browse/novels'));
    expect(await screen.findByText('まだ公開されたものがありません')).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it('keeps the global nav visible on every browsing screen', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '記録' }));
    await waitFor(() => expect(window.location.hash).toBe('#/records/endings'));
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();
  });
```

さらに、既存の `renders the ending gallery for the #/endings route` の直後に旧 URL の検証を追加する:

```jsx
  it('redirects the legacy #/endings hash to the records route', async () => {
    window.location.hash = '#/endings';
    try {
      render(<App />);
      expect(await screen.findByText('エンディング図鑑')).toBeInTheDocument();
      await waitFor(() => expect(window.location.hash).toBe('#/records/endings'));
    } finally {
      window.location.hash = '';
    }
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/App.test.jsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "素材"`

- [ ] **Step 3: App.jsx を書き換える**

`src/App.jsx` を全面的に次の内容へ置き換える:

```jsx
import { useState, useEffect, useRef } from 'react';
import { useGoogleFonts, COLORS, F_MONO } from './theme.js';
import { listSessions, getSession, saveSession, isStorageAvailable } from './storage/index.js';
import Home from './screens/Home.jsx';
import Setup from './screens/Setup.jsx';
import Play from './screens/Play.jsx';
import Library from './screens/Library.jsx';
import Gallery from './screens/Gallery.jsx';
import UserPage from './screens/UserPage.jsx';
import EndingGallery from './screens/EndingGallery.jsx';
import AchievementList from './screens/AchievementList.jsx';
import { useRoute, navigate, replace } from './navigation/useRoute.js';
import { buildHash } from './navigation/routes.js';
import { BreadcrumbProvider } from './navigation/BreadcrumbContext.jsx';
import AppShell from './components/nav/AppShell.jsx';
import { AuthProvider } from './auth/AuthContext.jsx';
import { useSessionTakeover } from './auth/useSessionTakeover.js';
import ConfirmModal from './components/library/ConfirmModal.jsx';

export default function App() {
  return (
    <AuthProvider>
      <BreadcrumbProvider>
        <AppInner />
      </BreadcrumbProvider>
    </AuthProvider>
  );
}

function AppInner() {
  useGoogleFonts();
  const route = useRoute();
  // route オブジェクトは hash が動くたびに作り直されるため、同一性の判定には正準 hash を使う。
  const routeKey = buildHash(route);
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [sessionError, setSessionError] = useState('');
  const [loadingHome, setLoadingHome] = useState(true);
  const [storageOk, setStorageOk] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [uploadingSessions, setUploadingSessions] = useState(false);
  // ウィザードへ引き継ぐ文脈。world.summary や scenario オブジェクトを含み URL には載せられないため、
  // 従来どおりメモリで持つ。#/setup を直接開いた場合は素のウィザードとして開く。
  const [campaignContext, setCampaignContext] = useState(null);
  const [starterContext, setStarterContext] = useState(null);
  const takeover = useSessionTakeover();

  // バナーはシェルの子として全ルートに描かれるため、出しっぱなしにすると
  // 一度の失敗が以降すべての画面の先頭に居座る。「どのルートで見せたいバナーか」を
  // 覚えておき、そこから離れた時点で畳む。null は「出していない」。
  const authErrorRouteRef = useRef(null);
  const sessionErrorRouteRef = useRef(null);
  // 直前のルート。プレイ画面から離れたことを検知するために持つ。
  const prevRouteRef = useRef(route);

  useEffect(() => {
    (async () => {
      setStorageOk(await isStorageAvailable());
      setSessions(await listSessions());
      setLoadingHome(false);
    })();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_error') === '1') {
      authErrorRouteRef.current = routeKey;
      setAuthError(true);
      params.delete('auth_error');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);

  // ホームへ戻るたびに一覧を取り直す(プレイ後の更新を反映するため)。
  useEffect(() => {
    if (route.name !== 'home') return;
    let cancelled = false;
    (async () => {
      const list = await listSessions();
      if (!cancelled) setSessions(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [route.name]);

  // #/play/:sessionId を直接開いた/リロードした場合にセッションを読み直す。
  useEffect(() => {
    if (route.name !== 'play') return;
    if (session && session.id === route.sessionId) return;
    let cancelled = false;
    (async () => {
      const s = await getSession(route.sessionId);
      if (cancelled) return;
      if (s) {
        setSession(s);
      } else {
        // 見せたいのは差し替えた先のホーム。ここで基準を先に置いておかないと、
        // 直後の replace によるルート変更で自分自身のバナーを畳んでしまう。
        sessionErrorRouteRef.current = buildHash({ name: 'home' });
        setSessionError('セッションが見つかりません');
        replace({ name: 'home' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [route.name, route.sessionId, session]);

  // ルートが変わったときの後始末。バナーを畳み、離れたプレイ画面のセッションを捨てる。
  // 依存は routeKey だけにして、route オブジェクトの作り直しでは走らないようにする。
  useEffect(() => {
    const prev = prevRouteRef.current;
    prevRouteRef.current = route;

    if (authErrorRouteRef.current !== null && authErrorRouteRef.current !== routeKey) {
      authErrorRouteRef.current = null;
      setAuthError(false);
    }
    if (sessionErrorRouteRef.current !== null && sessionErrorRouteRef.current !== routeKey) {
      sessionErrorRouteRef.current = null;
      setSessionError('');
    }

    // メモリ上の session を握ったままだと、素材ライブラリから消したセッションへ
    // 同じ #/play/:id で戻ったときにストレージを読み直さず古い内容を映してしまう。
    // ただし「ウィザード完了 → #/play/:id」では handleStart が置いた session を
    // 捨ててはいけないので、直前がプレイ画面だったときだけ捨てる。
    if (prev.name === 'play' && !(route.name === 'play' && route.sessionId === prev.sessionId)) {
      setSession(null);
    }
  }, [routeKey]);

  async function handleStart(newSession) {
    setSession(newSession);
    await saveSession(newSession);
    setCampaignContext(null);
    setStarterContext(null);
    navigate({ name: 'play', sessionId: newSession.id });
  }

  return (
    <div style={{ background: COLORS.paper, minHeight: '100vh', color: COLORS.ink }}>
      <AppShell route={route}>
        <ConfirmModal
          open={takeover.pendingCount > 0}
          message={`このブラウザに保存されたセッション${takeover.pendingCount}件をアカウントに保存しますか?`}
          confirmLabel="保存する"
          confirmDisabled={uploadingSessions}
          onConfirm={async () => {
            setUploadingSessions(true);
            try {
              await takeover.confirm();
            } finally {
              setUploadingSessions(false);
            }
          }}
          onCancel={takeover.dismiss}
        />
        {authError && (
          <div
            style={{
              fontFamily: F_MONO,
              fontSize: 12,
              color: COLORS.stamp,
              textAlign: 'center',
              padding: '8px 12px',
            }}
          >
            ログインに失敗しました。もう一度お試しください。
          </div>
        )}
        {sessionError && (
          <div
            style={{
              fontFamily: F_MONO,
              fontSize: 12,
              color: COLORS.stamp,
              textAlign: 'center',
              padding: '8px 12px',
            }}
          >
            {sessionError}
          </div>
        )}

        {route.name === 'home' &&
          (loadingHome ? (
            <div style={{ padding: 48, fontFamily: F_MONO, color: COLORS.faint }}>読み込み中…</div>
          ) : (
            <Home
              sessions={sessions}
              storageOk={storageOk}
              // ウィザードの入口は「自分が使う文脈」だけでなく「使わない文脈」も必ず落とす。
              // 離脱経路(ブラウザバック等)は文脈を消さないため、両方が同居すると
              // Setupがstarter基準でPCステップから開き、シナリオだけ無関係なものが
              // 選ばれたまま気づかれずに進んでしまう。
              onNew={() => {
                setStarterContext(null);
                setCampaignContext(null);
                navigate({ name: 'setup' });
              }}
              onContinue={(id) => navigate({ name: 'play', sessionId: id })}
              onNextChapter={(ctx) => {
                setCampaignContext(ctx);
                setStarterContext(null);
                navigate({ name: 'setup' });
              }}
              onStartStarter={(ctx) => {
                setStarterContext(ctx);
                setCampaignContext(null);
                navigate({ name: 'setup' });
              }}
            />
          ))}

        {route.name === 'setup' && (
          <Setup
            onStart={handleStart}
            campaignContext={campaignContext}
            starterContext={starterContext}
          />
        )}
        {route.name === 'library' && <Library route={route} />}
        {route.name === 'browse' && (
          <Gallery
            route={route}
            onStartStarter={(ctx) => {
              setStarterContext(ctx);
              setCampaignContext(null);
              navigate({ name: 'setup' });
            }}
          />
        )}
        {route.name === 'records' && route.recordsTab === 'endings' && <EndingGallery />}
        {route.name === 'records' && route.recordsTab === 'achievements' && <AchievementList />}
        {route.name === 'user' && <UserPage userId={route.userId} />}
        {/* 集中モードのシェルはナビを出さないので、読み込み中に何も描かないと
            真っ白で戻る手段の無い画面になる。ホームと同じ表示で埋める。 */}
        {route.name === 'play' &&
          (session && session.id === route.sessionId ? (
            <Play session={session} setSession={setSession} />
          ) : (
            <div style={{ padding: 48, fontFamily: F_MONO, color: COLORS.faint }}>読み込み中…</div>
          ))}
      </AppShell>
    </div>
  );
}
```

> このタスクの時点では `Library` / `Gallery` / `EndingGallery` / `AchievementList` / `Play` / `Setup` はまだ旧 props を受け取る。次タスク以降で各画面を合わせるまで、`npm test` の当該画面テストは落ちる。Step 4 で `App.test.jsx` のみを確認し、全体の緑は Task 16 で回復させる。

- [ ] **Step 4: App のテストが通ることを確認する**

Run: `npx vitest run src/App.test.jsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/App.jsx src/App.test.jsx
git commit -m "refactor(nav): App から view state を外し hash route へ一本化する"
```

---

## Task 11: 素材ライブラリを URL 駆動にする

**Files:**
- Modify: `src/screens/Library.jsx`
- Modify: `src/screens/Library.test.jsx`

**Interfaces:**
- Consumes: Task 1 の `LIBRARY_TABS` / `WORLD_SCOPED_LIBRARY_TABS`、Task 3 の `navigate`、Task 4 の `useBreadcrumbLabel`
- Produces: `Library({ route })` — `route` は `{ name: 'library', libraryTab, worldId }`

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Library.test.jsx` の先頭 import と、`Library` を描画している箇所すべてを次に合わせる。`onClose` の検証があれば削除し、代わりに次のテストを追加する:

```jsx
import { parseRoute } from '../navigation/routes.js';

  it('drives the tab from the route instead of local state', async () => {
    renderWithAuth(<Library route={parseRoute('#/library/ruleset')} />);
    expect(await screen.findByRole('button', { name: 'Ruleset' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('pushes the tab into the URL when a tab is pressed', async () => {
    renderWithAuth(<Library route={parseRoute('#/library/world')} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Character' }));
    expect(window.location.hash).toBe('#/library/character');
  });

  it('no longer renders a close button', () => {
    renderWithAuth(<Library route={parseRoute('#/library/world')} />);
    expect(screen.queryByText('閉じる')).not.toBeInTheDocument();
  });

  it('puts the selected world into the URL', async () => {
    renderWithAuth(<Library route={parseRoute('#/library/character')} />);
    const select = await screen.findByRole('combobox');
    fireEvent.change(select, { target: { value: 'w1' } });
    expect(window.location.hash).toBe('#/library/character/w1');
  });
```

`afterEach` で hash を戻す:

```jsx
afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/screens/Library.test.jsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Ruleset"`（現在はタブが `<div>` のため）

- [ ] **Step 3: 実装する**

`src/screens/Library.jsx` を次のとおり変更する。

import 部を差し替える（`TABS` のローカル定義を削除し、共有定義を使う）:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { COLORS, F_DISPLAY, F_MONO } from '../theme.js';
import { LIBRARY_TABS, WORLD_SCOPED_LIBRARY_TABS } from '../constants/libraryTabs.js';
import { navigate } from '../navigation/useRoute.js';
import { useBreadcrumbLabel } from '../navigation/BreadcrumbContext.jsx';
import WorldTab from './library/WorldTab.jsx';
import CharacterTab from './library/CharacterTab.jsx';
import ScenarioTab from './library/ScenarioTab.jsx';
import CampaignTab from './library/CampaignTab.jsx';
import RulesetTab from './library/RulesetTab.jsx';
import { listWorlds } from '../api/worldLibraryClient.js';
import { useAuth } from '../auth/AuthContext.jsx';

// World ピッカー(<select>)を出すタブ。WORLD_SCOPED_LIBRARY_TABS と違い、
// world タブは含めない。world タブでは WorldTab 自身が World のカード一覧を
// 描画するため、ここでピッカーを重ねると同じ選択肢が二重に表示されてしまう。
const WORLD_PICKER_TABS = WORLD_SCOPED_LIBRARY_TABS.filter((t) => t !== 'world');
```

（`const TABS = [...]` のブロックは削除する）

コンポーネント本体を次に置き換える:

```jsx
export default function Library({ route }) {
  const { user, loading: authLoading } = useAuth();
  const tab = route.libraryTab;
  const selectedWorldId = route.worldId;
  const [worlds, setWorlds] = useState([]);
  const [worldsError, setWorldsError] = useState('');

  const refreshWorlds = useCallback(async () => {
    try {
      setWorlds(await listWorlds());
      setWorldsError('');
    } catch (e) {
      setWorldsError('World一覧の取得に失敗した: ' + e.message);
    }
  }, []);

  useEffect(() => {
    refreshWorlds();
  }, [refreshWorlds]);

  // パンくず末尾に World 名を出す。未取得のうちは登録しない(IDを露出させないため)。
  const selectedWorld = worlds.find((w) => w.id === selectedWorldId);
  useBreadcrumbLabel(selectedWorld ? selectedWorld.title : null);

  function goToTab(nextTab) {
    // World スコープ外のタブへ移るときは worldId を落とす。
    const keepWorld = WORLD_SCOPED_LIBRARY_TABS.includes(nextTab) ? selectedWorldId : null;
    navigate({ name: 'library', libraryTab: nextTab, worldId: keepWorld });
  }

  function goToWorld(worldId) {
    navigate({ name: 'library', libraryTab: tab, worldId: worldId || null });
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 40px' }}>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 22, color: COLORS.ink, marginBottom: 24 }}>
        素材ライブラリ
      </div>

      {!user && !authLoading ? (
        <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.inkSoft }}>
          素材ライブラリの利用にはログインが必要です。右上からログインしてください。
        </div>
      ) : (
        <>
          {worldsError && (
            <div style={{ color: COLORS.stamp, fontSize: 13, marginBottom: 12 }}>{worldsError}</div>
          )}

          <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
            {LIBRARY_TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => goToTab(t.key)}
                  aria-current={active ? 'page' : undefined}
                  style={{
                    minHeight: 44,
                    padding: '6px 14px',
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontFamily: F_MONO,
                    fontSize: 12,
                    background: active ? COLORS.ink : 'transparent',
                    color: active ? COLORS.paper : COLORS.faint,
                    fontWeight: active ? 600 : 400,
                    border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/*
            WORLD_SCOPED_LIBRARY_TABS は「URLの3セグメント目にworldIdを取れるか」を
            答えるための定数で、world タブもそこに含まれる(WorldTab が選択中の
            World を詳細表示するため)。しかし「ピッカーを出すべきか」は別の問いで、
            world タブは WorldTab 自身が World のカード一覧を描画するため、
            ここで重ねてドロップダウンを出すと同じ選択を二重に提供してしまう。
            そのため World タブだけを除いた専用の配列で判定する。
          */}
          {WORLD_PICKER_TABS.includes(tab) && (
            <div style={{ marginBottom: 16 }}>
              <select
                value={selectedWorldId || ''}
                onChange={(e) => goToWorld(e.target.value)}
                style={{
                  fontFamily: F_MONO,
                  fontSize: 13,
                  minHeight: 44,
                  padding: '8px 10px',
                  border: `1px solid ${COLORS.line}`,
                  borderRadius: 4,
                  background: COLORS.card,
                  color: COLORS.inkSoft,
                }}
              >
                <option value="">World: 選択してください</option>
                {worlds.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {tab === 'world' && (
            <WorldTab
              worlds={worlds}
              selectedWorldId={selectedWorldId}
              onSelectWorld={goToWorld}
              onWorldsChanged={refreshWorlds}
            />
          )}
          {tab === 'character' && <CharacterTab worldId={selectedWorldId} />}
          {tab === 'scenario' && <ScenarioTab worldId={selectedWorldId} />}
          {tab === 'campaign' && <CampaignTab worldId={selectedWorldId} />}
          {tab === 'ruleset' && <RulesetTab />}
        </>
      )}
    </div>
  );
}
```

> `WorldTab` は `selectedWorldId` を「詳細/編集で開いている World」として使う（`WorldTab.jsx:50-85` で当該 World の regions/categories を取得し、`:287` の `onSelectWorld(w.id)` で開く）。したがって `world` タブも `worldId` を URL に載せる必要があり、`WORLD_SCOPED_LIBRARY_TABS` に `world` を含めてある。`#/library/world/w1` は「W1 を開いた World タブ」を意味する。`ruleset` だけが World に依存しないため、そこへ移ると `worldId` は落ちる。
>
> ただし `WORLD_SCOPED_LIBRARY_TABS` が答えるのは「URLの3セグメント目にworldIdを取れるか」だけであり、「World ピッカー（`<select>`）を出すべきか」とは別の問いである。`world` タブでは `WorldTab` 自身が World のカード一覧を描画する（`WorldTab.jsx:281-324`）ため、同じ選択肢のドロップダウンを重ねて出すと二重表示になる。そのためピッカーの表示条件は `WORLD_SCOPED_LIBRARY_TABS` から `world` を除いた `WORLD_PICKER_TABS`（= `character` / `scenario` / `campaign`）で判定し、`world` タブと `ruleset` タブの両方でピッカーを出さない。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/screens/Library.test.jsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/screens/Library.jsx src/screens/Library.test.jsx
git commit -m "refactor(library): タブとWorld選択をURL駆動にし閉じるを撤去する"
```

---

## Task 12: 公開ギャラリーを URL 駆動にする

**Files:**
- Modify: `src/screens/Gallery.jsx`
- Modify: `src/screens/Gallery.test.jsx`

**Interfaces:**
- Consumes: Task 3 の `navigate`、Task 4 の `useBreadcrumbLabel`、`GALLERY_TABS`
- Produces: `Gallery({ route, onStartStarter })` — `route` は `{ name: 'browse', browseTab, publicId }`

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Gallery.test.jsx` の描画箇所を `route` prop に合わせ、次のテストを追加する:

```jsx
import { parseRoute } from '../navigation/routes.js';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

  it('drives the tab from the route', async () => {
    render(<Gallery route={parseRoute('#/browse/novels')} onStartStarter={() => {}} />);
    expect(await screen.findByRole('button', { name: '小説' })).toHaveAttribute('aria-current', 'page');
  });

  it('pushes the tab into the URL when a tab is pressed', async () => {
    render(<Gallery route={parseRoute('#/browse/starters')} onStartStarter={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '世界観' }));
    expect(window.location.hash).toBe('#/browse/worlds');
  });

  it('no longer renders close or back-to-list buttons', () => {
    render(<Gallery route={parseRoute('#/browse/starters')} onStartStarter={() => {}} />);
    expect(screen.queryByText('閉じる')).not.toBeInTheDocument();
    expect(screen.queryByText('← 一覧に戻る')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/screens/Gallery.test.jsx`
Expected: FAIL — タブが `<div>` のため role で引けない

- [ ] **Step 3: 実装する**

`src/screens/Gallery.jsx` を次のとおり置き換える:

```jsx
import { useState, useEffect, useRef } from 'react';
import { COLORS, F_DISPLAY, F_MONO } from '../theme.js';
import { getPublic } from '../api/shareClient.js';
import PublicItemDetail from '../components/share/PublicItemDetail.jsx';
import PublicItemList from '../components/share/PublicItemList.jsx';
import StarterPackList from '../components/share/StarterPackList.jsx';
import { navigate } from '../navigation/useRoute.js';
import { useBreadcrumbLabel } from '../navigation/BreadcrumbContext.jsx';
import { GALLERY_TABS as TABS } from '../constants/publicContent.js';

export default function Gallery({ route, onStartStarter }) {
  const tab = route.browseTab;
  const publicId = route.publicId;

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailReqRef = useRef(0);

  // 詳細の取得は URL の publicId に従う。戻る/進むでも同じ経路を通る。
  useEffect(() => {
    if (!publicId) {
      setDetail(null);
      setDetailError('');
      return undefined;
    }
    const my = ++detailReqRef.current;
    let cancelled = false;
    setDetail(null);
    setDetailLoading(true);
    setDetailError('');
    (async () => {
      try {
        const item = await getPublic(tab, publicId);
        if (cancelled || my !== detailReqRef.current) return;
        setDetail(item);
      } catch (e) {
        if (cancelled || my !== detailReqRef.current) return;
        setDetailError('取得に失敗した: ' + e.message);
      } finally {
        if (!cancelled && my === detailReqRef.current) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, publicId]);

  useBreadcrumbLabel(detail ? detail.title : null);

  function goToTab(nextTab) {
    navigate({ name: 'browse', browseTab: nextTab, publicId: null });
  }

  function openDetail(id) {
    navigate({ name: 'browse', browseTab: tab, publicId: id });
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 20px 40px' }}>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 22, color: COLORS.ink, marginBottom: 24 }}>
        公開ギャラリー
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => goToTab(t.key)}
              aria-current={active ? 'page' : undefined}
              style={{
                minHeight: 44,
                padding: '6px 14px',
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: F_MONO,
                fontSize: 12,
                background: active ? COLORS.ink : 'transparent',
                color: active ? COLORS.paper : COLORS.faint,
                fontWeight: active ? 600 : 400,
                border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* starters は公開アイテムの一覧/詳細ではなく「まとめて取り込む単位」なので、
          /api/public/:type の TYPES にも属さない。ここだけ別コンポーネントを描画する。 */}
      {tab === 'starters' ? (
        <StarterPackList onImported={onStartStarter} />
      ) : (
        <>
          <PublicItemList
            key={tab}
            type={tab}
            active={!publicId}
            onOpenDetail={openDetail}
            onAuthorClick={(ownerId) => navigate({ name: 'user', userId: ownerId })}
          />

          {publicId &&
            (detailLoading ? (
              <div style={{ fontFamily: F_MONO, fontSize: 13, color: COLORS.faint }}>読み込み中…</div>
            ) : detailError ? (
              <div style={{ color: COLORS.stamp, fontSize: 13 }}>{detailError}</div>
            ) : (
              detail && (
                <PublicItemDetail
                  type={tab}
                  item={detail}
                  onBack={() => goToTab(tab)}
                  onAuthorClick={(ownerId) => navigate({ name: 'user', userId: ownerId })}
                />
              )
            ))}
        </>
      )}
    </div>
  );
}
```

> `PublicItemDetail` の `onBack` は残す。パンくずが主導線だが、詳細本文の末尾から戻る導線も従来どおり機能させるため。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/screens/Gallery.test.jsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/screens/Gallery.jsx src/screens/Gallery.test.jsx
git commit -m "refactor(gallery): タブと詳細をURL駆動にし閉じる/戻るを撤去する"
```

---

## Task 13: 記録タブ（エンディング図鑑・実績）

2画面を「記録」タブ配下の内部タブでつなぐ。共通のタブ列をコンポーネントに切り出し、両画面で使う。

**Files:**
- Create: `src/components/nav/RecordsTabs.jsx`
- Create: `src/components/nav/RecordsTabs.test.jsx`
- Modify: `src/screens/EndingGallery.jsx`
- Modify: `src/screens/AchievementList.jsx`
- Modify: `src/screens/EndingGallery.test.jsx`
- Modify: `src/screens/AchievementList.test.jsx`

**Interfaces:**
- Consumes: Task 3 の `navigate`
- Produces:
  - `RecordsTabs({ active: 'endings' | 'achievements' })`
  - `EndingGallery()` — props なし
  - `AchievementList()` — props なし

- [ ] **Step 1: 失敗するテストを書く**

`src/components/nav/RecordsTabs.test.jsx`:

```jsx
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RecordsTabs from './RecordsTabs.jsx';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('RecordsTabs', () => {
  it('renders both records destinations', () => {
    render(<RecordsTabs active="endings" />);
    expect(screen.getByRole('button', { name: 'エンディング図鑑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '実績' })).toBeInTheDocument();
  });

  it('marks the active tab', () => {
    render(<RecordsTabs active="achievements" />);
    expect(screen.getByRole('button', { name: '実績' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'エンディング図鑑' })).not.toHaveAttribute('aria-current');
  });

  it('navigates to the other records route', () => {
    render(<RecordsTabs active="endings" />);
    fireEvent.click(screen.getByRole('button', { name: '実績' }));
    expect(window.location.hash).toBe('#/records/achievements');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/nav/RecordsTabs.test.jsx`
Expected: FAIL — `Failed to resolve import "./RecordsTabs.jsx"`

- [ ] **Step 3: RecordsTabs を実装する**

`src/components/nav/RecordsTabs.jsx`:

```jsx
import { navigate } from '../../navigation/useRoute.js';
import { COLORS, F_MONO } from '../../theme.js';

// 「記録」タブ配下の内部タブ。Library / Gallery のタブ列と同じ見た目に揃える。
const TABS = [
  { key: 'endings', label: 'エンディング図鑑' },
  { key: 'achievements', label: '実績' },
];

export default function RecordsTabs({ active }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => navigate({ name: 'records', recordsTab: t.key })}
            aria-current={isActive ? 'page' : undefined}
            style={{
              minHeight: 44,
              padding: '6px 14px',
              borderRadius: 3,
              cursor: 'pointer',
              fontFamily: F_MONO,
              fontSize: 12,
              background: isActive ? COLORS.ink : 'transparent',
              color: isActive ? COLORS.paper : COLORS.faint,
              fontWeight: isActive ? 600 : 400,
              border: `1px solid ${isActive ? COLORS.ink : COLORS.line}`,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: RecordsTabs のテストが通ることを確認する**

Run: `npx vitest run src/components/nav/RecordsTabs.test.jsx`
Expected: PASS（3 tests）

- [ ] **Step 5: 2画面を記録タブに載せる**

`src/screens/EndingGallery.jsx`:

- `import { navigateToAchievements } from '../router/useHashRoute.js';`（`EndingGallery.jsx:12`）を削除し、代わりに追加する:

```jsx
import RecordsTabs from '../components/nav/RecordsTabs.jsx';
import { navigate } from '../navigation/useRoute.js';
```

- シグネチャから `onClose` を外す:

```jsx
export default function EndingGallery() {
```

- ヘッダー行（`EndingGallery.jsx:88-93`）から `ホームへ` ボタン（`onClose`）を削除し、見出しを単独にしたうえで、その直前に `<RecordsTabs active="endings" />` を置く:

```jsx
      <RecordsTabs active="endings" />
      <h1 style={{ fontFamily: F_DISPLAY, fontSize: 28, color: COLORS.ink, letterSpacing: 1, marginBottom: 24 }}>
        エンディング図鑑
      </h1>
```

- 実績サマリー内の `すべて見る →`（`EndingGallery.jsx:113`）は、実績の進捗という文脈からの深いリンクでありグローバルナビの重複ではないため**残す**。ハンドラだけ差し替える:

```jsx
            <Button
              variant="ghost"
              onClick={() => navigate({ name: 'records', recordsTab: 'achievements' })}
              style={{ fontSize: 12, padding: '6px 10px' }}
            >
              すべて見る →
            </Button>
```

`src/screens/AchievementList.jsx`:

- `import { navigateToEndings } from '../router/useHashRoute.js';` を削除し、代わりに追加する:

```jsx
import RecordsTabs from '../components/nav/RecordsTabs.jsx';
```

- シグネチャから `onClose` を外す:

```jsx
export default function AchievementList() {
```

- ヘッダー行（`AchievementList.jsx:94-104`）から `図鑑へ`（`navigateToEndings`）と `ホームへ`（`onClose`）の**両方**を削除する。どちらも `RecordsTabs` とグローバルナビが担う。見出しを単独にし、その直前に `<RecordsTabs active="achievements" />` を置く:

```jsx
      <RecordsTabs active="achievements" />
      <h1 style={{ fontFamily: F_DISPLAY, fontSize: 28, color: COLORS.ink, letterSpacing: 1, marginBottom: 24 }}>
        実績
      </h1>
```

- [ ] **Step 6: 2画面のテストを更新する**

`src/screens/EndingGallery.test.jsx` と `src/screens/AchievementList.test.jsx` で、`onClose` を渡している描画をすべて props なしに変え、`onClose` が呼ばれることを検証しているテストを次に置き換える。

`EndingGallery.test.jsx`:

```jsx
  it('offers a tab across to the achievements screen', async () => {
    renderWithAuth(<EndingGallery />);
    fireEvent.click(await screen.findByRole('button', { name: '実績' }));
    expect(window.location.hash).toBe('#/records/achievements');
    window.history.replaceState(null, '', window.location.pathname);
  });
```

`AchievementList.test.jsx`:

```jsx
  it('offers a tab across to the ending gallery', async () => {
    renderWithAuth(<AchievementList />);
    fireEvent.click(await screen.findByRole('button', { name: 'エンディング図鑑' }));
    expect(window.location.hash).toBe('#/records/endings');
    window.history.replaceState(null, '', window.location.pathname);
  });
```

- [ ] **Step 7: テストが通ることを確認する**

Run: `npx vitest run src/screens/EndingGallery.test.jsx src/screens/AchievementList.test.jsx src/components/nav/RecordsTabs.test.jsx`
Expected: PASS

- [ ] **Step 8: コミット**

```bash
git add src/components/nav/RecordsTabs.jsx src/components/nav/RecordsTabs.test.jsx src/screens/EndingGallery.jsx src/screens/EndingGallery.test.jsx src/screens/AchievementList.jsx src/screens/AchievementList.test.jsx
git commit -m "refactor(records): エンディング図鑑と実績を記録タブへ統合する"
```

---

## Task 14: ユーザーページ

**Files:**
- Modify: `src/screens/UserPage.jsx`
- Modify: `src/screens/UserPage.test.jsx`

**Interfaces:**
- Consumes: Task 4 の `useBreadcrumbLabel`
- Produces: `UserPage({ userId })` — 変更なし（内部の `clearHash` 依存のみ除去）

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/UserPage.test.jsx` に追加する:

```jsx
  it('no longer renders its own back buttons', async () => {
    vi.spyOn(shareClient, 'getUserProfile').mockResolvedValue({
      id: 'usr_1',
      displayName: 'Xavier',
      avatarUrl: null,
      bio: '',
    });
    vi.spyOn(shareClient, 'listPublic').mockResolvedValue({ items: [], total: 0, hasMore: false });

    renderWithAuth(<UserPage userId="usr_1" />);
    expect(await screen.findByText('Xavier')).toBeInTheDocument();
    expect(screen.queryByText('← 戻る')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/screens/UserPage.test.jsx`
Expected: FAIL — `← 戻る` がまだ存在する

- [ ] **Step 3: 実装する**

`src/screens/UserPage.jsx`:

- `clearHash` の import を削除し、代わりに追加する:

```jsx
import { useBreadcrumbLabel } from '../navigation/BreadcrumbContext.jsx';
```

- コンポーネント本体の冒頭（`profile` state 宣言の後）にパンくず登録を追加する:

```jsx
  // パンくず末尾に表示名を出す。プロフィール取得前は登録しない(IDを露出させないため)。
  useBreadcrumbLabel(profile ? profile.displayName : null);
```

- `← 戻る` を持つ3箇所（`UserPage.jsx:100-103`、`:110-114`、`:171-175` 付近）の `<Button variant="ghost" onClick={clearHash}>← 戻る</Button>` をすべて削除する。パンくずの「ホーム」が担う。
- `← 一覧に戻る`（`:208`、`:215` 付近）はユーザーページ内の一覧⇄詳細の切り替えでありグローバルな戻りではないため、**そのまま残す**。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/screens/UserPage.test.jsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/screens/UserPage.jsx src/screens/UserPage.test.jsx
git commit -m "refactor(user): 独自の戻るを撤去し表示名をパンくずへ登録する"
```

---

## Task 15: プレイ画面

**Files:**
- Modify: `src/screens/Play.jsx`
- Modify: `src/screens/Play.test.jsx`

**Interfaces:**
- Consumes: Task 7 の `FocusHeader`、Task 3 の `navigateHash`
- Produces: `Play({ session, setSession })` — `onExit` を廃止

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Play.test.jsx` の描画箇所から `onExit` を外し、次を追加する:

```jsx
  it('exits to home through the focus header', async () => {
    renderWithAuth(<Play session={makeSession()} setSession={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'ホーム' }));
    expect(window.location.hash).toBe('#/');
    window.history.replaceState(null, '', window.location.pathname);
  });
```

（`makeSession()` は当該テストファイルに既にあるセッション生成ヘルパを使う。無ければファイル内で既存テストが `<Play session={...}>` に渡しているオブジェクトをそのまま使う）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: FAIL — ボタン名が `← ホーム` のため `ホーム` で引けない

- [ ] **Step 3: 実装する**

`src/screens/Play.jsx`:

- import に追加する:

```jsx
import FocusHeader, { FOCUS_HEADER_HEIGHT } from '../components/nav/FocusHeader.jsx';
```

- シグネチャから `onExit` を外す:

```jsx
export default function Play({ session, setSession }) {
```

- `Play.jsx:283` 付近の `<Button variant="ghost" onClick={onExit} ...>← ホーム</Button>` を削除する。既存のヘッダー行より前に `FocusHeader` を置く:

```jsx
      <FocusHeader title={session.title || 'プレイ中'} />
```

- 既存のヘッダー行(スティッキーの完結バッジ/シーン/経験値/PC/挿絵設定の帯)は `FocusHeader` と同じ `session.title` をもう出さない。タイトルと離脱導線は `FocusHeader` 側だけの責務にし、この帯はセッションの文脈情報(完結バッジ・シーン・経験値・PC・挿絵設定)だけを出す帯にする。
- この帯の `top: 0` は `top: FOCUS_HEADER_HEIGHT` に変える。`FocusHeader` が画面最上部に sticky するようになったため、この帯はその直下に貼り付く必要がある。
- この帯の `margin: '-24px -20px 16px'` は `margin: '0 -20px 16px'` に変える。`-24px` の上マージンは、この帯が親コンテナ(`padding: '24px 20px 140px'`)の最初の子だった頃にその上パディングを打ち消すためのものだった。今は `FocusHeader` が先に来るため、そのままだと帯が `FocusHeader` の上に重なってしまう。横方向の `-20px` (フルブリード)はそのまま残す。
- タイトルを取り除いたことで、隣にいた完結バッジが空のflexコンテナに取り残されないよう、バッジをシーン/経験値のメタ情報と同じ行にまとめる。

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "refactor(play): 離脱導線をFocusHeaderへ統合する"
```

---

## Task 16: セットアップウィザード

ウィザード内の `戻る`（1ステップ戻す）と、ウィザード自体からの離脱は意味が異なる。前者はフッターに残し、後者を `FocusHeader` に移す。

**Files:**
- Modify: `src/screens/Setup.jsx`
- Modify: `src/screens/Setup.test.jsx`
- Modify: `src/App.test.jsx`

**Interfaces:**
- Consumes: Task 7 の `FocusHeader`、Task 3 の `navigateHash`
- Produces: `Setup({ onStart, campaignContext, starterContext })` — `onCancel` を廃止

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Setup.test.jsx` の描画箇所から `onCancel` を外し、次を追加する:

```jsx
  it('shows every wizard step in the focus header and marks the current one', () => {
    render(<Setup onStart={() => {}} />);
    for (const s of ['世界観', 'シナリオ', 'ルール', 'PC', '確認']) {
      expect(screen.getByText(s)).toBeInTheDocument();
    }
    expect(screen.getByText('世界観')).toHaveAttribute('aria-current', 'step');
  });

  it('leaves the wizard through the focus header, from any step', () => {
    render(<Setup onStart={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(window.location.hash).toBe('#/');
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('keeps the footer back button as a step-level control', () => {
    render(<Setup onStart={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(screen.getByText('シナリオ')).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.getByText('世界観')).toHaveAttribute('aria-current', 'step');
  });
```

`src/App.test.jsx` の `does not carry a previously imported starter pack...` 2件（`+ 新規プレイ` 版と `次の章へ` 版）は、ウィザード離脱の手順が変わるため書き換える。いまは離脱ボタンが無いので `act(() => navigate({ name: 'home' }));` で URL を直接戻しているが、それを `やめる` の1クリックに置き換える:

```jsx
    // ウィザードを離脱する(FocusHeaderの「やめる」はどのステップからでも押せる)。
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(await findHome()).toBeInTheDocument();
```

`GM's Desk` は `AppShell` が全ブラウジング画面のヘッダーにボタンとして出すため、
`getByText("GM's Desk")` ではホームに戻れたことを示せない。`src/App.test.jsx` が既に持つ
`findHome()`（`screen.findByRole('heading', { name: "GM's Desk" })`）でホーム本文の見出しを見る。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "やめる"`（0段目以外では出ない、かつステップ表示に `aria-current` が無い）

- [ ] **Step 3: 実装する**

`src/screens/Setup.jsx`:

- import に追加する:

```jsx
import FocusHeader from '../components/nav/FocusHeader.jsx';
import { navigateHash } from '../navigation/useRoute.js';
```

- シグネチャから `onCancel` を外す:

```jsx
export default function Setup({ onStart, campaignContext = null, starterContext = null }) {
```

- 画面の最上部（既存の外側 `<div>` の先頭）に `FocusHeader` を置く。`steps` は既存の `const steps = ['世界観', 'シナリオ', 'ルール', 'PC', '確認'];`（`Setup.jsx:78`）をそのまま渡す:

```jsx
      <FocusHeader
        title="新規プレイ"
        steps={steps}
        currentStep={step}
        exitLabel="やめる"
        onExit={() => navigateHash('#/')}
      />
```

- 既存のステップ表示バー（`Setup.jsx:338` の `{steps.map((s, i) => (` から始まるブロックと、それを包む `<div>`）は `FocusHeader` のステップ表示と重複するため削除する。
- フッターのボタン（`Setup.jsx:656-658`）を、ステップ移動専用に変える。0段目では戻り先が無いため無効化する:

```jsx
        <Button
          variant="ghost"
          onClick={() => setStep(step - 1)}
          disabled={busy || step === 0}
        >
          戻る
        </Button>
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/screens/Setup.test.jsx src/App.test.jsx`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/screens/Setup.jsx src/screens/Setup.test.jsx src/App.test.jsx
git commit -m "refactor(setup): 離脱をFocusHeaderへ移しフッターをステップ操作に限定する"
```

---

## Task 17: 旧ルータの削除と全体検証

**Files:**
- Delete: `src/router/useHashRoute.js`
- Delete: `src/router/useHashRoute.test.jsx`
- Modify: `src/screens/Home.jsx`

**Interfaces:**
- Consumes: Task 1〜16 のすべて
- Produces: なし（クリーンアップ）

- [ ] **Step 1: 旧ルータへの参照が残っていないか調べる**

Run: `grep -rn "useHashRoute\|navigateToUser\|navigateToEndings\|navigateToAchievements\|clearHash" src`
Expected: `src/router/useHashRoute.js`、`src/router/useHashRoute.test.jsx`、および `src/screens/Home.jsx` のみ

- [ ] **Step 2: Home からエンディング図鑑ボタンを外す**

`src/screens/Home.jsx`:

- `import { navigateToEndings } from '../router/useHashRoute.js';`（`Home.jsx:25`）を削除する。
- `Home.jsx:702-715` のボタン列から、`素材ライブラリ` / `公開ギャラリー` / `エンディング図鑑` の3ボタンを削除する。これらはグローバルナビが担う。`+ 新規プレイ` のみを残す:

```jsx
      <div style={{ display: 'flex', gap: 10, marginBottom: user ? 32 : 8 }}>
        <Button variant="brass" onClick={onNew} disabled={!user}>
          + 新規プレイ
        </Button>
      </div>
```

- `Home` のシグネチャ（`Home.jsx:83`）から使われなくなった props を外す:

```jsx
export default function Home({ sessions, storageOk, onNew, onContinue, onNextChapter, onStartStarter }) {
```

- [ ] **Step 3: Home のテストを更新する**

`src/screens/Home.test.jsx` で `onOpenLibrary` / `onOpenGallery` を渡している箇所と、それらが呼ばれることを検証しているテストを削除する。次のテストを追加する:

```jsx
  it('no longer duplicates the global nav destinations in its body', async () => {
    renderWithAuth(
      <Home sessions={[]} storageOk onNew={() => {}} onContinue={() => {}} />
    );
    expect(await screen.findByText('+ 新規プレイ')).toBeInTheDocument();
    expect(screen.queryByText('素材ライブラリ')).not.toBeInTheDocument();
    expect(screen.queryByText('公開ギャラリー')).not.toBeInTheDocument();
    expect(screen.queryByText('エンディング図鑑')).not.toBeInTheDocument();
  });
```

- [ ] **Step 4: 旧ルータを削除する**

```bash
git rm src/router/useHashRoute.js src/router/useHashRoute.test.jsx
```

- [ ] **Step 5: 参照が残っていないことを確認する**

Run: `grep -rn "router/useHashRoute" src`
Expected: 出力なし（終了コード 1）

- [ ] **Step 6: 全テストを実行する**

Run: `npm test`
Expected: 全ファイル PASS。失敗が残る場合は、そのファイルを対象タスクへ戻して修正する

- [ ] **Step 7: ビルドが通ることを確認する**

Run: `npm run build`
Expected: `built in ...` で終了。エラーなし

- [ ] **Step 8: 実ブラウザで成功条件を確認する**

`npm run dev` を起動し（`.claude/launch.json` の `dev` 設定）、`http://localhost:5173` で次を順に確認する。

1. 4タブ（ホーム／素材／さがす／記録）がどの画面でも同じ位置に出る
2. `素材` → `Character` → World 選択 と進み、パンくずが `ホーム › 素材 › Character › <World名>` になる
3. ブラウザの「戻る」で1段ずつ戻れる
4. その URL をリロードしても同じ場所に留まる
5. `#/endings` を直接開くと `#/records/endings` へ書き換わる
6. `#/nope` を直接開くとホームへ落ちる
7. プレイ中・ウィザード中はグローバルナビが消え、`← ホーム` / `← やめる` と現在地だけが出る
8. ウィンドウ幅を 768px 未満にすると、ナビが下部タブバーへ移る

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "refactor(nav): 旧hashルータを削除しHomeの重複導線を整理する"
```

---

## Self-Review

**1. Spec coverage**

| 設計書の要求 | 対応タスク |
|---|---|
| 全画面を hash route に統一 | Task 1, 3, 10 |
| 正規化・旧 URL リダイレクト・未知 hash のフォールバック | Task 1（parse/build）, Task 3（replace） |
| 4タブ ＋ アカウントメニュー | Task 5, 8, 9 |
| 集中モード（Play / Setup） | Task 2（`isFocusRoute`）, 7, 9, 15, 16 |
| パンくず（URL 由来 ＋ 動的ラベル） | Task 2, 4, 6, 11, 12, 14 |
| `AuthBar` の `position: fixed` 廃止 | Task 8 |
| 画面ごとの「閉じる／戻る」全廃 | Task 11, 12, 13, 14, 15, 16 |
| `lucide-react` 導入 | Task 5 |
| 未ログインでもナビ項目を消さない | Task 5（テスト）, 11（案内文言を維持） |
| Setup コンテキストは URL に載せない | Task 10 |
| `#/play/:sessionId` のリロード復元・失敗時のフォールバック | Task 10 |
| Library の `worldId` を URL へ | Task 1, 11 |
| 記録タブ内部タブ | Task 13 |
| `ErrorBoundary` をナビの内側・コンテンツの外側へ | Task 9 |
| a11y（`<nav>`, `aria-current`, 44px, 色以外の区別, `<button>` 化, スキップリンク） | Task 5, 6, 7, 9, 11, 12, 13 |
| 成功条件の実機確認 | Task 17 Step 8 |

未対応の要求は無い。

**2. Placeholder scan**

「TBD」「後で実装」「Task N と同様」「適切なエラー処理を追加」に類する記述は無い。コードを変更する全ステップに実際のコードを載せている。

**3. Type consistency**

- `Route` の各バリアントのフィールド名（`libraryTab` / `worldId` / `browseTab` / `publicId` / `recordsTab` / `userId` / `sessionId`）は Task 1 の定義と Task 2・3・9〜16 の利用箇所で一致している。
- `navigateHash(hash: string)` と `navigate(route: Route)` の使い分けは、Task 3 で定義したとおり Task 5・6（`hash` を持つデータからの遷移）と Task 11〜16（route を組み立てる遷移）で守られている。
- `useBreadcrumbLabel(label)` は Task 4 の定義どおり、Task 11・12・14 で `string | null` を渡している。
- `GlobalNav` の props は Task 5 で `{ activeTab }`、Task 9 の利用箇所も `activeTab={navTabFor(route)}` で一致。
- `FocusHeader` の props は Task 7 で定義した `{ title, steps, currentStep, exitLabel, onExit }` を、Task 15（`title` のみ）と Task 16（全部）が部分適用しており矛盾は無い。

**4. 補足（実装者向けの注意）**

Task 10 の時点では各画面がまだ旧 props を受け取るため、`npm test` 全体は一時的に赤くなる。これは意図した中間状態で、Task 16 の終わりに緑へ戻り、Task 17 Step 6 で全体を確認する。各タスクの Step は自タスクのテストファイルのみを対象に実行すること。
