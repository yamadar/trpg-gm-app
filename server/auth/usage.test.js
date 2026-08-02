// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from '../storage/dataStore.js';
import { createUsage, globalUsageKey, usageKey } from './usage.js';
import { createPersistence } from '../persistence/createPersistence.js';

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

  it('charges multiple units atomically without exceeding the limit', async () => {
    const usage = createUsage({ dataStore, limits: { textTokens: 5_000 }, now: () => T0 });
    expect((await usage.consume('usr_1', 'textTokens', 3_000)).ok).toBe(true);
    expect((await usage.consume('usr_1', 'textTokens', 3_000)).ok).toBe(false);
    expect(await dataStore.get(usageKey('usr_1', '2026-07-23'))).toEqual({ textTokens: 3_000 });
  });

  it('tracks a separate global budget', async () => {
    const usage = createUsage({
      dataStore,
      limits: { textTokens: 10_000 },
      globalLimits: { textTokens: 4_000 },
      now: () => T0,
    });
    expect((await usage.consumeGlobal('textTokens', 2_500)).ok).toBe(true);
    expect((await usage.consumeGlobal('textTokens', 2_000)).ok).toBe(false);
    expect(await dataStore.get(globalUsageKey('2026-07-23'))).toEqual({ textTokens: 2_500 });
  });

  it('reserves user and global text-operation budgets as one batch', async () => {
    const usage = createUsage({
      dataStore,
      limits: { messages: 3, textTokens: 10_000 },
      globalLimits: { textTokens: 2_000 },
      now: () => T0,
    });
    expect((await usage.reserveTextOperation('usr_1', 2_500)).ok).toBe(false);
    expect(await dataStore.get(usageKey('usr_1', '2026-07-23'))).toBeNull();
    expect(await dataStore.get(globalUsageKey('2026-07-23'))).toBeNull();
  });

  it('uses SQLite atomic counters under concurrent reservations', async () => {
    const persistence = createPersistence({ driver: 'sqlite', dataDir: dir });
    try {
      const usage = createUsage({
        repository: persistence.repositories.usage,
        limits: { messages: 5, textTokens: 5_000 },
        globalLimits: { textTokens: 5_000 },
        now: () => T0,
      });
      const results = await Promise.all(
        Array.from({ length: 20 }, () => usage.reserveTextOperation('usr_1', 1_000)),
      );
      expect(results.filter((result) => result.ok)).toHaveLength(5);
      expect(persistence.db.prepare(`
        SELECT used_units FROM usage_counters
        WHERE scope = 'user' AND owner_id = 'usr_1' AND day = '2026-07-23' AND kind = 'textTokens'
      `).get().used_units).toBe(5_000);
      expect(persistence.db.prepare(`
        SELECT used_units FROM usage_counters
        WHERE scope = 'global' AND owner_id = '' AND day = '2026-07-23' AND kind = 'textTokens'
      `).get().used_units).toBe(5_000);
    } finally {
      persistence.close();
    }
  });

  it('rejects invalid usage units', async () => {
    const usage = createUsage({ dataStore, limits: { messages: 10 }, now: () => T0 });
    await expect(usage.consume('usr_1', 'messages', 0)).rejects.toThrow('positive integer');
  });
});
