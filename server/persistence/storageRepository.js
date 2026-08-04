import crypto from 'node:crypto';

function escapedPrefix(prefix) {
  return prefix.replace(/[\\%_]/g, '\\$&');
}

export function createSqliteStorageRepository({ db, coordinator, now = Date.now }) {
  const itemUpsert = db.prepare(`
    INSERT INTO storage_items(item_type, resource_key, owner_id, charged_bytes, updated_at_ms)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(item_type, resource_key) DO UPDATE SET
      owner_id = excluded.owner_id,
      charged_bytes = excluded.charged_bytes,
      updated_at_ms = excluded.updated_at_ms
  `);
  const itemDelete = db.prepare('DELETE FROM storage_items WHERE item_type = ? AND resource_key = ?');
  const accountGet = db.prepare('SELECT used_bytes, reserved_bytes, limit_bytes FROM storage_accounts WHERE owner_id = ?');
  const accountEnsure = db.prepare(`
    INSERT INTO storage_accounts(owner_id, used_bytes, reserved_bytes, limit_bytes, updated_at_ms)
    VALUES (?, 0, 0, ?, ?)
    ON CONFLICT(owner_id) DO UPDATE SET limit_bytes = excluded.limit_bytes, updated_at_ms = excluded.updated_at_ms
  `);
  const reservationInsert = db.prepare(`
    INSERT INTO storage_reservations(id, owner_id, reserved_bytes, purpose, expires_at_ms, created_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const reservationGet = db.prepare('SELECT owner_id, reserved_bytes FROM storage_reservations WHERE id = ?');
  const reservationDelete = db.prepare('DELETE FROM storage_reservations WHERE id = ?');
  const expired = db.prepare('SELECT id, owner_id, reserved_bytes FROM storage_reservations WHERE expires_at_ms <= ?');

  function releaseRow(row, timestamp) {
    if (!row) return;
    reservationDelete.run(row.id);
    db.prepare(`
      UPDATE storage_accounts
      SET reserved_bytes = MAX(0, reserved_bytes - ?), updated_at_ms = ?
      WHERE owner_id = ?
    `).run(row.reserved_bytes, timestamp, row.owner_id);
  }

  function cleanupExpired(timestamp) {
    for (const row of expired.all(timestamp)) releaseRow(row, timestamp);
  }

  return {
    async usedBytes(ownerId) {
      return coordinator.run(() => Number(accountGet.get(ownerId)?.used_bytes || 0));
    },

    async reserve({ ownerId, bytes, limitBytes, purpose = 'http-write', ttlMs = 90 * 60 * 1000 }) {
      return coordinator.transaction(() => {
        const timestamp = now();
        cleanupExpired(timestamp);
        accountEnsure.run(ownerId, limitBytes, timestamp);
        const account = accountGet.get(ownerId);
        if (Number(account.used_bytes) + Number(account.reserved_bytes) + bytes > limitBytes) {
          return { ok: false };
        }
        const id = crypto.randomUUID();
        reservationInsert.run(id, ownerId, bytes, purpose, timestamp + ttlMs, timestamp);
        db.prepare(`
          UPDATE storage_accounts
          SET reserved_bytes = reserved_bytes + ?, updated_at_ms = ?
          WHERE owner_id = ?
        `).run(bytes, timestamp, ownerId);
        return { ok: true, id };
      });
    },

    async release(id) {
      return coordinator.transaction(() => {
        const row = reservationGet.get(id);
        if (row) releaseRow({ id, ...row }, now());
      });
    },

    async setItem(itemType, resourceKey, ownerId, bytes) {
      return coordinator.run(() => itemUpsert.run(itemType, resourceKey, ownerId || null, bytes, now()));
    },

    async removeItem(itemType, resourceKey) {
      return coordinator.run(() => itemDelete.run(itemType, resourceKey));
    },

    async removePrefix(itemType, prefix) {
      return coordinator.run(() => db.prepare(`
        DELETE FROM storage_items
        WHERE item_type = ? AND (resource_key = ? OR resource_key LIKE ? ESCAPE '\\')
      `).run(itemType, prefix, `${escapedPrefix(prefix)}/%`));
    },

    async audit() {
      return coordinator.run(() => db.prepare(`
        SELECT
          account.owner_id,
          account.used_bytes,
          COALESCE(SUM(item.charged_bytes), 0) AS measured_bytes
        FROM storage_accounts account
        LEFT JOIN storage_items item ON item.owner_id = account.owner_id
        GROUP BY account.owner_id, account.used_bytes
        ORDER BY account.owner_id
      `).all().map((row) => ({
        ownerId: row.owner_id,
        usedBytes: Number(row.used_bytes),
        measuredBytes: Number(row.measured_bytes),
      })));
    },
  };
}
