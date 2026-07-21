import { describe, it, expect } from 'vitest';
import { ROLL_TOOL, buildSystemPrompt } from './prompts.js';

function makeSession(overrides = {}) {
  return {
    rulesetId: 'coc7e',
    world: { summary: '霧深い港町' },
    scenario: { raw: '## シナリオ概要\n失踪事件' },
    pc: { raw: 'PC名: アリス' },
    state: {
      current_scene: '波止場',
      flags: { met_npc_a: true },
      history_summary: 'これまでのあらすじ',
      recent_log: [{ role: 'player', text: '波止場を調べる' }],
    },
    ...overrides,
  };
}

describe('ROLL_TOOL', () => {
  it('declares check_label and success_percent as required inputs', () => {
    expect(ROLL_TOOL.name).toBe('roll_check');
    expect(ROLL_TOOL.input_schema.required).toEqual(['check_label', 'success_percent']);
  });
});

describe('buildSystemPrompt', () => {
  it('includes the world summary, scenario, pc sheet, and current scene', () => {
    const prompt = buildSystemPrompt(makeSession());
    expect(prompt).toContain('霧深い港町');
    expect(prompt).toContain('失踪事件');
    expect(prompt).toContain('PC名: アリス');
    expect(prompt).toContain('波止場');
  });

  it('includes the matching ruleset hint', () => {
    const prompt = buildSystemPrompt(makeSession({ rulesetId: 'coc7e' }));
    expect(prompt).toContain('SAN値チェック');
  });

  it('falls back to the simple ruleset when rulesetId is unknown', () => {
    const prompt = buildSystemPrompt(makeSession({ rulesetId: 'unknown' }));
    expect(prompt).toContain('特別な演出指定なし。');
  });

  it('formats flags and falls back to placeholders when empty', () => {
    const prompt = buildSystemPrompt(makeSession({ state: { current_scene: 'x', flags: {}, history_summary: '', recent_log: [] } }));
    expect(prompt).toContain('既知フラグ: (なし)');
    expect(prompt).toContain('物語要約: (まだなし)');
    expect(prompt).toContain('直近のログ\n(まだなし)');
  });
});
