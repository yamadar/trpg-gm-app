export function usageKey(userId, day) {
  return `users/${userId}/usage/${day}`;
}

function utcDay(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function nextUtcMidnight(epochMs) {
  const d = new Date(epochMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export function createUsage({ dataStore, limits, now = Date.now }) {
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

  return {
    async consume(userId, kind) {
      const limit = limits[kind];
      if (typeof limit !== 'number') throw new Error(`unknown usage kind: ${kind}`);
      const t = now();
      const key = usageKey(userId, utcDay(t));
      return withKeyLock(key, async () => {
        const counts = (await dataStore.get(key)) || {};
        const used = counts[kind] || 0;
        if (used >= limit) return { ok: false, resetAt: nextUtcMidnight(t) };
        counts[kind] = used + 1;
        await dataStore.set(key, counts);
        return { ok: true };
      });
    },
  };
}
