// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createKeyedLock } from './keyedLock.js';

describe('createKeyedLock', () => {
  it('serializes operations for the same key', async () => {
    const withLock = createKeyedLock();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const order = [];
    const first = withLock('session-1', async () => {
      order.push('first-start');
      await gate;
      order.push('first-end');
    });
    const secondOperation = vi.fn(async () => {
      order.push('second');
    });
    const second = withLock('session-1', secondOperation);

    await vi.waitFor(() => expect(order).toEqual(['first-start']));
    expect(secondOperation).not.toHaveBeenCalled();
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('allows different keys to run independently', async () => {
    const withLock = createKeyedLock();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const first = withLock('session-1', () => gate);
    const other = vi.fn().mockResolvedValue('ok');

    await expect(withLock('session-2', other)).resolves.toBe('ok');
    expect(other).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
