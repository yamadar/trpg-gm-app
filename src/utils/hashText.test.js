import { describe, it, expect } from 'vitest';
import { hashText } from './hashText.js';

describe('hashText', () => {
  it('returns the same hash for the same text', () => {
    expect(hashText('hello world')).toBe(hashText('hello world'));
  });

  it('returns different hashes for different text', () => {
    expect(hashText('hello')).not.toBe(hashText('world'));
  });

  it('returns a string with no minus sign', () => {
    expect(hashText('x')).not.toMatch(/-/);
  });

  it('handles an empty string deterministically', () => {
    expect(hashText('')).toBe(hashText(''));
    expect(typeof hashText('')).toBe('string');
  });

  it('is sensitive to small changes', () => {
    expect(hashText('goal: 妹を救う')).not.toBe(hashText('goal: 妹を助ける'));
  });
});
