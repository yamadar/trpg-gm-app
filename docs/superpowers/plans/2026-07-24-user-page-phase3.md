# ユーザーページ (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 共有可能なハッシュURL(`#/u/{userId}`)を持つ公開ユーザーページ(bio付きプロフィール + そのユーザーの公開物一覧)を実装する。

**Architecture:** ユーザーモデルに `bio` を追加し、認証不要の公開プロフィール/公開物一覧APIを既存 `publicContent` ルーターに追加(配線変更不要 — 既にrequireAuth前にマウント済み)。クライアントは自作の軽量ハッシュルーターフックで `#/u/{userId}` を検出して `UserPage` を表示。Galleryの公開詳細+インポートUIを共有コンポーネント `PublicItemDetail` に抽出し両画面で使う。

**Tech Stack:** 既存スタックのみ(Express / React / vitest / supertest)。新規依存なし。

**Spec:** `docs/superpowers/specs/2026-07-24-user-page-phase3-design.md`

## Global Constraints

- ハッシュURL形式は `#/u/{userId}`。userIdは既存ID文字集合(`[A-Za-z0-9._-]`)。マッチしなければ通常画面
- 公開プロフィールAPIが返すのは `{ id, displayName, avatarUrl, bio }` **のみ**(`createdAt`/`updatedAt` は露出しない)。未知ユーザーは404
- `GET /api/users/:userId/public` は各typeの `listPublic` を `ownerId === userId` でフィルタ(publishedAt降順維持)。他ユーザーの公開物が混ざらないこと
- 両APIは**認証不要**(既存publicContentルーターに追加 = requireAuthの前)
- `bio`: 文字列、trim後500字まで、**空文字OK**。型不正・超過は400。既存ユーザーは読み出し時 `bio ?? ''` 補完(マイグレーションなし)
- `clearHash` は `history.pushState` でハッシュ除去後、`hashchange` イベントを手動dispatchする(pushStateは発火しないため)
- PublicItemDetail抽出はGalleryの**挙動を変えない**(既存Galleryテストが通ること)。`onAuthorClick` はオプショナル(渡された時だけ作者名をリンク化。UserPageは渡さない)
- 新規依存なし。UI文言は日本語。サーバーテストは node環境 + supertest、クライアントは renderWithAuth + fireEvent
- コミットは各タスク末尾、既存の `feat:`/`docs:` 規約

## 実行前の注意

- 前提: Phase 2 マージ済みの `main`(`415a7f6` 以降)から作業ブランチを切る
- 受け入れ: 全タスク完了後 `npx vitest run` 全パス

---

### Task 1: ユーザーモデルに bio 追加 + PATCH /api/me 対応

**Files:**
- Modify: `server/auth/users.js`(findOrCreateUser / getUser)
- Modify: `server/auth/routes.js`(PATCH /api/me ハンドラ)
- Test: `server/auth/users.test.js` / `server/auth/routes.test.js` 追記

**Interfaces:**
- Produces: Userオブジェクトに `bio: string`(既定 `''`)。`getUser` は常に `bio` を文字列で返す(古いレコードは `''` 補完)。`PATCH /api/me` が `{ bio?: string }` を受け付ける(trim・500字上限・空OK)

- [ ] **Step 1: 失敗するテストを追記**

`server/auth/users.test.js`:

```js
it('creates users with an empty bio by default', async () => {
  const user = await findOrCreateUser(dataStore, profile);
  expect(user.bio).toBe('');
});

it('getUser backfills bio for records saved before the field existed', async () => {
  const user = await findOrCreateUser(dataStore, profile);
  // bioフィールドを持たない旧レコードを直接書き戻す
  const raw = await dataStore.get(userProfileKey(user.id));
  delete raw.bio;
  await dataStore.set(userProfileKey(user.id), raw);
  expect((await getUser(dataStore, user.id)).bio).toBe('');
});

it('updateUserProfile can set and clear bio', async () => {
  const user = await findOrCreateUser(dataStore, profile);
  expect((await updateUserProfile(dataStore, user.id, { bio: 'よろしく' })).bio).toBe('よろしく');
  expect((await updateUserProfile(dataStore, user.id, { bio: '' })).bio).toBe('');
});
```

