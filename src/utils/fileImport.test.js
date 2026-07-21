import { describe, it, expect } from 'vitest';
import { htmlToText, readFilesAsEntries, combineEntries } from './fileImport.js';

describe('htmlToText', () => {
  it('strips tags and converts block elements to newlines', () => {
    const html = '<html><body><h1>Title</h1><p>Para one</p><p>Para two</p></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('Title');
    expect(text).toContain('Para one');
    expect(text).toContain('Para two');
    expect(text).not.toContain('<p>');
  });

  it('removes script and style content', () => {
    const html = '<body><script>evil()</script><style>.x{}</style><p>Visible</p></body>';
    const text = htmlToText(html);
    expect(text).not.toContain('evil()');
    expect(text).toBe('Visible');
  });
});

describe('combineEntries', () => {
  it('joins entries with a name header', () => {
    const combined = combineEntries([
      { name: 'a.md', content: 'Alpha' },
      { name: 'b.md', content: 'Beta' },
    ]);
    expect(combined).toBe('===== a.md =====\nAlpha\n\n===== b.md =====\nBeta');
  });

  it('returns an empty string for no entries', () => {
    expect(combineEntries([])).toBe('');
  });
});

describe('readFilesAsEntries', () => {
  it('filters to markdown/text/html files and reads their content', async () => {
    const files = [
      new File(['# Hello'], 'world.md', { type: 'text/markdown' }),
      new File(['<p>Hi</p>'], 'page.html', { type: 'text/html' }),
      new File(['ignored'], 'image.png', { type: 'image/png' }),
    ];
    const entries = await readFilesAsEntries(files);
    expect(entries.map((e) => e.name).sort()).toEqual(['page.html', 'world.md']);
    const world = entries.find((e) => e.name === 'world.md');
    expect(world.content).toBe('# Hello');
    const page = entries.find((e) => e.name === 'page.html');
    expect(page.content).toBe('Hi');
  });

  it('sorts entries by name', async () => {
    const files = [new File(['b'], 'b.txt'), new File(['a'], 'a.txt')];
    const entries = await readFilesAsEntries(files);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt']);
  });
});
