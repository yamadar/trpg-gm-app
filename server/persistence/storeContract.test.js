// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistence } from './createPersistence.js';

const resources = [];

async function createDriver(driver) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `persistence-${driver}-`));
  const persistence = createPersistence({ driver, dataDir: dir });
  resources.push({ dir, persistence });
  return persistence;
}

afterEach(async () => {
  for (const { dir, persistence } of resources.splice(0)) {
    persistence.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

for (const driver of ['filesystem', 'sqlite']) {
  describe(`${driver} persistence contract`, () => {
    it('round-trips, lists, overwrites, and deletes JSON records', async () => {
      const { dataStore } = await createDriver(driver);
      expect(await dataStore.get('users/u1/sessions/missing')).toBeNull();
      await dataStore.set('users/u1/sessions/a', { id: 'a', nested: { value: 1 } });
      await dataStore.set('users/u1/sessions/b', { id: 'b' });
      await dataStore.set('users/u1/sessions/a/novel', { turnCount: 1 });
      expect(await dataStore.list('users/u1/sessions')).toEqual([
        'users/u1/sessions/a',
        'users/u1/sessions/b',
      ]);
      await dataStore.set('users/u1/sessions/a', { id: 'a', nested: { value: 2 } });
      expect(await dataStore.get('users/u1/sessions/a')).toEqual({ id: 'a', nested: { value: 2 } });
      await dataStore.delete('users/u1/sessions/a');
      await dataStore.delete('users/u1/sessions/a');
      expect(await dataStore.get('users/u1/sessions/a')).toBeNull();
    });

    it('round-trips, lists, and deletes document trees', async () => {
      const { textStore } = await createDriver(driver);
      await textStore.write('users/u1/worlds/w1/world.md', '# World');
      await textStore.write('users/u1/worlds/w1/regions/r1.md', '# Region');
      expect(await textStore.read('users/u1/worlds/w1/world.md')).toBe('# World');
      expect(await textStore.list('users/u1/worlds/w1')).toEqual([
        'users/u1/worlds/w1/regions',
        'users/u1/worlds/w1/world.md',
      ]);
      await textStore.deleteDir('users/u1/worlds/w1');
      expect(await textStore.read('users/u1/worlds/w1/world.md')).toBeNull();
      expect(await textStore.read('users/u1/worlds/w1/regions/r1.md')).toBeNull();
    });
  });
}
