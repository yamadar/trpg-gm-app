# ルールセット判定アダプタ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 判定式(degree)をルールセットごとに切り替えるアダプタ機構と、CoC7e の SAN(正気度)副作用リソースを実装する。

**Architecture:** `src/engine/rulesetAdapters.js`(純粋・rng注入可)に判定式・リソース定義・副作用解決を集約し、`getAdapter(formula)` で解決(未知は simple フォールバック)。発火はAI駆動(`roll_check` の `check_kind:'sanity'`)、SAN減少量の解決は決定論。`takeTurn` は非破壊で `resourceChange` を返し、Play.jsx が state に合成する。

**Tech Stack:** React + vite + vitest(jsdom / @testing-library)、express + supertest(node env)。外部ライブラリ追加なし。

**Spec:** [docs/superpowers/specs/2026-07-25-ruleset-adapter-design.md](../specs/2026-07-25-ruleset-adapter-design.md)

## Global Constraints

- 依存方向: `rulesetAdapters.js → dice.js` の一方向。dice.js は rulesetAdapters.js を import しない(循環禁止)。
- `takeTurn` は引数 session を破壊的変更しない。
- degree 語彙は `fumble / fail / success / hard / extreme / critical` の部分集合のみ。
- SAN は `{ key: 'san', label: '正気度', max: 99, initial: 60 }` 固定。機械的ゲームオーバーなし。
- `TURN_OUTPUT_FORMAT` は変更しない。
- 既存セッション(formula/resources 無し)は simple 扱いで無害に動くこと。
- テストコマンドは `npx vitest run <file>`(全体は `npm test`)。
- コミットメッセージは既存流儀(`feat(engine): ...` 等、日本語)+ 末尾に `Co-Authored-By: Claude <noreply@anthropic.com>` トレーラ。

---

### Task 1: dice.js に normalizePercent 公開と rng 注入を追加

**Files:**
- Modify: `src/engine/dice.js`
- Test: `src/engine/dice.test.js`

**Interfaces:**
- Produces: `normalizePercent(successPercent) -> number`(整数・[1,99]、非有限は50)/ `evaluateRoll(successPercent, rng = rollD100)`(戻り値は従来通り `{ roll, success_percent, success, degree }`)。Task 2 の各アダプタがこの2つと `rollD100` を使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/engine/dice.test.js` の import を変更し、末尾に describe を追加:

```js
// import 行を変更
import { rollD100, evaluateRoll, normalizePercent } from './dice.js';
```

```js
describe('normalizePercent', () => {
  it('rounds and clamps into [1, 99]', () => {
    expect(normalizePercent(150)).toBe(99);
    expect(normalizePercent(0)).toBe(1);
    expect(normalizePercent(49.6)).toBe(50);
  });

  it('falls back to 50 for non-finite values', () => {
    expect(normalizePercent(undefined)).toBe(50);
    expect(normalizePercent(NaN)).toBe(50);
    expect(normalizePercent('')).toBe(50);
  });
});

