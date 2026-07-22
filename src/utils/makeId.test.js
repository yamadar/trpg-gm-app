import { describe, it, expect } from 'vitest';
import { makeId } from './makeId.js';

describe('makeId', () => {
  it('starts with the slugified base and includes a timestamp and random suffix', () => {
    const id = makeId('Test World');
    expect(id).toMatch(/^testworld-\d+-[a-z0-9]{4}$/);
  });

  it('produces distinct ids for rapid successive calls (random component)', () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeId('x')));
    expect(ids.size).toBe(50);
  });

  it('falls back to untitled for a non-ascii base', () => {
    expect(makeId('日本語').startsWith('untitled-')).toBe(true);
  });
});
