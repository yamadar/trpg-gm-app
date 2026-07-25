# エンディングコレクション/実績 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完結したセッションにGMがエンディングタイトルを付け、ダイス統計とともに記録して図鑑画面で集められるようにし、記録から実績を導出して表示する。

**Architecture:** 完結確定の瞬間のセッションからスナップショット(エンディング記録)を作り、`users/{userId}/endings/{sessionId}` に保存する。ダイス統計は判定式アダプタの `degrees` 語彙を使う純関数としてクライアント側に置き、記録に同梱してサーバーへ送る(サーバーは `src/` を import できないため)。実績は記録のコレクションから導出する純関数で、独立した保存を持たない。

**Tech Stack:** React 18(ビルドツールなしの inline style)、Express 4、vitest + @testing-library/react + supertest、fs ベースの `dataStore`。

**設計spec:** [docs/superpowers/specs/2026-07-25-ending-collection-design.md](../specs/2026-07-25-ending-collection-design.md)

## Global Constraints

- ブランチは `feat/ending-collection`(作成済み)。main へ直接コミットしない。
- テスト: 単一ファイルは `npx vitest run <path>`、全体は `npm test`。既存の 1029 テストを壊さない。
- `server/routes/characters.test.js` の「lists characters scoped to world and kind」は並列実行時にタイムアウトする既知のフレーク。落ちたら単体で再実行して確認する。
- UI文言・プロンプト文言は日本語。コメントも既存に倣い日本語で、「なぜ」を書く(「何を」はコードが語る)。
- スタイルは inline style + `src/theme.js` の `COLORS` / `F_DISPLAY` / `F_BODY` / `F_MONO`。CSSファイルは追加しない。
- **後方互換**: 旧セッションは `ruleset.formula` も `state.resources` も持たない。`resolveAdapter` は未知/未指定の formula を `simple` に落とすので、統計は必ず `['fumble','fail','success','critical']` の語彙で成立する。実在しないリソースは出さない。
- **サーバーは `src/` を import できない**(既存の制約)。統計・実績のロジックをサーバー側へ複製しないこと。
- テストファイルは実装ファイルと同じディレクトリに `<name>.test.js(x)`。サーバーのテストは冒頭に `// @vitest-environment node` が必要。
- `stats` はクライアントが計算してサーバーへ送る自己申告値。サーバーは形(オブジェクトであること)だけを検証し、中身は信用する(セッション本体を `PUT /api/sessions/:id` で丸ごと受け取っている既存の流儀と同じ)。

---

## File Structure

**新規作成**

| ファイル | 責務 |
|---|---|
| `src/engine/resolveRuleset.js` | セッション→ルールセット/判定式アダプタの解決(`prompts.js` から移設) |
| `src/engine/rollStats.js` | セッションのログからダイス統計を集計する純関数 |
| `src/engine/achievements.js` | エンディング記録のコレクションから実績を導出する純関数 |
| `server/storage/endingLibrary.js` | エンディング記録の保存・取得・一覧・削除 |
| `server/endingNaming.js` | エンディングタイトルと総括のAI生成 |
| `server/routes/endings.js` | エンディング記録のHTTP層 |
| `src/api/endingClient.js` | エンディングAPIのクライアント |
| `src/components/ui/RollStatsLine.jsx` | ダイス統計の1行表示(図鑑とPlayで共用) |
| `src/screens/EndingGallery.jsx` | エンディング図鑑画面 |

いずれも同ディレクトリに `.test.js(x)` を伴う。

**変更**

| ファイル | 変更内容 |
|---|---|
| `src/api/prompts.js` | `resolveRuleset` / `resolveAdapter` を `src/engine/resolveRuleset.js` から import・再export |
| `server/storage/paths.js` | `endingKey` / `endingListPrefix` を追加 |
| `server/index.js` | endings ルーターをマウント |
| `src/router/useHashRoute.js` | `#/endings` ルートと `navigateToEndings` を追加 |
| `src/App.jsx` | `#/endings` で `EndingGallery` を描画 |
| `src/screens/Play.jsx` | 完結確定時に記録し、結果カード・再試行を出す |
| `src/screens/Home.jsx` | 図鑑への導線、記録済みセッションのタイトル表示、未記録の記録ボタン |
| `docs/*.md` | 実装に合わせて同期 |

---

## Task 1: ルールセット解決の切り出し

統計モジュールが判定式アダプタを必要とするが、`resolveAdapter` は現在プロンプト生成モジュールにある。判定エンジン側へ移して層の逆転を避ける。

**Files:**
- Create: `src/engine/resolveRuleset.js`
- Test: `src/engine/resolveRuleset.test.js`
- Modify: `src/api/prompts.js:1-2, 103-109`

**Interfaces:**
- Consumes: `src/data/rulesets.js` の `RULESETS`、`src/engine/rulesetAdapters.js` の `getAdapter`
- Produces:
  - `export function resolveRuleset(session)` — `session.ruleset` → `RULESETS` から `rulesetId` 検索 → `RULESETS[0]` の順で解決
  - `export function resolveAdapter(session)` — `getAdapter(resolveRuleset(session).formula)`
  - `src/api/prompts.js` は引き続き `resolveAdapter` を named export する(`src/api/session.js:2` が prompts.js から import しているため)

- [ ] **Step 1: Write the failing test**

`src/engine/resolveRuleset.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { resolveRuleset, resolveAdapter } from './resolveRuleset.js';
import { RULESETS } from '../data/rulesets.js';

describe('resolveRuleset', () => {
  it('prefers the ruleset snapshot stored on the session', () => {
    const session = { ruleset: { id: 'custom', label: 'カスタム', formula: 'coc7e' }, rulesetId: 'simple' };
    expect(resolveRuleset(session).id).toBe('custom');
  });

  it('falls back to the built-in ruleset matching rulesetId', () => {
    const target = RULESETS[RULESETS.length - 1];
    expect(resolveRuleset({ rulesetId: target.id }).id).toBe(target.id);
  });

  it('falls back to the first built-in ruleset when nothing matches', () => {
    expect(resolveRuleset({}).id).toBe(RULESETS[0].id);
    expect(resolveRuleset({ rulesetId: 'nope' }).id).toBe(RULESETS[0].id);
  });
});

describe('resolveAdapter', () => {
  it('resolves the adapter for the session formula', () => {
    const adapter = resolveAdapter({ ruleset: { id: 'x', formula: 'coc7e' } });
    expect(adapter.degrees).toContain('extreme');
  });

  it('falls back to the simple adapter for an unknown formula', () => {
    const adapter = resolveAdapter({ ruleset: { id: 'x', formula: 'nope' } });
    expect(adapter.degrees).toEqual(['fumble', 'fail', 'success', 'critical']);
  });

  it('falls back to the simple adapter for a legacy session with no formula', () => {
    const adapter = resolveAdapter({ rulesetId: 'simple' });
    expect(adapter.degrees).toEqual(['fumble', 'fail', 'success', 'critical']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/resolveRuleset.test.js`
Expected: FAIL — `Failed to resolve import "./resolveRuleset.js"`

- [ ] **Step 3: Create the module**

`src/engine/resolveRuleset.js`:

```js
import { RULESETS } from '../data/rulesets.js';
import { getAdapter } from './rulesetAdapters.js';

// セッションのルールセット解決。セッションが持つスナップショット(session.ruleset)を
// 最優先し、rulesetIdしか持たない旧セッションにも対応する。
export function resolveRuleset(session) {
  return session.ruleset || RULESETS.find((r) => r.id === session.rulesetId) || RULESETS[0];
}

// 判定式アダプタの解決。プロンプト生成と統計集計の双方が同じ規則を使うため、
// 判定エンジン側に置く(プロンプト側に置くと統計モジュールからの依存が層を逆転する)。
export function resolveAdapter(session) {
  return getAdapter(resolveRuleset(session).formula);
}
```

- [ ] **Step 4: Point `prompts.js` at the new module**

`src/api/prompts.js` の先頭2行:

```js
import { resolveRuleset, resolveAdapter } from '../engine/resolveRuleset.js';

export { resolveAdapter };
```

を追加し、既存の `import { RULESETS } from '../data/rulesets.js';` と `import { getAdapter } from '../engine/rulesetAdapters.js';` を削除する。`resolveRuleset` / `resolveAdapter` のローカル定義(103-109行目付近)も削除する。他の箇所(`buildSystemBlocks` / `buildTurnUserContent`)は変更しない。

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/engine/resolveRuleset.test.js src/api/prompts.test.js src/api/session.test.js`
Expected: PASS(全件)

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS(既知フレークを除く)

- [ ] **Step 7: Commit**

```bash
git add src/engine/resolveRuleset.js src/engine/resolveRuleset.test.js src/api/prompts.js
git commit -m "refactor: ルールセット解決を判定エンジン側へ切り出す"
```

---

## Task 2: ダイス統計

**Files:**
- Create: `src/engine/rollStats.js`
- Test: `src/engine/rollStats.test.js`

**Interfaces:**
- Consumes: Task 1 の `resolveAdapter(session)`。アダプタは `degrees: string[]` と `resourceDefs: [{ key, label, max, initial }]` を持つ
- Produces: `export function summarizeRolls(session)` →
  ```js
  {
    total: number,
    successes: number,
    successRate: number,                          // 0〜1。total===0 なら 0
    byDegree: { [degree: string]: number },       // adapter.degrees のキーのみ。0も含む
    degrees: string[],                            // 表示順(adapter.degrees)
    resources: { [key: string]: { label: string, value: number, max: number } },
  }
  ```

- [ ] **Step 1: Write the failing test**

`src/engine/rollStats.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { summarizeRolls } from './rollStats.js';

function simpleSession(log, state = {}) {
  return { ruleset: { id: 'simple', label: 'シンプル', formula: 'simple' }, log, state };
}

function cocSession(log, state = {}) {
  return { ruleset: { id: 'coc7e', label: 'CoC7e風', formula: 'coc7e' }, log, state };
}

