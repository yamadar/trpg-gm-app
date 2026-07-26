import { describe, it, expect } from 'vitest';
import { normalizeTurnResult } from './turnResult.js';

describe('normalizeTurnResult', () => {
  it('passes through a well-formed result', () => {
    const out = normalizeTurnResult({
      narrative: '物語',
      choices: ['A', 'B'],
      state_update: { current_scene: '森', flags: { met: true }, history_summary: '要約', xp_gained: 5 },
    });
    expect(out.narrative).toBe('物語');
    expect(out.choices).toEqual(['A', 'B']);
    expect(out.stateUpdate).toEqual({
      current_scene: '森',
      flags: { met: true },
      history_summary: '要約',
      xpGain: 5,
      tension_level: null,
      endingReached: false,
    });
  });

  it('replaces a non-string narrative with a safe placeholder', () => {
    expect(normalizeTurnResult({ narrative: { bad: 1 } }).narrative).toBe('(描写を取得できませんでした)');
    expect(normalizeTurnResult({}).narrative).toBe('(描写を取得できませんでした)');
  });

  // 空文字は文字列なので型チェックだけでは通ってしまい、地の文の無いGMカードが
  // そのまま描かれる。プレイヤーには「何も起きなかった」と区別できないため、
  // 欠落と同じ扱いにして取得失敗であることを見せる。
  it('replaces a blank narrative with the placeholder', () => {
    expect(normalizeTurnResult({ narrative: '' }).narrative).toBe('(描写を取得できませんでした)');
    expect(normalizeTurnResult({ narrative: '   \n\t ' }).narrative).toBe('(描写を取得できませんでした)');
  });

  it('keeps only string choices and defaults to an empty array', () => {
    expect(normalizeTurnResult({ choices: ['ok', 3, null, 'yes'] }).choices).toEqual(['ok', 'yes']);
    expect(normalizeTurnResult({ choices: 'notarray' }).choices).toEqual([]);
    expect(normalizeTurnResult({}).choices).toEqual([]);
  });

  // 空文字の選択肢はラベルの無いボタンになり、押すと空の行動がGMへ送られる。
  it('drops blank choices so no empty button is offered', () => {
    expect(normalizeTurnResult({ choices: ['進む', '', '   '] }).choices).toEqual(['進む']);
  });

  it('returns null for an invalid current_scene so the caller keeps the previous one', () => {
    expect(normalizeTurnResult({ state_update: { current_scene: '' } }).stateUpdate.current_scene).toBeNull();
    expect(normalizeTurnResult({ state_update: { current_scene: { x: 1 } } }).stateUpdate.current_scene).toBeNull();
    expect(normalizeTurnResult({ state_update: { current_scene: '港' } }).stateUpdate.current_scene).toBe('港');
  });

  it('returns null for non-plain-object flags', () => {
    expect(normalizeTurnResult({ state_update: { flags: 'x' } }).stateUpdate.flags).toBeNull();
    expect(normalizeTurnResult({ state_update: { flags: [1, 2] } }).stateUpdate.flags).toBeNull();
    expect(normalizeTurnResult({ state_update: { flags: { a: 1 } } }).stateUpdate.flags).toEqual({ a: 1 });
  });

  it('returns null for a non-string history_summary', () => {
    expect(normalizeTurnResult({ state_update: { history_summary: { x: 1 } } }).stateUpdate.history_summary).toBeNull();
    expect(normalizeTurnResult({ state_update: { history_summary: 'ok' } }).stateUpdate.history_summary).toBe('ok');
  });

  it('coerces xp_gained to a finite non-negative number', () => {
    expect(normalizeTurnResult({ state_update: { xp_gained: '5' } }).stateUpdate.xpGain).toBe(5);
    expect(normalizeTurnResult({ state_update: { xp_gained: -10 } }).stateUpdate.xpGain).toBe(0);
    expect(normalizeTurnResult({ state_update: { xp_gained: 'abc' } }).stateUpdate.xpGain).toBe(0);
    expect(normalizeTurnResult({ state_update: {} }).stateUpdate.xpGain).toBe(0);
    expect(normalizeTurnResult({}).stateUpdate.xpGain).toBe(0);
  });

  it('tension_levelは既知の値のみ通し、不正・欠落はnull(前値保持)にする', () => {
    expect(normalizeTurnResult({ state_update: { tension_level: 'high' } }).stateUpdate.tension_level).toBe('high');
    expect(normalizeTurnResult({ state_update: { tension_level: 'low' } }).stateUpdate.tension_level).toBe('low');
    expect(normalizeTurnResult({ state_update: { tension_level: 'medium' } }).stateUpdate.tension_level).toBe('medium');
    expect(normalizeTurnResult({ state_update: { tension_level: '爆発' } }).stateUpdate.tension_level).toBeNull();
    expect(normalizeTurnResult({ state_update: {} }).stateUpdate.tension_level).toBeNull();
    expect(normalizeTurnResult({}).stateUpdate.tension_level).toBeNull();
  });

  it('never throws on a null or non-object result', () => {
    expect(() => normalizeTurnResult(null)).not.toThrow();
    expect(normalizeTurnResult(null).narrative).toBe('(描写を取得できませんでした)');
  });
});

describe('normalizeTurnResult ending_reached', () => {
  it('reports endingReached true when the model says the story ended', () => {
    const out = normalizeTurnResult({ narrative: 'n', state_update: { ending_reached: true }, choices: [] });
    expect(out.stateUpdate.endingReached).toBe(true);
  });

  it('defaults endingReached to false when absent', () => {
    const out = normalizeTurnResult({ narrative: 'n', state_update: {}, choices: [] });
    expect(out.stateUpdate.endingReached).toBe(false);
  });

  it('treats non-boolean ending_reached as false', () => {
    const out = normalizeTurnResult({ narrative: 'n', state_update: { ending_reached: 'yes' }, choices: [] });
    expect(out.stateUpdate.endingReached).toBe(false);
  });
});
