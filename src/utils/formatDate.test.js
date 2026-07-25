import { describe, it, expect } from 'vitest';
import { formatDate } from './formatDate.js';

describe('formatDate', () => {
  it('formats a timestamp as a local YYYY-MM-DD', () => {
    expect(formatDate(new Date(2026, 6, 5, 12).getTime())).toBe('2026-07-05');
  });

  it('returns an empty string for a missing timestamp', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate(0)).toBe('');
  });
});
