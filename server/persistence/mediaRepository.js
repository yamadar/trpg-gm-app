function rowToAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    resourceKey: row.resource_key,
    ownerId: row.owner_id,
    objectKey: row.object_key,
    state: row.state,
    sha256: row.sha256,
    bytes: Number(row.byte_size),
    mimeType: row.mime_type,
    lastErrorCode: row.last_error_code,
    createdAt: Number(row.created_at_ms),
    updatedAt: Number(row.updated_at_ms),
  };
}

function escapedPrefix(prefix) {
  return prefix.replace(/[\\%_]/g, '\\$&');
}

export function createSqliteMediaRepository({ db, coordinator, now = Date.now }) {
  const insertPending = db.prepare(`
    INSERT INTO media_assets(
      id, resource_key, owner_id, object_key, state, sha256, byte_size,
      mime_type, last_error_code, created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, NULL, ?, ?)
  `);
  const assetById = db.prepare('SELECT * FROM media_assets WHERE id = ?');
  const readyByResource = db.prepare(`
    SELECT asset.* FROM media_bindings binding
    JOIN media_assets asset ON asset.id = binding.asset_id
    WHERE binding.resource_key = ? AND asset.state = 'ready'
  `);
  const bindingByResource = db.prepare(`
    SELECT asset.* FROM media_bindings binding
    JOIN media_assets asset ON asset.id = binding.asset_id
    WHERE binding.resource_key = ?
  `);
  const upsertBinding = db.prepare(`
    INSERT INTO media_bindings(resource_key, asset_id, updated_at_ms)
    VALUES (?, ?, ?)
    ON CONFLICT(resource_key) DO UPDATE SET
      asset_id = excluded.asset_id,
      updated_at_ms = excluded.updated_at_ms
  `);
  const deleteBinding = db.prepare('DELETE FROM media_bindings WHERE resource_key = ?');
  const markState = db.prepare(`
    UPDATE media_assets SET state = ?, last_error_code = ?, updated_at_ms = ?
    WHERE id = ?
  `);

  return {
    async adoptExisting({ resourceKey, ownerId, objectKey = resourceKey, sha256 = null, bytes, mimeType }) {
      return coordinator.transaction(() => {
        const existing = bindingByResource.get(resourceKey);
        if (existing) return rowToAsset(existing);
        const timestamp = now();
        const id = `legacy:${resourceKey}`;
        db.prepare(`
          INSERT INTO media_assets(
            id, resource_key, owner_id, object_key, state, sha256, byte_size,
            mime_type, last_error_code, created_at_ms, updated_at_ms
          ) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, NULL, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            owner_id = excluded.owner_id,
            sha256 = COALESCE(excluded.sha256, media_assets.sha256),
            byte_size = excluded.byte_size,
            mime_type = excluded.mime_type,
            updated_at_ms = excluded.updated_at_ms
        `).run(
          id,
          resourceKey,
          ownerId || null,
          objectKey,
          sha256,
          bytes,
          mimeType,
          timestamp,
          timestamp,
        );
        upsertBinding.run(resourceKey, id, timestamp);
        return rowToAsset(assetById.get(id));
      });
    },

    async createPending({ id, resourceKey, ownerId, objectKey, sha256, bytes, mimeType }) {
      return coordinator.run(() => {
        const timestamp = now();
        insertPending.run(
          id,
          resourceKey,
          ownerId || null,
          objectKey,
          sha256,
          bytes,
          mimeType,
          timestamp,
          timestamp,
        );
        return rowToAsset(assetById.get(id));
      });
    },

    async activate(id) {
      return coordinator.transaction(() => {
        const timestamp = now();
        const candidate = assetById.get(id);
        if (!candidate || candidate.state !== 'pending') return null;
        const previous = bindingByResource.get(candidate.resource_key);
        markState.run('ready', null, timestamp, id);
        upsertBinding.run(candidate.resource_key, id, timestamp);
        if (previous && previous.id !== id) markState.run('deleting', null, timestamp, previous.id);
        return {
          asset: rowToAsset(assetById.get(id)),
          previous: previous && previous.id !== id ? rowToAsset(assetById.get(previous.id)) : null,
        };
      });
    },

    async fail(id, errorCode) {
      return coordinator.run(() => {
        const asset = assetById.get(id);
        if (asset?.state === 'pending') markState.run('failed', errorCode || 'upload_failed', now(), id);
      });
    },

    async get(resourceKey) {
      return coordinator.run(() => rowToAsset(readyByResource.get(resourceKey)));
    },

    async getAsset(id) {
      return coordinator.run(() => rowToAsset(assetById.get(id)));
    },

    async recordChecksum(id, sha256, bytes) {
      return coordinator.run(() => {
        db.prepare(`
          UPDATE media_assets
          SET sha256 = ?, byte_size = ?, updated_at_ms = ?
          WHERE id = ? AND state = 'ready'
        `).run(sha256, bytes, now(), id);
        return rowToAsset(assetById.get(id));
      });
    },

    async list(prefix) {
      return coordinator.run(() => db.prepare(`
        SELECT asset.* FROM media_bindings binding
        JOIN media_assets asset ON asset.id = binding.asset_id
        WHERE binding.resource_key = ? OR binding.resource_key LIKE ? ESCAPE '\\'
        ORDER BY binding.resource_key
      `).all(prefix, `${escapedPrefix(prefix)}/%`).map(rowToAsset));
    },

    async listAll() {
      return coordinator.run(() => db.prepare(`
        SELECT asset.* FROM media_bindings binding
        JOIN media_assets asset ON asset.id = binding.asset_id
        ORDER BY binding.resource_key
      `).all().map(rowToAsset));
    },

    async beginDelete(resourceKey) {
      return coordinator.transaction(() => {
        const asset = bindingByResource.get(resourceKey);
        if (!asset) return null;
        deleteBinding.run(resourceKey);
        markState.run('deleting', null, now(), asset.id);
        return rowToAsset(assetById.get(asset.id));
      });
    },

    async beginDeletePrefix(prefix) {
      return coordinator.transaction(() => {
        const rows = db.prepare(`
          SELECT asset.* FROM media_bindings binding
          JOIN media_assets asset ON asset.id = binding.asset_id
          WHERE binding.resource_key = ? OR binding.resource_key LIKE ? ESCAPE '\\'
          ORDER BY binding.resource_key
        `).all(prefix, `${escapedPrefix(prefix)}/%`);
        const timestamp = now();
        for (const row of rows) {
          deleteBinding.run(row.resource_key);
          markState.run('deleting', null, timestamp, row.id);
        }
        return rows.map((row) => rowToAsset(assetById.get(row.id)));
      });
    },

    async finishDelete(id) {
      return coordinator.run(() => {
        const asset = assetById.get(id);
        if (asset?.state === 'deleting') markState.run('deleted', null, now(), id);
      });
    },

    async listRecoverable() {
      return coordinator.run(() => db.prepare(`
        SELECT * FROM media_assets
        WHERE state IN ('pending', 'deleting')
        ORDER BY updated_at_ms, id
      `).all().map(rowToAsset));
    },
  };
}

export function createSqliteMediaOwnerResolver(db) {
  return async (resourcePath) => {
    const parts = String(resourcePath).split('/');
    if (parts[0] === 'users' && parts[1] && parts[2] !== 'sharedSessions') return parts[1];
    if (parts[0] === 'public' && parts.length >= 3) {
      return db.prepare('SELECT owner_id FROM domain_records WHERE key = ?')
        .get(`public/${parts[1]}/${parts[2]}`)?.owner_id || null;
    }
    if (parts[0] === 'sharedSessions' && parts[1]) {
      return db.prepare('SELECT owner_id FROM domain_records WHERE key = ?')
        .get(`sharedSessions/${parts[1]}`)?.owner_id || null;
    }
    return null;
  };
}
