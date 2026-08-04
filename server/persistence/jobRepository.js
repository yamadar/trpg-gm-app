import crypto from 'node:crypto';

function storageKey(id) {
  const digest = crypto.createHash('sha256').update(id).digest('hex');
  return `system/jobs/${digest}`;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function normalizeSqliteRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    ownerId: row.owner_id,
    aggregateId: row.aggregate_id,
    state: row.state,
    payload: JSON.parse(row.payload_json),
    result: row.result_json == null ? null : JSON.parse(row.result_json),
    attempts: Number(row.attempts),
    availableAtMs: Number(row.available_at_ms),
    leaseOwner: row.lease_owner,
    leaseExpiresAtMs: row.lease_expires_at_ms == null ? null : Number(row.lease_expires_at_ms),
    lastErrorCode: row.last_error_code,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

export function createFileJobRepository({
  dataStore,
  transaction = (operation) => operation(),
  now = Date.now,
}) {
  async function get(id) {
    const record = await dataStore.get(storageKey(id));
    return record?.id === id ? clone(record) : null;
  }

  return {
    get,

    enqueue(input, timestamp = now()) {
      return transaction(async () => {
        const current = await get(input.id);
        if (
          current?.state === 'running'
          && current.leaseExpiresAtMs != null
          && current.leaseExpiresAtMs > timestamp
        ) {
          return { ok: false, job: current };
        }
        const record = {
          id: input.id,
          type: input.type,
          ownerId: input.ownerId,
          aggregateId: input.aggregateId ?? null,
          state: 'queued',
          payload: clone(input.payload),
          result: null,
          attempts: current?.attempts || 0,
          availableAtMs: input.availableAtMs ?? timestamp,
          leaseOwner: null,
          leaseExpiresAtMs: null,
          lastErrorCode: null,
          createdAtMs: current?.createdAtMs ?? timestamp,
          updatedAtMs: timestamp,
        };
        await dataStore.set(storageKey(input.id), record);
        return { ok: true, job: clone(record) };
      });
    },

    claim(id, workerId, { leaseMs, allowSteal = false, timestamp = now() }) {
      return transaction(async () => {
        const current = await get(id);
        const claimable = current && (
          (current.state === 'queued' && current.availableAtMs <= timestamp)
          || (
            current.state === 'running'
            && (allowSteal || current.leaseExpiresAtMs == null || current.leaseExpiresAtMs <= timestamp)
          )
        );
        if (!claimable) return null;
        const claimed = {
          ...current,
          state: 'running',
          attempts: current.attempts + 1,
          leaseOwner: workerId,
          leaseExpiresAtMs: timestamp + leaseMs,
          updatedAtMs: timestamp,
        };
        await dataStore.set(storageKey(id), claimed);
        return clone(claimed);
      });
    },

    complete(id, workerId, result = null, timestamp = now()) {
      return transaction(async () => {
        const current = await get(id);
        if (!current || current.state !== 'running' || current.leaseOwner !== workerId) return false;
        await dataStore.set(storageKey(id), {
          ...current,
          state: 'done',
          result: clone(result),
          leaseOwner: null,
          leaseExpiresAtMs: null,
          lastErrorCode: null,
          updatedAtMs: timestamp,
        });
        return true;
      });
    },

    fail(id, workerId, errorCode, timestamp = now()) {
      return transaction(async () => {
        const current = await get(id);
        if (!current || current.state !== 'running' || current.leaseOwner !== workerId) return false;
        await dataStore.set(storageKey(id), {
          ...current,
          state: 'failed',
          result: null,
          leaseOwner: null,
          leaseExpiresAtMs: null,
          lastErrorCode: errorCode,
          updatedAtMs: timestamp,
        });
        return true;
      });
    },

    async listRecoverable(type, timestamp = now()) {
      const keys = await dataStore.list('system/jobs');
      const records = await Promise.all(keys.map((key) => dataStore.get(key)));
      return records
        .filter((record) => record?.type === type && (
          (record.state === 'queued' && record.availableAtMs <= timestamp)
          || record.state === 'running'
        ))
        .sort((a, b) => a.createdAtMs - b.createdAtMs)
        .map(clone);
    },
  };
}

export function createSqliteJobRepository({ db, coordinator, now = Date.now }) {
  const select = db.prepare('SELECT * FROM jobs WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO jobs(
      id, type, owner_id, aggregate_id, state, payload_json, result_json, attempts,
      available_at_ms, lease_owner, lease_expires_at_ms, last_error_code, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 'queued', ?, NULL, ?, ?, NULL, NULL, NULL, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      owner_id = excluded.owner_id,
      aggregate_id = excluded.aggregate_id,
      state = 'queued',
      payload_json = excluded.payload_json,
      result_json = NULL,
      available_at_ms = excluded.available_at_ms,
      lease_owner = NULL,
      lease_expires_at_ms = NULL,
      last_error_code = NULL,
      updated_at_ms = excluded.updated_at_ms
  `);
  const updateClaim = db.prepare(`
    UPDATE jobs SET
      state = 'running',
      attempts = attempts + 1,
      lease_owner = ?,
      lease_expires_at_ms = ?,
      updated_at_ms = ?
    WHERE id = ?
  `);
  const updateComplete = db.prepare(`
    UPDATE jobs SET
      state = 'done',
      result_json = ?,
      lease_owner = NULL,
      lease_expires_at_ms = NULL,
      last_error_code = NULL,
      updated_at_ms = ?
    WHERE id = ? AND state = 'running' AND lease_owner = ?
  `);
  const updateFailed = db.prepare(`
    UPDATE jobs SET
      state = 'failed',
      result_json = NULL,
      lease_owner = NULL,
      lease_expires_at_ms = NULL,
      last_error_code = ?,
      updated_at_ms = ?
    WHERE id = ? AND state = 'running' AND lease_owner = ?
  `);
  const list = db.prepare(`
    SELECT * FROM jobs
    WHERE type = ? AND (
      (state = 'queued' AND available_at_ms <= ?)
      OR state = 'running'
    )
    ORDER BY created_at_ms, id
  `);

  return {
    get(id) {
      return coordinator.run(() => normalizeSqliteRow(select.get(id)));
    },

    enqueue(input, timestamp = now()) {
      return coordinator.transaction(() => {
        const current = normalizeSqliteRow(select.get(input.id));
        if (
          current?.state === 'running'
          && current.leaseExpiresAtMs != null
          && current.leaseExpiresAtMs > timestamp
        ) {
          return { ok: false, job: current };
        }
        insert.run(
          input.id,
          input.type,
          input.ownerId,
          input.aggregateId ?? null,
          JSON.stringify(input.payload),
          current?.attempts || 0,
          input.availableAtMs ?? timestamp,
          current?.createdAtMs ?? timestamp,
          timestamp,
        );
        return { ok: true, job: normalizeSqliteRow(select.get(input.id)) };
      });
    },

    claim(id, workerId, { leaseMs, allowSteal = false, timestamp = now() }) {
      return coordinator.transaction(() => {
        const current = normalizeSqliteRow(select.get(id));
        const claimable = current && (
          (current.state === 'queued' && current.availableAtMs <= timestamp)
          || (
            current.state === 'running'
            && (allowSteal || current.leaseExpiresAtMs == null || current.leaseExpiresAtMs <= timestamp)
          )
        );
        if (!claimable) return null;
        updateClaim.run(workerId, timestamp + leaseMs, timestamp, id);
        return normalizeSqliteRow(select.get(id));
      });
    },

    complete(id, workerId, result = null, timestamp = now()) {
      return coordinator.run(() => (
        updateComplete.run(JSON.stringify(result), timestamp, id, workerId).changes === 1
      ));
    },

    fail(id, workerId, errorCode, timestamp = now()) {
      return coordinator.run(() => (
        updateFailed.run(errorCode, timestamp, id, workerId).changes === 1
      ));
    },

    listRecoverable(type, timestamp = now()) {
      return coordinator.run(() => list.all(type, timestamp).map(normalizeSqliteRow));
    },
  };
}