describe('summarizeRolls', () => {
  it('returns an empty summary for a session with no log', () => {
    const stats = summarizeRolls(simpleSession([]));
    expect(stats.total).toBe(0);
    expect(stats.successes).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.byDegree).toEqual({ fumble: 0, fail: 0, success: 0, critical: 0 });
    expect(stats.resources).toEqual({});
  });

  it('ignores log entries that carry no roll', () => {
    const stats = summarizeRolls(simpleSession([{ role: 'gm', text: 'g' }, { role: 'player', text: 'p' }]));
    expect(stats.total).toBe(0);
  });

  it('counts rolls by degree and computes the success rate', () => {
    const stats = summarizeRolls(
      simpleSession([
        { role: 'gm', text: 'a', roll: { degree: 'success', success: true } },
        { role: 'gm', text: 'b', roll: { degree: 'critical', success: true } },
        { role: 'gm', text: 'c', roll: { degree: 'fail', success: false } },
        { role: 'gm', text: 'd', roll: { degree: 'fumble', success: false } },
      ])
    );
    expect(stats.total).toBe(4);
    expect(stats.successes).toBe(2);
    expect(stats.successRate).toBe(0.5);
    expect(stats.byDegree).toEqual({ fumble: 1, fail: 1, success: 1, critical: 1 });
  });

  it('exposes the simple degree vocabulary in display order', () => {
    expect(summarizeRolls(simpleSession([])).degrees).toEqual(['fumble', 'fail', 'success', 'critical']);
  });

  it('exposes the coc7e degree vocabulary including hard and extreme', () => {
    expect(summarizeRolls(cocSession([])).degrees).toEqual([
      'fumble',
      'fail',
      'success',
      'hard',
      'extreme',
      'critical',
    ]);
  });

  it('counts coc7e-only degrees for a coc7e session', () => {
    const stats = summarizeRolls(
      cocSession([
        { role: 'gm', text: 'a', roll: { degree: 'hard', success: true } },
        { role: 'gm', text: 'b', roll: { degree: 'extreme', success: true } },
      ])
    );
    expect(stats.byDegree.hard).toBe(1);
    expect(stats.byDegree.extreme).toBe(1);
  });

  it('does not report degrees outside the ruleset vocabulary but still counts them in the total', () => {
    const stats = summarizeRolls(
      simpleSession([{ role: 'gm', text: 'a', roll: { degree: 'extreme', success: true } }])
    );
    expect(stats.total).toBe(1);
    expect(stats.successes).toBe(1);
    expect(stats.byDegree.extreme).toBeUndefined();
  });

  it('reports resources the session actually has', () => {
    const stats = summarizeRolls(cocSession([], { resources: { san: { value: 12, max: 99 } } }));
    expect(stats.resources).toEqual({ san: { label: '正気度', value: 12, max: 99 } });
  });

  it('reports no resources for a legacy session that has none', () => {
    expect(summarizeRolls(cocSession([], {})).resources).toEqual({});
  });

  it('reports no resources for a ruleset that defines none', () => {
    const stats = summarizeRolls(simpleSession([], { resources: { san: { value: 12, max: 99 } } }));
    expect(stats.resources).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/rollStats.test.js`
Expected: FAIL — `Failed to resolve import "./rollStats.js"`

- [ ] **Step 3: Write the implementation**

`src/engine/rollStats.js`:

```js
import { resolveAdapter } from './resolveRuleset.js';

// セッションのログからダイス統計を集計する。ルールセット差はアダプタのdegrees語彙で
// 吸収する: CoC7e風だけがhard/extremeを持つので、他のルールセットの記録には現れない。
export function summarizeRolls(session) {
  const adapter = resolveAdapter(session);
  const rolls = (session.log || []).map((e) => e.roll).filter(Boolean);
  const byDegree = Object.fromEntries(adapter.degrees.map((d) => [d, 0]));

  let successes = 0;
  for (const r of rolls) {
    // 語彙外のdegree(ルールセットを変えた等)は内訳には数えないが、
    // 判定が行われた事実は total と successes に残す。
    if (r.degree in byDegree) byDegree[r.degree] += 1;
    if (r.success) successes += 1;
  }

  // リソースはアダプタが定義していても、セッションが実際に持っていなければ出さない
  // (旧セッションは state.resources を持たない)。
  const sessionResources = session.state?.resources || {};
  const resources = {};
  for (const def of adapter.resourceDefs) {
    const res = sessionResources[def.key];
    if (res) resources[def.key] = { label: def.label, value: res.value, max: res.max };
  }

  const total = rolls.length;
  return {
    total,
    successes,
    successRate: total === 0 ? 0 : successes / total,
    byDegree,
    degrees: adapter.degrees,
    resources,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/rollStats.test.js`
Expected: PASS(11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/rollStats.js src/engine/rollStats.test.js
git commit -m "feat(engine): セッションのダイス統計を集計する純関数を追加"
```

---

## Task 3: 実績の導出

**Files:**
- Create: `src/engine/achievements.js`
- Test: `src/engine/achievements.test.js`

**Interfaces:**
- Consumes: エンディング記録の配列。各要素は `{ sessionId, endedAt, worldId, stats: { total, byDegree, resources } }` を持つ(他のフィールドは無視する)
- Produces: `export function evaluateAchievements(endings)` → カタログ全8件を常に返す配列。各要素は
  ```js
  { id: string, label: string, description: string, earned: boolean, earnedAt: number | null, sessionId: string | null }
  ```
  順序はカタログ定義順。`earnedAt` / `sessionId` は条件を最初に満たした記録のもの(`endedAt` 昇順で判定するので決定的)

- [ ] **Step 1: Write the failing test**

`src/engine/achievements.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { evaluateAchievements } from './achievements.js';

function ending(overrides = {}) {
  return {
    sessionId: 's1',
    endedAt: 1000,
    worldId: null,
    stats: { total: 20, byDegree: { fumble: 1, fail: 5, success: 13, critical: 1 }, resources: {} },
    ...overrides,
  };
}

function find(list, id) {
  return list.find((a) => a.id === id);
}

describe('evaluateAchievements', () => {
  it('returns the whole catalogue unearned for an empty collection', () => {
    const result = evaluateAchievements([]);
    expect(result.length).toBe(8);
    expect(result.every((a) => a.earned === false)).toBe(true);
    expect(result.every((a) => a.earnedAt === null && a.sessionId === null)).toBe(true);
    expect(result.every((a) => typeof a.label === 'string' && typeof a.description === 'string')).toBe(true);
  });

  it('tolerates a null collection', () => {
    expect(evaluateAchievements(null).length).toBe(8);
  });

  it('earns 初めての結末 on the first ending', () => {
    const result = evaluateAchievements([ending({ sessionId: 'a', endedAt: 5 })]);
    expect(find(result, 'first-ending')).toMatchObject({ earned: true, earnedAt: 5, sessionId: 'a' });
  });

  it('earns 三つの結末 only at the third ending, crediting that ending', () => {
    const two = [ending({ sessionId: 'a', endedAt: 1 }), ending({ sessionId: 'b', endedAt: 2 })];
    expect(find(evaluateAchievements(two), 'three-endings').earned).toBe(false);

    const three = [...two, ending({ sessionId: 'c', endedAt: 3 })];
    expect(find(evaluateAchievements(three), 'three-endings')).toMatchObject({
      earned: true,
      earnedAt: 3,
      sessionId: 'c',
    });
  });

  it('credits the earliest qualifying ending regardless of input order', () => {
    const result = evaluateAchievements([
      ending({ sessionId: 'late', endedAt: 900 }),
      ending({ sessionId: 'early', endedAt: 100 }),
    ]);
    expect(find(result, 'first-ending')).toMatchObject({ earnedAt: 100, sessionId: 'early' });
  });

  it('earns 一つの世界の三つの結末 only when three endings share a world', () => {
    const mixed = [
      ending({ sessionId: 'a', endedAt: 1, worldId: 'w1' }),
      ending({ sessionId: 'b', endedAt: 2, worldId: 'w1' }),
      ending({ sessionId: 'c', endedAt: 3, worldId: 'w2' }),
    ];
    expect(find(evaluateAchievements(mixed), 'world-trilogy').earned).toBe(false);

    const sameWorld = [...mixed, ending({ sessionId: 'd', endedAt: 4, worldId: 'w1' })];
    expect(find(evaluateAchievements(sameWorld), 'world-trilogy')).toMatchObject({ earned: true, sessionId: 'd' });
  });

  it('does not group endings that have no world', () => {
    const noWorld = [
      ending({ sessionId: 'a', endedAt: 1, worldId: null }),
      ending({ sessionId: 'b', endedAt: 2, worldId: null }),
      ending({ sessionId: 'c', endedAt: 3, worldId: null }),
    ];
    expect(find(evaluateAchievements(noWorld), 'world-trilogy').earned).toBe(false);
  });

  it('earns 無傷の旅路 only when the ending had rolls and no fumble', () => {
    const clean = ending({ stats: { total: 5, byDegree: { fumble: 0, fail: 2, success: 3, critical: 0 }, resources: {} } });
    expect(find(evaluateAchievements([clean]), 'flawless').earned).toBe(true);

    const fumbled = ending({ stats: { total: 5, byDegree: { fumble: 1, fail: 1, success: 3, critical: 0 }, resources: {} } });
    expect(find(evaluateAchievements([fumbled]), 'flawless').earned).toBe(false);

    const noRolls = ending({ stats: { total: 0, byDegree: { fumble: 0, fail: 0, success: 0, critical: 0 }, resources: {} } });
    expect(find(evaluateAchievements([noRolls]), 'flawless').earned).toBe(false);
  });

  it('earns 豪運 at three criticals, not two', () => {
    const two = ending({ stats: { total: 9, byDegree: { fumble: 0, fail: 4, success: 3, critical: 2 }, resources: {} } });
    expect(find(evaluateAchievements([two]), 'lucky').earned).toBe(false);

    const three = ending({ stats: { total: 9, byDegree: { fumble: 0, fail: 3, success: 3, critical: 3 }, resources: {} } });
    expect(find(evaluateAchievements([three]), 'lucky').earned).toBe(true);
  });

  it('earns 厄日 at three fumbles, not two', () => {
    const two = ending({ stats: { total: 9, byDegree: { fumble: 2, fail: 4, success: 3, critical: 0 }, resources: {} } });
    expect(find(evaluateAchievements([two]), 'cursed').earned).toBe(false);

    const three = ending({ stats: { total: 9, byDegree: { fumble: 3, fail: 3, success: 3, critical: 0 }, resources: {} } });
    expect(find(evaluateAchievements([three]), 'cursed').earned).toBe(true);
  });

  it('earns 瀬戸際の生還 at sanity 10, not 11', () => {
    const eleven = ending({ stats: { total: 5, byDegree: {}, resources: { san: { label: '正気度', value: 11, max: 99 } } } });
    expect(find(evaluateAchievements([eleven]), 'brink').earned).toBe(false);

    const ten = ending({ stats: { total: 5, byDegree: {}, resources: { san: { label: '正気度', value: 10, max: 99 } } } });
    expect(find(evaluateAchievements([ten]), 'brink').earned).toBe(true);
  });

  it('never earns 瀬戸際の生還 for a ruleset without sanity', () => {
    expect(find(evaluateAchievements([ending()]), 'brink').earned).toBe(false);
  });

  it('earns 短編 at ten rolls, not eleven, and not zero', () => {
    const ten = ending({ stats: { total: 10, byDegree: {}, resources: {} } });
    expect(find(evaluateAchievements([ten]), 'short-story').earned).toBe(true);

    const eleven = ending({ stats: { total: 11, byDegree: {}, resources: {} } });
    expect(find(evaluateAchievements([eleven]), 'short-story').earned).toBe(false);

    const zero = ending({ stats: { total: 0, byDegree: {}, resources: {} } });
    expect(find(evaluateAchievements([zero]), 'short-story').earned).toBe(false);
  });

  it('tolerates a record with no stats at all', () => {
    const bare = { sessionId: 'x', endedAt: 1, worldId: null };
    const result = evaluateAchievements([bare]);
    expect(find(result, 'first-ending').earned).toBe(true);
    expect(find(result, 'flawless').earned).toBe(false);
    expect(find(result, 'brink').earned).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/achievements.test.js`
Expected: FAIL — `Failed to resolve import "./achievements.js"`

- [ ] **Step 3: Write the implementation**

`src/engine/achievements.js`:

```js
// 実績はエンディング記録のコレクションから導出する。独立した保存を持たないので、
// 定義を後から足しても過去の記録に遡って付き、マイグレーションが要らない。
//
// isEarnedBy は「endedAt昇順で先頭からi番目までの記録」を受け取り、その時点で
// 条件が成立したかを返す。単体条件の実績は末尾の記録だけを見ればよい
// (それ以前の記録で成立していれば、より早い反復で確定しているため)。

function last(list) {
  return list[list.length - 1];
}

function degreeCount(ending, degree) {
  return ending.stats?.byDegree?.[degree] ?? 0;
}

function rollTotal(ending) {
  return ending.stats?.total ?? 0;
}

const CATALOG = [
  {
    id: 'first-ending',
    label: '初めての結末',
    description: '初めてエンディングに到達した',
    isEarnedBy: (list) => list.length >= 1,
  },
  {
    id: 'three-endings',
    label: '三つの結末',
    description: '3つのエンディングに到達した',
    isEarnedBy: (list) => list.length >= 3,
  },
  {
    id: 'world-trilogy',
    label: '一つの世界の三つの結末',
    description: '同じ世界で3つのエンディングに到達した',
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
    id: 'flawless',
    label: '無傷の旅路',
    description: 'ファンブルを1度も出さずに完結した',
    isEarnedBy: (list) => rollTotal(last(list)) >= 1 && degreeCount(last(list), 'fumble') === 0,
  },
  {
    id: 'lucky',
    label: '豪運',
    description: '1つの物語でクリティカルを3回以上出した',
    isEarnedBy: (list) => degreeCount(last(list), 'critical') >= 3,
  },
  {
    id: 'cursed',
    label: '厄日',
    description: '1つの物語でファンブルを3回以上出した',
    isEarnedBy: (list) => degreeCount(last(list), 'fumble') >= 3,
  },
  {
    id: 'brink',
    label: '瀬戸際の生還',
    description: '正気度10以下で完結した',
    isEarnedBy: (list) => {
      const value = last(list).stats?.resources?.san?.value;
      return typeof value === 'number' && value <= 10;
    },
  },
  {
    id: 'short-story',
    label: '短編',
    description: '判定10回以下で完結した',
    isEarnedBy: (list) => {
      const total = rollTotal(last(list));
      return total >= 1 && total <= 10;
    },
  },
];

export function evaluateAchievements(endings) {
  const ascending = [...(endings || [])].sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
  return CATALOG.map(({ id, label, description, isEarnedBy }) => {
    for (let i = 0; i < ascending.length; i++) {
      if (isEarnedBy(ascending.slice(0, i + 1))) {
        return {
          id,
          label,
          description,
          earned: true,
          earnedAt: ascending[i].endedAt ?? null,
          sessionId: ascending[i].sessionId ?? null,
        };
      }
    }
    return { id, label, description, earned: false, earnedAt: null, sessionId: null };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/achievements.test.js`
Expected: PASS(14 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/achievements.js src/engine/achievements.test.js
git commit -m "feat(engine): エンディング記録から実績を導出する純関数を追加"
```

---

## Task 4: エンディング記録のストレージ

**Files:**
- Create: `server/storage/endingLibrary.js`
- Test: `server/storage/endingLibrary.test.js`
- Modify: `server/storage/paths.js`(`sessionNovelJobKey` の直後に2関数を追加)

**Interfaces:**
- Consumes: `dataStore`(`get` / `set` / `list` / `delete`)
- Produces:
  - `server/storage/paths.js`: `endingKey(userId, sessionId)` → `users/{userId}/endings/{sessionId}`、`endingListPrefix(userId)` → `users/{userId}/endings`
  - `server/storage/endingLibrary.js`: `saveEnding(dataStore, userId, ending)` → 保存した記録、`getEnding(dataStore, userId, sessionId)` → 記録 or null、`listEndings(dataStore, userId)` → `endedAt` 降順の配列、`deleteEnding(dataStore, userId, sessionId)` → void

- [ ] **Step 1: Add the path builders**

`server/storage/paths.js` の `sessionNovelJobKey` の直後に追加:

```js
export function endingKey(userId, sessionId) {
  return `users/${userId}/endings/${sessionId}`;
}

export function endingListPrefix(userId) {
  return `users/${userId}/endings`;
}
```

- [ ] **Step 2: Write the failing test**

`server/storage/endingLibrary.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { saveEnding, getEnding, listEndings, deleteEnding } from './endingLibrary.js';

let dir;
let dataStore;

function ending(overrides = {}) {
  return { sessionId: 's1', endingTitle: '灰は星を数えない', endedAt: 100, stats: { total: 3 }, ...overrides };
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ending-library-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('endingLibrary', () => {
  it('returns null for a missing ending', async () => {
    expect(await getEnding(dataStore, 'u1', 'nope')).toBeNull();
  });

  it('saves and retrieves an ending', async () => {
    await saveEnding(dataStore, 'u1', ending());
    expect(await getEnding(dataStore, 'u1', 's1')).toMatchObject({ sessionId: 's1', endingTitle: '灰は星を数えない' });
  });

  it('overwrites the record for the same session', async () => {
    await saveEnding(dataStore, 'u1', ending());
    await saveEnding(dataStore, 'u1', ending({ endingTitle: '書き直した題' }));
    expect((await getEnding(dataStore, 'u1', 's1')).endingTitle).toBe('書き直した題');
  });

  it('lists endings newest first', async () => {
    await saveEnding(dataStore, 'u1', ending({ sessionId: 'old', endedAt: 100 }));
    await saveEnding(dataStore, 'u1', ending({ sessionId: 'new', endedAt: 300 }));
    await saveEnding(dataStore, 'u1', ending({ sessionId: 'mid', endedAt: 200 }));
    expect((await listEndings(dataStore, 'u1')).map((e) => e.sessionId)).toEqual(['new', 'mid', 'old']);
  });

  it('returns an empty list for a user with no endings', async () => {
    expect(await listEndings(dataStore, 'u1')).toEqual([]);
  });

  it('scopes endings per user', async () => {
    await saveEnding(dataStore, 'u1', ending());
    expect(await listEndings(dataStore, 'u2')).toEqual([]);
    expect(await getEnding(dataStore, 'u2', 's1')).toBeNull();
  });

  it('deletes an ending and tolerates deleting a missing one', async () => {
    await saveEnding(dataStore, 'u1', ending());
    await deleteEnding(dataStore, 'u1', 's1');
    expect(await getEnding(dataStore, 'u1', 's1')).toBeNull();
    await expect(deleteEnding(dataStore, 'u1', 's1')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/storage/endingLibrary.test.js`
Expected: FAIL — `Failed to resolve import "./endingLibrary.js"`

- [ ] **Step 4: Write the implementation**

`server/storage/endingLibrary.js`:

```js
import { endingKey, endingListPrefix } from './paths.js';

// エンディング記録は sessionId をキーにする。1セッションにつき記録は1つで、
// 記録し直し(命名の再試行・改名)は同じキーへの上書きになる。
export async function saveEnding(dataStore, userId, ending) {
  await dataStore.set(endingKey(userId, ending.sessionId), ending);
  return ending;
}

export async function getEnding(dataStore, userId, sessionId) {
  return (await dataStore.get(endingKey(userId, sessionId))) ?? null;
}

export async function listEndings(dataStore, userId) {
  const keys = await dataStore.list(endingListPrefix(userId));
  const list = await Promise.all(keys.map((k) => dataStore.get(k)));
  return list.filter(Boolean).sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
}

export async function deleteEnding(dataStore, userId, sessionId) {
  await dataStore.delete(endingKey(userId, sessionId));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/storage/endingLibrary.test.js server/storage/paths.test.js`
Expected: PASS(全件)

- [ ] **Step 6: Commit**

```bash
git add server/storage/endingLibrary.js server/storage/endingLibrary.test.js server/storage/paths.js
git commit -m "feat(server): エンディング記録のストレージを追加"
```

---

## Task 5: エンディングの命名(AI呼び出し)

**Files:**
- Create: `server/endingNaming.js`
- Test: `server/endingNaming.test.js`

**Interfaces:**
- Consumes: セッションオブジェクト(`pc` / `state.history_summary` / `log`)
- Produces: `export async function nameEnding({ session, apiKey, fetchImpl })` → `{ endingTitle: string, summary: string }`。失敗時は `Error` を throw する

- [ ] **Step 1: Write the failing test**

`server/endingNaming.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { nameEnding } from './endingNaming.js';

const SESSION = {
  id: 's1',
  title: '星降りの夜に',
  pc: { raw: '探索者アリス', goal: '真実を知る', bonds: '妹' },
  state: { history_summary: '廃坑の奥で灯りが消えた。' },
  log: [
    { role: 'gm', text: '一つ目の場面' },
    { role: 'player', text: '進む' },
    { role: 'gm', text: '最後の場面' },
  ],
};

function okFetch(payload) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }], stop_reason: 'end_turn' }),
  });
}

describe('nameEnding', () => {
  it('returns the title and summary produced by the model', async () => {
    const fetchImpl = okFetch({ ending_title: '灰は星を数えない', summary: '彼女は坑道を出た。夜は明けなかった。' });
    const out = await nameEnding({ session: SESSION, apiKey: 'k', fetchImpl });
    expect(out).toEqual({ endingTitle: '灰は星を数えない', summary: '彼女は坑道を出た。夜は明けなかった。' });
  });

  it('sends the story summary, the PC and the closing narration', async () => {
    const fetchImpl = okFetch({ ending_title: 'a', summary: 'b' });
    await nameEnding({ session: SESSION, apiKey: 'k', fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.messages[0].content).toContain('廃坑の奥で灯りが消えた。');
    expect(body.messages[0].content).toContain('探索者アリス');
    expect(body.messages[0].content).toContain('最後の場面');
  });

  it('asks for structured output with both fields required', async () => {
    const fetchImpl = okFetch({ ending_title: 'a', summary: 'b' });
    await nameEnding({ session: SESSION, apiKey: 'k', fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.output_config.format.schema.required).toEqual(['ending_title', 'summary']);
  });

  it('trims whitespace around the model output', async () => {
    const fetchImpl = okFetch({ ending_title: '  題  ', summary: '  総括  ' });
    const out = await nameEnding({ session: SESSION, apiKey: 'k', fetchImpl });
    expect(out).toEqual({ endingTitle: '題', summary: '総括' });
  });

  it('throws when the upstream call fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(nameEnding({ session: SESSION, apiKey: 'k', fetchImpl })).rejects.toThrow('boom');
  });

  it('throws when the model returns unparseable output', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'not json' }], stop_reason: 'end_turn' }),
    });
    await expect(nameEnding({ session: SESSION, apiKey: 'k', fetchImpl })).rejects.toThrow(/invalid/);
  });

  it('throws when the model returns an empty title', async () => {
    const fetchImpl = okFetch({ ending_title: '   ', summary: '総括' });
    await expect(nameEnding({ session: SESSION, apiKey: 'k', fetchImpl })).rejects.toThrow(/empty/);
  });

  it('tolerates a session with no summary, no pc and no log', async () => {
    const fetchImpl = okFetch({ ending_title: '題', summary: '総括' });
    const out = await nameEnding({ session: { id: 's', state: {}, log: [] }, apiKey: 'k', fetchImpl });
    expect(out.endingTitle).toBe('題');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/endingNaming.test.js`
Expected: FAIL — `Failed to resolve import "./endingNaming.js"`

- [ ] **Step 3: Write the implementation**

`server/endingNaming.js`:

```js
const NAMING_TIMEOUT_MS = 60000;

// 結末付近の地の文を何件渡すか。全文を渡すと長大なセッションで無駄が大きく、
// 物語全体は history_summary が担うため、締めくくりの雰囲気を拾える程度に絞る。
const CLOSING_NARRATION_COUNT = 4;

const ENDING_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ending_title', 'summary'],
    properties: {
      ending_title: { type: 'string', description: 'エンディングタイトル(20字程度)' },
      summary: { type: 'string', description: '物語の総括(2〜3文)' },
    },
  },
};

const SYSTEM_PROMPT =
  'あなたはTRPGのGM。1つの物語が結末を迎えた。この物語に相応しいエンディングタイトルと短い総括を付けよ。タイトルは20字程度の日本語で、結末を象徴する簡潔なもの。総括は2〜3文で、何が起きどう終わったかを物語の語り口で書く。ゲーム的表現(フラグのキー名・数値・選択肢)や、物語内で明かされなかった秘密は書かないこと。';

function extractText(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function buildUserContent(session) {
  const closing = (session.log || [])
    .filter((e) => e.role === 'gm')
    .slice(-CLOSING_NARRATION_COUNT)
    .map((e) => e.text)
    .join('\n');
  const pc = [session.pc?.raw, session.pc?.goal && `goal: ${session.pc.goal}`, session.pc?.bonds && `bonds: ${session.pc.bonds}`]
    .filter(Boolean)
    .join('\n');
  return `# PC\n${pc || '(未設定)'}\n\n# 物語要約\n${session.state?.history_summary || '(なし)'}\n\n# 結末付近の地の文\n${closing || '(なし)'}`;
}

export async function nameEnding({ session, apiKey, fetchImpl = fetch }) {
  const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 500,
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent(session) }],
      output_config: { format: ENDING_OUTPUT_FORMAT },
    }),
    signal: AbortSignal.timeout(NAMING_TIMEOUT_MS),
  });
  if (!upstream.ok) {
    const t = await upstream.text().catch(() => '');
    throw new Error(`upstream request failed: ${t.slice(0, 200)}`);
  }
  const data = await upstream.json();
  let parsed;
  try {
    parsed = JSON.parse(extractText(data.content));
  } catch {
    throw new Error('ending naming produced invalid JSON');
  }
  const endingTitle = typeof parsed?.ending_title === 'string' ? parsed.ending_title.trim() : '';
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
  if (!endingTitle) throw new Error('ending naming produced an empty title');
  return { endingTitle, summary };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/endingNaming.test.js`
Expected: PASS(8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/endingNaming.js server/endingNaming.test.js
git commit -m "feat(server): エンディングタイトルと総括のAI命名を追加"
```

