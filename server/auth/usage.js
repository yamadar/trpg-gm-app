export function usageKey(userId, day) {
  return `users/${userId}/usage/${day}`;
}

export function globalUsageKey(day) {
  return `global/usage/${day}`;
}

function utcDay(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function nextUtcMidnight(epochMs) {
  const d = new Date(epochMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export function createUsage({ dataStore, limits, globalLimits = {}, now = Date.now }) {
  // usageKeyごとに read-modify-write を直列化する(単一プロセス内)。
  // 注: 複数インスタンス運用ではストア側のアトミック性が別途必要。
  const locks = new Map();
  function withKeyLock(key, fn) {
    const prev = locks.get(key) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.then(() => {
      if (locks.get(key) === tail) locks.delete(key);
    });
    return run;
  }

  async function consumeAtKey(key, configuredLimits, kind, units) {
    const limit = configuredLimits[kind];
    if (typeof limit !== 'number') throw new Error(`unknown usage kind: ${kind}`);
    if (!Number.isSafeInteger(units) || units <= 0) throw new Error('usage units must be a positive integer');
    const t = now();
    return withKeyLock(key(t), async () => {
      const counts = (await dataStore.get(key(t))) || {};
      const used = counts[kind] || 0;
      if (used + units > limit) return { ok: false, resetAt: nextUtcMidnight(t) };
      counts[kind] = used + units;
      await dataStore.set(key(t), counts);
      return { ok: true };
    });
  }

  return {
    async consume(userId, kind, units = 1) {
      return consumeAtKey(
        (t) => usageKey(userId, utcDay(t)),
        limits,
        kind,
        units,
      );
    },

    async consumeGlobal(kind, units = 1) {
      return consumeAtKey(
        (t) => globalUsageKey(utcDay(t)),
        globalLimits,
        kind,
        units,
      );
    },
  };
}
