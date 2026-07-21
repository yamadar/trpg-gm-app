import { describe, it, expect } from 'vitest';
import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lowercases and strips non-alphanumeric characters', () => {
    expect(slugify('Water Deep!')).toBe('waterdeep');
  });

  it('truncates to 64 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long)).toHaveLength(64);
  });

  it('falls back to "untitled" when nothing ascii-alphanumeric remains', () => {
    expect(slugify('魔法体系')).toBe('untitled');
  });

  it('falls back to "untitled" for an empty string', () => {
    expect(slugify('')).toBe('untitled');
  });
});
