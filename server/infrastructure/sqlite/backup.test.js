// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createSqliteBackup } from './backup.js';

const dirs = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('createSqliteBackup', () => {
  it('creates and verifies a consistent online-backup snapshot', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-backup-'));
    dirs.push(dir);
    const sourcePath = path.join(dir, 'source.sqlite3');
    const destinationPath = path.join(dir, 'backups', 'snapshot.sqlite3');
    const source = new DatabaseSync(sourcePath);
    source.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT');
    source.prepare('INSERT INTO sample(value) VALUES (?)').run('before');

    const report = await createSqliteBackup({ sourcePath, destinationPath });
    source.prepare('INSERT INTO sample(value) VALUES (?)').run('after');
    source.close();

    expect(report).toMatchObject({
      source: sourcePath,
      destination: destinationPath,
      integrity: 'ok',
      foreignKeyViolations: 0,
    });
    expect(report.bytes).toBeGreaterThan(0);
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
    const snapshot = new DatabaseSync(destinationPath, { readOnly: true });
    expect(snapshot.prepare('SELECT value FROM sample ORDER BY id').all()).toEqual([{ value: 'before' }]);
    snapshot.close();
  });

  it('does not replace an existing destination unless overwrite is explicit', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-backup-existing-'));
    dirs.push(dir);
    const sourcePath = path.join(dir, 'source.sqlite3');
    const destinationPath = path.join(dir, 'snapshot.sqlite3');
    const source = new DatabaseSync(sourcePath);
    source.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY) STRICT');
    source.close();
    await fs.writeFile(destinationPath, 'keep');

    await expect(createSqliteBackup({ sourcePath, destinationPath })).rejects.toThrow(/already exists/);
    expect(await fs.readFile(destinationPath, 'utf8')).toBe('keep');
  });
});