describe('evaluateRoll with injected rng', () => {
  it('uses the injected rng instead of Math.random', () => {
    const result = evaluateRoll(60, () => 97);
    expect(result.roll).toBe(97);
    expect(result.degree).toBe('fumble');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/engine/dice.test.js`
Expected: FAIL(`normalizePercent` が export されていない)

- [ ] **Step 3: 実装**

`src/engine/dice.js` 全体を以下に置き換え:

```js
export function rollD100() {
  return Math.floor(Math.random() * 100) + 1;
}

// success_percentの正規化(整数化・[1,99]クランプ・非有限は50)。
// 各ルールセットアダプタ(rulesetAdapters.js)も共通で使う。
export function normalizePercent(successPercent) {
  return typeof successPercent === 'number' && Number.isFinite(successPercent)
    ? Math.max(1, Math.min(99, Math.round(successPercent)))
    : 50;
}

// simple(現行)判定式。成功判定が先で、fumbleは失敗側でのみ発生する。
// rngはテストと上位アダプタから注入可能。
export function evaluateRoll(successPercent, rng = rollD100) {
  const p = normalizePercent(successPercent);
  const roll = rng();
  const success = roll <= p;
  let degree;
  if (success) {
    degree = roll <= Math.max(1, Math.round(p * 0.05)) ? 'critical' : 'success';
  } else {
    degree = roll >= 96 ? 'fumble' : 'fail';
  }
  return { roll, success_percent: p, success, degree };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/engine/dice.test.js`
Expected: PASS(既存テスト含め全件)

- [ ] **Step 5: コミット**

```bash
git add src/engine/dice.js src/engine/dice.test.js
git commit -m "feat(engine): dice.jsにnormalizePercent公開とrng注入を追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: rulesetAdapters.js — getAdapter と4式の evaluate

**Files:**
- Create: `src/engine/rulesetAdapters.js`
- Test: `src/engine/rulesetAdapters.test.js`

**Interfaces:**
- Consumes: `rollD100` / `normalizePercent` / `evaluateRoll`(Task 1、`./dice.js`)。
- Produces: `getAdapter(formula) -> adapter`、`KNOWN_FORMULAS = ['simple', 'coc7e', 'dnd5e', 'gurps']`。adapter は `{ id, degrees, evaluate(successPercent, rng = rollD100) }` を持つ(リソース系フィールドは Task 3 で追加)。`evaluate` の戻り値は `{ roll, success_percent, success, degree, margin? }`(margin は gurps のみ)。

- [ ] **Step 1: 失敗するテストを書く**

`src/engine/rulesetAdapters.test.js` を新規作成:

```js
import { describe, it, expect } from 'vitest';
import { getAdapter, KNOWN_FORMULAS } from './rulesetAdapters.js';

const rng = (v) => () => v;

describe('getAdapter', () => {
  it('resolves each known formula to an adapter with the same id', () => {
    for (const f of ['simple', 'coc7e', 'dnd5e', 'gurps']) {
      expect(getAdapter(f).id).toBe(f);
    }
    expect(KNOWN_FORMULAS).toEqual(['simple', 'coc7e', 'dnd5e', 'gurps']);
  });

  it('falls back to simple for unknown or missing formulas', () => {
    expect(getAdapter('homebrew').id).toBe('simple');
    expect(getAdapter(undefined).id).toBe('simple');
    expect(getAdapter(null).id).toBe('simple');
  });
});

describe('simple.evaluate', () => {
  const simple = getAdapter('simple');

  it('matches the legacy evaluateRoll behavior (success takes priority over fumble)', () => {
    expect(simple.evaluate(60, rng(50))).toMatchObject({ roll: 50, success: true, degree: 'success' });
    expect(simple.evaluate(99, rng(97)).degree).toBe('success'); // p>=96ならroll97も成功
    expect(simple.evaluate(60, rng(97)).degree).toBe('fumble');
    expect(simple.evaluate(60, rng(1)).degree).toBe('critical'); // round(60*0.05)=3
    expect(simple.evaluate(60, rng(80)).degree).toBe('fail');
  });
});

describe('coc7e.evaluate', () => {
  const coc = getAdapter('coc7e');

  it('roll=1 is always critical', () => {
    expect(coc.evaluate(5, rng(1)).degree).toBe('critical');
  });

  it('roll=100 is always fumble', () => {
    expect(coc.evaluate(99, rng(100)).degree).toBe('fumble');
  });

  it('roll>=96 is fumble only when p < 50', () => {
    expect(coc.evaluate(49, rng(96)).degree).toBe('fumble');
    expect(coc.evaluate(50, rng(96)).degree).toBe('fail'); // p>=50では96-99は通常の失敗
  });

  it('extreme at roll <= ceil(p/5), hard at roll <= ceil(p/2)', () => {
    // p=60: extreme<=12, hard<=30, success<=60
    expect(coc.evaluate(60, rng(12)).degree).toBe('extreme');
    expect(coc.evaluate(60, rng(13)).degree).toBe('hard');
    expect(coc.evaluate(60, rng(30)).degree).toBe('hard');
    expect(coc.evaluate(60, rng(31)).degree).toBe('success');
    expect(coc.evaluate(60, rng(60)).degree).toBe('success');
    expect(coc.evaluate(60, rng(61)).degree).toBe('fail');
  });

  it('hard/extreme/critical count as success', () => {
    expect(coc.evaluate(60, rng(12)).success).toBe(true);
    expect(coc.evaluate(60, rng(25)).success).toBe(true);
    expect(coc.evaluate(60, rng(1)).success).toBe(true);
    expect(coc.evaluate(60, rng(61)).success).toBe(false);
  });
});

describe('dnd5e.evaluate', () => {
  const dnd = getAdapter('dnd5e');

  it('fixed 5% critical regardless of p', () => {
    expect(dnd.evaluate(10, rng(5)).degree).toBe('critical');
    expect(dnd.evaluate(10, rng(5)).success).toBe(true);
    expect(dnd.evaluate(90, rng(6)).degree).toBe('success');
  });

  it('fixed fumble range 96-100 even at high p (nat-1 style)', () => {
    expect(dnd.evaluate(99, rng(96)).degree).toBe('fumble');
    expect(dnd.evaluate(99, rng(95)).degree).toBe('success');
  });

  it('plain success/fail between the fixed bands', () => {
    expect(dnd.evaluate(50, rng(50)).degree).toBe('success');
    expect(dnd.evaluate(50, rng(51)).degree).toBe('fail');
  });
});

describe('gurps.evaluate', () => {
  const gurps = getAdapter('gurps');

  it('critical at roll <= 5, fumble at roll >= 96 (before success check)', () => {
    expect(gurps.evaluate(50, rng(5)).degree).toBe('critical');
    expect(gurps.evaluate(99, rng(96)).degree).toBe('fumble');
  });

  it('includes margin = p - roll', () => {
    expect(gurps.evaluate(60, rng(40)).margin).toBe(20);
    expect(gurps.evaluate(60, rng(80)).margin).toBe(-20);
  });

  it('other adapters do not include margin', () => {
    expect(getAdapter('simple').evaluate(60, rng(40)).margin).toBeUndefined();
    expect(getAdapter('coc7e').evaluate(60, rng(40)).margin).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/engine/rulesetAdapters.test.js`
Expected: FAIL(モジュールが存在しない)

- [ ] **Step 3: 実装**

`src/engine/rulesetAdapters.js` を新規作成:

```js
import { rollD100, normalizePercent, evaluateRoll } from './dice.js';

// 共通のdegree語彙のうち、成功として扱うもの。
const SUCCESS_DEGREES = new Set(['critical', 'extreme', 'hard', 'success']);

const simple = {
  id: 'simple',
  degrees: ['fumble', 'fail', 'success', 'critical'],
  // 現行のevaluateRoll(dice.js)へ委譲。依存方向は adapters -> dice の一方向を保つ。
  evaluate: (successPercent, rng = rollD100) => evaluateRoll(successPercent, rng),
};

const coc7e = {
  id: 'coc7e',
  degrees: ['fumble', 'fail', 'success', 'hard', 'extreme', 'critical'],
  evaluate(successPercent, rng = rollD100) {
    const p = normalizePercent(successPercent);
    const roll = rng();
    let degree;
    if (roll === 1) degree = 'critical';
    else if (roll === 100 || (p < 50 && roll >= 96)) degree = 'fumble';
    else if (roll <= Math.ceil(p / 5)) degree = 'extreme';
    else if (roll <= Math.ceil(p / 2)) degree = 'hard';
    else if (roll <= p) degree = 'success';
    else degree = 'fail';
    return { roll, success_percent: p, success: SUCCESS_DEGREES.has(degree), degree };
  },
};

const dnd5e = {
  id: 'dnd5e',
  degrees: ['fumble', 'fail', 'success', 'critical'],
  // simpleと異なりfumble/criticalが成功判定より先(どんな達人でも5%は転ぶ、というd20的意図)。
  evaluate(successPercent, rng = rollD100) {
    const p = normalizePercent(successPercent);
    const roll = rng();
    let degree;
    if (roll <= 5) degree = 'critical';
    else if (roll >= 96) degree = 'fumble';
    else if (roll <= p) degree = 'success';
    else degree = 'fail';
    return { roll, success_percent: p, success: SUCCESS_DEGREES.has(degree), degree };
  },
};

const gurps = {
  id: 'gurps',
  degrees: ['fumble', 'fail', 'success', 'critical'],
  evaluate(successPercent, rng = rollD100) {
    const p = normalizePercent(successPercent);
    const roll = rng();
    let degree;
    if (roll <= 5) degree = 'critical';
    else if (roll >= 96) degree = 'fumble';
    else if (roll <= p) degree = 'success';
    else degree = 'fail';
    // margin(成功率-出目)は代償・成功度の描写材料としてAIへ渡す。
    return { roll, success_percent: p, success: SUCCESS_DEGREES.has(degree), degree, margin: p - roll };
  },
};

const ADAPTERS = { simple, coc7e, dnd5e, gurps };

export const KNOWN_FORMULAS = Object.keys(ADAPTERS);

export function getAdapter(formula) {
  return ADAPTERS[formula] || ADAPTERS.simple;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/engine/rulesetAdapters.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/engine/rulesetAdapters.js src/engine/rulesetAdapters.test.js
git commit -m "feat(engine): ルールセット別判定式アダプタ(simple/coc7e/dnd5e/gurps)を追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: rulesetAdapters.js — resourceDefs と sideEffect(SAN)

**Files:**
- Modify: `src/engine/rulesetAdapters.js`
- Test: `src/engine/rulesetAdapters.test.js`

**Interfaces:**
- Produces: 各 adapter に追加されるフィールド:
  - `resourceDefs: [{ key, label, max, initial }]`(coc7e のみ `[{ key: 'san', label: '正気度', max: 99, initial: 60 }]`、他は `[]`)
  - `sideEffectKinds: string[]`(coc7e のみ `['sanity']`、他は `[]`)
  - `sideEffect(kind, degree, rng = rollD100) -> { key, delta } | null`
  - `promptText: string`(AI向けの degree 解釈説明)
  - `sideEffectPrompt?: string`(coc7e のみ。check_kind 指定と SAN 通知の説明)

- [ ] **Step 1: 失敗するテストを書く**

`src/engine/rulesetAdapters.test.js` の末尾に追加:

```js
describe('resourceDefs / sideEffectKinds', () => {
  it('coc7e declares the SAN resource (60/99) and the sanity side-effect kind', () => {
    const coc = getAdapter('coc7e');
    expect(coc.resourceDefs).toEqual([{ key: 'san', label: '正気度', max: 99, initial: 60 }]);
    expect(coc.sideEffectKinds).toEqual(['sanity']);
  });

  it('other adapters declare no resources and no side-effect kinds', () => {
    for (const f of ['simple', 'dnd5e', 'gurps']) {
      expect(getAdapter(f).resourceDefs).toEqual([]);
      expect(getAdapter(f).sideEffectKinds).toEqual([]);
    }
  });
});

describe('coc7e.sideEffect', () => {
  const coc = getAdapter('coc7e');

  it('returns null for non-sanity kinds', () => {
    expect(coc.sideEffect('normal', 'fail', rng(1))).toBeNull();
    expect(coc.sideEffect(undefined, 'fail', rng(1))).toBeNull();
  });

  it('strong successes keep sanity (delta 0)', () => {
    expect(coc.sideEffect('sanity', 'critical', rng(1))).toEqual({ key: 'san', delta: 0 });
    expect(coc.sideEffect('sanity', 'extreme', rng(1))).toEqual({ key: 'san', delta: 0 });
    expect(coc.sideEffect('sanity', 'hard', rng(1))).toEqual({ key: 'san', delta: 0 });
  });

  it('a plain success costs 1 sanity', () => {
    expect(coc.sideEffect('sanity', 'success', rng(1))).toEqual({ key: 'san', delta: -1 });
  });

  it('a fail costs 1d6 (rng 1-100 mapped onto 1-6)', () => {
    expect(coc.sideEffect('sanity', 'fail', rng(1))).toEqual({ key: 'san', delta: -1 });
    expect(coc.sideEffect('sanity', 'fail', rng(6))).toEqual({ key: 'san', delta: -6 });
    expect(coc.sideEffect('sanity', 'fail', rng(7))).toEqual({ key: 'san', delta: -1 }); // 7 -> 1+((7-1)%6)=1
  });

  it('a fumble costs 1d10', () => {
    expect(coc.sideEffect('sanity', 'fumble', rng(10))).toEqual({ key: 'san', delta: -10 });
    expect(coc.sideEffect('sanity', 'fumble', rng(11))).toEqual({ key: 'san', delta: -1 });
  });

  it('non-coc7e adapters always return null even for sanity', () => {
    expect(getAdapter('simple').sideEffect('sanity', 'fail', rng(1))).toBeNull();
  });
});

describe('promptText', () => {
  it('every adapter has a promptText describing its degrees', () => {
    for (const f of ['simple', 'coc7e', 'dnd5e', 'gurps']) {
      expect(getAdapter(f).promptText).toContain('degree');
    }
  });

  it('coc7e has a sideEffectPrompt mentioning check_kind and san_loss', () => {
    expect(getAdapter('coc7e').sideEffectPrompt).toContain('sanity');
    expect(getAdapter('coc7e').sideEffectPrompt).toContain('san_loss');
    expect(getAdapter('simple').sideEffectPrompt).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/engine/rulesetAdapters.test.js`
Expected: FAIL(resourceDefs 等が undefined)

- [ ] **Step 3: 実装**

`src/engine/rulesetAdapters.js` に以下を追加・変更する。

ファイル冒頭(SUCCESS_DEGREES の下)にヘルパを追加:

```js
// rollD100系rng(1-100)の値をsides面ダイスへ写像する。テストではrngを直接差し替える。
function rollDie(sides, rng) {
  return 1 + ((rng() - 1) % sides);
}

function noSideEffect() {
  return null;
}
```

`simple` オブジェクトへフィールド追加:

```js
const simple = {
  id: 'simple',
  degrees: ['fumble', 'fail', 'success', 'critical'],
  evaluate: (successPercent, rng = rollD100) => evaluateRoll(successPercent, rng),
  resourceDefs: [],
  sideEffectKinds: [],
  sideEffect: noSideEffect,
  promptText:
    'ロール結果のdegreeは演出に反映する: critical=劇的な大成功、success=成功、fail=失敗、fumble=手痛い代償を伴う大失敗。',
};
```

`coc7e` オブジェクトへフィールド追加(evaluate は Task 2 のまま):

```js
  resourceDefs: [{ key: 'san', label: '正気度', max: 99, initial: 60 }],
  sideEffectKinds: ['sanity'],
  sideEffect(kind, degree, rng = rollD100) {
    if (kind !== 'sanity') return null;
    if (degree === 'critical' || degree === 'extreme' || degree === 'hard') return { key: 'san', delta: 0 };
    if (degree === 'success') return { key: 'san', delta: -1 };
    if (degree === 'fumble') return { key: 'san', delta: -rollDie(10, rng) };
    return { key: 'san', delta: -rollDie(6, rng) }; // fail
  },
  promptText:
    'ロール結果のdegreeはCoC7e風の成功度: critical=出目1の奇跡的成功、extreme=イクストリーム成功、hard=ハード成功、success=通常成功、fail=失敗、fumble=大失敗(手痛い代償)。degreeに応じて演出の強度を変えること。',
  sideEffectPrompt:
    '恐怖・正気を試される場面ではroll_checkのcheck_kindに"sanity"を指定すること。正気度(SAN)の減少量はエンジンが決定し、tool_resultのsan_loss/san_nowで通知されるので、narrativeにその影響を反映すること。san_nowが0のときPCは正気を完全に失っている——狂気に呑まれる描写をせよ(ただしセッションを機械的に終了はしない)。',
```

`dnd5e` オブジェクトへフィールド追加:

```js
  resourceDefs: [],
  sideEffectKinds: [],
  sideEffect: noSideEffect,
  promptText:
    'ロール結果のdegreeはd20風: critical=会心(成功率に関わらず5%で発生する劇的大成功)、success=成功、fail=失敗、fumble=致命的失敗(成功率に関わらず5%で発生)。',
```

`gurps` オブジェクトへフィールド追加:

```js
  resourceDefs: [],
  sideEffectKinds: [],
  sideEffect: noSideEffect,
  promptText:
    'ロール結果のdegreeを演出に反映する: critical=会心、success=成功、fail=失敗、fumble=大失敗。加えてtool_resultのmargin(成功率-出目)が大きいほど余裕のある成功、負に大きいほど手痛い失敗として、成果や代償の程度を具体的に描写すること。',
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/engine/rulesetAdapters.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/engine/rulesetAdapters.js src/engine/rulesetAdapters.test.js
git commit -m "feat(engine): アダプタにSANリソース定義とsanity副作用(決定論解決)を追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: ビルトイン rulesets.js に formula を追加

**Files:**
- Modify: `src/data/rulesets.js`
- Test: `src/data/rulesets.test.js`

**Interfaces:**
- Produces: `RULESETS` 各要素に `formula` フィールド(`'simple' | 'coc7e' | 'dnd5e' | 'gurps'`)。Task 5 の `resolveAdapter`、Task 11 の Setup スナップショットが参照する。

- [ ] **Step 1: 失敗するテストを書く**

`src/data/rulesets.test.js` に describe を追加(既存テストは変更しない):

```js
describe('formula', () => {
  it('every builtin ruleset has a formula matching its id', () => {
    for (const r of RULESETS) {
      expect(r.formula).toBe(r.id);
    }
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/data/rulesets.test.js`
Expected: FAIL(formula が undefined)

- [ ] **Step 3: 実装**

`src/data/rulesets.js` の各要素に `formula: '<そのid>'` の1行を追加する。desc/hint 等の既存値は一切変更しない。simple の例(他3件も同様に自身の id を設定):

```js
  {
    id: 'simple',
    label: 'シンプル',
    desc: '判定は成功率%のみで統一。ルール色なし、テンポ重視。',
    hint: '',
    growthUnit: '経験値',
    formula: 'simple',
  },
```

coc7e → `formula: 'coc7e'`、dnd5e → `formula: 'dnd5e'`、gurps → `formula: 'gurps'`。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/data/rulesets.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/data/rulesets.js src/data/rulesets.test.js
git commit -m "feat(data): ビルトインRulesetにformulaフィールドを追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: prompts.js — resolveAdapter と buildRollTool

**Files:**
- Modify: `src/api/prompts.js`
- Test: `src/api/prompts.test.js`

**Interfaces:**
- Consumes: `getAdapter`(Task 2/3、`../engine/rulesetAdapters.js`)。
- Produces:
  - `resolveAdapter(session) -> adapter`(`resolveRuleset(session).formula` を `getAdapter` で解決)
  - `buildRollTool(adapter) -> tool定義`(`sideEffectKinds` が空なら既存 `ROLL_TOOL` と同一。非空なら `check_kind`(enum `['normal', ...kinds]`、必須ではない)を input_schema に追加)
  - 既存の `export const ROLL_TOOL` は維持(後方互換)。

- [ ] **Step 1: 失敗するテストを書く**

`src/api/prompts.test.js` の import に `buildRollTool, resolveAdapter` を追加し、describe を追加:

```js
import { ROLL_TOOL, TURN_OUTPUT_FORMAT, buildSystemBlocks, buildTurnUserContent, buildRollTool, resolveAdapter } from './prompts.js';
import { getAdapter } from '../engine/rulesetAdapters.js';
```

```js
describe('resolveAdapter', () => {
  it('resolves the adapter from session.ruleset.formula', () => {
    expect(resolveAdapter({ ruleset: { id: 'x', formula: 'coc7e' } }).id).toBe('coc7e');
  });

  it('falls back to simple for legacy sessions without formula', () => {
    expect(resolveAdapter({ ruleset: { id: 'coc7e', label: 'CoC7e風' } }).id).toBe('simple');
    expect(resolveAdapter({ rulesetId: 'nonexistent' }).id).toBe('simple');
  });

  it('resolves builtin formula via rulesetId lookup when no snapshot exists', () => {
    expect(resolveAdapter({ rulesetId: 'dnd5e' }).id).toBe('dnd5e');
  });
});

describe('buildRollTool', () => {
  it('returns the plain ROLL_TOOL for adapters without side-effect kinds', () => {
    expect(buildRollTool(getAdapter('simple'))).toEqual(ROLL_TOOL);
    expect(buildRollTool(getAdapter('simple')).input_schema.properties.check_kind).toBeUndefined();
  });

  it('adds an optional check_kind enum for coc7e', () => {
    const tool = buildRollTool(getAdapter('coc7e'));
    expect(tool.input_schema.properties.check_kind.enum).toEqual(['normal', 'sanity']);
    expect(tool.input_schema.required).toEqual(['check_label', 'success_percent']); // check_kindは必須にしない
    expect(tool.input_schema.properties.success_percent).toBeDefined();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/prompts.test.js`
Expected: FAIL(buildRollTool 未定義)

- [ ] **Step 3: 実装**

`src/api/prompts.js` の import に追加:

```js
import { getAdapter } from '../engine/rulesetAdapters.js';
```

`resolveRuleset` の直後に追加(`resolveRuleset` は変更しない):

```js
export function resolveAdapter(session) {
  return getAdapter(resolveRuleset(session).formula);
}
```

`ROLL_TOOL` 定義の直後に追加:

```js
// アダプタが副作用kind(sanity等)を持つ場合のみcheck_kindを受け付けるroll_checkを組み立てる。
export function buildRollTool(adapter) {
  if (!adapter?.sideEffectKinds?.length) return ROLL_TOOL;
  return {
    ...ROLL_TOOL,
    input_schema: {
      ...ROLL_TOOL.input_schema,
      properties: {
        ...ROLL_TOOL.input_schema.properties,
        check_kind: {
          type: 'string',
          enum: ['normal', ...adapter.sideEffectKinds],
          description: '判定の種別。恐怖・正気を試される場面ではsanity、それ以外はnormal(省略可)。',
        },
      },
    },
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/prompts.test.js`
Expected: PASS(既存テスト含む)

- [ ] **Step 5: コミット**

```bash
git add src/api/prompts.js src/api/prompts.test.js
git commit -m "feat(api): resolveAdapterとbuildRollTool(check_kind対応)を追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: prompts.js — システムプロンプトとターン状態へのアダプタ/リソース注入

**Files:**
- Modify: `src/api/prompts.js`
- Test: `src/api/prompts.test.js`

**Interfaces:**
- Consumes: `resolveAdapter`(Task 5)、adapter の `promptText` / `sideEffectPrompt` / `resourceDefs`(Task 3)。
- Produces: `buildSystemBlocks` が degree 説明をアダプタ別に注入し、リソースがあれば「# リソース」節を含む。`buildTurnUserContent` が `state.resources` を「リソース: 正気度 60/99」形式で含む。

- [ ] **Step 1: 失敗するテストを書く**

`src/api/prompts.test.js` に describe を追加:

```js
describe('buildSystemBlocks adapter injection', () => {
  it('injects the simple promptText for legacy sessions', () => {
    const text = buildSystemBlocks({
      world: { summary: 'w' }, scenario: { raw: 's' }, pc: { raw: 'p' },
      rulesetId: 'simple',
    })[0].text;
    expect(text).toContain('critical=劇的な大成功');
    expect(text).not.toContain('# リソース');
  });

  it('injects coc7e degree text, sideEffectPrompt, and a resource section', () => {
    const text = buildSystemBlocks({
      world: { summary: 'w' }, scenario: { raw: 's' }, pc: { raw: 'p' },
      ruleset: { id: 'coc7e', label: 'CoC7e風', formula: 'coc7e' },
    })[0].text;
    expect(text).toContain('ハード成功');
    expect(text).toContain('check_kind');
    expect(text).toContain('# リソース');
    expect(text).toContain('正気度');
  });
});

describe('buildTurnUserContent resources', () => {
  const base = {
    ruleset: { id: 'coc7e', formula: 'coc7e' },
    state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [] },
  };

  it('includes a resource line when state.resources exists', () => {
    const content = buildTurnUserContent(
      { ...base, state: { ...base.state, resources: { san: { value: 55, max: 99 } } } },
      '進む'
    );
    expect(content).toContain('リソース: 正気度 55/99');
  });

  it('omits the resource line when resources are absent or empty', () => {
    expect(buildTurnUserContent(base, '進む')).not.toContain('リソース:');
    expect(
      buildTurnUserContent({ ...base, state: { ...base.state, resources: {} } }, '進む')
    ).not.toContain('リソース:');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/prompts.test.js`
Expected: FAIL

- [ ] **Step 3: 実装**

`buildSystemBlocks` を変更。冒頭で adapter を解決:

```js
export function buildSystemBlocks(session) {
  const rs = resolveRuleset(session);
  const adapter = resolveAdapter(session);
```

「# ルール性向」節の直後に、リソース節を条件付きで挿入するため、テンプレートの該当部分を以下へ変更:

```js
# ルール性向: ${rs.label}
${rs.hint || '特別な演出指定なし。'}
${
  adapter.resourceDefs.length
    ? `\n# リソース\n${adapter.resourceDefs
        .map((d) => `- ${d.label}: 最大${d.max}。現在値は毎ターンの「現在の状況」に示される。`)
        .join('\n')}\n`
    : ''
}
# 判定ルール
```

「# 判定ルール」内の固定 degree 行:

```
- ロール結果のdegreeは演出に反映する: critical=劇的な大成功、success=成功、fail=失敗、fumble=手痛い代償を伴う大失敗。
```

を以下へ置換:

```js
- ${adapter.promptText}${adapter.sideEffectPrompt ? `\n- ${adapter.sideEffectPrompt}` : ''}
```

`buildTurnUserContent` を変更。flags 処理の後に追加:

```js
  const adapter = resolveAdapter(session);
  const resources = session.state.resources || {};
  const resourceLine = Object.keys(resources).length
    ? `\nリソース: ${Object.entries(resources)
        .map(([k, r]) => `${adapter.resourceDefs.find((d) => d.key === k)?.label || k} ${r.value}/${r.max}`)
        .join(', ')}`
    : '';
```

テンプレートの「テンション: ...」行の直後に `${resourceLine}` を挿入:

```js
  return `# 現在の状況
シーン: ${session.state.current_scene}
テンション: ${session.state.tension_level || 'medium'}${resourceLine}
既知フラグ: ${flagsText}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/prompts.test.js`
Expected: PASS(既存テスト含む。`instructs the GM on roll flow` テストが simple の promptText 文言変更で落ちる場合、文言は既存と同一のため落ちないはず——落ちたら期待値の文字列を確認して実装側を既存文言に合わせる)

- [ ] **Step 5: コミット**

```bash
git add src/api/prompts.js src/api/prompts.test.js
git commit -m "feat(api): システムプロンプトとターン状態にアダプタ別判定説明とリソースを注入

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: session.js — takeTurn のアダプタ適用と SAN 副作用

**Files:**
- Modify: `src/api/session.js`
- Test: `src/api/session.test.js`

**Interfaces:**
- Consumes: `resolveAdapter` / `buildRollTool`(Task 5)、adapter の `evaluate` / `sideEffect` / `resourceDefs`(Task 2/3)。
- Produces: `takeTurn(session, playerText) -> { result, roll, resourceChange }`。
  - `roll`: `{ roll, success_percent, success, degree, margin?, check_label, resourceChange? }`
  - `resourceChange`: `{ key, label, delta, before, after } | null`(delta は clamp 後の実効値)
  - **session は破壊的変更しない**。Task 8 の Play.jsx が resourceChange を state に合成する。

- [ ] **Step 1: 失敗するテストを書く**

`src/api/session.test.js` の `describe('takeTurn')` 内に追加:

```js
  it('uses the coc7e adapter formula for coc7e sessions', async () => {
    const toolUseResponse = {
      content: [
        { type: 'tool_use', id: 'tool_1', name: 'roll_check', input: { check_label: '調査', success_percent: 60 } },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "見つけた。", "state_update": {}, "choices": []}' }],
    };
    vi.spyOn(client, 'callClaude').mockResolvedValueOnce(toolUseResponse).mockResolvedValueOnce(finalResponse);
    vi.spyOn(Math, 'random').mockReturnValue(0.11); // roll = 12 -> coc7eではextreme(<=ceil(60/5))

    const session = makeSession({ ruleset: { id: 'coc7e', formula: 'coc7e' } });
    const { roll } = await takeTurn(session, '調べる');
    expect(roll.degree).toBe('extreme');
  });

  it('applies a sanity side effect: computes resourceChange, informs the AI, and does not mutate the session', async () => {
    const toolUseResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'roll_check',
          input: { check_label: '正気度チェック', success_percent: 50, check_kind: 'sanity' },
        },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "膝が笑う。", "state_update": {}, "choices": []}' }],
    };
    const callClaudeMock = vi
      .spyOn(client, 'callClaude')
      .mockResolvedValueOnce(toolUseResponse)
      .mockResolvedValueOnce(finalResponse);
    // roll = 80 -> fail(p=50)。副作用の1d6は rng()=80 -> 1+((80-1)%6)=1+1=2 -> delta -2
    vi.spyOn(Math, 'random').mockReturnValue(0.79);

    const session = makeSession({
      ruleset: { id: 'coc7e', formula: 'coc7e' },
      state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], resources: { san: { value: 60, max: 99 } } },
    });
    const { roll, resourceChange } = await takeTurn(session, '死体を見る');

    expect(resourceChange).toEqual({ key: 'san', label: '正気度', delta: -2, before: 60, after: 58 });
    expect(roll.resourceChange).toEqual(resourceChange);
    expect(session.state.resources.san.value).toBe(60); // 非破壊

    const toolResult = callClaudeMock.mock.calls[1][0].messages.at(-1).content[0];
    const payload = JSON.parse(toolResult.content);
    expect(payload.san_loss).toBe(2);
    expect(payload.san_now).toBe(58);
  });

  it('adds a madness note to the tool_result when sanity reaches 0', async () => {
    const toolUseResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'roll_check',
          input: { check_label: '正気度チェック', success_percent: 50, check_kind: 'sanity' },
        },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "闇。", "state_update": {}, "choices": []}' }],
    };
    const callClaudeMock = vi
      .spyOn(client, 'callClaude')
      .mockResolvedValueOnce(toolUseResponse)
      .mockResolvedValueOnce(finalResponse);
    vi.spyOn(Math, 'random').mockReturnValue(0.79); // fail -> -2

    const session = makeSession({
      ruleset: { id: 'coc7e', formula: 'coc7e' },
      state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], resources: { san: { value: 1, max: 99 } } },
    });
    const { resourceChange } = await takeTurn(session, '直視する');

    expect(resourceChange.after).toBe(0);
    expect(resourceChange.delta).toBe(-1); // clamp後の実効値
    const payload = JSON.parse(callClaudeMock.mock.calls[1][0].messages.at(-1).content[0].content);
    expect(payload.note).toContain('正気');
  });

  it('ignores check_kind for adapters without side effects and returns a null resourceChange', async () => {
    const toolUseResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'roll_check',
          input: { check_label: 'x', success_percent: 50, check_kind: 'sanity' },
        },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "何ともない。", "state_update": {}, "choices": []}' }],
    };
    vi.spyOn(client, 'callClaude').mockResolvedValueOnce(toolUseResponse).mockResolvedValueOnce(finalResponse);
    vi.spyOn(Math, 'random').mockReturnValue(0.79);

    const { resourceChange } = await takeTurn(makeSession(), '見る');
    expect(resourceChange).toBeNull();
  });

  it('includes the gurps margin in the tool_result payload', async () => {
    const toolUseResponse = {
      content: [
        { type: 'tool_use', id: 'tool_1', name: 'roll_check', input: { check_label: '狙撃', success_percent: 60 } },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "命中。", "state_update": {}, "choices": []}' }],
    };
    const callClaudeMock = vi
      .spyOn(client, 'callClaude')
      .mockResolvedValueOnce(toolUseResponse)
      .mockResolvedValueOnce(finalResponse);
    vi.spyOn(Math, 'random').mockReturnValue(0.39); // roll = 40 -> margin 20

    await takeTurn(makeSession({ ruleset: { id: 'gurps', formula: 'gurps' } }), '撃つ');
    const payload = JSON.parse(callClaudeMock.mock.calls[1][0].messages.at(-1).content[0].content);
    expect(payload.margin).toBe(20);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/session.test.js`
Expected: FAIL(resourceChange が undefined、coc7e で degree が simple 式)

- [ ] **Step 3: 実装**

`src/api/session.js` の import を変更:

```js
import { callClaude, extractText, extractToolUse, parseJsonLoose } from './client.js';
import { buildRollTool, resolveAdapter, TURN_OUTPUT_FORMAT, buildSystemBlocks, buildTurnUserContent } from './prompts.js';
```

(`ROLL_TOOL` と `evaluateRoll` の import を削除。)

`takeTurn` を以下へ変更:

```js
export async function takeTurn(session, playerText) {
  const adapter = resolveAdapter(session);
  const system = buildSystemBlocks(session);
  let messages = [{ role: 'user', content: buildTurnUserContent(session, playerText) }];
  const base = {
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: 'disabled' },
    system,
    tools: [buildRollTool(adapter)],
    output_config: { format: TURN_OUTPUT_FORMAT },
  };

  let data = await callClaude({ ...base, messages });
  let roll = null;
  let resourceChange = null;

  const toolUse = extractToolUse(data.content);
  if (toolUse && toolUse.name === 'roll_check') {
    roll = adapter.evaluate(toolUse.input.success_percent);
    roll.check_label = toolUse.input.check_label;

    // 副作用(SAN減少等)。発火はAIのcheck_kind指定、減少量はアダプタが決定論的に解決する。
    // sessionは破壊的変更せず、clamp後の実効deltaをresourceChangeとして呼び出し元へ返す。
    const eff = adapter.sideEffect(toolUse.input.check_kind || 'normal', roll.degree);
    const res = eff ? session.state.resources?.[eff.key] : null;
    if (eff && res) {
      const def = adapter.resourceDefs.find((d) => d.key === eff.key);
      const before = res.value;
      const after = Math.max(0, Math.min(res.max, before + eff.delta));
      resourceChange = { key: eff.key, label: def?.label || eff.key, delta: after - before, before, after };
      roll.resourceChange = resourceChange;
    }

    const payload = { roll: roll.roll, success: roll.success, degree: roll.degree };
    if (typeof roll.margin === 'number') payload.margin = roll.margin;
    if (resourceChange) {
      payload.san_loss = -resourceChange.delta;
      payload.san_now = resourceChange.after;
      if (resourceChange.after === 0) payload.note = '正気を完全に失った。狂気に呑まれる描写をせよ。';
    }

    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(payload),
          },
        ],
      },
    ];
    data = await callClaude({ ...base, messages });
  }

  const text = extractText(data.content);
  const result = normalizeFlags(parseJsonLoose(text));
  return { result, roll, resourceChange };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/session.test.js`
Expected: PASS(既存テスト含む)

- [ ] **Step 5: コミット**

```bash
git add src/api/session.js src/api/session.test.js
git commit -m "feat(api): takeTurnにアダプタ判定とSAN副作用(非破壊・決定論)を適用

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Play.jsx — resourceChange の state 合成

