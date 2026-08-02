// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPersistence } from './createPersistence.js';

const opened = [];

afterEach(async () => {
  while (opened.length) {
    const { persistence, dir } = opened.pop();
    persistence.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function repositoryFor(driver) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `jobs-${driver}-`));
  const persistence = createPersistence({ driver, dataDir: dir });
  opened.push({ persistence, dir });
  return persistence.repositories.jobs;
}

for (const driver of ['filesystem', 'sqlite']) {
  describe(`${driver} job repository`, () => {
    it('enqueues, claims, and completes a job with lease ownership', async () => {
      const jobs = await repositoryFor(driver);
      const queued = await jobs.enqueue({
        id: 'novel:u1:s1',
        type: 'novelize',
        ownerId: 'u1',
        aggregateId: 's1',
        payload: { userId: 'u1', sessionId: 's1', pov: 'third' },
      }, 100);
      expect(queued.ok).toBe(true);
      expect(queued.job.state).toBe('queued');

      const claimed = await jobs.claim('novel:u1:s1', 'worker-a', {
        leaseMs: 500,
        timestamp: 110,
      });
      expect(claimed).toMatchObject({
        state: 'running',
        attempts: 1,
        leaseOwner: 'worker-a',
        leaseExpiresAtMs: 610,
      });
      expect(await jobs.complete('novel:u1:s1', 'worker-b', {}, 120)).toBe(false);
      expect(await jobs.complete('novel:u1:s1', 'worker-a', { ok: true }, 120)).toBe(true);
      expect(await jobs.get('novel:u1:s1')).toMatchObject({
        state: 'done',
        result: { ok: true },
        leaseOwner: null,
      });
    });

    it('rejects an active duplicate and reclaims an interrupted worker explicitly', async () => {
      const jobs = await repositoryFor(driver);
      const input = {
        id: 'novel:u1:s1',
        type: 'novelize',
        ownerId: 'u1',
        aggregateId: 's1',
        payload: { userId: 'u1', sessionId: 's1' },
      };
      await jobs.enqueue(input, 100);
      await jobs.claim(input.id, 'old-worker', { leaseMs: 1000, timestamp: 110 });

      expect((await jobs.enqueue(input, 120)).ok).toBe(false);
      expect(await jobs.claim(input.id, 'new-worker', {
        leaseMs: 1000,
        timestamp: 120,
      })).toBeNull();
      expect(await jobs.claim(input.id, 'new-worker', {
        leaseMs: 1000,
        allowSteal: true,
        timestamp: 120,
      })).toMatchObject({ leaseOwner: 'new-worker', attempts: 2 });
      expect(await jobs.fail(input.id, 'new-worker', 'interrupted', 130)).toBe(true);
      expect(await jobs.get(input.id)).toMatchObject({
        state: 'failed',
        lastErrorCode: 'interrupted',
      });
    });

    it('lists only queued-ready and running jobs of the requested type', async () => {
      const jobs = await repositoryFor(driver);
      await jobs.enqueue({
        id: 'ready', type: 'novelize', ownerId: 'u1', payload: {}, availableAtMs: 100,
      }, 10);
      await jobs.enqueue({
        id: 'later', type: 'novelize', ownerId: 'u1', payload: {}, availableAtMs: 300,
      }, 20);
      await jobs.enqueue({
        id: 'other', type: 'image', ownerId: 'u1', payload: {}, availableAtMs: 100,
      }, 30);
      await jobs.enqueue({
        id: 'running', type: 'novelize', ownerId: 'u1', payload: {}, availableAtMs: 100,
      }, 40);
      await jobs.claim('running', 'old-worker', { leaseMs: 1000, timestamp: 100 });

      expect((await jobs.listRecoverable('novelize', 200)).map((job) => job.id)).toEqual([
        'ready',
        'running',
      ]);
    });
  });
}