---

## Task 6: エンディングAPIのルート

**Files:**
- Create: `server/routes/endings.js`
- Test: `server/routes/endings.test.js`
- Modify: `server/index.js`(import 追加とルーターのマウント)

**Interfaces:**
- Consumes: Task 4 の `saveEnding` / `getEnding` / `listEndings` / `deleteEnding`、Task 5 の `nameEnding`、既存の `sessionKey`
- Produces:
  - `createEndingsRouter({ dataStore, apiKey, fetchImpl, usage })`
  - `POST /api/sessions/:id/ending` — ボディ `{ stats }` → `201 { ...ending }`
  - `GET /api/endings` → `200 [ending, ...]`(`endedAt` 降順)
  - `PATCH /api/endings/:id` — ボディ `{ endingTitle }` → `200 { ...ending }`
  - `DELETE /api/endings/:id` → `204`

- [ ] **Step 1: Write the failing test**

`server/routes/endings.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createEndingsRouter } from './endings.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { sessionKey } from '../storage/paths.js';

let dir;
let dataStore;
let app;

const STATS = { total: 3, successes: 2, successRate: 2 / 3, byDegree: { fumble: 0, fail: 1, success: 2, critical: 0 }, degrees: ['fumble', 'fail', 'success', 'critical'], resources: {} };

function okFetch(payload = { ending_title: '灰は星を数えない', summary: '総括の文。' }) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }], stop_reason: 'end_turn' }),
  });
}

function buildApp(opts = {}) {
  const apiKey = 'apiKey' in opts ? opts.apiKey : 'test-key';
  const { fetchImpl = okFetch(), usage, userId = 'usr_test' } = opts;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = userId;
    next();
  });
  app.use('/api', createEndingsRouter({ dataStore, apiKey, fetchImpl, usage }));
}

async function putSession(id, overrides = {}) {
  await dataStore.set(sessionKey('usr_test', id), {
    id,
    title: '星降りの夜に',
    endedAt: 500,
    worldId: 'w1',
    campaignId: 'cp1',
    rulesetId: 'coc7e',
    ruleset: { id: 'coc7e', formula: 'coc7e' },
    moods: ['ホラー'],
    state: { history_summary: 'まとめ' },
    log: [{ role: 'gm', text: '最後の場面' }],
    ...overrides,
  });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'endings-route-test-'));
  dataStore = createFsDataStore(dir);
  buildApp();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('endings routes', () => {
  it('returns 500 when no API key is configured', async () => {
    buildApp({ apiKey: undefined });
    await putSession('s1');
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.status).toBe(500);
  });

  it('returns 404 for a missing session', async () => {
    const res = await request(app).post('/api/sessions/missing/ending').send({ stats: STATS });
    expect(res.status).toBe(404);
  });

  it('returns 400 for a session that has not ended', async () => {
    await putSession('s1', { endedAt: undefined });
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.status).toBe(400);
  });

  it('returns 400 when stats is missing or not an object', async () => {
    await putSession('s1');
    expect((await request(app).post('/api/sessions/s1/ending').send({})).status).toBe(400);
    expect((await request(app).post('/api/sessions/s1/ending').send({ stats: 'x' })).status).toBe(400);
  });

  it('records the ending with the session fields and the supplied stats', async () => {
    await putSession('s1');
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sessionId: 's1',
      sessionTitle: '星降りの夜に',
      endingTitle: '灰は星を数えない',
      summary: '総括の文。',
      endedAt: 500,
      worldId: 'w1',
      campaignId: 'cp1',
      rulesetId: 'coc7e',
      formula: 'coc7e',
      moods: ['ホラー'],
      stats: STATS,
    });
    expect(typeof res.body.recordedAt).toBe('number');
  });

  it('records a null formula for a legacy session with no ruleset snapshot', async () => {
    await putSession('s1', { ruleset: undefined });
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.body.formula).toBeNull();
  });

  it('returns 502 and saves nothing when naming fails', async () => {
    buildApp({ fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }) });
    await putSession('s1');
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.status).toBe(502);
    expect(await request(app).get('/api/endings').then((r) => r.body)).toEqual([]);
  });

  it('returns 429 when the daily limit is exhausted, without calling the model', async () => {
    const fetchImpl = okFetch();
    buildApp({ fetchImpl, usage: { consume: async () => ({ ok: false, resetAt: 456 }) } });
    await putSession('s1');
    const res = await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(res.status).toBe(429);
    expect(res.body.resetAt).toBe(456);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('consumes the messages usage kind', async () => {
    const consume = vi.fn().mockResolvedValue({ ok: true });
    buildApp({ usage: { consume } });
    await putSession('s1');
    await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect(consume).toHaveBeenCalledWith('usr_test', 'messages');
  });

  it('lists endings newest first', async () => {
    await putSession('a', { endedAt: 100 });
    await putSession('b', { endedAt: 300 });
    await request(app).post('/api/sessions/a/ending').send({ stats: STATS });
    await request(app).post('/api/sessions/b/ending').send({ stats: STATS });
    const res = await request(app).get('/api/endings');
    expect(res.status).toBe(200);
    expect(res.body.map((e) => e.sessionId)).toEqual(['b', 'a']);
  });

  it('renames an ending', async () => {
    await putSession('s1');
    await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    const res = await request(app).patch('/api/endings/s1').send({ endingTitle: '  新しい題  ' });
    expect(res.status).toBe(200);
    expect(res.body.endingTitle).toBe('新しい題');
    expect(res.body.summary).toBe('総括の文。'); // 他のフィールドは保たれる
  });

  it('rejects a blank rename and a missing ending', async () => {
    await putSession('s1');
    await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect((await request(app).patch('/api/endings/s1').send({ endingTitle: '   ' })).status).toBe(400);
    expect((await request(app).patch('/api/endings/nope').send({ endingTitle: 'x' })).status).toBe(404);
  });

  it('deletes an ending', async () => {
    await putSession('s1');
    await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    expect((await request(app).delete('/api/endings/s1')).status).toBe(204);
    expect((await request(app).get('/api/endings')).body).toEqual([]);
  });

  it('does not expose the endings of another user', async () => {
    await putSession('s1');
    await request(app).post('/api/sessions/s1/ending').send({ stats: STATS });
    buildApp({ userId: 'usr_other' });
    expect((await request(app).get('/api/endings')).body).toEqual([]);
    expect((await request(app).patch('/api/endings/s1').send({ endingTitle: 'x' })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/routes/endings.test.js`