**Files:**
- Modify: `src/screens/Play.jsx`
- Test: `src/screens/Play.test.jsx`

**Interfaces:**
- Consumes: `takeTurn -> { result, roll, resourceChange }`(Task 7)。
- Produces: `updated.state.resources` に clamp 済みの新値が保存される(saveSession / putSessionToServer 経由で永続化)。resources 未定義の既存セッションでは state に resources キーを追加しない。

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Play.test.jsx` に describe を追加。fetch モックで tool_use → 最終応答の2段応答を返す:

```js
describe('resource side effects', () => {
  it('saves the reduced SAN into state.resources after a sanity check', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'tool_use',
              id: 'tool_1',
              name: 'roll_check',
              input: { check_label: '正気度チェック', success_percent: 50, check_kind: 'sanity' },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({ narrative: '恐怖に震えた。', state_update: {}, choices: [] }),
            },
          ],
        }),
      });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.79); // roll=80 fail -> 1d6=2 -> -2
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);

    const session = makeSession({
      ruleset: { id: 'coc7e', label: 'CoC7e風', formula: 'coc7e', growthUnit: '経験値' },
      state: {
        current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], turn_count: 0,
        resources: { san: { value: 60, max: 99 } },
      },
    });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('恐怖に震えた。')).toBeInTheDocument());

    const saved = saveSpy.mock.calls.at(-1)[0];
    expect(saved.state.resources.san).toEqual({ value: 58, max: 99 });
    randomSpy.mockRestore();
  });

  it('does not add a resources key for sessions without resources', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    const saved = saveSpy.mock.calls.at(-1)[0];
    expect('resources' in saved.state).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: FAIL(saved.state.resources.san.value が 60 のまま)

- [ ] **Step 3: 実装**

`src/screens/Play.jsx` の `runTurn` 内を変更。

呼び出し行:

```js
        const { result, roll, resourceChange } = await takeTurn(session, playerText);
```

`newXp` 計算の直後に追加:

```js
        // SAN等のリソース副作用。takeTurnは非破壊なので、ここでclamp済みの新値を合成する。
        const newResources = resourceChange
          ? {
              ...(session.state.resources || {}),
              [resourceChange.key]: {
                ...(session.state.resources?.[resourceChange.key] || { max: resourceChange.after }),
                value: resourceChange.after,
              },
            }
          : session.state.resources;
```

`updated.state` に条件付きで含める(`tension_level` 行の後):

```js
            tension_level: norm.stateUpdate.tension_level ?? session.state.tension_level ?? 'medium',
            ...(newResources ? { resources: newResources } : {}),
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS(既存テスト含む)

- [ ] **Step 5: コミット**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "feat(ui): PlayがresourceChangeをstate.resourcesへ合成・保存する

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Stamp.jsx — hard/extreme ラベルと SAN 注記

**Files:**
- Modify: `src/components/ui/Stamp.jsx`
- Test: `src/components/ui/Stamp.test.jsx`

**Interfaces:**
- Consumes: ログエントリの `roll`(Task 7 で `degree: 'hard' | 'extreme'` と `resourceChange` が入りうる)。
- Produces: degree 全6種のラベル表示と、`resourceChange.delta !== 0` のときの「正気度 -N」注記。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/ui/Stamp.test.jsx` に追加:

```js
  it('labels hard and extreme degrees (coc7e)', () => {
    render(<Stamp roll={{ check_label: 'a', roll: 25, success_percent: 60, success: true, degree: 'hard' }} />);
    expect(screen.getByText('ハード成功')).toBeInTheDocument();
    render(<Stamp roll={{ check_label: 'b', roll: 10, success_percent: 60, success: true, degree: 'extreme' }} />);
    expect(screen.getByText('イクストリーム')).toBeInTheDocument();
  });

  it('shows a resource note when the roll carries a non-zero resourceChange', () => {
    render(
      <Stamp
        roll={{
          check_label: '正気度チェック', roll: 80, success_percent: 50, success: false, degree: 'fail',
          resourceChange: { key: 'san', label: '正気度', delta: -4, before: 60, after: 56 },
        }}
      />
    );
    expect(screen.getByText('正気度 -4')).toBeInTheDocument();
  });

  it('hides the resource note when delta is 0', () => {
    render(
      <Stamp
        roll={{
          check_label: '正気度チェック', roll: 10, success_percent: 50, success: true, degree: 'extreme',
          resourceChange: { key: 'san', label: '正気度', delta: 0, before: 60, after: 60 },
        }}
      />
    );
    expect(screen.queryByText(/正気度 /)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/ui/Stamp.test.jsx`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/components/ui/Stamp.jsx` を変更。

`DEGREE_COLORS` に追加(extreme は critical と同系、hard は success と同系):

```js
const DEGREE_COLORS = {
  critical: { fg: COLORS.brassDark, border: COLORS.brass },
  extreme: { fg: COLORS.brassDark, border: COLORS.brass },
  hard: { fg: COLORS.stamp, border: COLORS.stamp },
  success: { fg: COLORS.stamp, border: COLORS.stamp },
  fail: { fg: COLORS.stamp, border: COLORS.line },
  fumble: { fg: COLORS.stampDark, border: COLORS.stampDark },
};

const DEGREE_LABELS = {
  critical: '会心',
  extreme: 'イクストリーム',
  hard: 'ハード成功',
  success: '成功',
  fail: '失敗',
  fumble: '大失敗',
};
```

ラベル決定ロジックを置換:

```js
  const label = DEGREE_LABELS[roll.degree] || (roll.success ? '成功' : '失敗');
```

押印 span の後(`{label}` を表示する三項式の直後)に注記を追加:

```jsx
      {roll.resourceChange && roll.resourceChange.delta !== 0 && (
        <>
          <span style={{ opacity: 0.6 }}>|</span>
          <span style={{ color: COLORS.stampDark }}>
            {roll.resourceChange.label} {roll.resourceChange.delta}
          </span>
        </>
      )}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/components/ui/Stamp.test.jsx`
Expected: PASS(既存テスト含む)

- [ ] **Step 5: コミット**

```bash
git add src/components/ui/Stamp.jsx src/components/ui/Stamp.test.jsx
git commit -m "feat(ui): Stampにhard/extremeラベルとリソース減少注記を追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: CharacterPanel — リソース表示

**Files:**
- Modify: `src/components/play/CharacterPanel.jsx`
- Test: `src/components/play/CharacterPanel.test.jsx`

**Interfaces:**
- Consumes: `session.state.resources`(Task 8 で保存される)、`getAdapter`(Task 3 の resourceDefs ラベル)。
- Produces: 「正気度: 55/99」表示(resources が空/未定義なら非表示)。

- [ ] **Step 1: 失敗するテストを書く**

`src/components/play/CharacterPanel.test.jsx` に追加(既存の describe 内、セッション生成は既存テストのパターンに合わせる):

```js
  it('shows resources like SAN when present', () => {
    render(
      <CharacterPanel
        session={{
          ruleset: { id: 'coc7e', formula: 'coc7e', growthUnit: '経験値' },
          pc: { raw: 'PC' },
          state: { xp: 0, resources: { san: { value: 55, max: 99 } } },
        }}
        docked
      />
    );
    expect(screen.getByText('正気度: 55/99')).toBeInTheDocument();
  });

  it('hides the resource block when resources are absent', () => {
    render(
      <CharacterPanel
        session={{ ruleset: { id: 'simple' }, pc: { raw: 'PC' }, state: { xp: 0 } }}
        docked
      />
    );
    expect(screen.queryByText(/正気度/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/components/play/CharacterPanel.test.jsx`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/components/play/CharacterPanel.jsx` に import を追加:

```js
import { getAdapter } from '../../engine/rulesetAdapters.js';
```

コンポーネント冒頭(`xp` の下)に追加:

```js
  const resources = session.state?.resources || {};
  const adapter = getAdapter(session.ruleset?.formula);
```

growthUnit 表示 div の直後に追加:

```jsx
      {Object.entries(resources).map(([key, r]) => (
        <div key={key} style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.stampDark, marginBottom: 12 }}>
          {adapter.resourceDefs.find((d) => d.key === key)?.label || key}: {r.value}/{r.max}
        </div>
      ))}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/components/play/CharacterPanel.test.jsx`
Expected: PASS(既存テスト含む)

- [ ] **Step 5: コミット**

```bash
git add src/components/play/CharacterPanel.jsx src/components/play/CharacterPanel.test.jsx
git commit -m "feat(ui): CharacterPanelにSAN等のリソース表示を追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: Setup.jsx — formula スナップショットと resources 初期化

