import {
  classifyJsonRecord,
  classifyTextDocument,
  moduleForDocumentPath,
  moduleForJsonKey,
} from '../infrastructure/sqlite/classifyStorage.js';

export const RECORD_TABLES = Object.freeze({
  auth: 'auth_records',
  library: 'library_records',
  sessions: 'session_records',
  campaigns: 'campaign_records',
  party: 'party_records',
  publishing: 'publishing_records',
  usage: 'usage_records',
  jobs: 'job_records',
  system: 'system_records',
});

export const DOCUMENT_TABLES = Object.freeze({
  library: 'library_documents',
  sessions: 'session_documents',
  campaigns: 'campaign_documents',
  publishing: 'publishing_documents',
  system: 'system_documents',
});

function assertStorageKey(key, label = 'storage key') {
  if (typeof key !== 'string' || !key || key.startsWith('/') || key.includes('\0')) {
    throw new TypeError(`${label} must be a non-empty relative path`);
  }
}

function escapedPrefix(prefix) {
  return prefix.replace(/[\\%_]/g, '\\$&');
}

function revisionOf(value) {
  const candidate = value?._sync?.revision ?? value?.revision;
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : 0;
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value) || null;
}

function recordMetadata(key, value, timestamp) {
  const parts = key.split('/');
  return {
    entityId: firstString(value?.id, value?.sessionId, value?.userId, parts.at(-1)) || key,
    parentId: firstString(value?.campaignId, value?.worldId, value?.sessionId),
    title: firstString(value?.title, value?.displayName, value?.name, value?.endingTitle),
    revision: revisionOf(value),
    createdAt: Number.isSafeInteger(value?.createdAt) && value.createdAt >= 0 ? value.createdAt : timestamp,
  };
}

