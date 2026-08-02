import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

async function fileExists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function sha256File(filename) {
  const content = await fs.readFile(filename);
  return crypto.createHash('sha256').update(content).digest('hex');
}

export async function createSqliteBackup({ sourcePath, destinationPath, overwrite = false }) {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  if (source === destination) throw new Error('backup destination must differ from source');
  if (!(await fileExists(source))) throw new Error(`SQLite source does not exist: ${source}`);
  if (!overwrite && await fileExists(destination)) {
    throw new Error(`backup destination already exists: ${destination}`);
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.partial-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  let sourceDb;
  try {
    sourceDb = new DatabaseSync(source, { readOnly: true });
    const pages = await backup(sourceDb, temporary);
    sourceDb.close();
    sourceDb = null;

    const snapshot = new DatabaseSync(temporary, { readOnly: true });
    let integrity;
    let foreignKeyViolations;
    try {
      integrity = snapshot.prepare('PRAGMA integrity_check').all()
        .map((row) => String(Object.values(row)[0]));
      foreignKeyViolations = snapshot.prepare('PRAGMA foreign_key_check').all();
    } finally {
      snapshot.close();
    }
    if (integrity.length !== 1 || integrity[0] !== 'ok') {
      throw new Error(`backup integrity_check failed: ${integrity.join('; ')}`);
    }
    if (foreignKeyViolations.length > 0) {
      throw new Error(`backup foreign_key_check failed: ${foreignKeyViolations.length} violation(s)`);
    }

    if (overwrite) {
      await fs.rename(temporary, destination);
    } else {
      // linkは既存destinationを置換しない。検査中に別処理が同名backupを作った場合も安全側で失敗する。
      await fs.link(temporary, destination);
      await fs.unlink(temporary);
    }
    const stat = await fs.stat(destination);
    return {
      source,
      destination,
      pages,
      bytes: stat.size,
      sha256: await sha256File(destination),
      integrity: 'ok',
      foreignKeyViolations: 0,
    };
  } finally {
    if (sourceDb) sourceDb.close();
    await fs.rm(temporary, { force: true });
  }
}
