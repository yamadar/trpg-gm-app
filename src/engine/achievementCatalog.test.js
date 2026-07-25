import { describe, it, expect } from 'vitest';
import { CATALOG, CATEGORIES, MOOD_ENTRIES, FORMULAS } from './achievementCatalog.js';
import { MOODS } from '../constants/moods.js';
import { RULESETS } from '../data/rulesets.js';
import { ICONS } from '../components/achievements/AchievementIcon.jsx';

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

describe('mood achievements', () => {
  it('covers every mood in MOODS exactly once', () => {
    expect(MOOD_ENTRIES.map((m) => m.mood).sort()).toEqual([...MOODS].sort());
  });
});

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

  it('only names glyphs that AchievementIcon actually draws', () => {
    for (const a of CATALOG) {
      expect(Object.keys(ICONS), a.id).toContain(a.icon);
    }
  });
});
