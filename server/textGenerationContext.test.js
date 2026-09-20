// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistence } from './persistence/createPersistence.js';
import { createUsage, globalUsageKey, usageKey } from './auth/usage.js';
import { createTextLimiter, withTextGenerationContext } from './textGenerationContext.js';
import { generateText } from './textProvider.js';

const resources = [];
afterEach(async () => { for (const { persistence, dir } of resources.splice(0)) { persistence.close(); await fs.rm(dir, { recursive: true, force: true }); } });
const options = { apiKey: 'fake', model: 'gemini-3.8-flash', request: { max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] }, logger: () => {} };
const response = () => ({ ok: true, json: async () => ({ usageMetadata: { totalTokenCount: 30 }, candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'done' }] } }] }) });

describe.each(['filesystem', 'sqlite'])('shared AI accounting (%s)', (driver) => {
  async function setup() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'text-budget-'));
    const persistence = createPersistence({ dataDir: dir, driver });
    resources.push({ persistence, dir });
    const usage = createUsage({ dataStore: persistence.dataStore, repository: persistence.repositories.usage, limits: { textTokens: 1000 }, globalLimits: { textTokens: 1100 }, now: () => Date.UTC(2026, 8, 20) });
    return { usage, dataStore: driver === 'filesystem' ? persistence.dataStore : { get: async (key) => {
      const global = key.startsWith('global/');
      const owner = global ? '' : key.split('/')[1];
      return { textTokens: persistence.db.prepare('SELECT used_units FROM usage_counters WHERE scope = ? AND owner_id = ? AND day = ? AND kind = ?').get(global ? 'global' : 'user', owner, key.split('/').at(-1), 'textTokens')?.used_units || 0 };
    } } };
  }
  it('reserves globally across owners and settles actual usage exactly once', async () => {
    const { usage, dataStore } = await setup();
    const reservation = await usage.reserveTextTokens('a', 900);
    expect((await usage.reserveTextTokens('b', 300)).ok).toBe(false);
    await reservation.settle(30);
    await reservation.settle(0);
    expect((await dataStore.get(usageKey('a', '2026-09-20'))).textTokens).toBe(30);
    expect((await usage.reserveTextTokens('b', 1000)).ok).toBe(true);
    expect((await dataStore.get(globalUsageKey('2026-09-20'))).textTokens).toBe(1030);
  });
  it('enforces and accounts for every generation under the shared context', async () => {
    const { usage, dataStore } = await setup();
    const fetchImpl = vi.fn(async () => response());
    const context = { usage, userId: 'a', limiter: createTextLimiter(2) };
    await withTextGenerationContext(context, () => generateText({ ...options, fetchImpl }));
    expect((await dataStore.get(globalUsageKey('2026-09-20'))).textTokens).toBe(30);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).generationConfig.thinkingConfig.thinkingLevel).toBe('LOW');
    await usage.reserveTextTokens('a', 900);
    await expect(withTextGenerationContext(context, () => generateText({ ...options, fetchImpl }))).rejects.toMatchObject({ code: 'AI_DAILY_LIMIT' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('releases rejected HTTP calls but conservatively retains uncertain timed-out usage', async () => {
    const { usage, dataStore } = await setup();
    const context = { usage, userId: 'a', limiter: createTextLimiter(1) };
    await expect(withTextGenerationContext(context, () => generateText({ ...options, fetchImpl: async () => ({ ok: false, status: 503, text: async () => '' }) }))).rejects.toThrow();
    expect((await dataStore.get(globalUsageKey('2026-09-20'))).textTokens).toBe(0);
    await expect(withTextGenerationContext(context, () => generateText({ ...options, fetchImpl: async () => { throw new Error('timeout'); } }))).rejects.toThrow();
    expect((await dataStore.get(globalUsageKey('2026-09-20'))).textTokens).toBeGreaterThan(100);
  });
});

it('shares the concurrency limit across operations and frees the slot after failure', async () => {
  const limiter = createTextLimiter(1);
  let release;
  const first = limiter(() => new Promise((resolve) => { release = resolve; }));
  await expect(limiter(async () => {})).rejects.toMatchObject({ code: 'AI_BUSY' });
  release(); await first;
  await expect(limiter(async () => 'next')).resolves.toBe('next');
});
