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

export function createUsage({ dataStore, repository, limits, globalLimits = {}, now = Date.now }) {
  let resolvedRepository = repository;
  let repositoryPromise = null;
  async function getRepository() {
    if (resolvedRepository) return resolvedRepository;
    repositoryPromise ||= import('../persistence/usageRepository.js').then(({ createFileUsageRepository }) => {
      resolvedRepository = createFileUsageRepository({ dataStore });
      return resolvedRepository;
    });
    return repositoryPromise;
  }

  function request(scope, ownerId, day, configuredLimits, kind, units) {
    const limit = configuredLimits[kind];
    if (typeof limit !== 'number') throw new Error(`unknown usage kind: ${kind}`);
    if (!Number.isSafeInteger(units) || units <= 0) throw new Error('usage units must be a positive integer');
    return { scope, ownerId, day, kind, units, limit };
  }

  async function consumeRequests(requests, timestamp) {
    const result = await (await getRepository()).consumeBatch(requests, timestamp);
    return result.ok ? { ok: true } : { ok: false, resetAt: nextUtcMidnight(timestamp) };
  }

  return {
    async consume(userId, kind, units = 1) {
      const timestamp = now();
      return consumeRequests([
        request('user', userId, utcDay(timestamp), limits, kind, units),
      ], timestamp);
    },

    async consumeGlobal(kind, units = 1) {
      const timestamp = now();
      return consumeRequests([
        request('global', '', utcDay(timestamp), globalLimits, kind, units),
      ], timestamp);
    },

    async reserveTextOperation(userId, tokenUnits) {
      const timestamp = now();
      const day = utcDay(timestamp);
      return consumeRequests([
        request('user', userId, day, limits, 'messages', 1),
        request('user', userId, day, limits, 'textTokens', tokenUnits),
        request('global', '', day, globalLimits, 'textTokens', tokenUnits),
      ], timestamp);
    },
  };
}
