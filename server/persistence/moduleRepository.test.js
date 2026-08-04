// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistence } from './createPersistence.js';
import { DOCUMENT_TABLES, RECORD_TABLES } from './moduleRepository.js';

const resources = [];

async function createDriver(driver) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), `module-repository-${driver}-`));
  const persistence = createPersistence({ driver, dataDir: directory });
  resources.push({ directory, persistence });
  return persistence;
}

afterEach(async () => {
  for (const { directory, persistence } of resources.splice(0)) {
    persistence.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

const recordCases = [
  ['auth', 'users/usr_owner/profile', { id: 'usr_owner', displayName: 'Owner', createdAt: 10 }],
  ['library', 'users/usr_owner/worlds/w1', { id: 'w1', title: 'World', updatedAt: 20 }],
  ['sessions', 'users/usr_owner/sessions/s1', { id: 's1', title: 'Session', worldId: 'w1', _sync: { revision: 3 } }],
  ['campaigns', 'users/usr_owner/worlds/w1/campaigns/c1', { id: 'c1', worldId: 'w1', title: 'Campaign' }],
  ['party', 'sharedSessions/p1', { id: 'p1', ownerId: 'usr_owner', title: 'Party', revision: 2 }],
  ['publishing', 'public/worlds/pub1', { publicId: 'pub1', ownerId: 'usr_owner', title: 'Public' }],
  ['usage', 'users/usr_owner/usage/2026-08-02', { images: 1 }],
  ['jobs', 'users/usr_owner/sessions/s1/novelJob', { status: 'running', sessionId: 's1' }],
  ['system', 'system/config', { id: 'config', title: 'System' }],
];

const documentCases = [
  ['library', 'users/usr_owner/worlds/w1/world.md'],
  ['sessions', 'users/usr_owner/sessions/s1/novel.md'],
  ['campaigns', 'users/usr_owner/worlds/w1/campaigns/c1/bible.md'],
  ['publishing', 'public/worlds/pub1/world.md'],
  ['system', 'system/readme.md'],
];

for (const driver of ['filesystem', 'sqlite']) {
  describe(`${driver} module repositories`, () => {
    it('routes every record module through the same contract', async () => {
      const persistence = await createDriver(driver);
      for (const [module, key, value] of recordCases) {
        const repository = persistence.repositories.modules[module].records;
        await repository.set(key, value);
        expect(await repository.get(key)).toEqual(value);
      }
      expect(await persistence.dataStore.list('users/usr_owner/sessions')).toEqual([
        'users/usr_owner/sessions/s1',
      ]);
      await persistence.repositories.modules.sessions.records.delete('users/usr_owner/sessions/s1');
      expect(await persistence.dataStore.get('users/usr_owner/sessions/s1')).toBeNull();
    });

    it('routes every document module through the same contract', async () => {
      const persistence = await createDriver(driver);
      for (const [module, documentPath] of documentCases) {
        const repository = persistence.repositories.modules[module].documents;
        await repository.write(documentPath, `# ${module}`);
        expect(await repository.read(documentPath)).toBe(`# ${module}`);
      }
      await persistence.repositories.modules.library.documents.deleteDir('users/usr_owner/worlds/w1');
      expect(await persistence.textStore.read('users/usr_owner/worlds/w1/world.md')).toBeNull();
    });

    it('rejects writes through the wrong module boundary', async () => {
      const persistence = await createDriver(driver);
      await expect(persistence.repositories.modules.auth.records.set(
        'users/usr_owner/worlds/w1',
        { id: 'w1' },
      )).rejects.toThrow(/belongs to library/);
    });

    it('fails fast when an application scope crosses an undeclared module', async () => {
      const persistence = await createDriver(driver);
      await expect(persistence.scopes.auth.dataStore.get('users/usr_owner/worlds/w1'))
        .rejects.toMatchObject({ code: 'MODULE_SCOPE_VIOLATION' });
    });

    it('provides revision compare-and-set for Solo sessions', async () => {
      const persistence = await createDriver(driver);
      const key = 'users/usr_owner/sessions/cas';
      const repository = persistence.repositories.modules.sessions.records;
      await repository.set(key, { id: 'cas', title: 'v1', _sync: { revision: 1 } });
      expect(await repository.compareAndSet(key, 1, {
        id: 'cas',
        title: 'v2',
        _sync: { revision: 2 },
      })).toMatchObject({ ok: true });
      expect(await repository.compareAndSet(key, 1, {
        id: 'cas',
        title: 'stale',
        _sync: { revision: 2 },
      })).toMatchObject({
        ok: false,
        current: { id: 'cas', title: 'v2', _sync: { revision: 2 } },
      });
      expect(await repository.get(key)).toEqual({ id: 'cas', title: 'v2', _sync: { revision: 2 } });
    });
  });
}

describe('SQLite normalized module tables', () => {
  it('extracts searchable columns and keeps compatibility mirrors exact', async () => {
    const persistence = await createDriver('sqlite');
    for (const [module, key, value] of recordCases) await persistence.dataStore.set(key, value);
    for (const [, documentPath] of documentCases) await persistence.textStore.write(documentPath, '# Title');

    const session = persistence.db.prepare('SELECT * FROM session_records WHERE key = ?')
      .get('users/usr_owner/sessions/s1');
    expect(session).toMatchObject({
      entity_id: 's1',
      parent_id: 'w1',
      owner_id: 'usr_owner',
      title: 'Session',
      revision: 3,
    });
    expect(persistence.db.prepare('SELECT value_json FROM domain_records WHERE key = ?')
      .get('users/usr_owner/sessions/s1').value_json).toBe(session.value_json);
    expect(persistence.db.prepare('SELECT title FROM library_documents WHERE path = ?')
      .get('users/usr_owner/worlds/w1/world.md').title).toBe('Title');

    const audit = await persistence.auditModules();
    expect(audit.ok).toBe(true);
    for (const [module] of recordCases) {
      expect(audit.records.find((row) => row.module === module)).toMatchObject({ mismatches: 0 });
    }
  });

  it('has one physical record table per declared module', async () => {
    const persistence = await createDriver('sqlite');
    const tables = new Set(persistence.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all().map((row) => row.name));
    for (const table of Object.values(RECORD_TABLES)) expect(tables.has(table)).toBe(true);
    for (const table of Object.values(DOCUMENT_TABLES)) expect(tables.has(table)).toBe(true);
  });
});