Expected: FAIL — `Failed to resolve import "./endings.js"`

- [ ] **Step 3: Write the router**

`server/routes/endings.js`:

```js
import { Router } from 'express';
import { sessionKey } from '../storage/paths.js';
import { saveEnding, getEnding, listEndings, deleteEnding } from '../storage/endingLibrary.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { nameEnding } from '../endingNaming.js';

export function createEndingsRouter({ dataStore, apiKey, fetchImpl = fetch, usage }) {
  const router = Router();
  router.param('id', idParamGuard);

  router.get('/endings', asyncHandler(async (req, res) => {
    res.json(await listEndings(dataStore, req.userId));
  }));

  router.post('/sessions/:id/ending', asyncHandler(async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
      return;
    }
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    if (!session.endedAt) {
      res.status(400).json({ error: 'session has not ended' });
      return;
    }
    // 統計はクライアントが集計して送る(サーバーはsrc/をimportできないため)。
    // 形だけを検証し、中身はセッション本体と同じくクライアントを信用する。
    const stats = req.body?.stats;
    if (typeof stats !== 'object' || stats === null || Array.isArray(stats)) {
      res.status(400).json({ error: 'stats must be an object' });
      return;
    }
    if (usage) {
      const check = await usage.consume(req.userId, 'messages');
      if (!check.ok) {
        res.status(429).json({ error: 'daily limit reached', resetAt: check.resetAt });
        return;
      }
    }
    let named;
    try {
      named = await nameEnding({ session, apiKey, fetchImpl });
    } catch (e) {
      res.status(502).json({ error: e.message });
      return;
    }
    const ending = {
      sessionId: req.params.id,
      sessionTitle: session.title || '',
      endingTitle: named.endingTitle,
      summary: named.summary,
      endedAt: session.endedAt,
      recordedAt: Date.now(),
      worldId: session.worldId ?? null,
      campaignId: session.campaignId ?? null,
      rulesetId: session.rulesetId ?? null,
      formula: session.ruleset?.formula ?? null,
      moods: Array.isArray(session.moods) ? session.moods : [],
      stats,
    };
    await saveEnding(dataStore, req.userId, ending);
    res.status(201).json(ending);
  }));

  router.patch('/endings/:id', asyncHandler(async (req, res) => {
    const endingTitle = req.body?.endingTitle;
    if (typeof endingTitle !== 'string' || endingTitle.trim() === '') {
      res.status(400).json({ error: 'endingTitle is required' });
      return;
    }
    const existing = await getEnding(dataStore, req.userId, req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'ending not found' });
      return;
    }
    res.json(await saveEnding(dataStore, req.userId, { ...existing, endingTitle: endingTitle.trim() }));
  }));

  router.delete('/endings/:id', asyncHandler(async (req, res) => {
    await deleteEnding(dataStore, req.userId, req.params.id);
    res.status(204).end();
  }));

  return router;
}
```

