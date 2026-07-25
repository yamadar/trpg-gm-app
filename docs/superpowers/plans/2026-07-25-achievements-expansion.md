# 実績の拡張とSteam的な実績UI 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実績を8件から50件へ増やし、図鑑上部を進捗サマリーに縮めたうえで、取得済み/未取得を絞り込める実績一覧画面 `#/achievements` を追加する。

**Architecture:** 実績は今までどおりエンディング記録から導出する純関数のままで、保存を増やさない。カタログ(データ)を `src/engine/achievementCatalog.js` へ分離し、エントリに `category` / `tier` / `icon` と任意の `progress` / `target` を足す。表示は `src/components/achievements/` の4コンポーネント(アイコン・進捗バー・行・タイル)に切り出し、実績一覧画面と図鑑の両方から使う。

**Tech Stack:** React 18(インラインスタイル、CSSファイルなし) / Vitest + @testing-library/react / jsdom。ビルドは Vite。

設計書: [docs/superpowers/specs/2026-07-25-achievements-expansion-design.md](../specs/2026-07-25-achievements-expansion-design.md)

## Global Constraints

- テストは `npx vitest run <path>` で単体実行、最後に `npm test` で全件。既存テストは全て通す。`server/routes/characters.test.js` の「lists characters scoped to world and kind」は並列実行時にタイムアウトする既知のフレークで、これだけは再実行して通ればよい。
- コメントは日本語。「なぜそうしたか」を書き、コードを読めば分かることは書かない。既存ファイルのコメント密度に合わせる。
- 色・書体は `src/theme.js` の `COLORS` / `F_DISPLAY` / `F_BODY` / `F_MONO` だけを使う。新しい色を足さない。
- スタイルはインライン。CSSファイルもCSS-in-JSライブラリも導入しない。
- 絵文字を使わない。アイコンはインラインSVGのみ。
- 実績の保存・マイグレーション・サーバー変更は一切しない。実績は記録から導出するだけ。
- 日付の判定はローカルタイムゾーンで行う(`new Date(ms).getHours()` など)。テストもローカル時刻から `Date` を組み立てて書き、固定ミリ秒を直書きしない。
- カテゴリのキーは `arrival` / `world` / `mood` / `roll` / `fate` / `survival` / `trace` の7つ。ティアは `1`(銅) / `2`(銀) / `3`(金)。
- 実績の総数は最終的に50件。内訳は 到達6・世界6・雰囲気10・判定7・運命10・生還4・軌跡7。

---

## File Structure

**新規**
- `src/engine/achievementCatalog.js` — 50件の定義と計数ヘルパ。データだけを持ち、評価はしない
- `src/engine/achievementCatalog.test.js` — カタログの形の検査(id重複・カテゴリ・ティア・アイコン・進捗の対応)
- `src/components/achievements/AchievementIcon.jsx` — SVGグリフ集とティア枠
- `src/components/achievements/AchievementIcon.test.jsx`
- `src/components/achievements/AchievementProgressBar.jsx` — `role="progressbar"` の帯
- `src/components/achievements/AchievementProgressBar.test.jsx`
- `src/components/achievements/AchievementRow.jsx` — 実績一覧の行
- `src/components/achievements/AchievementRow.test.jsx`
- `src/components/achievements/AchievementTile.jsx` — 図鑑の「直近の獲得」タイル
- `src/screens/AchievementList.jsx` — `#/achievements` の画面
- `src/screens/AchievementList.test.jsx`
- `src/utils/formatDate.js` — `EndingGallery` と実績側で共有する日付整形
- `src/utils/formatDate.test.js`

**変更**
- `src/engine/achievements.js` — カタログを外部から読み、評価ループの向きを変える
- `src/engine/achievements.test.js` — 件数の直書きをやめ、新カテゴリの境界値を足す
- `src/router/useHashRoute.js` — `#/achievements` を追加
- `src/router/useHashRoute.test.jsx` — `parseHash` の戻り値にフィールドが増えたことへの追随
- `src/App.jsx` — `#/achievements` で `AchievementList` を描画
- `src/screens/EndingGallery.jsx` — 上部の実績ベタ並べをサマリーに置き換え
- `src/screens/EndingGallery.test.jsx` — サマリー表示への追随
- `docs/05-ui-ux.md` / `docs/02-data-model.md` / `docs/08-feature-ideas.md` / `docs/superpowers/specs/2026-07-25-ending-collection-design.md`

---

### Task 1: カタログの分離と評価ループの反転

既存8件の振る舞いを変えずに、置き場所と評価の向きだけを変える。

**Files:**
- Create: `src/engine/achievementCatalog.js`
- Create: `src/engine/achievementCatalog.test.js`
- Modify: `src/engine/achievements.js`(全面書き換え)
- Modify: `src/engine/achievements.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `CATEGORIES: Array<{ key: string, label: string }>`(`src/engine/achievementCatalog.js`)
  - `CATALOG: Array<{ id, label, description, category, tier, icon, isEarnedBy, progress?, target? }>`(同上)
  - `evaluateAchievements(endings) -> Array<{ id, label, description, category, tier, icon, earned, earnedAt, sessionId, progress: { current, target } | null }>`(`src/engine/achievements.js`)

- [ ] **Step 1: カタログの形を検査するテストを書く**

Create `src/engine/achievementCatalog.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { CATALOG, CATEGORIES } from './achievementCatalog.js';

const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);

