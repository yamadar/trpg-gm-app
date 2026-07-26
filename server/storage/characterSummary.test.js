// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { summarizeSheet } from './characterSummary.js';

describe('summarizeSheet', () => {
  it('takes the display name from the PC名 line and drops it from the excerpt', () => {
    const { displayName, excerpt } = summarizeSheet('PC名: ハワード・ケイン\n新聞記者。取材で街を歩き回る。');
    expect(displayName).toBe('ハワード・ケイン');
    expect(excerpt).toBe('新聞記者。取材で街を歩き回る。');
  });

  it('accepts the full-width colon and trims the surrounding spaces', () => {
    expect(summarizeSheet('PC名：　メイベル　\n骨董商').displayName).toBe('メイベル');
  });

  it('leaves the display name empty when the sheet has no PC名 line', () => {
    const { displayName, excerpt } = summarizeSheet('放浪の剣士。故郷を焼かれている。');
    expect(displayName).toBe('');
    expect(excerpt).toBe('放浪の剣士。故郷を焼かれている。');
  });

  it('flattens the sheet into one line, stripping markdown markers and blank lines', () => {
    const raw = ['# ハワード・ケイン', '', '- goal: 兄の死の真相を知る', '> bonds: 編集長とは腐れ縁'].join('\n');
    expect(summarizeSheet(raw).excerpt).toBe(
      'ハワード・ケイン / goal: 兄の死の真相を知る / bonds: 編集長とは腐れ縁'
    );
  });

  it('truncates a long sheet so a card stays readable', () => {
    const { excerpt } = summarizeSheet('あ'.repeat(300));
    expect(excerpt).toHaveLength(121); // 120文字 + 省略記号
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('returns empty strings for an empty or missing sheet', () => {
    expect(summarizeSheet('')).toEqual({ displayName: '', excerpt: '' });
    expect(summarizeSheet(undefined)).toEqual({ displayName: '', excerpt: '' });
  });
});
