import { describe, it, expect } from 'vitest';
import { RULESETS } from './rulesets.js';

describe('RULESETS', () => {
  it('has 4 entries with unique ids', () => {
    expect(RULESETS).toHaveLength(4);
    const ids = RULESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('every entry has id/label/desc/hint fields', () => {
    for (const r of RULESETS) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('label');
      expect(r).toHaveProperty('desc');
      expect(r).toHaveProperty('hint');
    }
  });

  it('includes the simple ruleset with no hint', () => {
    const simple = RULESETS.find((r) => r.id === 'simple');
    expect(simple.hint).toBe('');
  });
});
