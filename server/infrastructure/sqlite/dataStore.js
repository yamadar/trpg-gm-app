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

export function createSqliteDataStore(db, { now = Date.now } = {}) {
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
      const row = getStatement.get(key);
      return row ? JSON.parse(row.value_json) : null;
    },
    async set(key, value) {
      assertKey(key);
      const valueJson = JSON.stringify(value);
      if (valueJson === undefined) throw new TypeError('storage value must be JSON serializable');
      const classification = classifyJsonRecord(db, key, value);
      const revision = Number.isSafeInteger(value?._sync?.revision) && value._sync.revision >= 0
        ? value._sync.revision
        : 0;
      setStatement.run(
        key,
        classification.module,
        classification.resourceType,
        classification.ownerId,
        valueJson,
        Buffer.byteLength(valueJson, 'utf8'),
        revision,
        now(),
      );
    },
    async list(prefix) {
      assertKey(prefix);
      const start = `${prefix}/`;
      return prefixRows(db, prefix)
        .map((row) => row.key)
        .filter((key) => !key.slice(start.length).includes('/'));
    },
    async delete(key) {
      assertKey(key);
      deleteStatement.run(key);
    },
  };
}
