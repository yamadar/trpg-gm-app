// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildTranscriptWithMarkers, stripImageMarkers } from './novelMarkers.js';

describe('buildTranscriptWithMarkers', () => {
  it('挿絵を持つGMエントリの直前にマーカー行を挿入し、imageIdsを出現順で返す', () => {
    const log = [
      { role: 'player', text: '進む' },
      { role: 'gm', text: '森だ', image: { imageId: 'img_a' } },
      { role: 'gm', text: '奥へ' },
      { role: 'gm', text: '洞窟だ', image: { imageId: 'img_b' } },
    ];
    const { transcript, imageIds } = buildTranscriptWithMarkers(log);
    expect(imageIds).toEqual(['img_a', 'img_b']);
    expect(transcript).toBe('PL: 進む\n〈挿絵1〉\nGM: 森だ\nGM: 奥へ\n〈挿絵2〉\nGM: 洞窟だ');
  });
  it('挿絵が無ければ従来のトランスクリプトと同一でimageIdsは空', () => {
    const log = [{ role: 'gm', text: 'a' }, { role: 'player', text: 'b' }];
    const { transcript, imageIds } = buildTranscriptWithMarkers(log);
    expect(imageIds).toEqual([]);
    expect(transcript).toBe('GM: a\nPL: b');
  });
  it('空・未定義logで例外を投げない', () => {
    expect(buildTranscriptWithMarkers([]).transcript).toBe('');
    expect(buildTranscriptWithMarkers(undefined).imageIds).toEqual([]);
  });
});

describe('stripImageMarkers', () => {
  it('独立行のマーカーは行ごと除去し、連続空行を作らない', () => {
    expect(stripImageMarkers('前\n〈挿絵1〉\n後')).toBe('前\n後');
  });
  it('本文中に紛れたマーカーも除去する', () => {
    expect(stripImageMarkers('これは〈挿絵2〉テスト')).toBe('これはテスト');
  });
  it('マーカーが無ければ不変', () => {
    expect(stripImageMarkers('そのまま')).toBe('そのまま');
    expect(stripImageMarkers('段落1\n\n段落2')).toBe('段落1\n\n段落2');
  });
  it('null/undefinedで例外を投げない', () => {
    expect(stripImageMarkers(null)).toBe('');
    expect(stripImageMarkers(undefined)).toBe('');
  });
});