- [ ] **Step 4: Mount the router**

`server/index.js` の `import { createSessionsRouter } ...` の下に追加:

```js
import { createEndingsRouter } from './routes/endings.js';
```

`app.use('/api', createSessionsRouter({...}));` の直後に追加:

```js
  app.use('/api', createEndingsRouter({ dataStore, apiKey, fetchImpl, usage }));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/routes/endings.test.js server/index.test.js`
Expected: PASS(全件)

- [ ] **Step 6: Commit**

```bash
git add server/routes/endings.js server/routes/endings.test.js server/index.js
git commit -m "feat(server): エンディング記録のAPIを追加"
```

---

## Task 7: エンディングAPIのクライアント

**Files:**
- Create: `src/api/endingClient.js`
- Test: `src/api/endingClient.test.js`

**Interfaces:**
- Consumes: `src/api/apiFetch.js` の `apiFetch`
- Produces:
  - `recordEnding(sessionId, stats)` → `POST /api/sessions/:id/ending`、記録を返す
  - `listEndings()` → `GET /api/endings`、記録の配列
  - `renameEnding(sessionId, endingTitle)` → `PATCH /api/endings/:id`、更新後の記録
  - `deleteEnding(sessionId)` → `DELETE /api/endings/:id`、戻り値なし

- [ ] **Step 1: Write the failing test**

`src/api/endingClient.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { recordEnding, listEndings, renameEnding, deleteEnding } from './endingClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonFetch(body) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body });
}

describe('recordEnding', () => {
  it('POSTs the stats to the session ending endpoint', async () => {
    const fetchMock = jsonFetch({ sessionId: 's1', endingTitle: '題' });
    vi.stubGlobal('fetch', fetchMock);
    const stats = { total: 3 };

    const out = await recordEnding('s1', stats);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/s1/ending',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ stats }) })
    );
    expect(out.endingTitle).toBe('題');
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => 'boom' }));
    await expect(recordEnding('s1', {})).rejects.toThrow('API error 502: boom');
  });
});

describe('listEndings', () => {
  it('GETs the ending list', async () => {
    const fetchMock = jsonFetch([{ sessionId: 's1' }]);
    vi.stubGlobal('fetch', fetchMock);

    const out = await listEndings();

    expect(fetchMock).toHaveBeenCalledWith('/api/endings', undefined);
    expect(out).toHaveLength(1);
  });
});

describe('renameEnding', () => {
  it('PATCHes the new title', async () => {
    const fetchMock = jsonFetch({ sessionId: 's1', endingTitle: '新題' });
    vi.stubGlobal('fetch', fetchMock);

    await renameEnding('s1', '新題');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/endings/s1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ endingTitle: '新題' }) })
    );
  });
});

describe('deleteEnding', () => {
  it('DELETEs the ending without parsing a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteEnding('s1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('/api/endings/s1', expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'nope' }));
    await expect(deleteEnding('s1')).rejects.toThrow('API error 404: nope');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/endingClient.test.js`
Expected: FAIL — `Failed to resolve import "./endingClient.js"`

- [ ] **Step 3: Write the implementation**

`src/api/endingClient.js`:

```js
import { apiFetch } from './apiFetch.js';

export async function recordEnding(sessionId, stats) {
  return apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/ending`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stats }),
  });
}

export async function listEndings() {
  return apiFetch('/api/endings');
}

