import { describe, expect, it } from 'vitest';
import { normalizeMarkdown } from './markdown.js';

describe('normalizeMarkdown', () => {
  it('turns escaped model line breaks into real Markdown line breaks', () => {
    expect(normalizeMarkdown('# 世界\\n\\n## 地域\\n本文')).toBe('# 世界\n\n## 地域\n本文');
  });

  it('normalizes CRLF without changing existing LF breaks', () => {
    expect(normalizeMarkdown('# 世界\r\n\r\n本文\n続き')).toBe('# 世界\n\n本文\n続き');
  });
});

