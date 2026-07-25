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
