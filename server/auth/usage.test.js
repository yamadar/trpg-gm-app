// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from '../storage/dataStore.js';
import { createUsage, usageKey } from './usage.js';

let dir;
let dataStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'usage-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 6, 23, 10, 0, 0); // 2026-07-23T10:00:00Z

describe('usage limits', () => {
  it('allows consumption up to the limit, then rejects with resetAt', async () => {
    const usage = createUsage({ dataStore, limits: { messages: 2, novelize: 1 }, now: () => T0 });
    expect((await usage.consume('usr_1', 'messages')).ok).toBe(true);
    expect((await usage.consume('usr_1', 'messages')).ok).toBe(true);
    const third = await usage.consume('usr_1', 'messages');
    expect(third.ok).toBe(false);
    expect(third.resetAt).toBe(Date.UTC(2026, 6, 24));
  });

  it('tracks kinds independently', async () => {
    const usage = createUsage({ dataStore, limits: { messages: 1, novelize: 1 }, now: () => T0 });
    await usage.consume('usr_1', 'messages');
    expect((await usage.consume('usr_1', 'novelize')).ok).toBe(true);
  });

  it('tracks users independently', async () => {
    const usage = createUsage({ dataStore, limits: { messages: 1, novelize: 1 }, now: () => T0 });
    await usage.consume('usr_1', 'messages');
    expect((await usage.consume('usr_2', 'messages')).ok).toBe(true);
  });

  it('resets on the next UTC day', async () => {
    let t = T0;
    const usage = createUsage({ dataStore, limits: { messages: 1, novelize: 1 }, now: () => t });
    await usage.consume('usr_1', 'messages');
    expect((await usage.consume('usr_1', 'messages')).ok).toBe(false);
    t = Date.UTC(2026, 6, 24, 0, 0, 1);
    expect((await usage.consume('usr_1', 'messages')).ok).toBe(true);
  });

  it('persists counters under the user namespace', async () => {
    const usage = createUsage({ dataStore, limits: { messages: 5, novelize: 5 }, now: () => T0 });
    await usage.consume('usr_1', 'messages');
    expect(await dataStore.get(usageKey('usr_1', '2026-07-23'))).toEqual({ messages: 1 });
  });

  it('does not exceed the limit under concurrent consume of the same key', async () => {
    const usage = createUsage({ dataStore, limits: { messages: 5, novelize: 1 }, now: () => T0 });
    const results = await Promise.all(Array.from({ length: 20 }, () => usage.consume('usr_1', 'messages')));
    expect(results.filter((r) => r.ok).length).toBe(5);
    expect(await dataStore.get(usageKey('usr_1', '2026-07-23'))).toEqual({ messages: 5 });
  });
});
