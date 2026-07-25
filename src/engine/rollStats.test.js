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
