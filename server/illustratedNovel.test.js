// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildIllustratedMarkdown } from './illustratedNovel.js';

const bufA = Buffer.from([1, 2, 3]);
const bufB = Buffer.from([4, 5]);
const uriA = `data:image/png;base64,${bufA.toString('base64')}`;

describe('buildIllustratedMarkdown', () => {
  it('本文中のマーカーをdata URIのMarkdown画像に置換する', () => {
    const out = buildIllustratedMarkdown({
      novelText: '冒頭\n〈挿絵1〉\n本文',
      imageIds: ['img_a'],
      images: new Map([['img_a', bufA]]),
    });
    expect(out).toBe(`冒頭\n![挿絵1](${uriA})\n本文`);
  });
  it('範囲外番号・画像nullのマーカーは除去する', () => {
    const out = buildIllustratedMarkdown({
      novelText: 'x〈挿絵9〉y\n〈挿絵1〉',
      imageIds: ['img_a'],
      images: new Map([['img_a', null]]),
    });
    expect(out).not.toContain('挿絵9');
    expect(out).not.toContain('data:');
  });
  it('本文に現れなかった画像は末尾の「## 挿絵」節にまとめる', () => {
    const out = buildIllustratedMarkdown({
      novelText: '本文のみ',
      imageIds: ['img_a', 'img_b'],
      images: new Map([
        ['img_a', bufA],
        ['img_b', bufB],
      ]),
    });
    expect(out).toContain('## 挿絵');
    expect(out).toContain(`![挿絵1](${uriA})`);
    expect(out).toContain('![挿絵2](data:image/png;base64,');
  });
  it('重複マーカーは最初だけ置換し以降は除去する', () => {
    const out = buildIllustratedMarkdown({
      novelText: '〈挿絵1〉\n中\n〈挿絵1〉',
      imageIds: ['img_a'],
      images: new Map([['img_a', bufA]]),
    });
    expect(out.match(/data:image\/png/g)).toHaveLength(1);
  });
  it('マーカーも画像も無ければ本文は不変', () => {
    expect(buildIllustratedMarkdown({ novelText: 'plain', imageIds: [], images: new Map() })).toBe('plain');
  });
});
