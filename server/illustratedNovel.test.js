// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildIllustratedHtml } from './illustratedNovel.js';

const bufA = Buffer.from([1, 2, 3]);
const bufB = Buffer.from([4, 5]);
const uriA = `data:image/png;base64,${bufA.toString('base64')}`;

describe('buildIllustratedHtml', () => {
  it('本文中のマーカーをdata URIのHTML画像に置換する', () => {
    const out = buildIllustratedHtml({
      title: '冒険譚',
      novelText: '冒頭\n〈挿絵1〉\n本文',
      imageIds: ['img_a'],
      images: new Map([['img_a', bufA]]),
    });
    expect(out).toContain('<!doctype html>');
    expect(out).toContain('<title>冒険譚</title>');
    expect(out).toContain(`<img src="${uriA}" alt="">`);
    expect(out).not.toContain('〈挿絵1〉');
    expect(out).not.toContain('<figcaption>');
    expect(out).not.toContain('挿絵1');
  });

  it('範囲外番号・画像nullのマーカーは除去する', () => {
    const out = buildIllustratedHtml({
      novelText: 'x〈挿絵9〉y\n〈挿絵1〉',
      imageIds: ['img_a'],
      images: new Map([['img_a', null]]),
    });
    expect(out).not.toContain('挿絵9');
    expect(out).not.toContain('data:');
  });

  it('本文に現れなかった画像は末尾の挿絵節にまとめる', () => {
    const out = buildIllustratedHtml({
      novelText: '本文のみ',
      imageIds: ['img_a', 'img_b'],
      images: new Map([
        ['img_a', bufA],
        ['img_b', bufB],
      ]),
    });
    expect(out).toContain('<h2>挿絵</h2>');
    expect(out).toContain(`<img src="${uriA}" alt="">`);
    expect(out).toContain('<img src="data:image/png;base64,');
    expect(out).not.toContain('<figcaption>');
  });

  it('重複マーカーは最初だけ置換し以降は除去する', () => {
    const out = buildIllustratedHtml({
      novelText: '〈挿絵1〉\n中\n〈挿絵1〉',
      imageIds: ['img_a'],
      images: new Map([['img_a', bufA]]),
    });
    expect(out.match(/data:image\/png/g)).toHaveLength(1);
  });

  it('タイトルと本文をHTMLとして解釈させない', () => {
    const out = buildIllustratedHtml({
      title: '<script>alert(1)</script>',
      novelText: '<img src=x onerror=alert(1)>&',
      imageIds: [],
      images: new Map(),
    });
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;&amp;');
  });

  it('Markdownの小見出し・太字・段落をHTMLへ変換する', () => {
    const out = buildIllustratedHtml({
      novelText: '## 霧の港\n\n**古い鍵**が光った。\n次の一文。\n\n### 地下室\n\n静寂。',
      imageIds: [],
      images: new Map(),
    });

    expect(out).toContain('<h2>霧の港</h2>');
    expect(out).toContain('<p><strong>古い鍵</strong>が光った。<br>次の一文。</p>');
    expect(out).toContain('<h3>地下室</h3>');
    expect(out).toContain('<p>静寂。</p>');
    expect(out).not.toContain('## 霧の港');
    expect(out).not.toContain('**古い鍵**');
  });

  it('Markdown変換後も見出しと太字のHTMLを安全にエスケープする', () => {
    const out = buildIllustratedHtml({
      novelText: '## <img src=x>\n\n**<script>alert(1)</script>**',
      imageIds: [],
      images: new Map(),
    });

    expect(out).toContain('<h2>&lt;img src=x&gt;</h2>');
    expect(out).toContain('<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>');
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).not.toContain('<img src=x>');
  });
});