**Files:**
- Modify: `src/screens/Setup.jsx`
- Test: `src/screens/Setup.test.jsx`

**Interfaces:**
- Consumes: `getAdapter`(Task 3)、`RULESETS[].formula`(Task 4)。
- Produces: セッションの `ruleset.formula` と、`state.resources`(coc7e なら `{ san: { value: 60, max: 99 } }`、他は resources キーなし)。

- [ ] **Step 1: 失敗するテストを書く**

`src/screens/Setup.test.jsx` の既存テスト「carries the selected Scenario's recommendedRuleset ...」(coc7e で開始するテスト)のアサーション部に追加:

```js
    expect(session.ruleset.formula).toBe('coc7e');
    expect(session.state.resources).toEqual({ san: { value: 60, max: 99 } });
```

さらに simple で開始する既存テスト(`session.rulesetId).toBe('simple')` をアサートしているもの)に追加:

```js
    expect(session.ruleset.formula).toBe('simple');
    expect('resources' in session.state).toBe(false);
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/screens/Setup.jsx` に import を追加:

```js
import { getAdapter } from '../engine/rulesetAdapters.js';
```

セッション生成部(`const resolvedRuleset = ...` の直後)に追加:

```js
      const adapter = getAdapter(resolvedRuleset.formula);
      const resources = Object.fromEntries(
        adapter.resourceDefs.map((d) => [d.key, { value: d.initial, max: d.max }])
      );
```

