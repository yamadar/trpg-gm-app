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

  it('returns an empty string when the PC名 line holds only a full-width space', () => {
    // 正規表現の末尾trimは[ \t]*(半角のみ)なので、全角スペース(U+3000)だけの行は
    // trim前だとキャプチャがtruthyな空白文字列になってしまう(composePcRawが
    // 「PC名行が既にある」と誤判定し、入力欄の名前を黙って捨てる原因になる)。
    expect(extractPcName('PC名: 　\ngoal: 生き延びる')).toBe('');
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

  it('does not treat a full-width-space-only PC名 line as already named', () => {
    // extractPcNameがtrimせずに全角スペースを返すと、composePcRawがここで早期returnしてしまい、
    // 入力欄に打った名前が本文へ反映されない事故になっていた。
    const raw = 'PC名: 　\ngoal: 生き延びる';
    expect(composePcRaw('カイ', raw)).toBe('PC名: カイ\nPC名: 　\ngoal: 生き延びる');
  });
});
