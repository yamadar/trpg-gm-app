// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isValidId, HttpError } from './validateId.js';

describe('isValidId', () => {
  it('accepts normal slug ids', () => {
    expect(isValidId('waterdeep')).toBe(true);
    expect(isValidId('a-b_1')).toBe(true);
  });
  it('rejects traversal and separators', () => {
    expect(isValidId('..')).toBe(false);
    expect(isValidId('../x')).toBe(false);
    expect(isValidId('a/b')).toBe(false);
    expect(isValidId('a\\b')).toBe(false);
    expect(isValidId('.hidden')).toBe(false);
  });
  it('rejects empty, non-string, control chars, and over-long', () => {
    expect(isValidId('')).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(123)).toBe(false);
    expect(isValidId('a b')).toBe(false);
    expect(isValidId('a'.repeat(129))).toBe(false);
  });
});

describe('HttpError', () => {
  it('carries a status', () => {
    const e = new HttpError(400, 'bad');
    expect(e.status).toBe(400);
    expect(e.message).toBe('bad');
    expect(e instanceof Error).toBe(true);
  });
});