`ruleset` スナップショットに `formula` を追加:

```js
        ruleset: {
          id: resolvedRuleset.id,
          label: resolvedRuleset.label,
          desc: resolvedRuleset.desc,
          hint: resolvedRuleset.hint,
          growthUnit: resolvedRuleset.growthUnit || '経験値',
          formula: resolvedRuleset.formula,
        },
```

`state` に resources を条件付きで追加:

```js
        state: {
          current_scene: '冒頭',
          flags: {},
          history_summary: '',
          recent_log: [],
          turn_count: 0,
          xp: campaignContext?.xp || 0,
          ...(Object.keys(resources).length ? { resources } : {}),
        },
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: PASS(既存テスト含む)

- [ ] **Step 5: コミット**

```bash
git add src/screens/Setup.jsx src/screens/Setup.test.jsx
git commit -m "feat(ui): Setupがformulaスナップショットとリソース初期化を行う

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 12: サーバ — Ruleset の formula 永続化(未知値は simple 丸め)

**Files:**
- Modify: `server/storage/rulesetLibrary.js`
- Modify: `server/routes/rulesets.js`
- Test: `server/storage/rulesetLibrary.test.js`
- Test: `server/routes/rulesets.test.js`

**Interfaces:**
- Produces: `saveRuleset` が `formula` を保存。PUT `/api/rulesets/:id` が `formula` を受理し、既知4種(`simple`/`coc7e`/`dnd5e`/`gurps`)以外は `'simple'` に丸めて保存。GET 応答に `formula` が含まれる。
- 注意: サーバは `src/engine/` を import しない(client/server の境界を跨がない)。既知リストはルート側に定数で持つ。