export async function renameEnding(sessionId, endingTitle) {
  return apiFetch(`/api/endings/${encodeURIComponent(sessionId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endingTitle }),
  });
}

// 204(本文なし)を返すため、JSONを読むapiFetchではなく素のfetchを使う
// (src/api/campaignClient.js の削除と同じ流儀)。
export async function deleteEnding(sessionId) {
  const res = await fetch(`/api/endings/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/endingClient.test.js`
Expected: PASS(6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/api/endingClient.js src/api/endingClient.test.js
git commit -m "feat(api): エンディングAPIのクライアントを追加"
```

---

## Task 8: `#/endings` ルート

**Files:**
- Modify: `src/router/useHashRoute.js`
- Modify: `src/router/useHashRoute.test.jsx`

**Interfaces:**
- Produces:
  - `parseHash(hash)` → `{ userId: string | null, endings: boolean }`(戻り値の形が変わる)
  - `navigateToEndings()` — `#/endings` へ遷移する
  - 既存の `navigateToUser` / `clearHash` / `useHashRoute` は変更しない

**注意:** `src/App.jsx` の分岐は Task 10 で `EndingGallery` を作ってから足す。このタスクはルーターだけを変更する。

- [ ] **Step 1: Write the failing test**

`src/router/useHashRoute.test.jsx` の末尾に追加:

```jsx
describe('endings route', () => {
  it('parses the endings hash', () => {
    expect(parseHash('#/endings')).toEqual({ userId: null, endings: true });
  });

  it('does not treat other hashes as the endings route', () => {
    expect(parseHash('#/endings/extra').endings).toBe(false);
    expect(parseHash('#/u/usr_1').endings).toBe(false);
    expect(parseHash('').endings).toBe(false);
  });

  it('still parses the user hash', () => {
    expect(parseHash('#/u/usr_1')).toEqual({ userId: 'usr_1', endings: false });
  });

  it('navigates to the endings route', () => {
    navigateToEndings();
    expect(window.location.hash).toBe('#/endings');
    expect(parseHash(window.location.hash).endings).toBe(true);
  });
});
```

同ファイル冒頭の import に `navigateToEndings` を加える。既存テストが `parseHash(...)` の戻り値を `toEqual({ userId: ... })` で比較している場合は `endings: false` を足す(`grep -n "toEqual({ userId" src/router/useHashRoute.test.jsx` で確認する)。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/router/useHashRoute.test.jsx`
Expected: FAIL — `navigateToEndings is not a function`

- [ ] **Step 3: Write the implementation**

`src/router/useHashRoute.js` の `parseHash` を差し替え、`navigateToEndings` を `navigateToUser` の直後に追加する:

```js
const USER_HASH_RE = /^#\/u\/([A-Za-z0-9._-]+)$/;
const ENDINGS_HASH = '#/endings';

export function parseHash(hash) {
  const h = hash || '';
  const m = USER_HASH_RE.exec(h);
  return { userId: m ? m[1] : null, endings: h === ENDINGS_HASH };
}
```

```js
export function navigateToEndings() {
  window.location.hash = ENDINGS_HASH;
  notify(); // jsdom/一部環境ではhash代入がイベントを発火しないため明示的に通知
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/router/useHashRoute.test.jsx src/App.test.jsx`
Expected: PASS(全件)

- [ ] **Step 5: Commit**

```bash
git add src/router/useHashRoute.js src/router/useHashRoute.test.jsx
git commit -m "feat(router): エンディング図鑑の #/endings ルートを追加"
```

---

## Task 9: ダイス統計の表示コンポーネント

図鑑とPlay画面の両方が同じ統計を表示するので、degree→日本語ラベルの対応表を1箇所に持つ。

**Files:**
- Create: `src/components/ui/RollStatsLine.jsx`
- Test: `src/components/ui/RollStatsLine.test.jsx`

**Interfaces:**
- Consumes: Task 2 の `summarizeRolls` が返す形の `stats`
- Produces: `export default function RollStatsLine({ stats })` — `stats` が無ければ `null` を返す

- [ ] **Step 1: Write the failing test**

`src/components/ui/RollStatsLine.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RollStatsLine from './RollStatsLine.jsx';

const SIMPLE = {
  total: 4,
  successes: 2,
  successRate: 0.5,
  byDegree: { fumble: 1, fail: 1, success: 1, critical: 1 },
  degrees: ['fumble', 'fail', 'success', 'critical'],
  resources: {},
};

describe('RollStatsLine', () => {
  it('renders nothing without stats', () => {
    const { container } = render(<RollStatsLine />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the roll count and the success rate as a percentage', () => {
    render(<RollStatsLine stats={SIMPLE} />);
    expect(screen.getByText(/判定 4回/)).toBeInTheDocument();
    expect(screen.getByText(/成功率 50%/)).toBeInTheDocument();
  });

  it('shows only degrees that actually occurred', () => {
    render(<RollStatsLine stats={{ ...SIMPLE, byDegree: { fumble: 0, fail: 3, success: 1, critical: 0 } }} />);
    expect(screen.getByText(/失敗 3/)).toBeInTheDocument();
    expect(screen.queryByText(/ファンブル/)).not.toBeInTheDocument();
  });

  it('shows coc7e-only degrees with their labels', () => {
    render(
      <RollStatsLine
        stats={{
          total: 2,
          successes: 2,
          successRate: 1,
          byDegree: { fumble: 0, fail: 0, success: 0, hard: 1, extreme: 1, critical: 0 },
          degrees: ['fumble', 'fail', 'success', 'hard', 'extreme', 'critical'],
          resources: {},
        }}
      />
    );
    expect(screen.getByText(/ハード成功 1/)).toBeInTheDocument();
    expect(screen.getByText(/イクストリーム成功 1/)).toBeInTheDocument();
  });

  it('shows resources the session had', () => {
    render(<RollStatsLine stats={{ ...SIMPLE, resources: { san: { label: '正気度', value: 12, max: 99 } } }} />);
    expect(screen.getByText(/正気度 12\/99/)).toBeInTheDocument();
  });

  it('handles a session with no rolls', () => {
    render(<RollStatsLine stats={{ total: 0, successes: 0, successRate: 0, byDegree: {}, degrees: [], resources: {} }} />);
    expect(screen.getByText(/判定 0回/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/RollStatsLine.test.jsx`
Expected: FAIL — `Failed to resolve import "./RollStatsLine.jsx"`

- [ ] **Step 3: Write the implementation**

`src/components/ui/RollStatsLine.jsx`:

```jsx
import { COLORS, F_MONO } from '../../theme.js';

// degreeの日本語ラベル。判定式ごとに語彙が違う(hard/extremeはCoC7e風のみ)ため、
// stats.degrees に含まれるものだけを引く。
const DEGREE_LABELS = {
  critical: 'クリティカル',
  extreme: 'イクストリーム成功',
  hard: 'ハード成功',
  success: '成功',
  fail: '失敗',
  fumble: 'ファンブル',
};

export default function RollStatsLine({ stats }) {
  if (!stats) return null;

  const parts = [`判定 ${stats.total}回`, `成功率 ${Math.round((stats.successRate || 0) * 100)}%`];
  // 0回のdegreeは並べても情報にならないので出さない。
  for (const degree of stats.degrees || []) {
    const count = stats.byDegree?.[degree] || 0;
    if (count > 0) parts.push(`${DEGREE_LABELS[degree] || degree} ${count}`);
  }
  for (const res of Object.values(stats.resources || {})) {
    parts.push(`${res.label} ${res.value}/${res.max}`);
  }

  return (
    <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark, lineHeight: 1.8 }}>
      {parts.join(' ・ ')}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/RollStatsLine.test.jsx`
Expected: PASS(6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/RollStatsLine.jsx src/components/ui/RollStatsLine.test.jsx
git commit -m "feat(ui): ダイス統計の1行表示コンポーネントを追加"
```

---

## Task 10: エンディング図鑑画面

**Files:**
- Create: `src/screens/EndingGallery.jsx`
- Test: `src/screens/EndingGallery.test.jsx`
- Modify: `src/App.jsx`
- Modify: `src/App.test.jsx`

**Interfaces:**
- Consumes: Task 3 の `evaluateAchievements`、Task 7 の `listEndings` / `renameEnding` / `deleteEnding`、Task 9 の `RollStatsLine`、既存の `Badge` / `Card` / `Button` / `ConfirmModal`、Task 8 の `parseHash().endings` と `clearHash`
- Produces: `export default function EndingGallery({ onClose })`

- [ ] **Step 1: Write the failing test**

`src/screens/EndingGallery.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import EndingGallery from './EndingGallery.jsx';
import * as endingClient from '../api/endingClient.js';
import { renderWithAuth } from '../test/renderWithAuth.jsx';

const SIMPLE_STATS = {
  total: 4,
  successes: 2,
  successRate: 0.5,
  byDegree: { fumble: 1, fail: 1, success: 1, critical: 1 },
  degrees: ['fumble', 'fail', 'success', 'critical'],
  resources: {},
};

const COC_STATS = {
  total: 6,
  successes: 4,
  successRate: 4 / 6,
  byDegree: { fumble: 0, fail: 2, success: 2, hard: 1, extreme: 1, critical: 0 },
  degrees: ['fumble', 'fail', 'success', 'hard', 'extreme', 'critical'],
  resources: { san: { label: '正気度', value: 12, max: 99 } },
};

function ending(overrides = {}) {
  return {
    sessionId: 's1',
    sessionTitle: '星降りの夜に',
    endingTitle: '灰は星を数えない',
    summary: '彼女は坑道を出た。',
    endedAt: 1000,
    worldId: null,
    moods: ['ホラー'],
    stats: SIMPLE_STATS,
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('EndingGallery', () => {
  it('shows an empty state when nothing has been recorded', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    expect(await screen.findByText(/まだエンディングの記録がありません/)).toBeInTheDocument();
  });

  it('lists recorded endings with their title, session and summary', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    expect(await screen.findByText('灰は星を数えない')).toBeInTheDocument();
    expect(screen.getByText(/星降りの夜に/)).toBeInTheDocument();
    expect(screen.getByText('彼女は坑道を出た。')).toBeInTheDocument();
    expect(screen.getByText('ホラー')).toBeInTheDocument();
  });

  it('shows ruleset-specific statistics only for the ruleset that has them', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([
      ending({ sessionId: 'a', endingTitle: '簡易の結末', stats: SIMPLE_STATS }),
      ending({ sessionId: 'b', endingTitle: 'CoCの結末', stats: COC_STATS }),
    ]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    await screen.findByText('CoCの結末');
    expect(screen.getByText(/ハード成功 1/)).toBeInTheDocument();
    expect(screen.getByText(/正気度 12\/99/)).toBeInTheDocument();
  });

  it('shows earned and unearned achievements', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    expect(await screen.findByText('初めての結末')).toBeInTheDocument();
    expect(screen.getByText('三つの結末')).toBeInTheDocument();
    expect(screen.getByText('初めてエンディングに到達した')).toBeInTheDocument();
  });

  it('renames an ending', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    const renameSpy = vi
      .spyOn(endingClient, 'renameEnding')
      .mockResolvedValue(ending({ endingTitle: '新しい題' }));
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('改名'));
    fireEvent.change(screen.getByDisplayValue('灰は星を数えない'), { target: { value: '新しい題' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() => expect(renameSpy).toHaveBeenCalledWith('s1', '新しい題'));
    expect(await screen.findByText('新しい題')).toBeInTheDocument();
  });

  it('cancels a rename without calling the API', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    const renameSpy = vi.spyOn(endingClient, 'renameEnding');
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('改名'));
    fireEvent.click(screen.getByText('取消'));

    expect(renameSpy).not.toHaveBeenCalled();
    expect(screen.getByText('灰は星を数えない')).toBeInTheDocument();
  });

  it('deletes an ending after confirmation', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([ending()]);
    const deleteSpy = vi.spyOn(endingClient, 'deleteEnding').mockResolvedValue(undefined);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);

    fireEvent.click(await screen.findByText('削除'));
    fireEvent.click(screen.getByText('削除する'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(screen.queryByText('灰は星を数えない')).not.toBeInTheDocument());
  });

  it('shows an error when loading fails', async () => {
    vi.spyOn(endingClient, 'listEndings').mockRejectedValue(new Error('boom'));
    renderWithAuth(<EndingGallery onClose={vi.fn()} />);
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });

  it('asks for login when logged out', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    renderWithAuth(<EndingGallery onClose={vi.fn()} />, { user: null });
    expect(await screen.findByText(/ログインが必要です/)).toBeInTheDocument();
  });

  it('closes the gallery', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    const onClose = vi.fn();
    renderWithAuth(<EndingGallery onClose={onClose} />);
    fireEvent.click(await screen.findByText('ホームへ'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/EndingGallery.test.jsx`
Expected: FAIL — `Failed to resolve import "./EndingGallery.jsx"`

- [ ] **Step 3: Write the screen**

`src/screens/EndingGallery.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Badge from '../components/ui/Badge.jsx';
import RollStatsLine from '../components/ui/RollStatsLine.jsx';
import ConfirmModal from '../components/library/ConfirmModal.jsx';
import { listEndings, renameEnding, deleteEnding } from '../api/endingClient.js';
import { evaluateAchievements } from '../engine/achievements.js';
import { useAuth } from '../auth/AuthContext.jsx';

function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function EndingGallery({ onClose }) {
  const { user } = useAuth();
  const [endings, setEndings] = useState([]);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

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

  const achievements = evaluateAchievements(endings);

  async function saveTitle(sessionId) {
    setBusyId(sessionId);
    setError('');
    try {
      const updated = await renameEnding(sessionId, draftTitle.trim());
      setEndings((prev) => prev.map((e) => (e.sessionId === sessionId ? updated : e)));
      setEditingId(null);
    } catch (e) {
      setError('改名に失敗した: ' + e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    const sessionId = pendingDelete;
    setBusyId(sessionId);
    setError('');
    try {
      await deleteEnding(sessionId);
      setEndings((prev) => prev.filter((e) => e.sessionId !== sessionId));
      setPendingDelete(null);
    } catch (e) {
      setError('削除に失敗した: ' + e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 24 }}>
        <h1 style={{ fontFamily: F_DISPLAY, fontSize: 28, color: COLORS.ink, letterSpacing: 1 }}>エンディング図鑑</h1>
        <Button variant="ghost" onClick={onClose}>
          ホームへ
        </Button>
      </div>

      {!user && (
        <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint, marginBottom: 24 }}>
          エンディング図鑑の閲覧にはログインが必要です(右上からログイン)
        </div>
      )}

      {error && (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.stamp, marginBottom: 16 }}>{error}</div>
      )}

      <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.brassDark, marginBottom: 10 }}>実績</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 32 }}>
        {achievements.map((a) => (
          <div key={a.id} style={{ opacity: a.earned ? 1 : 0.45 }}>
            <Badge variant={a.earned ? 'brass' : 'faint'}>{a.label}</Badge>
            <div style={{ fontFamily: F_BODY, fontSize: 11, color: COLORS.inkSoft, marginTop: 4, maxWidth: 200 }}>
              {a.description}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.brassDark, marginBottom: 10 }}>
        到達したエンディング
      </div>
      {user && endings.length === 0 && !error && (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
          まだエンディングの記録がありません。物語を結末まで進めて「この物語を終える」を押すと記録されます。
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {endings.map((e) => (
          <Card key={e.sessionId}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              {editingId === e.sessionId ? (
                <input
                  value={draftTitle}
                  onChange={(ev) => setDraftTitle(ev.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
              ) : (
                <div style={{ fontFamily: F_DISPLAY, fontSize: 17, color: COLORS.ink }}>{e.endingTitle}</div>
              )}
              <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, whiteSpace: 'nowrap' }}>
                {formatDate(e.endedAt)}
              </div>
            </div>
            <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, marginTop: 4 }}>
              セッション: {e.sessionTitle}
            </div>
            {e.moods?.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {e.moods.map((m) => (
                  <Badge key={m} variant="outline">
                    {m}
                  </Badge>
                ))}
              </div>
            )}
            {e.summary && (
              <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.inkSoft, lineHeight: 1.8, marginTop: 10 }}>
                {e.summary}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <RollStatsLine stats={e.stats} />
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginTop: 12,
                paddingTop: 12,
                borderTop: `1px solid ${COLORS.line}`,
              }}
            >
              {editingId === e.sessionId ? (
                <>
                  <Button
                    variant="brass"
                    onClick={() => saveTitle(e.sessionId)}
                    disabled={busyId === e.sessionId || draftTitle.trim() === ''}
                    style={{ fontSize: 12, padding: '6px 10px' }}
                  >
                    保存
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingId(null)} style={{ fontSize: 12, padding: '6px 10px' }}>
                    取消
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditingId(e.sessionId);
                      setDraftTitle(e.endingTitle);
                    }}
                    style={{ fontSize: 12, padding: '6px 10px' }}
                  >
                    改名
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setPendingDelete(e.sessionId)}
                    style={{ fontSize: 12, padding: '6px 10px' }}
                  >
                    削除
                  </Button>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>

      <ConfirmModal
        open={pendingDelete !== null}
        message="このエンディングの記録を削除しますか?(セッション自体は消えません)"
        confirmDisabled={busyId !== null}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
```

- [ ] **Step 4: Wire the route in `src/App.jsx`**

import に追加:

```js
import EndingGallery from './screens/EndingGallery.jsx';
import { useHashRoute, clearHash } from './router/useHashRoute.js';
```

(`useHashRoute` の import 行に `clearHash` を足す。)

`const { userId: routeUserId } = useHashRoute();` を差し替え:

```js
  const { userId: routeUserId, endings: routeEndings } = useHashRoute();
```

`if (routeUserId) { ... }` のブロックの直後に追加:

```jsx
  if (routeEndings) {
    return (
      <div
        style={{
          background: COLORS.paper,
          minHeight: '100vh',
          color: COLORS.ink,
        }}
      >
        <AuthBar />
        <EndingGallery onClose={clearHash} />
      </div>
    );
  }
```

- [ ] **Step 5: Add the App routing test**

`src/App.test.jsx` の末尾の `describe` 内に追加:

```jsx
  it('renders the ending gallery for the #/endings route', async () => {
    window.location.hash = '#/endings';
    try {
      render(<App />);
      expect(await screen.findByText('エンディング図鑑')).toBeInTheDocument();
    } finally {
      window.location.hash = '';
    }
  });
```

`src/App.test.jsx` が `listEndings` の実ネットワーク呼び出しで警告を出す場合は、ファイル冒頭で `vi.mock('./api/endingClient.js', () => ({ listEndings: vi.fn().mockResolvedValue([]), renameEnding: vi.fn(), deleteEnding: vi.fn() }));` を追加する。

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/screens/EndingGallery.test.jsx src/App.test.jsx`
Expected: PASS(全件)

- [ ] **Step 7: Commit**

```bash
git add src/screens/EndingGallery.jsx src/screens/EndingGallery.test.jsx src/App.jsx src/App.test.jsx
git commit -m "feat(ui): エンディング図鑑画面を追加"
```

---

## Task 11: Play画面での記録

**Files:**
- Modify: `src/screens/Play.jsx`
- Modify: `src/screens/Play.test.jsx`

**Interfaces:**
- Consumes: Task 2 の `summarizeRolls(session)`、Task 7 の `recordEnding(sessionId, stats)`、Task 9 の `RollStatsLine`
- Produces: なし(画面内で完結)

- [ ] **Step 1: Write the failing test**

`src/screens/Play.test.jsx` の末尾の `describe` 内に追加:

```jsx
  it('records the ending after the player finishes the story', async () => {
    vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    const recordSpy = vi.spyOn(endingClient, 'recordEnding').mockResolvedValue({
      sessionId: 's1',
      endingTitle: '灰は星を数えない',
      summary: '彼女は坑道を出た。',
      stats: { total: 1, successes: 1, successRate: 1, byDegree: { fumble: 0, fail: 0, success: 1, critical: 0 }, degrees: ['fumble', 'fail', 'success', 'critical'], resources: {} },
    });
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。', roll: { degree: 'success', success: true } }],
    });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);

    fireEvent.click(await screen.findByText('この物語を終える'));

    await waitFor(() => expect(recordSpy).toHaveBeenCalledWith('s1', expect.objectContaining({ total: 1 })));
    expect(await screen.findByText('灰は星を数えない')).toBeInTheDocument();
    expect(screen.getByText('彼女は坑道を出た。')).toBeInTheDocument();
  });

  it('keeps the session finished and offers a retry when recording fails', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    const recordSpy = vi.spyOn(endingClient, 'recordEnding').mockRejectedValue(new Error('boom'));
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。' }],
    });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);

    fireEvent.click(await screen.findByText('この物語を終える'));

    expect(await screen.findByText(/エンディングの記録に失敗した/)).toBeInTheDocument();
    expect(typeof saveSpy.mock.calls.at(-1)[0].endedAt).toBe('number'); // 完結自体は取り消さない
    expect(screen.getByText('完結')).toBeInTheDocument();

    recordSpy.mockResolvedValue({ sessionId: 's1', endingTitle: '再試行の題', summary: '', stats: null });
    fireEvent.click(screen.getByText('エンディングを記録する'));
    expect(await screen.findByText('再試行の題')).toBeInTheDocument();
  });
```

`src/screens/Play.test.jsx` 冒頭の import に追加:

```jsx
import * as endingClient from '../api/endingClient.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: FAIL — `recordEnding` が呼ばれない

- [ ] **Step 3: Add imports and state**

`src/screens/Play.jsx` の import に追加:

```js
import RollStatsLine from '../components/ui/RollStatsLine.jsx';
import { recordEnding } from '../api/endingClient.js';
import { summarizeRolls } from '../engine/rollStats.js';
```

`const [imageError, setImageError] = useState(null);` の下に追加:

```js
  const [ending, setEnding] = useState(null); // 記録済みのエンディング(この画面で確定した場合のみ)
  const [endingBusy, setEndingBusy] = useState(false);
  const [endingError, setEndingError] = useState('');
```

- [ ] **Step 4: Record on finish**

`src/screens/Play.jsx` の `finishStory` を差し替え、その下に記録処理を追加する:

```jsx
  // エンディングの記録。命名はサーバー側でAIが行い、統計はここで集計して送る
  // (サーバーはsrc/をimportできないため、集計ロジックをサーバーへ複製しない)。
  async function recordEndingNow() {
    const current = sessionRef.current;
    setEndingBusy(true);
    setEndingError('');
    try {
      setEnding(await recordEnding(current.id, summarizeRolls(current)));
    } catch (e) {
      setEndingError('エンディングの記録に失敗した: ' + e.message);
    } finally {
      setEndingBusy(false);
    }
  }

  async function finishStory() {
    const current = sessionRef.current;
    // 先に完結を確定させる。記録に失敗しても完結は取り消さない。
    await persistSession({ ...current, endedAt: Date.now(), updatedAt: Date.now() });
    await recordEndingNow();
  }
```

- [ ] **Step 5: Render the ending result**

`src/screens/Play.jsx` のエンディング案内カード(`{session.state?.ending_reached && !session.endedAt && (...)}`)の**直後**に追加:

```jsx
        {session.endedAt && endingBusy && (
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>エンディングを記録しています…</div>
        )}
        {session.endedAt && !endingBusy && ending && (
          <Card style={{ borderColor: COLORS.brass }}>
            <div style={{ fontFamily: F_DISPLAY, fontSize: 18, color: COLORS.ink, marginBottom: 8 }}>
              {ending.endingTitle}
            </div>
            {ending.summary && (
              <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.inkSoft, lineHeight: 1.8, marginBottom: 10 }}>
                {ending.summary}
              </div>
            )}
            <RollStatsLine stats={ending.stats} />
          </Card>
        )}
        {session.endedAt && !endingBusy && !ending && endingError && (
          <Card style={{ borderColor: COLORS.stamp }}>
            <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.stamp, marginBottom: 10 }}>{endingError}</div>
            <Button variant="ghost" onClick={recordEndingNow}>
              エンディングを記録する
            </Button>
          </Card>
        )}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS(全件)

- [ ] **Step 7: Commit**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "feat(ui): 完結の確定時にエンディングを記録し結果を表示する"
```

---

## Task 12: Home画面の導線と記録状態

**Files:**
- Modify: `src/screens/Home.jsx`
- Modify: `src/screens/Home.test.jsx`

**Interfaces:**
- Consumes: Task 2 の `summarizeRolls`、Task 7 の `listEndings` / `recordEnding`、Task 8 の `navigateToEndings`
- Produces: なし(画面内で完結)

- [ ] **Step 1: Write the failing test**

`src/screens/Home.test.jsx` の末尾の `describe` 内に追加:

```jsx
  it('navigates to the ending gallery', async () => {
    renderWithAuth(<Home sessions={[]} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} onOpenGallery={vi.fn()} />);
    fireEvent.click(screen.getByText('エンディング図鑑'));
    expect(window.location.hash).toBe('#/endings');
    window.location.hash = '';
  });

  it('shows the recorded ending title on a finished session', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([{ sessionId: 's1', endingTitle: '灰は星を数えない' }]);
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, endedAt: 500, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(await screen.findByText(/灰は星を数えない/)).toBeInTheDocument();
    expect(screen.queryByText('エンディングを記録する')).not.toBeInTheDocument();
  });

  it('offers to record an ending for a finished session that has none', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    const recordSpy = vi.spyOn(endingClient, 'recordEnding').mockResolvedValue({ sessionId: 's1', endingTitle: '後から付けた題' });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, endedAt: 500, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    fireEvent.click(await screen.findByText('エンディングを記録する'));

    await waitFor(() => expect(recordSpy).toHaveBeenCalledWith('s1', expect.objectContaining({ total: 0 })));
    expect(await screen.findByText(/後から付けた題/)).toBeInTheDocument();
  });

  it('does not offer to record an ending for a session still in progress', async () => {
    vi.spyOn(endingClient, 'listEndings').mockResolvedValue([]);
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    await screen.findByText('小説化する');
    expect(screen.queryByText('エンディングを記録する')).not.toBeInTheDocument();
  });
```

`src/screens/Home.test.jsx` 冒頭の import に追加:

```jsx
import * as endingClient from '../api/endingClient.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: FAIL — `Unable to find an element with the text: エンディング図鑑`

- [ ] **Step 3: Add imports and state**

`src/screens/Home.jsx` の import に追加:

```js
import { listEndings, recordEnding } from '../api/endingClient.js';
import { summarizeRolls } from '../engine/rollStats.js';
import { navigateToEndings } from '../router/useHashRoute.js';
```

`const [campaignMap, setCampaignMap] = useState({});` の下に追加:

```js
  const [endingMap, setEndingMap] = useState({}); // sessionId -> エンディング記録
  const [endingBusy, setEndingBusy] = useState({});
```

- [ ] **Step 4: Fetch the endings**

`publishedNovels` の useEffect の下に追加:

```jsx
  useEffect(() => {
    if (!user) {
      setEndingMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await listEndings();
        if (!cancelled) setEndingMap(Object.fromEntries(list.map((e) => [e.sessionId, e])));
      } catch {
        // 記録の取得に失敗してもホーム自体は使えるようにする(黙って無視する)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);
```

- [ ] **Step 5: Add the record handler**

`handleNextChapter` の下に追加:

```jsx
  // Play画面での確定時に記録できなかった場合(命名失敗・旧データ)の受け皿。
  async function handleRecordEnding(e, session) {
    e.stopPropagation();
    setEndingBusy((prev) => ({ ...prev, [session.id]: true }));
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      const ending = await recordEnding(session.id, summarizeRolls(session));
      setEndingMap((prev) => ({ ...prev, [session.id]: ending }));
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: 'エンディングの記録に失敗した: ' + err.message }));
    } finally {
      setEndingBusy((prev) => {
        const next = { ...prev };
        delete next[session.id];
        return next;
      });
    }
  }
```

- [ ] **Step 6: Render the ending title and the record button**

`renderSessionCard` の先頭(`const job = novelJobs[s.id] || {};` の下)に追加:

```jsx
    const ending = endingMap[s.id];
```

状態バッジ層の直後(バッジの `)}` と `novelizeError` ブロックの間)に追加:

```jsx
        {ending && (
          <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.brassDark, marginTop: 8 }}>
            エンディング: {ending.endingTitle}
          </div>
        )}
