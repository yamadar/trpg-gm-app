import { classifyJsonRecord } from './classifyStorage.js';

function assertKey(key) {
  if (typeof key !== 'string' || !key || key.startsWith('/') || key.includes('\0')) {
    throw new TypeError('storage key must be a non-empty relative path');
  }
}

function prefixRows(db, prefix) {
  const escaped = prefix.replace(/[\\%_]/g, '\\$&');
  return db.prepare(`
    SELECT key FROM domain_records
    WHERE key LIKE ? ESCAPE '\\'
    ORDER BY key
  `).all(`${escaped}/%`);
}

function reassignAggregateOwnership(db, key, value, timestamp) {
  const publicMatch = key.match(/^public\/([^/]+)\/([^/]+)$/);
  const partyMatch = key.match(/^sharedSessions\/([^/]+)$/);
  const ownerId = value?.ownerId;
  if (typeof ownerId !== 'string' || !ownerId) return;
  const prefix = publicMatch
    ? `public/${publicMatch[1]}/${publicMatch[2]}`
    : partyMatch ? `sharedSessions/${partyMatch[1]}` : null;
  if (!prefix) return;
  const escaped = prefix.replace(/[\\%_]/g, '\\$&');
  db.prepare(`
    UPDATE domain_records SET owner_id = ?, updated_at_ms = ?
    WHERE key LIKE ? ESCAPE '\\' AND key <> ?
  `).run(ownerId, timestamp, `${escaped}/%`, key);
  db.prepare(`
    UPDATE documents SET owner_id = ?, updated_at_ms = ?
    WHERE path LIKE ? ESCAPE '\\'
  `).run(ownerId, timestamp, `${escaped}/%`);
  db.prepare(`
    UPDATE storage_items SET owner_id = ?, updated_at_ms = ?
    WHERE item_type = 'media' AND resource_key LIKE ? ESCAPE '\\'
  `).run(ownerId, timestamp, `${escaped}/%`);
}

export function createSqliteDataStore(db, { now = Date.now, coordinator } = {}) {
  const execute = coordinator?.run || (async (operation) => operation());
  const getStatement = db.prepare('SELECT value_json FROM domain_records WHERE key = ?');
  const setStatement = db.prepare(`
    INSERT INTO domain_records(
      key, module, resource_type, owner_id, value_json, logical_bytes, revision, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      module = excluded.module,
      resource_type = excluded.resource_type,
      owner_id = excluded.owner_id,
      value_json = excluded.value_json,
      logical_bytes = excluded.logical_bytes,
      revision = excluded.revision,
      updated_at_ms = excluded.updated_at_ms
  `);
  const deleteStatement = db.prepare('DELETE FROM domain_records WHERE key = ?');

  return {
    async get(key) {
      assertKey(key);
      return execute(() => {
        const row = getStatement.get(key);
        return row ? JSON.parse(row.value_json) : null;
      });
    },
    async set(key, value) {
      assertKey(key);
      return execute(() => {
        const valueJson = JSON.stringify(value);
        if (valueJson === undefined) throw new TypeError('storage value must be JSON serializable');
        const classification = classifyJsonRecord(db, key, value);
        const candidateRevision = value?._sync?.revision ?? value?.revision;
        const revision = Number.isSafeInteger(candidateRevision) && candidateRevision >= 0
          ? candidateRevision
          : 0;
        const timestamp = now();
        setStatement.run(
          key,
          classification.module,
          classification.resourceType,
          classification.ownerId,
          valueJson,
          Buffer.byteLength(valueJson, 'utf8'),
          revision,
          timestamp,
        );
        reassignAggregateOwnership(db, key, value, timestamp);
      });
    },
    async list(prefix) {
      assertKey(prefix);
      return execute(() => {
        const start = `${prefix}/`;
        return prefixRows(db, prefix)
          .map((row) => row.key)
          .filter((key) => !key.slice(start.length).includes('/'));
      });
    },
    async delete(key) {
      assertKey(key);
      return execute(() => deleteStatement.run(key));
    },
  };
}