(`userProfileKey` のimport追加を忘れない)

`server/auth/routes.test.js`(PATCH /api/me の節に追記):

```js
it('PATCH /api/me updates bio with trim and allows empty', async () => {
  const app = buildApp(googleFetchMock());
  const { sessionCookie } = await login(app);
  const res = await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ bio: '  自己紹介です  ' });
  expect(res.status).toBe(200);
  expect(res.body.user.bio).toBe('自己紹介です');
  const cleared = await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ bio: '' });
  expect(cleared.body.user.bio).toBe('');
});

it('PATCH /api/me validates bio', async () => {
  const app = buildApp(googleFetchMock());
  const { sessionCookie } = await login(app);
  expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ bio: 123 })).status).toBe(400);
  expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ bio: 'あ'.repeat(501) })).status).toBe(400);
  expect((await request(app).patch('/api/me').set('Cookie', sessionCookie).send({ bio: 'あ'.repeat(500) })).status).toBe(200);
});
```

- [ ] **Step 2: RED確認** — Run: `npx vitest run server/auth/users.test.js server/auth/routes.test.js` / Expected: FAIL(新ケースのみ)
- [ ] **Step 3: 実装**

`server/auth/users.js`:
- `findOrCreateUser` の新規userオブジェクトに `bio: ''` を追加(`avatarUrl` の次)
- `getUser` を補完形に:

```js
export async function getUser(dataStore, userId) {
  const user = await dataStore.get(userProfileKey(userId));
  if (!user) return null;
  return { ...user, bio: user.bio ?? '' };
}
```

`server/auth/routes.js` の PATCH /api/me — `avatarUrl` ブロックの後に追加:

```js
if ('bio' in req.body) {
  const bio = typeof req.body.bio === 'string' ? req.body.bio.trim() : null;
  if (bio === null || bio.length > 500) {
    res.status(400).json({ error: 'bio must be a string of at most 500 characters' });
    return;
  }
  patch.bio = bio;
}
```

- [ ] **Step 4: GREEN確認** — Run: `npx vitest run server/auth/` / Expected: 全PASS
- [ ] **Step 5: Commit**

```bash
git add server/auth/users.js server/auth/users.test.js server/auth/routes.js server/auth/routes.test.js
git commit -m "feat(auth): ユーザーモデルにbio(自己紹介文)を追加"
```

---

### Task 2: 公開ユーザーAPI(プロフィール + 公開物一覧)

**Files:**
- Modify: `server/routes/publicContent.js`(2ルート追加)
- Test: `server/routes/publicContent.test.js` / `server/index.test.js` 追記

**Interfaces:**
- Consumes: Task 1の `getUser`(bio補完済み)、既存 `listPublic`
- Produces:
  - `GET /users/:userId` → `200 { id, displayName, avatarUrl, bio }` / 404
  - `GET /users/:userId/public` → `200 { worlds, characters, scenarios, novels }`(各配列、ownerIdフィルタ済み・publishedAt降順) / 404

- [ ] **Step 1: 失敗するテストを追記**

`server/routes/publicContent.test.js`(認証スタブなしのまま):

```js
describe('public user profile', () => {
  it('returns only the public profile fields', async () => {
    const user = await findOrCreateUser(dataStore, { provider: 'google', providerUserId: '111', displayName: '太郎', avatarUrl: null });
    await updateUserProfile(dataStore, user.id, { bio: 'よろしく' });
    const res = await request(app).get(`/api/users/${user.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: user.id, displayName: '太郎', avatarUrl: null, bio: 'よろしく' });
  });

  it('404 for an unknown user', async () => {
    expect((await request(app).get('/api/users/usr_nothere')).status).toBe(404);
    expect((await request(app).get('/api/users/usr_nothere/public')).status).toBe(404);
  });

  it('rejects a malformed userId', async () => {
    expect((await request(app).get('/api/users/..evil')).status).toBe(400);
  });

  it('lists only the given user\'s public items grouped by type', async () => {
    // ユーザーA・Bを作成、それぞれworldを公開(publishWorldで実データseed)
    // GET /api/users/{A}/public → worlds配列にAのだけ、novels等は空配列
  });
});
```

`server/index.test.js` に統合テスト追記:

```js
it('serves public user profile without auth', async () => {
  const { user } = await createTestUserSession(app.locals.dataStore);
  expect((await request(app).get(`/api/users/${user.id}`)).status).toBe(200);
  expect((await request(app).get(`/api/users/${user.id}/public`)).status).toBe(200);
});
```

- [ ] **Step 2: RED確認** — Run: `npx vitest run server/routes/publicContent.test.js`
- [ ] **Step 3: 実装** — `publicContent.js` に追加(importに `getUser` を追加):

```js
import { getUser } from '../auth/users.js';
// createPublicContentRouter内、既存2ルートの後:
router.param('userId', idParamGuard);