```

操作層の `次の章へ` ボタンの直後に追加:

```jsx
          {s.endedAt && !ending && (
            <Button
              variant="ghost"
              onClick={(e) => handleRecordEnding(e, s)}
              disabled={!!endingBusy[s.id] || !user}
              style={ACTION_BTN}
            >
              {endingBusy[s.id] ? '記録中…' : 'エンディングを記録する'}
            </Button>
          )}
```

- [ ] **Step 7: Add the gallery link**

`src/screens/Home.jsx` のボタン行の `公開ギャラリー` ボタンの直後に追加:

```jsx
        <Button variant="ghost" onClick={navigateToEndings}>
          エンディング図鑑
        </Button>
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: PASS(全件)

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS(既知フレークを除く)

- [ ] **Step 10: Commit**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "feat(ui): ホームに図鑑導線とエンディング記録の状態を追加"
```

---

## Task 13: ドキュメント同期

**Files:**
- Modify: `docs/02-data-model.md`
- Modify: `docs/04-persistence.md`
- Modify: `docs/05-ui-ux.md`
- Modify: `docs/06-content-generation.md`
- Modify: `docs/08-feature-ideas.md`
- Modify: `docs/superpowers/handoff-2026-07-25-ending-collection.md`

- [ ] **Step 1: 各ドキュメントの該当箇所を読む**

Run: `grep -rn "エンディング\|endedAt\|ending_reached" docs/*.md`

- [ ] **Step 2: `docs/02-data-model.md` を更新**

エンディング記録の節を追加する。保存先 `users/{userId}/endings/{sessionId}`、形状 `{ sessionId, sessionTitle, endingTitle, summary, endedAt, recordedAt, worldId, campaignId, rulesetId, formula, moods, stats }`、`stats` の形状(`total` / `successes` / `successRate` / `byDegree` / `degrees` / `resources`)、そして**完結時点のスナップショットである**こと(完結後もセッションは継続できるため、都度再計算せず固定する)を書く。実績は保存を持たず記録から導出することも明記する。

- [ ] **Step 3: `docs/04-persistence.md` を更新**

API一覧に4本を追加する: `POST /api/sessions/:id/ending`(完結済みセッションのエンディングを記録。統計はクライアントが送る。AI利用枠は `messages` を消費)、`GET /api/endings`(`endedAt` 降順)、`PATCH /api/endings/:id`(改名)、`DELETE /api/endings/:id`。`:id` はいずれも `sessionId`。

- [ ] **Step 4: `docs/05-ui-ux.md` を更新**

- エンディング図鑑画面(`#/endings`、実績の獲得/未獲得表示、記録一覧、改名・削除)
- ホームの `エンディング図鑑` 導線、記録済みセッションのエンディングタイトル表示、未記録の完結セッションの `エンディングを記録する`
- Play画面の確定後のエンディング結果カードと記録失敗時の再試行

- [ ] **Step 5: `docs/06-content-generation.md` を更新**

エンディング命名のAI呼び出しを追加する。入力は物語要約・PC設定・結末付近の地の文の4件(GM専用情報は渡さない)、出力は structured outputs の `{ ending_title, summary }`、タイトルは20字程度・総括は2〜3文。

- [ ] **Step 6: `docs/08-feature-ideas.md` を更新**

2章の「エンディングコレクション/実績」を実装済みにする。実装したもの(GM命名・図鑑画面・ルールセット別ダイス統計・導出型の実績8種)と、非対象のまま残るもの(エンディングの公開/ギャラリー連携、ユーザー定義の実績、分岐ツリーの可視化)を書き分ける。

- [ ] **Step 7: `docs/superpowers/handoff-2026-07-25-ending-collection.md` を更新**

本機能が完了したことを冒頭に追記する。引き継ぎ書が挙げていた4つの論点(セッション終了の概念 / ダイス統計の degree 語彙 / 図鑑の置き場所 / 実績をやるか)がそれぞれどう解決されたかを1行ずつ書く。

- [ ] **Step 8: Verify**

Run: `npm test`
Expected: PASS(既知フレークを除く)

- [ ] **Step 9: Commit**

```bash
git add docs
git commit -m "docs: エンディングコレクション/実績をドキュメントへ反映"
```

---

## 完了条件

- `npm test` が通る(既知フレーク `server/routes/characters.test.js` の1件を除く)
- 手動確認: `npm run dev` で
  1. 物語を結末まで進めて「この物語を終える」を押すと、エンディングタイトル・総括・統計のカードが出る
  2. ホームの「エンディング図鑑」から図鑑を開き、記録と実績が見える
  3. 図鑑で改名・削除ができる
  4. CoC7e風のセッションの記録にだけハード成功/イクストリーム成功と正気度が出る
