import { globalUsageKey, usageKey } from '../auth/usage.js';

function keyOf(request) {
  return request.scope === 'global'
    ? globalUsageKey(request.day)
    : usageKey(request.ownerId, request.day);
}

export function createFileUsageRepository({ dataStore, transaction = (operation) => operation() }) {
  let lock = Promise.resolve();
  function serialize(operation) {
    const run = lock.catch(() => {}).then(() => transaction(operation));
    lock = run.catch(() => {});
    return run;
  }

  return {
    consumeBatch(requests) {
      return serialize(async () => {
        const records = new Map();
        const projected = new Map();
        for (const request of requests) {
          const key = keyOf(request);
          if (!records.has(key)) records.set(key, (await dataStore.get(key)) || {});
          const counts = records.get(key);
          const counterKey = `${key}\0${request.kind}`;
          const next = (projected.get(counterKey) ?? counts[request.kind] ?? 0) + request.units;
          if (next > request.limit) {
            return { ok: false, denied: request };
          }
          projected.set(counterKey, next);
        }
        for (const request of requests) {
          const counts = records.get(keyOf(request));
          counts[request.kind] = projected.get(`${keyOf(request)}\0${request.kind}`);
        }
        await Promise.all([...records].map(([key, counts]) => dataStore.set(key, counts)));
        return { ok: true };
      });
    },
  };
}

export function createSqliteUsageRepository({ db, coordinator }) {
  const get = db.prepare(`
    SELECT used_units FROM usage_counters
    WHERE scope = ? AND owner_id = ? AND day = ? AND kind = ?
  `);
  const upsert = db.prepare(`
    INSERT INTO usage_counters(scope, owner_id, day, kind, used_units, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, owner_id, day, kind) DO UPDATE SET
      used_units = excluded.used_units,
      updated_at_ms = excluded.updated_at_ms
  `);

  return {
    consumeBatch(requests, timestamp) {
      return coordinator.transaction(() => {
        const values = [];
        const projected = new Map();
        for (const request of requests) {
          const ownerId = request.scope === 'global' ? '' : request.ownerId;
          const counterKey = `${request.scope}\0${ownerId}\0${request.day}\0${request.kind}`;
          const stored = Number(get.get(request.scope, ownerId, request.day, request.kind)?.used_units || 0);
          const used = (projected.get(counterKey) ?? stored) + request.units;
          if (used > request.limit) return { ok: false, denied: request };
          projected.set(counterKey, used);
          values.push({ request, ownerId, counterKey });
        }
        const written = new Set();
        for (const { request, ownerId, counterKey } of values) {
          if (written.has(counterKey)) continue;
          written.add(counterKey);
          upsert.run(request.scope, ownerId, request.day, request.kind, projected.get(counterKey), timestamp);
        }
        return { ok: true };
      });
    },
  };
}