router.get('/users/:userId', asyncHandler(async (req, res) => {
  const user = await getUser(dataStore, req.params.userId);
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  res.json({ id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl, bio: user.bio });
}));

router.get('/users/:userId/public', asyncHandler(async (req, res) => {
  const user = await getUser(dataStore, req.params.userId);
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  const result = {};
  for (const type of TYPES) {
    result[type] = (await listPublic(dataStore, type)).filter((m) => m.ownerId === req.params.userId);
  }
  res.json(result);
}));
```

- [ ] **Step 4: GREEN確認** — Run: `npx vitest run server/routes/publicContent.test.js server/index.test.js` → PASS。`npx vitest run server/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add server/routes/publicContent.js server/routes/publicContent.test.js server/index.test.js
git commit -m "feat(routes): 公開ユーザープロフィール/公開物一覧API(認証不要)"
```

---

### Task 3: ハッシュルーターフック useHashRoute

**Files:**
- Create: `src/router/useHashRoute.js`
- Test: `src/router/useHashRoute.test.jsx`

**Interfaces:**
- Produces: `parseHash(hash): { userId: string|null }` / `useHashRoute(): { userId }` / `navigateToUser(userId): void` / `clearHash(): void`

- [ ] **Step 1: 失敗するテストを書く**

```jsx
// src/router/useHashRoute.test.jsx
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { parseHash, useHashRoute, navigateToUser, clearHash } from './useHashRoute.js';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('parseHash', () => {
  it('parses a user hash', () => {
    expect(parseHash('#/u/usr_ab12')).toEqual({ userId: 'usr_ab12' });
  });
  it('returns null for empty, unknown or malformed hashes', () => {
    expect(parseHash('')).toEqual({ userId: null });
    expect(parseHash('#/other')).toEqual({ userId: null });
    expect(parseHash('#/u/')).toEqual({ userId: null });
    expect(parseHash('#/u/../evil')).toEqual({ userId: null });
  });
});

describe('useHashRoute', () => {
  it('reflects the current hash and follows hashchange', () => {
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.userId).toBeNull();
    act(() => navigateToUser('usr_1'));
    expect(result.current.userId).toBe('usr_1');
  });

  it('clearHash removes the hash and notifies subscribers', () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => navigateToUser('usr_1'));
    expect(result.current.userId).toBe('usr_1');
    act(() => clearHash());
    expect(result.current.userId).toBeNull();
    expect(window.location.hash).toBe('');
  });
});
```

(jsdomで `location.hash` 代入が `hashchange` を同期発火しない場合は、`navigateToUser` 実装側で手動dispatchするため通る — Step 3参照)

- [ ] **Step 2: RED確認** — Run: `npx vitest run src/router/useHashRoute.test.jsx`
- [ ] **Step 3: 実装**

```js
// src/router/useHashRoute.js
import { useEffect, useState } from 'react';

const USER_HASH_RE = /^#\/u\/([A-Za-z0-9._-]+)$/;

export function parseHash(hash) {
  const m = USER_HASH_RE.exec(hash || '');
  return { userId: m ? m[1] : null };
}

function notify() {
  window.dispatchEvent(new Event('hashchange'));
}