- [ ] **Step 1: 失敗するテストを書く**

`server/routes/rulesets.test.js` に追加:

```js
  it('persists a known formula', async () => {
    await request(app)
      .put('/api/rulesets/homebrew')
      .send({ label: '自作', desc: '', hint: '', growthUnit: '', formula: 'coc7e' });
    const res = await request(app).get('/api/rulesets/homebrew');
    expect(res.body.formula).toBe('coc7e');
  });

  it('rounds an unknown formula down to simple', async () => {
    await request(app)
      .put('/api/rulesets/homebrew')
      .send({ label: '自作', desc: '', hint: '', formula: 'my-custom-dice' });
    const res = await request(app).get('/api/rulesets/homebrew');
    expect(res.body.formula).toBe('simple');
  });

  it('defaults a missing formula to simple', async () => {
    await request(app).put('/api/rulesets/homebrew').send({ label: '自作', desc: '', hint: '' });
    const res = await request(app).get('/api/rulesets/homebrew');
    expect(res.body.formula).toBe('simple');
  });
```

`server/storage/rulesetLibrary.test.js` の保存テストに `formula: 'gurps'` を含めて保存し、`getRuleset` の戻りに `formula: 'gurps'` が含まれることをアサートする1ケースを追加:

```js
  it('persists the formula field', async () => {
    await saveRuleset(dataStore, 'usr_test', { id: 'r1', label: 'L', desc: '', hint: '', growthUnit: '', formula: 'gurps' });
    expect((await getRuleset(dataStore, 'usr_test', 'r1')).formula).toBe('gurps');
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/routes/rulesets.test.js server/storage/rulesetLibrary.test.js`
Expected: FAIL(formula が保存されない)