function documentTitle(content) {
  const match = String(content).match(/^#{1,2}\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

function directChildren(keys, prefix) {
  const start = `${prefix}/`;
  return keys.filter((key) => key.startsWith(start) && !key.slice(start.length).includes('/'));
}

export function createSqliteModulePersistence(db, { coordinator, now = Date.now } = {}) {
  const recordStatements = Object.fromEntries(Object.entries(RECORD_TABLES).map(([module, table]) => [module, {
    get: db.prepare(`SELECT value_json FROM ${table} WHERE key = ?`),
    list: db.prepare(`SELECT key FROM ${table} WHERE key LIKE ? ESCAPE '\\' ORDER BY key`),
    upsert: db.prepare(`
      INSERT INTO ${table}(
        key, entity_type, entity_id, parent_id, owner_id, title, value_json,
        logical_bytes, revision, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        entity_type = excluded.entity_type,
        entity_id = excluded.entity_id,
        parent_id = excluded.parent_id,
        owner_id = excluded.owner_id,
        title = excluded.title,
        value_json = excluded.value_json,
        logical_bytes = excluded.logical_bytes,
        revision = excluded.revision,
        created_at_ms = ${table}.created_at_ms,
        updated_at_ms = excluded.updated_at_ms
    `),
    delete: db.prepare(`DELETE FROM ${table} WHERE key = ?`),
  }]));
  const documentStatements = Object.fromEntries(Object.entries(DOCUMENT_TABLES).map(([module, table]) => [module, {
    get: db.prepare(`SELECT content FROM ${table} WHERE path = ?`),
    list: db.prepare(`SELECT path FROM ${table} WHERE path LIKE ? ESCAPE '\\' ORDER BY path`),
    upsert: db.prepare(`
      INSERT INTO ${table}(path, document_type, owner_id, title, content, logical_bytes, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        document_type = excluded.document_type,
        owner_id = excluded.owner_id,
        title = excluded.title,
        content = excluded.content,
        logical_bytes = excluded.logical_bytes,
        updated_at_ms = excluded.updated_at_ms
    `),
    delete: db.prepare(`DELETE FROM ${table} WHERE path = ?`),
  }]));
  const mirrorRecordUpsert = db.prepare(`
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
  const mirrorRecordDelete = db.prepare('DELETE FROM domain_records WHERE key = ?');
  const mirrorDocumentUpsert = db.prepare(`
    INSERT INTO documents(path, module, resource_type, owner_id, content, logical_bytes, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      module = excluded.module,
      resource_type = excluded.resource_type,
      owner_id = excluded.owner_id,
      content = excluded.content,
      logical_bytes = excluded.logical_bytes,
      updated_at_ms = excluded.updated_at_ms
  `);
  const mirrorDocumentDelete = db.prepare('DELETE FROM documents WHERE path = ?');

  function reassignAggregateOwnership(key, value, timestamp) {
    const publicMatch = key.match(/^public\/([^/]+)\/([^/]+)$/);
    const partyMatch = key.match(/^sharedSessions\/([^/]+)$/);
    const ownerId = value?.ownerId;
    if (typeof ownerId !== 'string' || !ownerId) return;
    const prefix = publicMatch
      ? `public/${publicMatch[1]}/${publicMatch[2]}`
      : partyMatch ? `sharedSessions/${partyMatch[1]}` : null;
    if (!prefix) return;
    const module = publicMatch ? 'publishing' : 'party';
    const recordTable = RECORD_TABLES[module];
    const escaped = escapedPrefix(prefix);
    db.prepare(`
      UPDATE ${recordTable} SET owner_id = ?, updated_at_ms = ?
      WHERE key LIKE ? ESCAPE '\\' AND key <> ?
    `).run(ownerId, timestamp, `${escaped}/%`, key);
    db.prepare(`
      UPDATE domain_records SET owner_id = ?, updated_at_ms = ?
      WHERE key LIKE ? ESCAPE '\\' AND key <> ?
    `).run(ownerId, timestamp, `${escaped}/%`, key);
    if (publicMatch) {
      db.prepare(`
        UPDATE publishing_documents SET owner_id = ?, updated_at_ms = ?
        WHERE path LIKE ? ESCAPE '\\'
      `).run(ownerId, timestamp, `${escaped}/%`);
      db.prepare(`
        UPDATE documents SET owner_id = ?, updated_at_ms = ?
        WHERE path LIKE ? ESCAPE '\\'
      `).run(ownerId, timestamp, `${escaped}/%`);
    }
    db.prepare(`
      UPDATE storage_items SET owner_id = ?, updated_at_ms = ?
      WHERE item_type = 'media' AND resource_key LIKE ? ESCAPE '\\'
    `).run(ownerId, timestamp, `${escaped}/%`);
    db.prepare(`
      UPDATE media_assets SET owner_id = ?, updated_at_ms = ?
      WHERE resource_key LIKE ? ESCAPE '\\' AND state <> 'deleted'
    `).run(ownerId, timestamp, `${escaped}/%`);
  }

  async function setRecord(module, key, value) {
    assertStorageKey(key);
    const expected = moduleForJsonKey(key);
    if (expected !== module) throw new Error(`record ${key} belongs to ${expected}, not ${module}`);
    return coordinator.transaction(() => {
      const valueJson = JSON.stringify(value);
      if (valueJson === undefined) throw new TypeError('storage value must be JSON serializable');
      const classification = classifyJsonRecord(db, key, value);
      const timestamp = now();
      const metadata = recordMetadata(key, value, timestamp);
      const bytes = Buffer.byteLength(valueJson, 'utf8');
      recordStatements[module].upsert.run(
        key,
        classification.resourceType,
        metadata.entityId,
        metadata.parentId,
        classification.ownerId,
        metadata.title,
        valueJson,
        bytes,
        metadata.revision,
        metadata.createdAt,
        timestamp,
      );
      mirrorRecordUpsert.run(
        key,
        module,
        classification.resourceType,
        classification.ownerId,
        valueJson,
        bytes,
        metadata.revision,
        timestamp,
      );
      reassignAggregateOwnership(key, value, timestamp);
    });
  }

  async function deleteRecord(module, key) {
    assertStorageKey(key);
    return coordinator.transaction(() => {
      recordStatements[module].delete.run(key);
      mirrorRecordDelete.run(key);
    });
  }

  async function compareAndSetSession(key, expectedRevision, value) {
    assertStorageKey(key);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new TypeError('expected revision must be a non-negative integer');
    }
    return coordinator.transaction(() => {
      const valueJson = JSON.stringify(value);
      if (valueJson === undefined) throw new TypeError('storage value must be JSON serializable');
      const classification = classifyJsonRecord(db, key, value);
      const timestamp = now();
      const metadata = recordMetadata(key, value, timestamp);
      if (metadata.revision !== expectedRevision + 1) {
        throw new Error('session compare-and-set must increment revision by one');
      }
      const bytes = Buffer.byteLength(valueJson, 'utf8');
      const result = db.prepare(`
        UPDATE session_records SET
          entity_type = ?, entity_id = ?, parent_id = ?, owner_id = ?, title = ?,
          value_json = ?, logical_bytes = ?, revision = ?, updated_at_ms = ?
        WHERE key = ? AND revision = ?
      `).run(
        classification.resourceType,
        metadata.entityId,
        metadata.parentId,
        classification.ownerId,
        metadata.title,
        valueJson,
        bytes,
        metadata.revision,
        timestamp,
        key,
        expectedRevision,
      );
      if (result.changes !== 1) {
        const current = recordStatements.sessions.get.get(key);
        return { ok: false, current: current ? JSON.parse(current.value_json) : null };
      }
      mirrorRecordUpsert.run(
        key,
        'sessions',
        classification.resourceType,
        classification.ownerId,
        valueJson,
        bytes,
        metadata.revision,
        timestamp,
      );
      return { ok: true, value };
    });
  }

  async function writeDocument(module, documentPath, content) {
    assertStorageKey(documentPath, 'document path');
    if (typeof content !== 'string') throw new TypeError('document content must be a string');
    const expected = moduleForDocumentPath(documentPath);
    if (expected !== module) throw new Error(`document ${documentPath} belongs to ${expected}, not ${module}`);
    return coordinator.transaction(() => {
      const classification = classifyTextDocument(db, documentPath);
      const timestamp = now();
      const bytes = Buffer.byteLength(content, 'utf8');
      documentStatements[module].upsert.run(
        documentPath,
        classification.resourceType,
        classification.ownerId,
        documentTitle(content),
        content,
        bytes,
        timestamp,
      );
      mirrorDocumentUpsert.run(
        documentPath,
        module,
        classification.resourceType,
        classification.ownerId,
        content,
        bytes,
        timestamp,
      );
    });
  }

  async function deleteDocument(module, documentPath) {
    assertStorageKey(documentPath, 'document path');
    return coordinator.transaction(() => {
      documentStatements[module].delete.run(documentPath);
      mirrorDocumentDelete.run(documentPath);
    });
  }

  const modules = Object.fromEntries(Object.keys(RECORD_TABLES).map((module) => [module, {
    records: {
      async get(key) {
        assertStorageKey(key);
        const row = await coordinator.run(() => recordStatements[module].get.get(key));
        return row ? JSON.parse(row.value_json) : null;
      },
      set: (key, value) => setRecord(module, key, value),
      async list(prefix) {
        assertStorageKey(prefix);
        const rows = await coordinator.run(() => recordStatements[module].list
          .all(`${escapedPrefix(prefix)}/%`).map((row) => row.key));
        return directChildren(rows, prefix);
      },
      delete: (key) => deleteRecord(module, key),
    },
    documents: documentStatements[module] ? {
      async read(documentPath) {
        assertStorageKey(documentPath, 'document path');
        return coordinator.run(() => documentStatements[module].get.get(documentPath)?.content ?? null);
      },
      write: (documentPath, content) => writeDocument(module, documentPath, content),
      async list(prefix) {
        assertStorageKey(prefix, 'document prefix');
        const rows = await coordinator.run(() => documentStatements[module].list
          .all(`${escapedPrefix(prefix)}/%`).map((row) => row.path));
        const start = `${prefix}/`;
        return [...new Set(rows.map((row) => `${prefix}/${row.slice(start.length).split('/')[0]}`))];
      },
      delete: (documentPath) => deleteDocument(module, documentPath),
      async deleteDir(prefix) {
        assertStorageKey(prefix, 'document prefix');
        return coordinator.transaction(() => {
          const rows = documentStatements[module].list
            .all(`${escapedPrefix(prefix)}/%`).map((row) => row.path);
          for (const documentPath of rows) {
            documentStatements[module].delete.run(documentPath);
            mirrorDocumentDelete.run(documentPath);
          }
        });
      },
    } : null,
  }]));
  modules.sessions.records.compareAndSet = compareAndSetSession;

  const dataStore = {
    get(key) {
      assertStorageKey(key);
      return modules[moduleForJsonKey(key)].records.get(key);
    },
    set(key, value) {
      assertStorageKey(key);
      return modules[moduleForJsonKey(key)].records.set(key, value);
    },
    async list(prefix) {
      assertStorageKey(prefix);
      const lists = await Promise.all(Object.values(modules).map((module) => module.records.list(prefix)));
      return [...new Set(lists.flat())].sort();
    },
    delete(key) {
      assertStorageKey(key);
      return modules[moduleForJsonKey(key)].records.delete(key);
    },
  };

  const textStore = {
    read(documentPath) {
      assertStorageKey(documentPath, 'document path');
      return modules[moduleForDocumentPath(documentPath)].documents.read(documentPath);
    },
    write(documentPath, content) {
      assertStorageKey(documentPath, 'document path');
      return modules[moduleForDocumentPath(documentPath)].documents.write(documentPath, content);
    },
    async list(prefix) {
      assertStorageKey(prefix, 'document prefix');
      const lists = await Promise.all(Object.values(modules)
        .filter((module) => module.documents)
        .map((module) => module.documents.list(prefix)));
      return [...new Set(lists.flat())].sort();
    },
    delete(documentPath) {
      assertStorageKey(documentPath, 'document path');
      return modules[moduleForDocumentPath(documentPath)].documents.delete(documentPath);
    },
    async deleteDir(prefix) {
      assertStorageKey(prefix, 'document prefix');
      await Promise.all(Object.values(modules)
        .filter((module) => module.documents)
        .map((module) => module.documents.deleteDir(prefix)));
    },
  };

  async function audit() {
    return coordinator.run(() => {
      const records = Object.entries(RECORD_TABLES).map(([module, table]) => ({
        module,
        normalized: Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
        mirror: Number(db.prepare('SELECT COUNT(*) AS count FROM domain_records WHERE module = ?').get(module).count),
        mismatches: Number(db.prepare(`
          SELECT COUNT(*) AS count FROM (
            SELECT key, value_json, owner_id, logical_bytes, revision FROM ${table}
            EXCEPT
            SELECT key, value_json, owner_id, logical_bytes, revision FROM domain_records WHERE module = ?
          )
        `).get(module).count),
      }));
      const documents = Object.entries(DOCUMENT_TABLES).map(([module, table]) => ({
        module,
        normalized: Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count),
        mirror: Number(db.prepare('SELECT COUNT(*) AS count FROM documents WHERE module = ?').get(module).count),
        mismatches: Number(db.prepare(`
          SELECT COUNT(*) AS count FROM (
            SELECT path, content, owner_id, logical_bytes FROM ${table}
            EXCEPT
            SELECT path, content, owner_id, logical_bytes FROM documents WHERE module = ?
          )
        `).get(module).count),
      }));
      return {
        records,
        documents,
        ok: [...records, ...documents].every((row) => row.normalized === row.mirror && row.mismatches === 0),
      };
    });
  }

  return { dataStore, textStore, modules, audit };
}

export function createFileModuleRepositories({ dataStore, textStore, transaction = async (operation) => operation() }) {
  const modules = Object.fromEntries(Object.keys(RECORD_TABLES).map((module) => [module, {
    records: {
      get: (key) => dataStore.get(key),
      async set(key, value) {
        const expected = moduleForJsonKey(key);
        if (expected !== module) throw new Error(`record ${key} belongs to ${expected}, not ${module}`);
        await dataStore.set(key, value);
      },
      async list(prefix) {
        return (await dataStore.list(prefix)).filter((key) => moduleForJsonKey(key) === module);
      },
      delete: (key) => dataStore.delete(key),
    },
    documents: DOCUMENT_TABLES[module] ? {
      read: (documentPath) => textStore.read(documentPath),
      async write(documentPath, content) {
        const expected = moduleForDocumentPath(documentPath);
        if (expected !== module) throw new Error(`document ${documentPath} belongs to ${expected}, not ${module}`);
        await textStore.write(documentPath, content);
      },
      async list(prefix) {
        return (await textStore.list(prefix)).filter((documentPath) => moduleForDocumentPath(documentPath) === module);
      },
      delete: (documentPath) => textStore.delete(documentPath),
      deleteDir: (prefix) => textStore.deleteDir(prefix),
    } : null,
  }]));
  modules.sessions.records.compareAndSet = (key, expectedRevision, value) => transaction(async () => {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new TypeError('expected revision must be a non-negative integer');
    }
    const current = await dataStore.get(key);
    if (!current || revisionOf(current) !== expectedRevision) return { ok: false, current };
    if (revisionOf(value) !== expectedRevision + 1) {
      throw new Error('session compare-and-set must increment revision by one');
    }
    await dataStore.set(key, value);
    return { ok: true, value };
  });
  return modules;
}

export function createScopedModuleStores(modules, allowedModules) {
  const allowed = new Set(allowedModules);
  for (const module of allowed) {
    if (!modules[module]) throw new Error(`unknown persistence module: ${module}`);
  }
  function recordRepository(key) {
    const module = moduleForJsonKey(key);
    if (!allowed.has(module)) {
      const error = new Error(`persistence module ${module} is outside scope`);
      error.code = 'MODULE_SCOPE_VIOLATION';
      throw error;
    }
    return modules[module].records;
  }
  function documentRepository(documentPath) {
    const module = moduleForDocumentPath(documentPath);
    if (!allowed.has(module) || !modules[module].documents) {
      const error = new Error(`persistence module ${module} is outside document scope`);
      error.code = 'MODULE_SCOPE_VIOLATION';
      throw error;
    }
    return modules[module].documents;
  }
  return {
    dataStore: {
      async get(key) { return recordRepository(key).get(key); },
      async set(key, value) { await recordRepository(key).set(key, value); },
      async list(prefix) {
        const lists = await Promise.all([...allowed].map((module) => modules[module].records.list(prefix)));
        return [...new Set(lists.flat())].sort();
      },
      async delete(key) { await recordRepository(key).delete(key); },
    },
    textStore: {
      async read(documentPath) { return documentRepository(documentPath).read(documentPath); },
      async write(documentPath, content) { await documentRepository(documentPath).write(documentPath, content); },
      async list(prefix) {
        const lists = await Promise.all([...allowed]
          .filter((module) => modules[module].documents)
          .map((module) => modules[module].documents.list(prefix)));
        return [...new Set(lists.flat())].sort();
      },
      async delete(documentPath) { await documentRepository(documentPath).delete(documentPath); },
      async deleteDir(prefix) {
        await Promise.all([...allowed]
          .filter((module) => modules[module].documents)
          .map((module) => modules[module].documents.deleteDir(prefix)));
      },
    },
  };
}
