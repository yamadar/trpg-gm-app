import { describe, it, expect } from 'vitest';
import { RULESETS } from './rulesets.js';

describe('RULESETS', () => {
  it('has 4 entries with unique ids', () => {
    expect(RULESETS).toHaveLength(4);
    const ids = RULESETS.map((r) => r.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('every entry has id/label/desc/hint/growthUnit fields', () => {
    for (const r of RULESETS) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('label');
      expect(r).toHaveProperty('desc');
      expect(r).toHaveProperty('hint');
      expect(r).toHaveProperty('growthUnit');
    }
  });

  it('includes the simple ruleset with no hint', () => {
    const simple = RULESETS.find((r) => r.id === 'simple');
    expect(simple.hint).toBe('');
  });

  it('uses "CP" as the growthUnit for gurps and "経験値" for the others', () => {
    const byId = Object.fromEntries(RULESETS.map((r) => [r.id, r]));
    expect(byId.simple.growthUnit).toBe('経験値');
    expect(byId.coc7e.growthUnit).toBe('経験値');
    expect(byId.dnd5e.growthUnit).toBe('経験値');
    expect(byId.gurps.growthUnit).toBe('CP');
  });
});

describe('formula', () => {
  it('every builtin ruleset has a formula matching its id', () => {
    for (const r of RULESETS) {
      expect(r.formula).toBe(r.id);
    }
  });
});