- [ ] **Step 3: 実装**

`server/storage/rulesetLibrary.js` の `saveRuleset` を変更:

```js
export async function saveRuleset(dataStore, userId, { id, label, desc, hint, growthUnit, formula }) {
  const meta = { id, label, desc, hint, growthUnit, formula, updatedAt: Date.now() };
  await dataStore.set(rulesetMetaKey(userId, id), meta);
  return meta;
}
```

`server/routes/rulesets.js` の PUT ハンドラを変更。ファイル冒頭(import の下)に定数を追加:

```js
// 判定式の既知値。クライアントのsrc/engine/rulesetAdapters.jsと対応(未知値はsimpleへ丸める)。
const KNOWN_FORMULAS = ['simple', 'coc7e', 'dnd5e', 'gurps'];
```

`saveRuleset` 呼び出しに追加:

```js
    const ruleset = await saveRuleset(dataStore, req.userId, {
      id: req.params.id,
      label: req.body.label,
      desc: req.body.desc,
      hint: req.body.hint,
      growthUnit: req.body.growthUnit,
      formula: KNOWN_FORMULAS.includes(req.body.formula) ? req.body.formula : 'simple',
    });
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run server/routes/rulesets.test.js server/storage/rulesetLibrary.test.js`
Expected: PASS(既存テスト含む)

- [ ] **Step 5: コミット**

