// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { openSqliteDatabase } from './database.js';
import { createSqliteCoordinator } from './coordinator.js';

describe('SQLite coordinator', () => {
  it('rolls back all writes when a transaction fails', async () => {
    const db = openSqliteDatabase(':memory:');
    const coordinator = createSqliteCoordinator(db);
    await expect(coordinator.transaction(async () => {
      db.prepare(`INSERT INTO app_metadata(key, value, updated_at_ms) VALUES ('a', '1', 1)`).run();
      await Promise.resolve();
      throw new Error('stop');
    })).rejects.toThrow('stop');
    expect(db.prepare(`SELECT value FROM app_metadata WHERE key = 'a'`).get()).toBeUndefined();
    expect(coordinator.snapshotMetrics()).toMatchObject({ transactions: 1, rollbacks: 1 });
    db.close();
  });

  it('queues outside operations until an async transaction commits', async () => {
    const db = openSqliteDatabase(':memory:');
    const coordinator = createSqliteCoordinator(db);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let outsideRan = false;
    const transaction = coordinator.transaction(async () => {
      db.prepare(`INSERT INTO app_metadata(key, value, updated_at_ms) VALUES ('inside', '1', 1)`).run();
      await gate;
    });
    const outside = coordinator.run(() => {
      outsideRan = true;
      db.prepare(`INSERT INTO app_metadata(key, value, updated_at_ms) VALUES ('outside', '1', 1)`).run();
    });
    await Promise.resolve();
    expect(outsideRan).toBe(false);
    release();
    await Promise.all([transaction, outside]);
    expect(outsideRan).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM app_metadata').get().count).toBe(2);
    db.close();
  });
});