describe('achievement catalogue', () => {
  it('has unique ids', () => {
    const ids = CATALOG.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every entry a label, a description and a predicate', () => {
    for (const a of CATALOG) {
      expect(a.label.length, a.id).toBeGreaterThan(0);
      expect(a.description.length, a.id).toBeGreaterThan(0);
      expect(typeof a.isEarnedBy, a.id).toBe('function');
    }
  });

  it('gives every entry a known category and a tier of 1, 2 or 3', () => {
    for (const a of CATALOG) {
      expect(CATEGORY_KEYS, a.id).toContain(a.category);
      expect([1, 2, 3], a.id).toContain(a.tier);
    }
  });

  it('pairs progress with target, never one without the other', () => {
    for (const a of CATALOG) {
      expect(typeof a.progress === 'function', a.id).toBe(typeof a.target === 'number');
    }
  });

  it('groups entries by category, in CATEGORIES order, without interleaving', () => {
    const seen = CATALOG.map((a) => a.category).filter((c, i, arr) => c !== arr[i - 1]);
    const expected = CATEGORY_KEYS.filter((k) => CATALOG.some((a) => a.category === k));
    expect(seen).toEqual(expected);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/engine/achievementCatalog.test.js`
Expected: FAIL — `Failed to resolve import "./achievementCatalog.js"`

- [ ] **Step 3: カタログを作る**

Create `src/engine/achievementCatalog.js`:

```js
// 実績カタログ。定義(データ)と評価(achievements.js)を分けているのは、件数が増えると
// どちらを読むときも他方が邪魔になるため。
//
// isEarnedBy は「endedAt昇順で先頭からi番目までの記録」を受け取り、その時点で条件が
// 成立したかを返す。単体条件の実績は末尾の記録だけを見ればよい(それ以前の記録で
// 成立していれば、より早い反復で確定しているため)。渡される配列は評価側が使い回すので
// 保持してはいけない。

export const CATEGORIES = [
  { key: 'arrival', label: '到達' },
  { key: 'world', label: '世界' },
  { key: 'mood', label: '雰囲気' },
  { key: 'roll', label: '判定' },
  { key: 'fate', label: '運命' },
  { key: 'survival', label: '生還' },
  { key: 'trace', label: '軌跡' },
];

function last(list) {
  return list[list.length - 1];
}

function degreeCount(ending, degree) {
  return ending.stats?.byDegree?.[degree] ?? 0;
}

function rollTotal(ending) {
  return ending.stats?.total ?? 0;
}

export const CATALOG = [
  {
    id: 'first-ending',
    label: '初めての結末',
    description: '初めてエンディングに到達した',
    category: 'arrival',
    tier: 1,
    icon: 'flag',
    isEarnedBy: (list) => list.length >= 1,
  },
  {
    id: 'three-endings',
    label: '三つの結末',
    description: '3つのエンディングに到達した',
    category: 'arrival',
    tier: 1,
    icon: 'book',
    isEarnedBy: (list) => list.length >= 3,
  },
  {
    id: 'world-trilogy',
    label: '一つの世界の三つの結末',
    description: '同じ世界で3つのエンディングに到達した',
    category: 'world',
    tier: 1,
    icon: 'globe',
    isEarnedBy: (list) => {
      const counts = {};
      for (const e of list) {
        if (!e.worldId) continue; // 世界に属さない単発セッションはまとめない
        counts[e.worldId] = (counts[e.worldId] || 0) + 1;
        if (counts[e.worldId] >= 3) return true;
      }
      return false;
    },
  },
  {
    id: 'short-story',
    label: '短編',
    description: '判定10回以下で完結した',
    category: 'roll',
    tier: 1,
    icon: 'quill',
    isEarnedBy: (list) => {
      const total = rollTotal(last(list));
      return total >= 1 && total <= 10;
    },
  },
  {
    id: 'flawless',
    label: '無傷の旅路',
    description: 'ファンブルを1度も出さずに完結した',
    category: 'fate',
    tier: 1,
    icon: 'shield',
    isEarnedBy: (list) => rollTotal(last(list)) >= 1 && degreeCount(last(list), 'fumble') === 0,
  },
  {
    id: 'lucky',
    label: '豪運',
    description: '1つの物語でクリティカルを3回以上出した',
    category: 'fate',
    tier: 1,
    icon: 'sparkle',
    isEarnedBy: (list) => degreeCount(last(list), 'critical') >= 3,
  },
  {
    id: 'cursed',
    label: '厄日',
    description: '1つの物語でファンブルを3回以上出した',
    category: 'fate',
    tier: 1,
    icon: 'skull',
    isEarnedBy: (list) => degreeCount(last(list), 'fumble') >= 3,
  },
  {
    id: 'brink',
    label: '瀬戸際の生還',
    description: '正気度10以下で完結した',
    category: 'survival',
    tier: 1,
    icon: 'heart',
    isEarnedBy: (list) => {
      const value = last(list).stats?.resources?.san?.value;
      return typeof value === 'number' && value <= 10;
    },
  },
];
```

- [ ] **Step 4: カタログのテストが通ることを確認する**

Run: `npx vitest run src/engine/achievementCatalog.test.js`
Expected: PASS(5 tests)

- [ ] **Step 5: 評価側のテストを、件数の直書きをやめる形に直す**

Modify `src/engine/achievements.test.js` — 先頭の import に `CATALOG` を足し、`8` の直書きを2箇所置き換える。

```js
import { describe, it, expect } from 'vitest';
import { evaluateAchievements } from './achievements.js';
import { CATALOG } from './achievementCatalog.js';
```

`returns the whole catalogue unearned for an empty collection` の中の

```js
    expect(result.length).toBe(8);
```

を

```js
    expect(result.length).toBe(CATALOG.length);
```

に、`tolerates a null collection` の中の

```js
    expect(evaluateAchievements(null).length).toBe(8);
```

を

```js
    expect(evaluateAchievements(null).length).toBe(CATALOG.length);
```

に置き換える。以降のタスクでカタログが増えても、このテストを触らなくて済むようにするため。

さらに、戻り値にメタ情報が乗ったことを確かめるテストを `describe('evaluateAchievements', ...)` の末尾に足す。

```js
  it('carries the catalogue metadata through to the result', () => {
    const result = evaluateAchievements([]);
    const first = result.find((a) => a.id === 'first-ending');
    expect(first).toMatchObject({ category: 'arrival', tier: 1, icon: 'flag', progress: null });
  });

  it('returns entries in catalogue order', () => {
    expect(evaluateAchievements([]).map((a) => a.id)).toEqual(CATALOG.map((a) => a.id));
  });
```

- [ ] **Step 6: テストが失敗することを確認する**

Run: `npx vitest run src/engine/achievements.test.js`
Expected: FAIL — `carries the catalogue metadata through to the result` で `category` が undefined

- [ ] **Step 7: 評価を書き直す**

Replace the whole of `src/engine/achievements.js`:

```js
import { CATALOG } from './achievementCatalog.js';

// 実績はエンディング記録のコレクションから導出する。独立した保存を持たないので、
// 定義を後から足しても過去の記録に遡って付き、マイグレーションが要らない。
export function evaluateAchievements(endings) {
  const all = [...(endings || [])].sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));

  // 記録の接頭辞を1本だけ伸ばし、その時点で未獲得の実績にだけ判定をかける。
  // 実績ごとに接頭辞をsliceし直すと、カタログが増えるほど無駄な配列コピーが増える。
  const earned = new Map();
  const prefix = [];
  let pending = CATALOG;
  for (const record of all) {
    if (pending.length === 0) break;
    prefix.push(record);
    const stillPending = [];
    for (const a of pending) {
      if (a.isEarnedBy(prefix)) {
        earned.set(a.id, { earnedAt: record.endedAt ?? null, sessionId: record.sessionId ?? null });
      } else {
        stillPending.push(a);
      }
    }
    pending = stillPending;
  }

  return CATALOG.map((a) => {
    const hit = earned.get(a.id);
    return {
      id: a.id,
      label: a.label,
      description: a.description,
      category: a.category,
      tier: a.tier,
      icon: a.icon,
      earned: Boolean(hit),
      earnedAt: hit ? hit.earnedAt : null,
      sessionId: hit ? hit.sessionId : null,
      progress: null,
    };
  });
}
```

- [ ] **Step 8: テストが通ることを確認する**

Run: `npx vitest run src/engine/achievements.test.js src/engine/achievementCatalog.test.js src/screens/EndingGallery.test.jsx`
Expected: PASS(全て)

- [ ] **Step 9: コミットする**

```bash
git add src/engine/achievementCatalog.js src/engine/achievementCatalog.test.js src/engine/achievements.js src/engine/achievements.test.js
git commit -m "refactor(achievements): カタログを分離し評価ループの向きを変える"
```

---

### Task 2: 進捗の仕組みと、到達・世界カテゴリ(12件)

**Files:**
- Modify: `src/engine/achievementCatalog.js`
- Modify: `src/engine/achievements.js`
- Modify: `src/engine/achievements.test.js`

**Interfaces:**
- Consumes: Task 1 の `CATALOG` / `evaluateAchievements`
- Produces: `progress: { current, target } | null` が実際に値を返すようになる。`current` は `target` で頭打ち。

- [ ] **Step 1: 失敗するテストを書く**

Append to `src/engine/achievements.test.js`(ファイル末尾、`describe('evaluateAchievements', ...)` の外側):

```js
describe('arrival achievements', () => {
  function endings(n) {
    return Array.from({ length: n }, (_, i) => ending({ sessionId: `s${i}`, endedAt: i + 1 }));
  }

  it('earns 十の結末 at the tenth ending, not the ninth', () => {
    expect(find(evaluateAchievements(endings(9)), 'ten-endings').earned).toBe(false);
    expect(find(evaluateAchievements(endings(10)), 'ten-endings')).toMatchObject({ earned: true, earnedAt: 10 });
  });

  it('reports progress toward the count and caps it at the target', () => {
    expect(find(evaluateAchievements(endings(3)), 'ten-endings').progress).toEqual({ current: 3, target: 10 });
    expect(find(evaluateAchievements(endings(12)), 'ten-endings').progress).toEqual({ current: 10, target: 10 });
  });

  it('leaves progress null for achievements that are not countable', () => {
    expect(find(evaluateAchievements(endings(1)), 'flawless').progress).toBeNull();
  });
});

describe('world achievements', () => {
  it('earns 一つの世界の五つの結末 only on the fifth ending in the same world', () => {
    const four = [1, 2, 3, 4].map((i) => ending({ sessionId: `s${i}`, endedAt: i, worldId: 'w1' }));
    expect(find(evaluateAchievements(four), 'world-five').earned).toBe(false);
    expect(find(evaluateAchievements(four), 'world-five').progress).toEqual({ current: 4, target: 5 });

    const five = [...four, ending({ sessionId: 's5', endedAt: 5, worldId: 'w1' })];
    expect(find(evaluateAchievements(five), 'world-five')).toMatchObject({ earned: true, sessionId: 's5' });
  });

  it('counts distinct worlds for 三つの世界 and ignores endings without a world', () => {
    const list = [
      ending({ sessionId: 'a', endedAt: 1, worldId: 'w1' }),
      ending({ sessionId: 'b', endedAt: 2, worldId: 'w2' }),
      ending({ sessionId: 'c', endedAt: 3, worldId: null }),
    ];
    expect(find(evaluateAchievements(list), 'worlds-three')).toMatchObject({
      earned: false,
      progress: { current: 2, target: 3 },
    });

    const withThird = [...list, ending({ sessionId: 'd', endedAt: 4, worldId: 'w3' })];
    expect(find(evaluateAchievements(withThird), 'worlds-three')).toMatchObject({ earned: true, sessionId: 'd' });
  });

  it('groups by campaign for 章を重ねて', () => {
    const one = [ending({ sessionId: 'a', endedAt: 1, campaignId: 'c1' })];
    expect(find(evaluateAchievements(one), 'campaign-two').earned).toBe(false);

    const two = [...one, ending({ sessionId: 'b', endedAt: 2, campaignId: 'c1' })];
    expect(find(evaluateAchievements(two), 'campaign-two')).toMatchObject({ earned: true, sessionId: 'b' });
  });
});
```

`ending()` ヘルパは `campaignId` を持たないので、ファイル冒頭のヘルパに1行足す。

```js
function ending(overrides = {}) {
  return {
    sessionId: 's1',
    endedAt: 1000,
    worldId: null,
    campaignId: null,
    stats: { total: 20, byDegree: { fumble: 1, fail: 5, success: 13, critical: 1 }, resources: {} },
    ...overrides,
  };
}
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/engine/achievements.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'earned')`(`ten-endings` がカタログに無い)

- [ ] **Step 3: 計数ヘルパと12件を書く**

Modify `src/engine/achievementCatalog.js` — `rollTotal` の下にヘルパを足す。

```js
// 同じキーに何件集まっているかの最大値。worldId/campaignId が無い記録は数えない
// (世界にもキャンペーンにも属さない単発セッションをまとめないため)。
function maxByKey(list, keyOf) {
  const counts = new Map();
  let max = 0;
  for (const e of list) {
    const k = keyOf(e);
    if (!k) continue;
    const n = (counts.get(k) || 0) + 1;
    counts.set(k, n);
    if (n > max) max = n;
  }
  return max;
}

function distinctCount(list, keyOf) {
  const set = new Set();
  for (const e of list) {
    const k = keyOf(e);
    if (k) set.add(k);
  }
  return set.size;
}

// 数えれば現在地が出る実績は、同じ計数関数を判定と進捗の両方に使う。
// 判定には接頭辞が、進捗には全記録が渡るが、関数の中身は同じでよい。
function counted(count, target) {
  return { isEarnedBy: (list) => count(list) >= target, progress: count, target };
}

const countOf = (list) => list.length;
const worldGroup = (list) => maxByKey(list, (e) => e.worldId);
const worldVariety = (list) => distinctCount(list, (e) => e.worldId);
const campaignGroup = (list) => maxByKey(list, (e) => e.campaignId);
```

`CATALOG` の `first-ending` / `three-endings` を `counted` を使う形へ書き換え、到達を6件に増やす。配列の先頭は次のようになる。

```js
export const CATALOG = [
  {
    id: 'first-ending',
    label: '初めての結末',
    description: '初めてエンディングに到達した',
    category: 'arrival',
    tier: 1,
    icon: 'flag',
    ...counted(countOf, 1),
  },
  {
    id: 'three-endings',
    label: '三つの結末',
    description: '3つのエンディングに到達した',
    category: 'arrival',
    tier: 1,
    icon: 'book',
    ...counted(countOf, 3),
  },
  {
    id: 'five-endings',
    label: '五つの結末',
    description: '5つのエンディングに到達した',
    category: 'arrival',
    tier: 1,
    icon: 'books',
    ...counted(countOf, 5),
  },
  {
    id: 'ten-endings',
    label: '十の結末',
    description: '10のエンディングに到達した',
    category: 'arrival',
    tier: 2,
    icon: 'library',
    ...counted(countOf, 10),
  },
  {
    id: 'endings-25',
    label: '二十五の結末',
    description: '25のエンディングに到達した',
    category: 'arrival',
    tier: 3,
    icon: 'library',
    ...counted(countOf, 25),
  },
  {
    id: 'endings-50',
    label: '五十の結末',
    description: '50のエンディングに到達した',
    category: 'arrival',
    tier: 3,
    icon: 'crown',
    ...counted(countOf, 50),
  },
```

続けて `world-trilogy` を `counted` 版に差し替え、世界カテゴリを6件にする。

```js
  {
    id: 'world-trilogy',
    label: '一つの世界の三つの結末',
    description: '同じ世界で3つのエンディングに到達した',
    category: 'world',
    tier: 1,
    icon: 'globe',
    ...counted(worldGroup, 3),
  },
  {
    id: 'world-five',
    label: '一つの世界の五つの結末',
    description: '同じ世界で5つのエンディングに到達した',
    category: 'world',
    tier: 2,
    icon: 'globe',
    ...counted(worldGroup, 5),
  },
  {
    id: 'worlds-three',
    label: '三つの世界',
    description: '3つの異なる世界でエンディングに到達した',
    category: 'world',
    tier: 1,
    icon: 'map',
    ...counted(worldVariety, 3),
  },
  {
    id: 'worlds-five',
    label: '五つの世界',
    description: '5つの異なる世界でエンディングに到達した',
    category: 'world',
    tier: 2,
    icon: 'map',
    ...counted(worldVariety, 5),
  },
  {
    id: 'campaign-two',
    label: '章を重ねて',
    description: '同じキャンペーンで2つのエンディングに到達した',
    category: 'world',
    tier: 1,
    icon: 'compass',
    ...counted(campaignGroup, 2),
  },
  {
    id: 'campaign-four',
    label: '長い年代記',
    description: '同じキャンペーンで4つのエンディングに到達した',
    category: 'world',
    tier: 3,
    icon: 'crown',
    ...counted(campaignGroup, 4),
  },
```

- [ ] **Step 4: 評価側で進捗を返す**

Modify `src/engine/achievements.js` — `CATALOG.map` の中の `progress: null,` を次に置き換える。

```js
      // 進捗は「いま何本持っているか」なので、判定に使う接頭辞ではなく全記録で数える。
      progress: a.progress ? { current: Math.min(a.progress(all), a.target), target: a.target } : null,
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/engine/achievements.test.js src/engine/achievementCatalog.test.js`
Expected: PASS。カタログは17件(到達6・世界6・判定1・運命3・生還1)になる。

- [ ] **Step 6: コミットする**

```bash
git add src/engine/achievementCatalog.js src/engine/achievements.js src/engine/achievements.test.js
git commit -m "feat(achievements): 進捗表示の仕組みと到達・世界の実績を追加"
```

---

### Task 3: 雰囲気カテゴリ(10件)

**Files:**
- Modify: `src/engine/achievementCatalog.js`
- Modify: `src/engine/achievementCatalog.test.js`
- Modify: `src/engine/achievements.test.js`

**Interfaces:**
- Consumes: Task 2 の `counted` / `CATALOG`
- Produces: `MOOD_ENTRIES: Array<{ mood, id, icon }>`(`src/engine/achievementCatalog.js` から export。カタログのテストが `MOODS` との一致を検査するため)

- [ ] **Step 1: 失敗するテストを書く**

Modify `src/engine/achievementCatalog.test.js` — 冒頭の import を差し替え、`MOODS` を足す。

```js
import { CATALOG, CATEGORIES, MOOD_ENTRIES } from './achievementCatalog.js';
import { MOODS } from '../constants/moods.js';
```

そしてファイル末尾に足す。

```js
describe('mood achievements', () => {
  it('covers every mood in MOODS exactly once', () => {
    expect(MOOD_ENTRIES.map((m) => m.mood).sort()).toEqual([...MOODS].sort());
  });
});
```

Append to `src/engine/achievements.test.js`:

```js
describe('mood achievements', () => {
  it('earns the per-mood achievement from any ending carrying that mood', () => {
    const list = [ending({ sessionId: 'a', endedAt: 1, moods: ['ホラー', 'ミステリー'] })];
    expect(find(evaluateAchievements(list), 'mood-horror')).toMatchObject({ earned: true, sessionId: 'a' });
    expect(find(evaluateAchievements(list), 'mood-mystery').earned).toBe(true);
    expect(find(evaluateAchievements(list), 'mood-comedy').earned).toBe(false);
  });

  it('earns 八色の物語 only when all eight moods have been reached', () => {
    const seven = MOODS.slice(0, 7).map((m, i) => ending({ sessionId: `s${i}`, endedAt: i + 1, moods: [m] }));
    expect(find(evaluateAchievements(seven), 'mood-all')).toMatchObject({
      earned: false,
      progress: { current: 7, target: 8 },
    });

    const eight = [...seven, ending({ sessionId: 'last', endedAt: 8, moods: [MOODS[7]] })];
    expect(find(evaluateAchievements(eight), 'mood-all')).toMatchObject({ earned: true, sessionId: 'last' });
  });

  it('earns 混ざりあう色 from a single ending with three moods', () => {
    const two = [ending({ sessionId: 'a', endedAt: 1, moods: ['ホラー', 'SF'] })];
    expect(find(evaluateAchievements(two), 'mood-blend').earned).toBe(false);

    const three = [ending({ sessionId: 'a', endedAt: 1, moods: ['ホラー', 'SF', '日常'] })];
    expect(find(evaluateAchievements(three), 'mood-blend').earned).toBe(true);
  });

  it('tolerates endings without moods', () => {
    const list = [ending({ sessionId: 'a', endedAt: 1 })];
    expect(find(evaluateAchievements(list), 'mood-horror').earned).toBe(false);
  });
});
```

冒頭の import に `MOODS` を足す。

```js
import { MOODS } from '../constants/moods.js';
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/engine/achievementCatalog.test.js src/engine/achievements.test.js`
Expected: FAIL — `MOOD_ENTRIES is not defined` と `mood-horror` が見つからない

- [ ] **Step 3: 雰囲気の実績を書く**

Modify `src/engine/achievementCatalog.js` — ヘルパに追加する。

```js
import { MOODS } from '../constants/moods.js';

function moodsOf(ending) {
  return Array.isArray(ending.moods) ? ending.moods : [];
}

function hasMood(list, mood) {
  return list.some((e) => moodsOf(e).includes(mood));
}

const moodVariety = (list) => MOODS.filter((m) => hasMood(list, m)).length;

// 雰囲気タグごとの実績。MOODS と1対1で対応させ、カタログのテストで取りこぼしを検出する。
export const MOOD_ENTRIES = [
  { mood: 'ホラー', id: 'mood-horror', icon: 'skull' },
  { mood: '冒険', id: 'mood-adventure', icon: 'map' },
  { mood: 'ミステリー', id: 'mood-mystery', icon: 'quill' },
  { mood: '日常', id: 'mood-daily', icon: 'heart' },
  { mood: 'SF', id: 'mood-sf', icon: 'sparkle' },
  { mood: 'ファンタジー', id: 'mood-fantasy', icon: 'star' },
  { mood: 'コメディ', id: 'mood-comedy', icon: 'mask' },
  { mood: 'シリアス', id: 'mood-serious', icon: 'scales' },
];
```

`CATALOG` の世界カテゴリの直後、判定カテゴリ(`short-story`)の直前に差し込む。

```js
  ...MOOD_ENTRIES.map(({ mood, id, icon }) => ({
    id,
    label: `${mood}の結末`,
    description: `雰囲気「${mood}」の物語でエンディングに到達した`,
    category: 'mood',
    tier: 1,
    icon,
    isEarnedBy: (list) => hasMood(list, mood),
  })),
  {
    id: 'mood-all',
    label: '八色の物語',
    description: 'すべての雰囲気でエンディングに到達した',
    category: 'mood',
    tier: 3,
    icon: 'crown',
    ...counted(moodVariety, MOODS.length),
  },
  {
    id: 'mood-blend',
    label: '混ざりあう色',
    description: '1つの物語に雰囲気を3つ以上つけて完結した',
    category: 'mood',
    tier: 1,
    icon: 'mask',
    isEarnedBy: (list) => moodsOf(last(list)).length >= 3,
  },
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/engine/achievementCatalog.test.js src/engine/achievements.test.js`
Expected: PASS。カタログは27件になる。

- [ ] **Step 5: コミットする**

```bash
git add src/engine/achievementCatalog.js src/engine/achievementCatalog.test.js src/engine/achievements.test.js
git commit -m "feat(achievements): 雰囲気タグの実績を追加"
```

---

### Task 4: 判定・運命カテゴリ(17件)

**Files:**
- Modify: `src/engine/achievementCatalog.js`
- Modify: `src/engine/achievements.test.js`

**Interfaces:**
- Consumes: Task 2 の `counted` / `rollTotal` / `degreeCount`
- Produces: なし(カタログが増えるだけ)

- [ ] **Step 1: 失敗するテストを書く**

Append to `src/engine/achievements.test.js`:

```js
describe('roll achievements', () => {
  function withStats(stats, overrides = {}) {
    return ending({ stats: { byDegree: {}, resources: {}, ...stats }, ...overrides });
  }

  it('earns 長編 at fifty rolls, not at forty-nine', () => {
    expect(find(evaluateAchievements([withStats({ total: 49 })]), 'long-story').earned).toBe(false);
    expect(find(evaluateAchievements([withStats({ total: 50 })]), 'long-story').earned).toBe(true);
  });

  it('sums rolls across endings for 百の判定 and caps the progress', () => {
    const list = [
      withStats({ total: 60 }, { sessionId: 'a', endedAt: 1 }),
      withStats({ total: 39 }, { sessionId: 'b', endedAt: 2 }),
    ];
    expect(find(evaluateAchievements(list), 'rolls-100')).toMatchObject({
      earned: false,
      progress: { current: 99, target: 100 },
    });

    const third = [...list, withStats({ total: 1 }, { sessionId: 'c', endedAt: 3 })];
    expect(find(evaluateAchievements(third), 'rolls-100')).toMatchObject({ earned: true, sessionId: 'c' });
  });

  it('earns 手練れ at a success rate of exactly 0.8 with enough rolls', () => {
    expect(find(evaluateAchievements([withStats({ total: 10, successRate: 0.79 })]), 'adept').earned).toBe(false);
    expect(find(evaluateAchievements([withStats({ total: 10, successRate: 0.8 })]), 'adept').earned).toBe(true);
    // 判定が少ないうちは成功率が偶然に振れるので、10回に満たない記録では成立させない
    expect(find(evaluateAchievements([withStats({ total: 9, successRate: 1 })]), 'adept').earned).toBe(false);
  });

  it('earns 苦難の道 at a success rate of exactly 0.3', () => {
    expect(find(evaluateAchievements([withStats({ total: 10, successRate: 0.31 })]), 'ordeal').earned).toBe(false);
    expect(find(evaluateAchievements([withStats({ total: 10, successRate: 0.3 })]), 'ordeal').earned).toBe(true);
  });
});

describe('fate achievements', () => {
  function withDegrees(byDegree, overrides = {}) {
    return ending({ stats: { total: 30, byDegree, resources: {} }, ...overrides });
  }

  it('earns 完全なる旅路 only with thirty rolls and no fumble', () => {
    expect(find(evaluateAchievements([withDegrees({ fumble: 0 })]), 'flawless-long').earned).toBe(true);
    expect(
      find(evaluateAchievements([ending({ stats: { total: 29, byDegree: { fumble: 0 }, resources: {} } })]), 'flawless-long')
        .earned
    ).toBe(false);
    expect(find(evaluateAchievements([withDegrees({ fumble: 1 })]), 'flawless-long').earned).toBe(false);
  });

  it('earns 明暗 only when one ending has both three criticals and three fumbles', () => {
    expect(find(evaluateAchievements([withDegrees({ critical: 3, fumble: 2 })]), 'tempest').earned).toBe(false);
    expect(find(evaluateAchievements([withDegrees({ critical: 3, fumble: 3 })]), 'tempest').earned).toBe(true);
  });

  it('treats degrees missing from the ruleset as zero', () => {
    // simple/dnd5e/gurps は byDegree に hard/extreme を持たないので、成立しないだけで壊れない
    const result = evaluateAchievements([withDegrees({ fumble: 0, critical: 0 })]);
    expect(find(result, 'hard-three').earned).toBe(false);
    expect(find(result, 'extreme-one').earned).toBe(false);
  });

  it('earns 際どい成功 and 会心 from CoC7e-style degrees', () => {
    const result = evaluateAchievements([withDegrees({ hard: 3, extreme: 1 })]);
    expect(find(result, 'hard-three').earned).toBe(true);
    expect(find(result, 'extreme-one').earned).toBe(true);
  });

  it('sums criticals across endings for 積み重なる幸運', () => {
    const list = [
      withDegrees({ critical: 20 }, { sessionId: 'a', endedAt: 1 }),
      withDegrees({ critical: 4 }, { sessionId: 'b', endedAt: 2 }),
    ];
    expect(find(evaluateAchievements(list), 'criticals-25')).toMatchObject({
      earned: false,
      progress: { current: 24, target: 25 },
    });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/engine/achievements.test.js`
Expected: FAIL — `long-story` などが見つからない

- [ ] **Step 3: 判定と運命の実績を書く**

Modify `src/engine/achievementCatalog.js` — ヘルパを足す。

```js
function successRate(ending) {
  return ending.stats?.successRate ?? 0;
}

function sumOf(list, pick) {
  let n = 0;
  for (const e of list) n += pick(e);
  return n;
}

const rollsTotal = (list) => sumOf(list, rollTotal);
const criticalsTotal = (list) => sumOf(list, (e) => degreeCount(e, 'critical'));
```

`short-story` を残したまま、判定カテゴリを7件にする(`short-story` を先頭に置く)。

```js
  {
    id: 'short-story',
    label: '短編',
    description: '判定10回以下で完結した',
    category: 'roll',
    tier: 1,
    icon: 'quill',
    isEarnedBy: (list) => {
      const total = rollTotal(last(list));
      return total >= 1 && total <= 10;
    },
  },
  {
    id: 'long-story',
    label: '長編',
    description: '判定50回以上で完結した',
    category: 'roll',
    tier: 2,
    icon: 'book',
    isEarnedBy: (list) => rollTotal(last(list)) >= 50,
  },
  {
    id: 'epic',
    label: '大長編',
    description: '判定100回以上で完結した',
    category: 'roll',
    tier: 3,
    icon: 'library',
    isEarnedBy: (list) => rollTotal(last(list)) >= 100,
  },
  {
    id: 'rolls-100',
    label: '百の判定',
    description: '通算100回の判定を行った',
    category: 'roll',
    tier: 1,
    icon: 'dice',
    ...counted(rollsTotal, 100),
  },
  {
    id: 'rolls-500',
    label: '五百の判定',
    description: '通算500回の判定を行った',
    category: 'roll',
    tier: 2,
    icon: 'dice',
    ...counted(rollsTotal, 500),
  },
  {
    id: 'adept',
    label: '手練れ',
    description: '判定10回以上、成功率8割以上で完結した',
    category: 'roll',
    tier: 2,
    icon: 'star',
    // 判定が少ないうちは成功率が偶然に振れるので、10回の下限を置く
    isEarnedBy: (list) => rollTotal(last(list)) >= 10 && successRate(last(list)) >= 0.8,
  },
  {
    id: 'ordeal',
    label: '苦難の道',
    description: '判定10回以上、成功率3割以下で完結した',
    category: 'roll',
    tier: 2,
    icon: 'hourglass',
    isEarnedBy: (list) => rollTotal(last(list)) >= 10 && successRate(last(list)) <= 0.3,
  },
```

運命カテゴリを10件にする(既存の `flawless` / `lucky` / `cursed` を含む)。

```js
  {
    id: 'flawless',
    label: '無傷の旅路',
    description: 'ファンブルを1度も出さずに完結した',
    category: 'fate',
    tier: 1,
    icon: 'shield',
    isEarnedBy: (list) => rollTotal(last(list)) >= 1 && degreeCount(last(list), 'fumble') === 0,
  },
  {
    id: 'flawless-long',
    label: '完全なる旅路',
    description: '判定30回以上、ファンブルを1度も出さずに完結した',
    category: 'fate',
    tier: 3,
    icon: 'shield',
    isEarnedBy: (list) => rollTotal(last(list)) >= 30 && degreeCount(last(list), 'fumble') === 0,
  },
  {
    id: 'lucky',
    label: '豪運',
    description: '1つの物語でクリティカルを3回以上出した',
    category: 'fate',
    tier: 1,
    icon: 'sparkle',
    isEarnedBy: (list) => degreeCount(last(list), 'critical') >= 3,
  },
  {
    id: 'lucky-five',
    label: '天佑',
    description: '1つの物語でクリティカルを5回以上出した',
    category: 'fate',
    tier: 2,
    icon: 'sparkle',
    isEarnedBy: (list) => degreeCount(last(list), 'critical') >= 5,
  },
  {
    id: 'cursed',
    label: '厄日',
    description: '1つの物語でファンブルを3回以上出した',
    category: 'fate',
    tier: 1,
    icon: 'skull',
    isEarnedBy: (list) => degreeCount(last(list), 'fumble') >= 3,
  },
  {
    id: 'cursed-five',
    label: '呪われた日',
    description: '1つの物語でファンブルを5回以上出した',
    category: 'fate',
    tier: 2,
    icon: 'skull',
    isEarnedBy: (list) => degreeCount(last(list), 'fumble') >= 5,
  },
  {
    id: 'tempest',
    label: '明暗',
    description: '1つの物語でクリティカルとファンブルを3回ずつ出した',
    category: 'fate',
    tier: 2,
    icon: 'scales',
    isEarnedBy: (list) => degreeCount(last(list), 'critical') >= 3 && degreeCount(last(list), 'fumble') >= 3,
  },
  {
    id: 'hard-three',
    label: '際どい成功',
    description: '1つの物語でハード成功を3回以上出した',
    category: 'fate',
    tier: 1,
    icon: 'dice',
    // hard/extreme を持たないルールセットでは degreeCount が0を返し、成立しないだけで壊れない
    isEarnedBy: (list) => degreeCount(last(list), 'hard') >= 3,
  },
  {
    id: 'extreme-one',
    label: '会心',
    description: 'イクストリーム成功を出した',
    category: 'fate',
    tier: 1,
    icon: 'star',
    isEarnedBy: (list) => degreeCount(last(list), 'extreme') >= 1,
  },
  {
    id: 'criticals-25',
    label: '積み重なる幸運',
    description: '通算25回のクリティカルを出した',
    category: 'fate',
    tier: 2,
    icon: 'sparkle',
    ...counted(criticalsTotal, 25),
  },
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/engine/achievements.test.js src/engine/achievementCatalog.test.js`
Expected: PASS。カタログは40件になる(残るのは生還3件と軌跡7件)。

- [ ] **Step 5: コミットする**

```bash
git add src/engine/achievementCatalog.js src/engine/achievements.test.js
git commit -m "feat(achievements): 判定と運命の実績を追加"
```

---

### Task 5: 生還・軌跡カテゴリ(11件)とカタログの最終検査

**Files:**
- Modify: `src/engine/achievementCatalog.js`
- Modify: `src/engine/achievementCatalog.test.js`
- Modify: `src/engine/achievements.test.js`

**Interfaces:**
- Consumes: Task 2 の `counted` / `distinctCount`
- Produces: `CATALOG.length === 50`。全7カテゴリが埋まる。

- [ ] **Step 1: 失敗するテストを書く**

Modify `src/engine/achievementCatalog.test.js` — 冒頭の import に `FORMULAS` と `RULESETS` を足す。

```js
import { CATALOG, CATEGORIES, MOOD_ENTRIES, FORMULAS } from './achievementCatalog.js';
import { MOODS } from '../constants/moods.js';
import { RULESETS } from '../data/rulesets.js';
```

そしてファイル末尾に足す。

```js
describe('the finished catalogue', () => {
  it('holds fifty achievements', () => {
    expect(CATALOG.length).toBe(50);
  });

  it('fills every category', () => {
    for (const c of CATEGORIES) {
      expect(CATALOG.some((a) => a.category === c.key), c.key).toBe(true);
    }
  });

  it('keeps the formula list in step with the shipped rulesets', () => {
    // 判定式が増えたらここで落ちる。四つの流儀のラベルと目標値を見直すため。
    expect([...FORMULAS].sort()).toEqual([...new Set(RULESETS.map((r) => r.formula))].sort());
  });
});
```

Append to `src/engine/achievements.test.js`:

```js
describe('survival achievements', () => {
  function withSan(value, total = 20) {
    return ending({ stats: { total, byDegree: {}, resources: { san: { label: '正気度', value, max: 99 } } } });
  }

  it('earns 瀬戸際の生還 at ten and not at eleven', () => {
    expect(find(evaluateAchievements([withSan(11)]), 'brink').earned).toBe(false);
    expect(find(evaluateAchievements([withSan(10)]), 'brink').earned).toBe(true);
  });

  it('earns 削られた精神 at three tenths of the maximum', () => {
    expect(find(evaluateAchievements([withSan(30)]), 'shaken').earned).toBe(false);
    expect(find(evaluateAchievements([withSan(29)]), 'shaken').earned).toBe(true);
  });

  it('needs ten rolls for 削られた精神 and 揺るがぬ精神', () => {
    expect(find(evaluateAchievements([withSan(29, 9)]), 'shaken').earned).toBe(false);
    expect(find(evaluateAchievements([withSan(90, 9)]), 'steady').earned).toBe(false);
  });

  it('earns 揺るがぬ精神 at six tenths of the maximum', () => {
    expect(find(evaluateAchievements([withSan(59)]), 'steady').earned).toBe(false);
    expect(find(evaluateAchievements([withSan(60)]), 'steady').earned).toBe(true);
  });

  it('earns 正気の底 only at zero', () => {
    expect(find(evaluateAchievements([withSan(1)]), 'sanity-zero').earned).toBe(false);
    expect(find(evaluateAchievements([withSan(0)]), 'sanity-zero').earned).toBe(true);
  });

  it('stays unearned for rulesets without the resource', () => {
    const result = evaluateAchievements([ending({ stats: { total: 20, byDegree: {}, resources: {} } })]);
    expect(result.filter((a) => a.category === 'survival').every((a) => a.earned === false)).toBe(true);
  });
});

describe('trace achievements', () => {
  // ローカルタイムゾーンで判定するので、テストもローカル時刻からミリ秒を組み立てる
  function at(year, month, day, hour = 12) {
    return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
  }

  it('earns 二つの流儀 from two distinct formulas', () => {
    const one = [ending({ sessionId: 'a', endedAt: 1, formula: 'simple' })];
    expect(find(evaluateAchievements(one), 'formula-two')).toMatchObject({
      earned: false,
      progress: { current: 1, target: 2 },
    });

    const two = [...one, ending({ sessionId: 'b', endedAt: 2, formula: 'coc7e' })];
    expect(find(evaluateAchievements(two), 'formula-two')).toMatchObject({ earned: true, sessionId: 'b' });
  });

  it('earns 四つの流儀 only with every formula', () => {
    const list = ['simple', 'coc7e', 'dnd5e', 'gurps'].map((f, i) =>
      ending({ sessionId: f, endedAt: i + 1, formula: f })
    );
    expect(find(evaluateAchievements(list), 'formula-all')).toMatchObject({ earned: true, sessionId: 'gurps' });
    expect(find(evaluateAchievements(list.slice(0, 3)), 'formula-all').earned).toBe(false);
  });

  it('earns 夜更かしの語り部 between midnight and five', () => {
    expect(find(evaluateAchievements([ending({ endedAt: at(2026, 7, 1, 4) })]), 'night-owl').earned).toBe(true);
    expect(find(evaluateAchievements([ending({ endedAt: at(2026, 7, 1, 5) })]), 'night-owl').earned).toBe(false);
  });

  it('earns 夜明けの結末 between five and eight', () => {
    expect(find(evaluateAchievements([ending({ endedAt: at(2026, 7, 1, 5) })]), 'dawn').earned).toBe(true);
    expect(find(evaluateAchievements([ending({ endedAt: at(2026, 7, 1, 8) })]), 'dawn').earned).toBe(false);
  });

  it('earns 一日二作 from two endings on the same local day', () => {
    const apart = [
      ending({ sessionId: 'a', endedAt: at(2026, 7, 1, 9) }),
      ending({ sessionId: 'b', endedAt: at(2026, 7, 2, 9) }),
    ];
    expect(find(evaluateAchievements(apart), 'same-day-two').earned).toBe(false);

    const together = [
      ending({ sessionId: 'a', endedAt: at(2026, 7, 1, 9) }),
      ending({ sessionId: 'b', endedAt: at(2026, 7, 1, 22) }),
    ];
    expect(find(evaluateAchievements(together), 'same-day-two').earned).toBe(true);
  });

  it('earns 三日連続 across a month boundary but not with a gap', () => {
    const gap = [at(2026, 7, 1), at(2026, 7, 2), at(2026, 7, 4)].map((ms, i) =>
      ending({ sessionId: `s${i}`, endedAt: ms })
    );
    expect(find(evaluateAchievements(gap), 'streak-three').earned).toBe(false);

    const straddle = [at(2026, 7, 30), at(2026, 7, 31), at(2026, 8, 1)].map((ms, i) =>
      ending({ sessionId: `s${i}`, endedAt: ms })
    );
    expect(find(evaluateAchievements(straddle), 'streak-three').earned).toBe(true);
  });

  it('earns 実り月 from five endings in the same month', () => {
    const four = [1, 2, 3, 4].map((d) => ending({ sessionId: `s${d}`, endedAt: at(2026, 7, d) }));
    expect(find(evaluateAchievements(four), 'month-five').earned).toBe(false);

    const five = [...four, ending({ sessionId: 's5', endedAt: at(2026, 7, 20) })];
    expect(find(evaluateAchievements(five), 'month-five').earned).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/engine/achievements.test.js src/engine/achievementCatalog.test.js`
Expected: FAIL — `FORMULAS` が未定義、`shaken` などが見つからない

- [ ] **Step 3: 生還と軌跡の実績を書く**

Modify `src/engine/achievementCatalog.js` — ヘルパを足す。

```js
// 正気度は CoC7e風だけが持つ(他のルールセットは resourceDefs が空)。
// 記録が持たなければ条件を満たさないだけで、判定式の分岐は実績側に持ち込まない。
function sanOf(ending) {
  const san = ending.stats?.resources?.san;
  if (!san || typeof san.value !== 'number' || typeof san.max !== 'number' || san.max <= 0) return null;
  return san;
}

function sanAtMost(ending, ratio) {
  const san = sanOf(ending);
  return san !== null && san.value <= san.max * ratio;
}

function sanAtLeast(ending, ratio) {
  const san = sanOf(ending);
  return san !== null && san.value >= san.max * ratio;
}

// 判定式は src/data/rulesets.js が配っているもの。増えたらカタログのテストが落ちるので、
// そのとき「四つの流儀」のラベルと目標値を見直す。
export const FORMULAS = ['simple', 'coc7e', 'dnd5e', 'gurps'];

const formulaVariety = (list) => distinctCount(list, (e) => e.formula);

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// プレイヤーの体感時刻と一致させるため、日付の判定は全てローカルタイムゾーンで行う。
function localDayKey(ms) {
  return dayKey(new Date(ms));
}

function localMonthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function hourOf(ms) {
  return new Date(ms).getHours();
}

function hasDayStreak(list, length) {
  const days = new Set(list.map((e) => localDayKey(e.endedAt)));
  for (const e of list) {
    const start = new Date(e.endedAt);
    let run = true;
    for (let i = 1; i < length && run; i++) {
      const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      run = days.has(dayKey(next));
    }
    if (run) return true;
  }
  return false;
}
```

`CATALOG` の `brink` を残したまま生還を4件にし、その後ろに軌跡7件を足す。

```js
  {
    id: 'brink',
    label: '瀬戸際の生還',
    description: '正気度10以下で完結した',
    category: 'survival',
    tier: 1,
    icon: 'heart',
    isEarnedBy: (list) => {
      const san = sanOf(last(list));
      return san !== null && san.value <= 10;
    },
  },
  {
    id: 'shaken',
    label: '削られた精神',
    description: '判定10回以上、正気度が最大の3割以下で完結した',
    category: 'survival',
    tier: 1,
    icon: 'heart',
    isEarnedBy: (list) => rollTotal(last(list)) >= 10 && sanAtMost(last(list), 0.3),
  },
  {
    id: 'steady',
    label: '揺るがぬ精神',
    description: '判定10回以上、正気度が最大の6割以上で完結した',
    category: 'survival',
    tier: 2,
    icon: 'shield',
    isEarnedBy: (list) => rollTotal(last(list)) >= 10 && sanAtLeast(last(list), 0.6),
  },
  {
    id: 'sanity-zero',
    label: '正気の底',
    description: '正気度0で完結した',
    category: 'survival',
    tier: 3,
    icon: 'skull',
    isEarnedBy: (list) => {
      const san = sanOf(last(list));
      return san !== null && san.value === 0;
    },
  },
  {
    id: 'formula-two',
    label: '二つの流儀',
    description: '2種類の判定式でエンディングに到達した',
    category: 'trace',
    tier: 1,
    icon: 'scales',
    ...counted(formulaVariety, 2),
  },
  {
    id: 'formula-all',
    label: '四つの流儀',
    description: 'すべての判定式でエンディングに到達した',
    category: 'trace',
    tier: 3,
    icon: 'crown',
    ...counted(formulaVariety, FORMULAS.length),
  },
  {
    id: 'night-owl',
    label: '夜更かしの語り部',
    description: '0時から4時台に物語を終えた',
    category: 'trace',
    tier: 1,
    icon: 'moon',
    isEarnedBy: (list) => hourOf(last(list).endedAt) <= 4,
  },
  {
    id: 'dawn',
    label: '夜明けの結末',
    description: '5時から7時台に物語を終えた',
    category: 'trace',
    tier: 1,
    icon: 'sunrise',
    isEarnedBy: (list) => {
      const h = hourOf(last(list).endedAt);
      return h >= 5 && h <= 7;
    },
  },
  {
    id: 'same-day-two',
    label: '一日二作',
    description: '同じ日に2つのエンディングに到達した',
    category: 'trace',
    tier: 2,
    icon: 'clock',
    isEarnedBy: (list) => maxByKey(list, (e) => localDayKey(e.endedAt)) >= 2,
  },
  {
    id: 'streak-three',
    label: '三日連続',
    description: '3日続けてエンディングに到達した',
    category: 'trace',
    tier: 2,
    icon: 'calendar',
    isEarnedBy: (list) => hasDayStreak(list, 3),
  },
  {
    id: 'month-five',
    label: '実り月',
    description: '同じ月に5つのエンディングに到達した',
    category: 'trace',
    tier: 2,
    icon: 'calendar',
    isEarnedBy: (list) => maxByKey(list, (e) => localMonthKey(e.endedAt)) >= 5,
  },
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/engine/achievements.test.js src/engine/achievementCatalog.test.js`
Expected: PASS。`holds fifty achievements` が通る。

- [ ] **Step 5: 既存のテスト全体が壊れていないことを確認する**

Run: `npm test`
Expected: PASS(`server/routes/characters.test.js` のフレークを除く)

- [ ] **Step 6: コミットする**

```bash
git add src/engine/achievementCatalog.js src/engine/achievementCatalog.test.js src/engine/achievements.test.js
git commit -m "feat(achievements): 生還と軌跡の実績を追加してカタログを50件にする"
```

---

### Task 6: アイコン

**Files:**
- Create: `src/components/achievements/AchievementIcon.jsx`
- Create: `src/components/achievements/AchievementIcon.test.jsx`
- Modify: `src/engine/achievementCatalog.test.js`

**Interfaces:**
- Consumes: `COLORS`(`src/theme.js`)
- Produces:
  - `ICONS: Record<string, string>`(グリフ名 → SVGパス)
  - `AchievementIcon({ icon, category, tier = 1, earned = false, size = 42 })` — default export

- [ ] **Step 1: 失敗するテストを書く**

Create `src/components/achievements/AchievementIcon.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import AchievementIcon, { ICONS } from './AchievementIcon.jsx';
import { COLORS } from '../../theme.js';

function ring(container) {
  return container.firstChild;
}

describe('AchievementIcon', () => {
  it('draws the requested glyph', () => {
    const { container } = render(<AchievementIcon icon="flag" category="arrival" earned />);
    expect(container.querySelector('path').getAttribute('d')).toBe(ICONS.flag);
  });

  it('falls back to the category glyph for an unknown name', () => {
    const { container } = render(<AchievementIcon icon="nope" category="fate" earned />);
    expect(container.querySelector('path').getAttribute('d')).toBe(ICONS.sparkle);
  });

  it('marks the ring solid when earned and dashed when locked', () => {
    const { container: earned } = render(<AchievementIcon icon="flag" category="arrival" tier={1} earned />);
    expect(ring(earned).style.border).toContain('solid');

    const { container: locked } = render(<AchievementIcon icon="flag" category="arrival" tier={1} />);
    expect(ring(locked).style.border).toContain('dashed');
  });

  it('distinguishes the three tiers by width and colour', () => {
    const { container: bronze } = render(<AchievementIcon icon="flag" category="arrival" tier={1} earned />);
    const { container: silver } = render(<AchievementIcon icon="flag" category="arrival" tier={2} earned />);
    const { container: gold } = render(<AchievementIcon icon="flag" category="arrival" tier={3} earned />);
    expect(ring(bronze).style.border).toBe(`1.5px solid ${COLORS.line}`);
    expect(ring(silver).style.border).toBe(`2px solid ${COLORS.brass}`);
    expect(ring(gold).style.border).toBe(`3px double ${COLORS.stamp}`);
  });

  it('hides itself from assistive technology', () => {
    const { container } = render(<AchievementIcon icon="flag" category="arrival" earned />);
    expect(ring(container).getAttribute('aria-hidden')).toBe('true');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/components/achievements/AchievementIcon.test.jsx`
Expected: FAIL — `Failed to resolve import "./AchievementIcon.jsx"`

- [ ] **Step 3: アイコンを書く**

Create `src/components/achievements/AchievementIcon.jsx`:

```jsx
import { COLORS } from '../../theme.js';

// 24×24・currentColorの単色線画。絵文字を使わないのは、紙とタイプライターの意匠に
// 合わないため。1つのグリフを複数の実績で使い回してよい。
export const ICONS = {
  flag: 'M6 3v18 M6 4h11l-2.5 4L17 12H6',
  book: 'M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z M7 20a2 2 0 0 1 0-4h11',
  books: 'M5 6h4v14H5z M11 6h4v14h-4z M17 7l3 11',
  library: 'M3 20h18 M6 20V10 M10 20V10 M14 20V10 M18 20V10 M3 10l9-6 9 6',
  crown: 'M4 8l3 9h10l3-9-4.5 3L12 5 8.5 11z M7 20h10',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c3 3.5 3 14.5 0 18 M12 3c-3 3.5-3 14.5 0 18',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z M9 4v14 M15 6v14',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M15.5 8.5l-2 5-5 2 2-5z',
  mask: 'M4 5h16v6a8 8 0 0 1-8 9 8 8 0 0 1-8-9z M8.5 11h.01 M15.5 11h.01',
  skull: 'M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z M9.5 12h.01 M14.5 12h.01',
  star: 'M12 3l2.7 5.9 6.3.7-4.7 4.3 1.3 6.1L12 17l-5.6 3 1.3-6.1L3 9.6l6.3-.7z',
  sparkle: 'M12 4l1.8 4.7L18 10.5l-4.2 1.8L12 17l-1.8-4.7L6 10.5l4.2-1.8z M18 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  moon: 'M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10z',
  sunrise: 'M12 3v4 M5.5 9.5l2 2 M18.5 9.5l-2 2 M3 20h18 M7 17a5 5 0 0 1 10 0z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5.5l3.5 2',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  hourglass: 'M7 3h10 M7 21h10 M7 3c0 4 5 6 5 9 0-3 5-5 5-9 M7 21c0-4 5-6 5-9 0 3 5 5 5 9',
  dice: 'M5 5h14v14H5z M9 9h.01 M15 9h.01 M9 15h.01 M15 15h.01 M12 12h.01',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  heart: 'M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9z',
  quill: 'M4 20s2-8 8-12 8-4 8-4-1 6-5 9-9 4-9 4z M4 20l5.5-5.5',
  scales: 'M12 4v16 M6 20h12 M4 8h16 M4 8l-2.5 5.5a3 3 0 0 0 5 0z M20 8l2.5 5.5a3 3 0 0 1-5 0z',
};

// カタログはテストで実在するキーだけに縛られているが、実行時に穴を開けないための保険。
const CATEGORY_FALLBACK = {
  arrival: 'flag',
  world: 'globe',
  mood: 'mask',
  roll: 'dice',
  fate: 'sparkle',
  survival: 'heart',
  trace: 'clock',
};

// ティアの差が色だけに乗らないよう、枠の太さと本数も併せて変える。銅と未取得は
// どちらも淡いので、実線と破線で区別する。
const TIER_RINGS = {
  1: { border: `1.5px solid ${COLORS.line}`, color: COLORS.brassDark },
  2: { border: `2px solid ${COLORS.brass}`, color: COLORS.brassDark },
  3: { border: `3px double ${COLORS.stamp}`, color: COLORS.stamp }, // 紙に押した朱印の見立て
};

const LOCKED_RING = { border: `2px dashed ${COLORS.faint}`, color: COLORS.faint };

export default function AchievementIcon({ icon, category, tier = 1, earned = false, size = 42 }) {
  const key = ICONS[icon] ? icon : CATEGORY_FALLBACK[category] || 'flag';
  const ring = earned ? TIER_RINGS[tier] || TIER_RINGS[1] : LOCKED_RING;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        flex: 'none',
        border: ring.border,
        color: ring.color,
        background: earned ? COLORS.card : 'transparent',
      }}
    >
      <svg
        width={Math.round(size * 0.5)}
        height={Math.round(size * 0.5)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ICONS[key]} />
      </svg>
    </span>
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/components/achievements/AchievementIcon.test.jsx`
Expected: PASS(5 tests)

- [ ] **Step 5: カタログのアイコンが実在することを検査するテストを足す**

Append to `src/engine/achievementCatalog.test.js`(`describe('the finished catalogue', ...)` の中):

```js
  it('only names glyphs that AchievementIcon actually draws', () => {
    for (const a of CATALOG) {
      expect(Object.keys(ICONS), a.id).toContain(a.icon);
    }
  });
```

冒頭の import に足す。

```js
import { ICONS } from '../components/achievements/AchievementIcon.jsx';
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `npx vitest run src/engine/achievementCatalog.test.js`
Expected: PASS。落ちた場合は `ICONS` に足りないグリフがあるので、カタログ側のキーを既存のグリフへ寄せる。

- [ ] **Step 7: コミットする**

```bash
git add src/components/achievements/AchievementIcon.jsx src/components/achievements/AchievementIcon.test.jsx src/engine/achievementCatalog.test.js
git commit -m "feat(achievements): ティアを枠で表すアイコンを追加"
```

---

### Task 7: 進捗バーと行

**Files:**
- Create: `src/utils/formatDate.js`
- Create: `src/utils/formatDate.test.js`
- Create: `src/components/achievements/AchievementProgressBar.jsx`
- Create: `src/components/achievements/AchievementProgressBar.test.jsx`
- Create: `src/components/achievements/AchievementRow.jsx`
- Create: `src/components/achievements/AchievementRow.test.jsx`
- Modify: `src/screens/EndingGallery.jsx`(ローカルの `formatDate` を共有ユーティリティへ置き換え)

**Interfaces:**
- Consumes: Task 6 の `AchievementIcon`
- Produces:
  - `formatDate(ms) -> string`(`src/utils/formatDate.js`、default export ではなく名前付き)
  - `AchievementProgressBar({ current, target, label, width })` — default export
  - `AchievementRow({ achievement })` — default export。`achievement` は `evaluateAchievements` の要素

- [ ] **Step 1: 失敗するテストを書く**

Create `src/utils/formatDate.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { formatDate } from './formatDate.js';

describe('formatDate', () => {
  it('formats a timestamp as a local YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 6, 5, 12).getTime())).toBe('2026-07-05');
  });

  it('returns an empty string for a missing timestamp', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(0)).toBe('');
  });
});
```

Create `src/components/achievements/AchievementProgressBar.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AchievementProgressBar from './AchievementProgressBar.jsx';

describe('AchievementProgressBar', () => {
  it('exposes the position to assistive technology', () => {
    render(<AchievementProgressBar current={3} target={10} label="十の結末の進捗" />);
    const bar = screen.getByRole('progressbar', { name: '十の結末の進捗' });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
  });

  it('fills in proportion to the target', () => {
    const { container } = render(<AchievementProgressBar current={3} target={10} label="進捗" />);
    expect(container.querySelector('div > div').style.width).toBe('30%');
  });

  it('never overflows when current exceeds target', () => {
    const { container } = render(<AchievementProgressBar current={30} target={10} label="進捗" />);
    expect(container.querySelector('div > div').style.width).toBe('100%');
  });

  it('stays at zero when the target is zero', () => {
    const { container } = render(<AchievementProgressBar current={0} target={0} label="進捗" />);
    expect(container.querySelector('div > div').style.width).toBe('0%');
  });
});
```

Create `src/components/achievements/AchievementRow.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AchievementRow from './AchievementRow.jsx';

function achievement(overrides = {}) {
  return {
    id: 'ten-endings',
    label: '十の結末',
    description: '10のエンディングに到達した',
    category: 'arrival',
    tier: 2,
    icon: 'library',
    earned: false,
    earnedAt: null,
    sessionId: null,
    progress: { current: 3, target: 10 },
    ...overrides,
  };
}

describe('AchievementRow', () => {
  it('shows the label and the condition', () => {
    render(<AchievementRow achievement={achievement()} />);
    expect(screen.getByText('十の結末')).toBeInTheDocument();
    expect(screen.getByText('10のエンディングに到達した')).toBeInTheDocument();
  });

  it('shows the earned date once earned, and no progress bar', () => {
    render(
      <AchievementRow
        achievement={achievement({ earned: true, earnedAt: new Date(2026, 6, 12, 9).getTime() })}
      />
    );
    expect(screen.getByText('2026-07-12')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows the count and a progress bar while unearned', () => {
    render(<AchievementRow achievement={achievement()} />);
    expect(screen.getByText('3 / 10')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '十の結末の進捗' })).toBeInTheDocument();
  });

  it('says 未取得 when there is nothing to count', () => {
    render(<AchievementRow achievement={achievement({ progress: null })} />);
    expect(screen.getByText('未取得')).toBeInTheDocument();
  });

  it('falls back to 取得済み when the record has no date', () => {
    render(<AchievementRow achievement={achievement({ earned: true, earnedAt: null })} />);
    expect(screen.getByText('取得済み')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/utils/formatDate.test.js src/components/achievements/`
Expected: FAIL — 3ファイルとも import 解決に失敗

- [ ] **Step 3: 3つのモジュールを書く**

Create `src/utils/formatDate.js`:

```js
// 図鑑と実績で同じ整形を使うための共有ユーティリティ。ローカルタイムゾーンで日付にする。
export function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

Create `src/components/achievements/AchievementProgressBar.jsx`:

```jsx
import { COLORS } from '../../theme.js';

export default function AchievementProgressBar({ current, target, label, width }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={0}
      aria-valuemax={target}
      aria-label={label}
      style={{ height: 4, borderRadius: 999, background: COLORS.paperDark, overflow: 'hidden', width }}
    >
      <div style={{ height: '100%', width: `${pct}%`, background: COLORS.brass }} />
    </div>
  );
}
```

Create `src/components/achievements/AchievementRow.jsx`:

```jsx
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';
import { formatDate } from '../../utils/formatDate.js';
import AchievementIcon from './AchievementIcon.jsx';
import AchievementProgressBar from './AchievementProgressBar.jsx';

// ラベルと条件は書体で階層を分ける。同じ書体で2行並べると1件の切れ目が読み取れないため。
export default function AchievementRow({ achievement }) {
  const { label, description, category, tier, icon, earned, earnedAt, progress } = achievement;
  // 色だけに情報を載せないよう、右端には必ず状態をテキストで出す
  const status = earned ? formatDate(earnedAt) || '取得済み' : progress ? `${progress.current} / ${progress.target}` : '未取得';
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '10px 0',
        borderTop: `1px solid ${COLORS.line}`,
      }}
    >
      <AchievementIcon icon={icon} category={category} tier={tier} earned={earned} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: earned ? COLORS.ink : COLORS.inkSoft }}>{label}</div>
        <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft, lineHeight: 1.6, marginTop: 2 }}>
          {description}
        </div>
        {!earned && progress && (
          <div style={{ marginTop: 6 }}>
            <AchievementProgressBar
              current={progress.current}
              target={progress.target}
              label={`${label}の進捗`}
              width={180}
            />
          </div>
        )}
      </div>
      <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, whiteSpace: 'nowrap', flex: 'none' }}>
        {status}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/utils/formatDate.test.js src/components/achievements/`
Expected: PASS

- [ ] **Step 5: 図鑑のローカルな formatDate を共有版へ置き換える**

Modify `src/screens/EndingGallery.jsx` — import に1行足す。

```jsx
import { formatDate } from '../utils/formatDate.js';
```

そしてファイル冒頭のローカル定義を削除する。

```jsx
function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
```

- [ ] **Step 6: 図鑑のテストが通ることを確認する**

Run: `npx vitest run src/screens/EndingGallery.test.jsx`
Expected: PASS

- [ ] **Step 7: コミットする**

```bash
git add src/utils/formatDate.js src/utils/formatDate.test.js src/components/achievements/ src/screens/EndingGallery.jsx
git commit -m "feat(achievements): 進捗バーと実績行のコンポーネントを追加"
```

---

### Task 8: 実績一覧画面とルーティング

**Files:**
- Create: `src/screens/AchievementList.jsx`
- Create: `src/screens/AchievementList.test.jsx`
- Modify: `src/router/useHashRoute.js`
- Modify: `src/router/useHashRoute.test.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: Task 5 の `CATEGORIES` / `evaluateAchievements`、Task 7 の `AchievementRow` / `AchievementProgressBar`
- Produces:
  - `parseHash(hash) -> { userId, endings, achievements }`
  - `navigateToAchievements(): void`
  - `AchievementList({ onClose })` — default export。`onClose` はホームへ戻るハンドラ

- [ ] **Step 1: ルーティングの失敗するテストを書く**

Modify `src/router/useHashRoute.test.jsx` — 既存の `toEqual` は戻り値のフィールドが増えると落ちるので、`achievements: false` を足す。

```js
    expect(parseHash('#/u/usr_ab12')).toEqual({ userId: 'usr_ab12', endings: false, achievements: false });
```

```js
    expect(parseHash('')).toEqual({ userId: null, endings: false, achievements: false });
    expect(parseHash('#/other')).toEqual({ userId: null, endings: false, achievements: false });
    expect(parseHash('#/u/')).toEqual({ userId: null, endings: false, achievements: false });
    expect(parseHash('#/u/../evil')).toEqual({ userId: null, endings: false, achievements: false });
```

```js
    expect(parseHash('#/endings')).toEqual({ userId: null, endings: true, achievements: false });
```

```js
    expect(parseHash('#/u/usr_1')).toEqual({ userId: 'usr_1', endings: false, achievements: false });
```

そして末尾に新しい describe を足し、冒頭の import に `navigateToAchievements` を加える。

```js
describe('achievements route', () => {
  it('parses the achievements hash', () => {
    expect(parseHash('#/achievements')).toEqual({ userId: null, endings: false, achievements: true });
  });

  it('does not treat other hashes as the achievements route', () => {
    expect(parseHash('#/achievements/extra').achievements).toBe(false);
    expect(parseHash('#/endings').achievements).toBe(false);
    expect(parseHash('').achievements).toBe(false);
  });

  it('navigates to the achievements route', () => {
    navigateToAchievements();
    expect(window.location.hash).toBe('#/achievements');
    expect(parseHash(window.location.hash).achievements).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/router/useHashRoute.test.jsx`
Expected: FAIL — `navigateToAchievements is not a function`

- [ ] **Step 3: ルートを足す**

Modify `src/router/useHashRoute.js`:

```js
const ENDINGS_HASH = '#/endings';
const ACHIEVEMENTS_HASH = '#/achievements';

export function parseHash(hash) {
  const h = hash || '';
  const m = USER_HASH_RE.exec(h);
  return { userId: m ? m[1] : null, endings: h === ENDINGS_HASH, achievements: h === ACHIEVEMENTS_HASH };
}
```

`navigateToEndings` の直後に足す。

```js
export function navigateToAchievements() {
  window.location.hash = ACHIEVEMENTS_HASH;
  notify(); // jsdom/一部環境ではhash代入がイベントを発火しないため明示的に通知
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/router/useHashRoute.test.jsx`
Expected: PASS

- [ ] **Step 5: 画面の失敗するテストを書く**

Create `src/screens/AchievementList.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import AchievementList from './AchievementList.jsx';
import * as endingClient from '../api/endingClient.js';
import { CATALOG } from '../engine/achievementCatalog.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';

const STATS = {
  total: 4,
  successes: 2,
  successRate: 0.5,
  byDegree: { fumble: 1, fail: 1, success: 1, critical: 1 },
  degrees: ['fumble', 'fail', 'success', 'critical'],
  resources: {},
};

function ending(overrides = {}) {
  return {
    sessionId: 's1',
    sessionTitle: '星降りの夜に',
    endingTitle: '灰は星を数えない',
    endedAt: new Date(2026, 6, 12, 9).getTime(),
    worldId: null,
    campaignId: null,
    formula: 'simple',
    moods: ['ホラー'],
    stats: STATS,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('AchievementList', () => {
  it('lists the whole catalogue', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    expect(await screen.findByText('初めての結末')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('未取得').length).toBeGreaterThan(0));
    expect(screen.getByText('五十の結末')).toBeInTheDocument();
    expect(screen.getByText('三日連続')).toBeInTheDocument();
  });

  it('shows how many are earned out of the catalogue', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    expect(await screen.findByText(`1 / ${CATALOG.length}`)).toBeInTheDocument();
  });

  it('filters down to the earned achievements', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /取得済み/ }));
    expect(screen.getByText('初めての結末')).toBeInTheDocument();
    expect(screen.queryByText('五十の結末')).toBeNull();
  });

  it('filters down to the unearned achievements', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /^未取得/ }));
    expect(screen.queryByText('初めての結末')).toBeNull();
    expect(screen.getByText('五十の結末')).toBeInTheDocument();
  });

  it('drops the other sections when a category is chosen', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '軌跡' }));
    expect(screen.getByText('三日連続')).toBeInTheDocument();
    expect(screen.queryByText('初めての結末')).toBeNull();
  });

  it('keeps the segment counts on the whole catalogue while a category is chosen', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<AchievementList onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '軌跡' }));
    // 絞り込むたびに数字が動くと「全体でいくつか」が読めなくなる
    expect(screen.getByRole('button', { name: '取得済み 1' })).toBeInTheDocument();
  });

  it('tells the visitor to sign in when signed out', async () => {
    const listEndings = vi.spyOn(endingClient, 'listEndings');
    renderWithAuth(<AchievementList onClose={vi.fn()} />, { user: null });
    expect(await screen.findByText(/ログインが必要です/)).toBeInTheDocument();
    expect(listEndings).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: テストが失敗することを確認する**

Run: `npx vitest run src/screens/AchievementList.test.jsx`
Expected: FAIL — `Failed to resolve import "./AchievementList.jsx"`

- [ ] **Step 7: 画面を書く**

Create `src/screens/AchievementList.jsx`:

```jsx
import { useState, useEffect, useMemo } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Button from '../components/ui/Button.jsx';
import AchievementRow from '../components/achievements/AchievementRow.jsx';
import AchievementProgressBar from '../components/achievements/AchievementProgressBar.jsx';
import { CATEGORIES } from '../engine/achievementCatalog.js';
import { evaluateAchievements } from '../engine/achievements.js';
import { listEndings } from '../api/endingClient.js';
import { navigateToEndings } from '../router/useHashRoute.js';
import { useAuth } from '../auth/AuthContext.jsx';

const SEGMENTS = [
  { key: 'earned', label: '取得済み' },
  { key: 'locked', label: '未取得' },
  { key: 'all', label: 'すべて' },
];

function Chip({ selected, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      style={{
        fontFamily: F_MONO,
        fontSize: 11,
        letterSpacing: 0.5,
        padding: '5px 12px',
        borderRadius: 999,
        cursor: 'pointer',
        border: `1px solid ${selected ? COLORS.brass : COLORS.line}`,
        background: selected ? COLORS.brass : 'transparent',
        color: selected ? COLORS.paper : COLORS.brassDark,
      }}
    >
      {children}
    </button>
  );
}

export default function AchievementList({ onClose }) {
  const { user } = useAuth();
  const [endings, setEndings] = useState([]);
  const [error, setError] = useState('');
  const [segment, setSegment] = useState('all');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    if (!user) {
      setEndings([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listEndings();
        if (!cancelled) setEndings(list);
      } catch (e) {
        if (!cancelled) setError('エンディングの取得に失敗した: ' + e.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const achievements = useMemo(() => evaluateAchievements(endings), [endings]);
  const earnedCount = achievements.filter((a) => a.earned).length;

  // 件数バッジはカテゴリ絞り込みの影響を受けない全体の数にする。
  // 絞り込むたびに数字が動くと「全体でいくつか」が読めなくなるため。
  const segmentCounts = {
    earned: earnedCount,
    locked: achievements.length - earnedCount,
    all: achievements.length,
  };

  const visible = achievements.filter((a) => {
    if (segment === 'earned' && !a.earned) return false;
    if (segment === 'locked' && a.earned) return false;
    return category === 'all' || a.category === category;
  });

  // セクション内は銅から順に埋まっていくのが見えるよう、ティア昇順→カタログ定義順にする
  const sections = CATEGORIES.map((c) => ({
    ...c,
    items: visible.filter((a) => a.category === c.key).sort((a, b) => a.tier - b.tier),
  })).filter((s) => s.items.length > 0);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
        <h1 style={{ fontFamily: F_DISPLAY, fontSize: 28, color: COLORS.ink, letterSpacing: 1 }}>実績</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button variant="ghost" onClick={navigateToEndings}>
            図鑑へ
          </Button>
          <Button variant="ghost" onClick={onClose}>
            ホームへ
          </Button>
        </div>
      </div>

      {!user && (
        <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint, marginBottom: 24 }}>
          実績の閲覧にはログインが必要です(右上からログイン)
        </div>
      )}

      {error && (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.stamp, marginBottom: 16 }}>{error}</div>
      )}

      {user && (
        <>
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginBottom: 6 }}>
            {earnedCount} / {achievements.length}
          </div>
          <AchievementProgressBar
            current={earnedCount}
            target={achievements.length}
            label="実績の取得状況"
          />

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '18px 0 8px' }}>
            {SEGMENTS.map((s) => (
              <Chip key={s.key} selected={segment === s.key} onClick={() => setSegment(s.key)}>
                {s.label} {segmentCounts[s.key]}
              </Chip>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 24 }}>
            <Chip selected={category === 'all'} onClick={() => setCategory('all')}>
              すべて
            </Chip>
            {CATEGORIES.map((c) => (
              <Chip key={c.key} selected={category === c.key} onClick={() => setCategory(c.key)}>
                {c.label}
              </Chip>
            ))}
          </div>

          {sections.length === 0 && (
            <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
              条件に合う実績がありません。
            </div>
          )}

          {sections.map((s) => (
            <div key={s.key} style={{ marginBottom: 28 }}>
              <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.brassDark, letterSpacing: 1 }}>
                {s.label}
              </div>
              {s.items.map((a) => (
                <AchievementRow key={a.id} achievement={a} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 8: テストが通ることを確認する**

Run: `npx vitest run src/screens/AchievementList.test.jsx`
Expected: PASS(7 tests)

- [ ] **Step 9: App にルートを足す**

Modify `src/App.jsx` — import を足す。

```jsx
import AchievementList from './screens/AchievementList.jsx';
```

ルートの取り出しに1つ足す。

```jsx
  const { userId: routeUserId, endings: routeEndings, achievements: routeAchievements } = useHashRoute();
```

`routeEndings` のブロックの直後に足す。

```jsx
  if (routeAchievements) {
    return (
      <div
        style={{
          background: COLORS.paper,
          minHeight: '100vh',
          color: COLORS.ink,
        }}
      >
        <AuthBar />
        <AchievementList onClose={clearHash} />
      </div>
    );
  }
```

- [ ] **Step 10: 全体のテストが通ることを確認する**

Run: `npm test`
Expected: PASS(既知のフレークを除く)

- [ ] **Step 11: コミットする**

```bash
git add src/screens/AchievementList.jsx src/screens/AchievementList.test.jsx src/router/useHashRoute.js src/router/useHashRoute.test.jsx src/App.jsx
git commit -m "feat(achievements): 実績一覧画面と #/achievements ルートを追加"
```

---

### Task 9: 図鑑上部を進捗サマリーに置き換える

**Files:**
- Create: `src/components/achievements/AchievementTile.jsx`
- Modify: `src/screens/EndingGallery.jsx`
- Modify: `src/screens/EndingGallery.test.jsx`

**Interfaces:**
- Consumes: Task 6〜8 の `AchievementIcon` / `AchievementProgressBar` / `navigateToAchievements`
- Produces: `AchievementTile({ achievement })` — default export

- [ ] **Step 1: 失敗するテストを書く**

Modify `src/screens/EndingGallery.test.jsx` — 既存の

```js
    expect(await screen.findByText('初めての結末')).toBeInTheDocument();
    expect(screen.getByText('三つの結末')).toBeInTheDocument();
```

を含むテストを、サマリー表示に合わせて書き直す。該当の `it` ブロック全体を次に差し替える。

```js
  it('summarises the achievements instead of listing the whole catalogue', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    expect(await screen.findByText(`1 / ${CATALOG.length}`)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '実績の取得状況' })).toBeInTheDocument();
    // 直近の獲得だけを出すので、未取得の実績は図鑑には並ばない
    expect(screen.getByText('初めての結末')).toBeInTheDocument();
    expect(screen.queryByText('五十の結末')).toBeNull();
  });

  it('shows at most three recently earned achievements, newest first', async () => {
    const many = [1, 2, 3].map((i) =>
      ending({ sessionId: `s${i}`, endedAt: new Date(2026, 6, i, 9).getTime(), worldId: 'w1' })
    );
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue(many);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    const tiles = await screen.findAllByTestId('achievement-tile');
    expect(tiles.length).toBe(3);
    const dates = tiles.map((t) => t.textContent.match(/\d{4}-\d{2}-\d{2}/)[0]);
    expect([...dates]).toEqual([...dates].sort().reverse());
  });

  it('says so when nothing has been earned yet', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    expect(await screen.findByText(/まだ実績がありません/)).toBeInTheDocument();
  });

  it('links to the full achievement list', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /すべて見る/ }));
    expect(window.location.hash).toBe('#/achievements');
  });
```

冒頭の import に `CATALOG` を足す。

```js
import { CATALOG } from '../engine/achievementCatalog.js';
```

末尾に後片付けを足す(ハッシュを残すと他のテストへ漏れる)。

```js
afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});
```

`afterEach` を vitest の import に加える。

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/screens/EndingGallery.test.jsx`
Expected: FAIL — `1 / 50` が見つからない

- [ ] **Step 3: タイルを書く**

Create `src/components/achievements/AchievementTile.jsx`:

```jsx
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';
import { formatDate } from '../../utils/formatDate.js';
import AchievementIcon from './AchievementIcon.jsx';

// 図鑑の「直近の獲得」用。取得済みだけを並べる場所なので、進捗も未取得の表現も持たない。
export default function AchievementTile({ achievement }) {
  const { label, description, category, tier, icon, earnedAt } = achievement;
  return (
    <div
      data-testid="achievement-tile"
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 6,
        padding: '12px 10px',
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <AchievementIcon icon={icon} category={category} tier={tier} earned />
      </div>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink }}>{label}</div>
      <div style={{ fontFamily: F_BODY, fontSize: 11, color: COLORS.inkSoft, lineHeight: 1.5, marginTop: 3 }}>
        {description}
      </div>
      <div style={{ fontFamily: F_MONO, fontSize: 10, color: COLORS.faint, marginTop: 6 }}>
        {formatDate(earnedAt)}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 図鑑を書き換える**

Modify `src/screens/EndingGallery.jsx` — import を差し替える。

```jsx
import AchievementTile from '../components/achievements/AchievementTile.jsx';
import AchievementProgressBar from '../components/achievements/AchievementProgressBar.jsx';
import { navigateToAchievements } from '../router/useHashRoute.js';
```

`achievements` の `useMemo` の直後に足す。

```jsx
  // 図鑑では取得済みの直近3件だけを見せ、全件は #/achievements に任せる。
  // 件数が増えても図鑑本体(エンディング一覧)が押し下げられないようにするため。
  const earned = useMemo(() => achievements.filter((a) => a.earned), [achievements]);
  const recent = useMemo(
    () => [...earned].sort((a, b) => (b.earnedAt || 0) - (a.earnedAt || 0)).slice(0, 3),
    [earned]
  );
```

そして実績のブロック(`<div ...>実績</div>` から、その下の `flexWrap` の `div` の閉じまで)を次に置き換える。

```jsx
      {user && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.brassDark }}>
              実績 {earned.length} / {achievements.length}
            </div>
            <Button variant="ghost" onClick={navigateToAchievements} style={{ fontSize: 12, padding: '6px 10px' }}>
              すべて見る →
            </Button>
          </div>
          <AchievementProgressBar
            current={earned.length}
            target={achievements.length}
            label="実績の取得状況"
          />
          {recent.length === 0 ? (
            <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft, marginTop: 10 }}>
              まだ実績がありません。物語を結末まで進めると集まります。
            </div>
          ) : (
            <>
              <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, margin: '14px 0 8px' }}>
                直近の獲得
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                {recent.map((a) => (
                  <AchievementTile key={a.id} achievement={a} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
```

`Badge` が図鑑の他の箇所(moods)でまだ使われているので、import は消さない。

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/screens/EndingGallery.test.jsx`
Expected: PASS

`shows at most three recently earned achievements` の記録3件(同じ世界 `w1`、雰囲気ホラー、判定4回、7月1〜3日の連日)では `first-ending` / `mood-horror` / `short-story` / `three-endings` / `world-trilogy` / `streak-three` の6件が立つので、タイルは3件で頭打ちになる。

- [ ] **Step 6: 全体のテストが通ることを確認する**

Run: `npm test`
Expected: PASS(既知のフレークを除く)

- [ ] **Step 7: コミットする**

```bash
git add src/components/achievements/AchievementTile.jsx src/screens/EndingGallery.jsx src/screens/EndingGallery.test.jsx
git commit -m "feat(achievements): 図鑑上部を実績の進捗サマリーに置き換える"
```

---

### Task 10: ドキュメントの更新

**Files:**
- Modify: `docs/05-ui-ux.md`
- Modify: `docs/02-data-model.md`
- Modify: `docs/08-feature-ideas.md`
- Modify: `docs/superpowers/specs/2026-07-25-ending-collection-design.md`

**Interfaces:**
- Consumes: 完成したコード
- Produces: なし

- [ ] **Step 1: 実装とドキュメントの食い違いを洗い出す**

Run: `grep -rn "実績" docs/*.md docs/superpowers/specs/2026-07-25-ending-collection-design.md`

出てきた箇所を全て開き、「実績は8件」「図鑑の上部に全件を並べる」を前提にした記述を特定する。

- [ ] **Step 2: `docs/05-ui-ux.md` を直す**

エンディング図鑑の節に、上部が `実績 12 / 50` の進捗帯＋直近獲得3件のタイル＋「すべて見る →」になったことを書く。続けて実績一覧画面の節を足し、次を書く。

- ルートは `#/achievements`、入口は図鑑の「すべて見る →」だけ(ホームからの直接の導線は作らない)
- 取得済み / 未取得 / すべて のセグメントと、カテゴリ(到達・世界・雰囲気・判定・運命・生還・軌跡)の絞り込み
- 件数バッジは絞り込みの影響を受けない全体の数
- セクション内はティア昇順
- ティアは枠で表す(銅=実線細・銀=実線太・金=二重線＋朱)。未取得は破線。色だけに頼らないよう右端に獲得日・進捗・「未取得」をテキストで出す

- [ ] **Step 3: `docs/02-data-model.md` を直す**

実績の節に、カタログエントリの形(`id` / `label` / `description` / `category` / `tier` / `icon` / `isEarnedBy` / 任意の `progress` と `target`)と、`evaluateAchievements` の戻り値(`progress: { current, target } | null` を含む)を書く。実績は保存を持たず記録から導出する、という既存の説明は残す。

- [ ] **Step 4: `docs/08-feature-ideas.md` を直す**

エンディングコレクション/実績の項に、実績が50件・7カテゴリ・3ティアで専用画面を持つことを反映する。

- [ ] **Step 5: 既存の設計書を直す**

Modify `docs/superpowers/specs/2026-07-25-ending-collection-design.md` — 5章の8件の表と6章の画面構成図は本機能で置き換わったので、表と図をそのまま残さず、次の一文と参照に差し替える。

```markdown
実績は後続の [2026-07-25-achievements-expansion-design.md](2026-07-25-achievements-expansion-design.md) で50件・7カテゴリへ拡張し、一覧は専用画面 `#/achievements` へ移した。カタログの定義と図鑑上部の構成はそちらを参照。
```

「エンディング記録のコレクションだけから導出する。実績の保存を持たない」という設計の核は今も生きているので、その説明は残す。

- [ ] **Step 6: リンクが壊れていないことを確認する**

Run: `grep -n "achievements-expansion" docs/superpowers/specs/2026-07-25-ending-collection-design.md docs/05-ui-ux.md`
Expected: 参照が意図した箇所に入っている

- [ ] **Step 7: 最終確認**

Run: `npm test`
Expected: PASS(既知のフレークを除く)

- [ ] **Step 8: コミットする**

```bash
git add docs/
git commit -m "docs: 実績の拡張と実績一覧画面をドキュメントに反映する"
```

---

## 動作確認

コミット後、実際の画面で確かめる。

Run: `npm run dev`

1. ログインして `#/endings` を開く。上部が `実績 N / 50` の帯になり、直近の獲得が最大3件のタイルで出ること
2. 「すべて見る →」で `#/achievements` へ移り、7つのセクションに50件が並ぶこと
3. 「取得済み」「未取得」で切り替わり、カテゴリチップで1セクションに絞れること。件数バッジが絞り込みで動かないこと
4. 未取得の行に進捗バーと `3 / 10` が出ること
5. 銅・銀・金の枠が見分けられること。ブラウザの拡大を200%にしても行が崩れないこと
6. 「図鑑へ」で戻れること
