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
