import { classifyTextDocument } from './classifyStorage.js';

function assertPath(documentPath) {
  if (typeof documentPath !== 'string' || !documentPath || documentPath.startsWith('/') || documentPath.includes('\0')) {
    throw new TypeError('document path must be a non-empty relative path');
  }
}

function escapedPrefix(prefix) {
  return prefix.replace(/[\\%_]/g, '\\$&');
}

export function createSqliteTextStore(db, { now = Date.now } = {}) {
  const readStatement = db.prepare('SELECT content FROM documents WHERE path = ?');
  const writeStatement = db.prepare(`
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
  const deleteStatement = db.prepare('DELETE FROM documents WHERE path = ?');
  const deleteDirStatement = db.prepare(`
    DELETE FROM documents
    WHERE path = ? OR path LIKE ? ESCAPE '\\'
  `);

  return {
    async read(documentPath) {
      assertPath(documentPath);
      return readStatement.get(documentPath)?.content ?? null;
    },
    async write(documentPath, content) {
      assertPath(documentPath);
      if (typeof content !== 'string') throw new TypeError('document content must be a string');
      const classification = classifyTextDocument(db, documentPath);
      writeStatement.run(
        documentPath,
        classification.module,
        classification.resourceType,
        classification.ownerId,
        content,
        Buffer.byteLength(content, 'utf8'),
        now(),
      );
    },
    async list(prefix) {
      assertPath(prefix);
      const rows = db.prepare(`
        SELECT path FROM documents
        WHERE path LIKE ? ESCAPE '\\'
        ORDER BY path
      `).all(`${escapedPrefix(prefix)}/%`);
      const start = `${prefix}/`;
      return [...new Set(rows.map((row) => `${prefix}/${row.path.slice(start.length).split('/')[0]}`))];
    },
    async delete(documentPath) {
      assertPath(documentPath);
      deleteStatement.run(documentPath);
    },
    async deleteDir(prefix) {
      assertPath(prefix);
      deleteDirStatement.run(prefix, `${escapedPrefix(prefix)}/%`);
    },
  };
}