export function navigateToUser(userId) {
  window.location.hash = `#/u/${userId}`;
  notify(); // jsdom/一部環境ではhash代入がイベントを発火しないため明示的に通知
}

export function clearHash() {
  // pushState/replaceStateはhashchangeを発火しないため、除去後に手動通知する
  window.history.pushState(null, '', window.location.pathname + window.location.search);
  notify();
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
```

(注: 実ブラウザでは `location.hash` 代入もhashchangeを発火するため `notify()` は二重発火になるが、`setRoute` は同値なら再レンダリングしないので無害)

- [ ] **Step 4: GREEN確認** — Run: `npx vitest run src/router/useHashRoute.test.jsx` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/router/useHashRoute.js src/router/useHashRoute.test.jsx
git commit -m "feat(router): ハッシュルーティング(#/u/{userId})フック"
```

---

### Task 4: shareClient にユーザーAPI追加

**Files:**
- Modify: `src/api/shareClient.js`(末尾に2関数追加)
- Test: `src/api/shareClient.test.js` 追記

**Interfaces:**
- Produces: `getUserProfile(userId)` → GET `/api/users/{userId}`、`getUserPublicItems(userId)` → GET `/api/users/{userId}/public`(いずれも `apiFetch` 利用・`encodeURIComponent` 適用)

- [ ] **Step 1: 失敗するテストを追記**(既存のstubスタイルで)

```js
it('getUserProfile GETs /api/users/{id}', async () => {
  const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'usr_1' }) });
  vi.stubGlobal('fetch', f);
  expect(await getUserProfile('usr_1')).toEqual({ id: 'usr_1' });
  expect(f.mock.calls[0][0]).toBe('/api/users/usr_1');
});

it('getUserPublicItems GETs /api/users/{id}/public', async () => {
  const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ worlds: [] }) });
  vi.stubGlobal('fetch', f);
  await getUserPublicItems('usr_1');
  expect(f.mock.calls[0][0]).toBe('/api/users/usr_1/public');
});
```

- [ ] **Step 2: RED確認** — Run: `npx vitest run src/api/shareClient.test.js`
- [ ] **Step 3: 実装**

```js
export async function getUserProfile(userId) {
  return apiFetch(`/api/users/${encodeURIComponent(userId)}`);
}

export async function getUserPublicItems(userId) {
  return apiFetch(`/api/users/${encodeURIComponent(userId)}/public`);
}
```

- [ ] **Step 4: GREEN確認** — `npx vitest run src/api/` → 全PASS
- [ ] **Step 5: Commit**

```bash
git add src/api/shareClient.js src/api/shareClient.test.js
git commit -m "feat(client): 公開ユーザープロフィール/公開物一覧クライアント"
```

---

### Task 5: PublicItemDetail 抽出(Galleryリファクタ、挙動不変)

**Files:**
- Create: `src/components/share/PublicItemDetail.jsx`
- Modify: `src/screens/Gallery.jsx`(詳細表示+インポートUIを抽出先の利用に置換)
- Test: `src/components/share/PublicItemDetail.test.jsx`(新規)、`src/screens/Gallery.test.jsx`(**既存テストは変更せず全て通ること** — 挙動不変の証明)

**実装前に読む**: `src/screens/Gallery.jsx` 全体(detail/viewMode/adding/picker系のstateとhandler、`metaLine`)、`src/screens/Gallery.test.jsx`

**Interfaces:**
- Produces: `PublicItemDetail({ type, item, onBack, onAuthorClick })`
  - `type`: 'novels'|'worlds'|'characters'|'scenarios'、`item`: `getPublic` の返す詳細(raw、worldsはregions/categories入り)
  - 内部で `useAuth` を使い、Galleryの現詳細ビューと同一の表示・インポート挙動(ライブラリに追加/行き先ピッカー/未ログイン案内/成功・失敗メッセージ/小説は追加なし)を持つ
  - `onAuthorClick?: (ownerId) => void` — 渡された場合のみ作者名をクリック可能なリンク風表示にする(このタスクでは実装のみ。Galleryから渡すのはTask 7)
  - `publicMetaLine(item): string` も同ファイルからexport(作者名・日付文字列。Gallery一覧カードでも使用し重複を解消)
- Gallery側: 一覧・詳細フェッチ(`openDetail`)・タブはGalleryに残し、`viewMode === 'detail'` のレンダリングを `<PublicItemDetail type={tab} item={detail} onBack={backToList} />` に置換。import系state/handler(adding/picker等)はPublicItemDetailへ移動

- [ ] **Step 1: PublicItemDetail.test.jsx を書く**(Galleryの既存詳細系テストを参考に、コンポーネント単体で: 本文表示/worldsのregions見出し/未ログイン案内/worlds追加成功/ピッカー→importCharacter引数/小説は追加ボタンなし/onAuthorClick渡した時のみ作者名がbutton化)
- [ ] **Step 2: RED確認** — Run: `npx vitest run src/components/share/PublicItemDetail.test.jsx`
- [ ] **Step 3: 抽出実装** — Galleryから該当JSX/state/handlerを移動(コピーではなく移動。Gallery側から削除)。挙動・文言は一切変えない
- [ ] **Step 4: GREEN確認** — Run: `npx vitest run src/components/share/ src/screens/Gallery.test.jsx` → 全PASS(Gallery既存テスト無修正で通ることを必ず確認。通らない場合は抽出が挙動を変えている — 直すのは実装側)
- [ ] **Step 5: フルスイート** — `npx vitest run` → 全PASS
- [ ] **Step 6: Commit**

```bash
git add src/components/share/ src/screens/Gallery.jsx
git commit -m "refactor(ui): 公開詳細+インポートUIをPublicItemDetailに抽出"
```

---

### Task 6: UserPage 画面 + App 配線

**Files:**
- Create: `src/screens/UserPage.jsx`
- Modify: `src/App.jsx`(useHashRouteで最優先レンダリング)
- Test: `src/screens/UserPage.test.jsx`、`src/App.test.jsx` 追記

**実装前に読む**: `src/screens/Gallery.jsx`(抽出後のタブ/一覧パターン)、`src/components/share/PublicItemDetail.jsx`(Task 5)、`src/App.jsx`

**Interfaces:**
- Consumes: Task 3 `useHashRoute`/`clearHash`、Task 4 `getUserProfile`/`getUserPublicItems`、既存 `getPublic`(詳細フェッチ)、Task 5 `PublicItemDetail`/`publicMetaLine`
- Produces: `UserPage({ userId })` — onCloseは持たずヘッダーの「← 戻る」が `clearHash()` を呼ぶ

**挙動仕様**:
- マウント/userId変更時に `getUserProfile(userId)` と `getUserPublicItems(userId)` を並行フェッチ
- ヘッダー: アバター画像(なければ表示名頭文字の丸)+ displayName + bio(`whiteSpace: 'pre-wrap'`、空なら非表示)+「← 戻る」
- 本体: Galleryと同じ見た目の4タブ(小説/世界観/キャラクター/シナリオ、既定 小説)。データは取得済みオブジェクトからクライアント側切替。カードは `publicMetaLine` 使用
- カードクリック → `getPublic(type, publicId)` で詳細フェッチ → `<PublicItemDetail type item onBack={一覧に戻る} />`(onAuthorClickは渡さない)
- 状態: プロフィール404 → 「ユーザーが見つかりません」+ 戻るボタン / 一覧空 → 「まだ公開されたものがありません」 / ローディング / 取得失敗メッセージ
- App(AppInner): `const { userId: routeUserId } = useHashRoute();` を先頭で呼び、returnの最初で `if (routeUserId) return (<div style={既存の外枠と同じ}> <AuthBar /> <UserPage userId={routeUserId} /> </div>);`(AuthBarは出したままにする)

**テスト(要点)**: プロフィール+一覧が表示される/bio空で非表示/タブ切替でそのtypeのカードだけ/404で「ユーザーが見つかりません」/空一覧メッセージ/カードクリックでgetPublicが呼ばれ詳細表示/App: ハッシュありでUserPageがレンダリングされる(`window.location.hash='#/u/usr_x'`をセットしてrender)

- [ ] **Step 1: テストを書いてRED確認**
- [ ] **Step 2: 実装してGREEN確認** — `npx vitest run src/screens/UserPage.test.jsx src/App.test.jsx`
- [ ] **Step 3: フルスイート** — `npx vitest run` → 全PASS
- [ ] **Step 4: Commit**

```bash
git add src/screens/UserPage.jsx src/screens/UserPage.test.jsx src/App.jsx src/App.test.jsx
git commit -m "feat(ui): ユーザーページ(#/u/{userId})とApp配線"
```

---

### Task 7: 導線(Gallery作者リンク / AuthBar「自分のページ」+ bio編集)

**Files:**
- Modify: `src/screens/Gallery.jsx`(一覧カードの作者名リンク化 + PublicItemDetailへ `onAuthorClick` を渡す)
- Modify: `src/components/auth/AuthBar.jsx`(メニューに「自分のページ」、プロフィール編集にbio textarea)
- Test: `src/screens/Gallery.test.jsx` / `src/components/auth/AuthBar.test.jsx` 追記

**実装前に読む**: 抽出後の `Gallery.jsx`、`PublicItemDetail.jsx` の `onAuthorClick` 仕様(Task 5)、`AuthBar.jsx` 全体(メニュー/プロフィール編集モーダル構造、patchMe呼び出し)

**挙動仕様**:
- Gallery一覧カード: `publicMetaLine` の作者名部分をクリック可能に(`stopPropagation` してカードの詳細遷移と分離)→ `navigateToUser(item.ownerId)`。詳細側は `onAuthorClick={(ownerId) => navigateToUser(ownerId)}` を渡す
- AuthBar: ログイン中メニューに「自分のページ」項目 → `navigateToUser(user.id)` + メニューを閉じる
- AuthBarプロフィール編集モーダル: bioのtextarea(初期値 `user.bio ?? ''`、保存時は displayName と同じ流れで `patchMe({ displayName, bio })` にまとめて送る。エラー表示は既存パターン)

**テスト(要点)**: 一覧カードの作者名クリックで `location.hash` が `#/u/{ownerId}` になる(かつ詳細遷移しない)/AuthBarメニュー「自分のページ」でhashが自分のidになる/プロフィール編集でbioを入力し保存すると patchMe に bio が含まれる

- [ ] **Step 1: テスト追記 → RED確認**
- [ ] **Step 2: 実装 → GREEN確認** — `npx vitest run src/screens/Gallery.test.jsx src/components/auth/AuthBar.test.jsx`
- [ ] **Step 3: フルスイート** — `npx vitest run` → 全PASS
- [ ] **Step 4: Commit**

```bash
git add src/screens/Gallery.jsx src/screens/Gallery.test.jsx src/components/auth/AuthBar.jsx src/components/auth/AuthBar.test.jsx
git commit -m "feat(ui): ギャラリー作者リンクとAuthBarの自分のページ/bio編集"
```

---

### Task 8: ドキュメント更新と受け入れ確認

**Files:**
- Modify: `docs/04-persistence.md`(APIサーフェスに `GET /api/users/:userId`・`GET /api/users/:userId/public`(認証不要)、`PATCH /api/me` の bio を追記。ユーザーprofileのフィールドに bio 追加)
- Modify: `docs/05-ui-ux.md`(画面一覧にユーザーページ、ハッシュルーティング `#/u/{userId}` を追記)
- Modify: `docs/01-architecture.md`(該当があればユーザーページAPIを1行追記 — 実ファイルを読んで判断)

- [ ] **Step 1: 実コードと突き合わせてdocsを更新**(記述は実装に対して正確であること)
- [ ] **Step 2: 受け入れ** — Run: `npx vitest run` / Expected: 全PASS
- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "docs: ユーザーページ(公開プロフィール/ハッシュルーティング)を反映"
```

---

## 完了条件

- `npx vitest run` 全パス
- 手動確認: Galleryで作者名クリック → `#/u/{userId}` に遷移しそのユーザーの公開物だけが見える → URLをコピーして新規タブ(未ログイン)で開いても同じページが見える → AuthBarからbioを設定すると自分のページに表示される