```bash
git add server/storage/rulesetLibrary.js server/routes/rulesets.js server/routes/rulesets.test.js server/storage/rulesetLibrary.test.js
git commit -m "feat(server): Rulesetのformula永続化(未知値はsimple丸め)を追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 13: クライアント + RulesetTab — formula ドロップダウン

**Files:**
- Modify: `src/api/rulesetLibraryClient.js`
- Modify: `src/screens/library/RulesetTab.jsx`
- Test: `src/api/rulesetLibraryClient.test.js`
- Test: `src/screens/library/RulesetTab.test.jsx`

**Interfaces:**
- Consumes: PUT `/api/rulesets/:id` の `formula` 受理(Task 12)。
- Produces: `putRuleset(id, { label, desc, hint, growthUnit, formula })`。RulesetTab の作成/編集フォームに「判定式(formula)」select(4択、既定 `simple`)。

- [ ] **Step 1: 失敗するテストを書く**

`src/api/rulesetLibraryClient.test.js` の putRuleset テストに倣い、body に formula が含まれるケースを追加:

```js
  it('putRuleset sends the formula in the body', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    await putRuleset('r1', { label: 'L', desc: '', hint: '', growthUnit: '', formula: 'dnd5e' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.formula).toBe('dnd5e');
  });
```

`src/screens/library/RulesetTab.test.jsx` に追加(既存のモックパターンに合わせて `rulesetLibraryClient` を spy する):

```js
  it('sends the selected formula when creating a ruleset', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([]);
    const putSpy = vi.spyOn(rulesetLibraryClient, 'putRuleset').mockResolvedValue({});
    render(<RulesetTab />);
    fireEvent.click(screen.getByText('+ 新規Ruleset'));
    fireEvent.change(screen.getByPlaceholderText('例: homebrew'), { target: { value: 'homebrew' } });
    fireEvent.change(screen.getByPlaceholderText('ラベル'), { target: { value: '自作' } });
    fireEvent.change(screen.getByLabelText('判定式(formula)'), { target: { value: 'coc7e' } });
    fireEvent.click(screen.getByText('作成する'));
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(putSpy.mock.calls[0][1].formula).toBe('coc7e');
  });

  it('loads and saves the formula when editing', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([{ id: 'r1', label: 'L', desc: 'd' }]);
    vi.spyOn(rulesetLibraryClient, 'getRuleset').mockResolvedValue({
      id: 'r1', label: 'L', desc: 'd', hint: '', growthUnit: '', formula: 'gurps',
    });
    const putSpy = vi.spyOn(rulesetLibraryClient, 'putRuleset').mockResolvedValue({});
    render(<RulesetTab />);
    await waitFor(() => expect(screen.getByText('L')).toBeInTheDocument());
    fireEvent.click(screen.getByText('L'));
    await waitFor(() => expect(screen.getByLabelText('判定式(formula)')).toHaveValue('gurps'));
    fireEvent.click(screen.getByText('保存する'));
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(putSpy.mock.calls[0][1].formula).toBe('gurps');
  });
```

(注: `getByLabelText` を効かせるため、実装では `<label htmlFor>` / `<select id>` を紐付けるか、`Field` コンポーネントの既存の label 実装を確認してアクセシブルに紐付けること。既存 Field が label 紐付けを持たない場合は `aria-label="判定式(formula)"` を select に直接付与する。)

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/rulesetLibraryClient.test.js src/screens/library/RulesetTab.test.jsx`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/api/rulesetLibraryClient.js` の `putRuleset` を変更:

```js
export async function putRuleset(id, { label, desc, hint, growthUnit, formula }) {
  return apiFetch(`/api/rulesets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, desc, hint, growthUnit, formula }),
  });
}
```

`src/screens/library/RulesetTab.jsx` を変更。ファイル冒頭に選択肢定数:

```js
const FORMULA_OPTIONS = [
  { value: 'simple', label: 'シンプル(d100成功率)' },
  { value: 'coc7e', label: 'CoC7e風(ハード/イクストリーム+SAN)' },
  { value: 'dnd5e', label: 'D&D5e風(固定5%会心/致命)' },
  { value: 'gurps', label: 'GURPS風(マージン付き)' },
];
```

state を追加:

```js
  const [newFormula, setNewFormula] = useState('simple');
  const [editFormula, setEditFormula] = useState('simple');
```

選択時ロード(`setEditGrowthUnit(r.growthUnit || '')` の下):

```js
        setEditFormula(r.formula || 'simple');
```

`handleCreate` / `handleSave` の `putRuleset` 呼び出しに `formula: newFormula` / `formula: editFormula` を追加し、`handleCreate` 成功時のリセットに `setNewFormula('simple')` を追加。

作成フォーム(growthUnit Field の下)に追加:

```jsx
          <Field label="判定式(formula)" hint="判定式と成功度の出し方。CoC7e風はSAN(正気度)も有効になる。">
            <select
              aria-label="判定式(formula)"
              value={newFormula}
              onChange={(e) => setNewFormula(e.target.value)}
              style={inputStyle}
            >
              {FORMULA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
```

編集フォームにも同様の select(`value={editFormula}` / `onChange={(e) => setEditFormula(e.target.value)}`)を追加。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/rulesetLibraryClient.test.js src/screens/library/RulesetTab.test.jsx`
Expected: PASS(既存テスト含む)

- [ ] **Step 5: コミット**

```bash
git add src/api/rulesetLibraryClient.js src/screens/library/RulesetTab.jsx src/api/rulesetLibraryClient.test.js src/screens/library/RulesetTab.test.jsx
git commit -m "feat(ui): RulesetTabに判定式(formula)ドロップダウンを追加

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 14: 全テスト + ドキュメント更新

**Files:**
- Modify: `docs/07-risks-and-roadmap.md`
- Modify: `docs/08-feature-ideas.md`

**Interfaces:**
- Consumes: Task 1–13 の完成状態。

- [ ] **Step 1: 全テストを実行**

Run: `npm test`
Expected: 全件 PASS。失敗があれば該当タスクに戻って修正(勝手にテストを skip しない)。

- [ ] **Step 2: docs/07-risks-and-roadmap.md を更新**

- 9章の表の「ルールシステム」行を更新: 判定式アダプタ(`src/engine/rulesetAdapters.js`)が実装され、simple/coc7e/dnd5e/gurps の判定式と coc7e の SAN 副作用が有効である旨に書き換える。
- 10.1節の見出しを「(実装済み)」に変更し、本文冒頭の「**現状は未実装**。」段落を実装サマリへ書き換える: 実装は `formula` ベース(`getAdapter`、未知は simple フォールバック)、`side_effect_triggers` はシナリオタグ方式ではなく `roll_check` の `check_kind`(AI駆動発火・決定論解決)で実現、リソースは SAN のみ、と当初案との差分を明記。設計JSONブロックは経緯として残してよい。

- [ ] **Step 3: docs/08-feature-ideas.md を更新**

2章の「ルールセット判定アダプタ」項目を実装済みへ更新:

```markdown
- **ルールセット判定アダプタ**: **実装済み(2026-07-25)**。判定式(simple/coc7e/dnd5e/gurps)を`src/engine/rulesetAdapters.js`でアダプタ化し、CoC7e風はハード/イクストリーム成功とSAN(正気度60/99、check_kind='sanity'でAI駆動発火・決定論減少)を実装。カスタムRulesetも基準式を選択可能。HP等の追加リソース・シナリオ側イベントタグは非対象(07-risks-and-roadmap.md 10.1節)。
```

- [ ] **Step 4: コミット**

```bash
git add docs/07-risks-and-roadmap.md docs/08-feature-ideas.md
git commit -m "docs: ルールセット判定アダプタを実装済みとして反映

Co-Authored-By: Claude <noreply@anthropic.com>"
```
