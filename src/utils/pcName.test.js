import { describe, it, expect } from 'vitest';
import { extractPcName, composePcRaw } from './pcName.js';

describe('extractPcName', () => {
  it('picks the name out of a PC名 line', () => {
    expect(extractPcName('PC名: カイ・アーレンス\n能力値: STR10')).toBe('カイ・アーレンス');
  });

  it('accepts a full-width colon and surrounding spaces', () => {
    expect(extractPcName('  PC名 ： ミラ  ')).toBe('ミラ');
  });

  it('finds the line even when it is not the first line', () => {
    expect(extractPcName('# シート\nPC名: ゲオルク\ngoal: 復讐')).toBe('ゲオルク');
  });

  it('returns an empty string when there is no PC名 line', () => {
    expect(extractPcName('能力値: STR10\ngoal: 生き延びる')).toBe('');
  });

  it('returns an empty string for empty or nullish input', () => {
    expect(extractPcName('')).toBe('');
    expect(extractPcName(null)).toBe('');
    expect(extractPcName(undefined)).toBe('');
  });
});

describe('composePcRaw', () => {
  it('prepends a PC名 line to a sheet that has none', () => {
    expect(composePcRaw('カイ', 'goal: 生き延びる')).toBe('PC名: カイ\ngoal: 生き延びる');
  });

  it('leaves a sheet that already names the PC untouched', () => {
    const raw = 'PC名: ハワード\ngoal: 真相を暴く';
    expect(composePcRaw('カイ', raw)).toBe(raw);
  });

  it('returns just the name line when the sheet body is empty', () => {
    expect(composePcRaw('カイ', '')).toBe('PC名: カイ');
  });

  it('returns the body unchanged when no name is given', () => {
    expect(composePcRaw('', 'goal: 生き延びる')).toBe('goal: 生き延びる');
    expect(composePcRaw('   ', 'goal: 生き延びる')).toBe('goal: 生き延びる');
  });

  it('trims the name and the body', () => {
    expect(composePcRaw('  カイ  ', '  goal: 生き延びる  ')).toBe('PC名: カイ\ngoal: 生き延びる');
  });
});
