// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import {
  createStorageGuard,
  createStorageOwnerResolver,
  userStorageBytes,
} from './storageGuard.js';

let dir;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'storage-guard-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function appWithGuard(options = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_1';
    next();
  });
  app.use(createStorageGuard({ dataDir: dir, ...options }));
  app.use((req, res) => res.json({ ok: true }));
  return app;
}

describe('storage guard', () => {
  it('allows writes within user and free-space reserves', async () => {
    const app = appWithGuard({
      maxUserBytes: 100,
      minFreeBytes: 20,
      writeHeadroomBytes: 10,
      measureUser: vi.fn().mockResolvedValue(50),
      statfs: vi.fn().mockResolvedValue({ bavail: 100, bsize: 1 }),
    });
    expect((await request(app).post('/api/value').send({ x: 1 })).status).toBe(200);
  });

  it('rejects writes that would cross the per-user quota', async () => {
    const app = appWithGuard({
      maxUserBytes: 100,
      writeHeadroomBytes: 20,
      measureUser: vi.fn().mockResolvedValue(90),
      statfs: vi.fn().mockResolvedValue({ bavail: 1_000, bsize: 1 }),
    });
    const res = await request(app).post('/api/value').send({ x: 1 });
    expect(res.status).toBe(507);
    expect(res.body.code).toBe('STORAGE_QUOTA_EXCEEDED');
  });

  it('rejects writes before the global disk reserve is consumed', async () => {
    const app = appWithGuard({
      maxUserBytes: 1_000,
      minFreeBytes: 100,
      writeHeadroomBytes: 20,
      measureUser: vi.fn().mockResolvedValue(10),
      statfs: vi.fn().mockResolvedValue({ bavail: 110, bsize: 1 }),
    });
    const res = await request(app).post('/api/value').send({ x: 1 });
    expect(res.status).toBe(507);
    expect(res.body.code).toBe('STORAGE_CAPACITY_LOW');
  });

  it('reserves capacity across concurrent writes and releases it after completion', async () => {
    const measureUser = vi.fn().mockResolvedValue(50);
    const statfs = vi.fn().mockResolvedValue({ bavail: 1_000, bsize: 1 });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.userId = 'usr_1';
      next();
    });
    app.use(createStorageGuard({
      dataDir: dir,
      maxUserBytes: 100,
      minFreeBytes: 0,
      writeHeadroomBytes: 30,
      measureUser,
      statfs,
    }));
    app.post('/hold', async (req, res) => {
      await gate;
      res.json({ ok: true });
    });

    const first = request(app).post('/hold').send({ x: 1 }).then((response) => response);
    await vi.waitFor(() => expect(measureUser).toHaveBeenCalledTimes(1));
    const second = await request(app).post('/hold').send({ x: 2 });
    expect(second.status).toBe(507);
    expect(second.body.code).toBe('STORAGE_QUOTA_EXCEEDED');
    release();
    expect((await first).status).toBe(200);
    expect((await request(app).post('/hold').send({ x: 3 })).status).toBe(200);
  });

  it('keeps a retained reservation after the response until background work releases it', async () => {
    const measureUser = vi.fn().mockResolvedValue(50);
    let releaseBackground;
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.userId = 'usr_1';
      next();
    });
    app.use(createStorageGuard({
      dataDir: dir,
      maxUserBytes: 100,
      minFreeBytes: 0,
      writeHeadroomBytes: 30,
      measureUser,
      statfs: vi.fn().mockResolvedValue({ bavail: 1_000, bsize: 1 }),
    }));
    app.post('/background', (req, res) => {
      releaseBackground = req.storageReservation.retain();
      res.json({ ownerId: req.storageReservation.ownerId });
    });
    app.post('/write', (req, res) => res.json({ ok: true }));

    const started = await request(app).post('/background').send({ x: 1 });
    expect(started.body.ownerId).toBe('usr_1');
    expect((await request(app).post('/write').send({ x: 2 })).status).toBe(507);

    releaseBackground();
    await vi.waitFor(async () => {
      expect((await request(app).post('/write').send({ x: 3 })).status).toBe(200);
    });
  });

  it('uses a persistent reservation manager when configured', async () => {
    const reservationManager = {
      reserve: vi.fn().mockResolvedValue({ ok: true, id: 'reservation_1' }),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const app = appWithGuard({
      maxUserBytes: 100,
      minFreeBytes: 0,
      writeHeadroomBytes: 20,
      reservationManager,
      ownerIdForRequest: vi.fn().mockResolvedValue('usr_owner'),
      measureUser: vi.fn(() => { throw new Error('filesystem measurement must not run'); }),
      statfs: vi.fn().mockResolvedValue({ bavail: 1_000, bsize: 1 }),
    });
    expect((await request(app).post('/api/value').send({ x: 1 })).status).toBe(200);
    expect(reservationManager.reserve).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'usr_owner',
      bytes: 20,
      limitBytes: 100,
    }));
    await vi.waitFor(() => expect(reservationManager.release).toHaveBeenCalledWith('reservation_1'));
  });

  it('charges a resolved data owner instead of the authenticated actor', async () => {
    const measureUser = vi.fn(async (_dataDir, userId) => (userId === 'usr_owner' ? 90 : 0));
    const app = appWithGuard({
      maxUserBytes: 100,
      writeHeadroomBytes: 20,
      measureUser,
      ownerIdForRequest: vi.fn().mockResolvedValue('usr_owner'),
      statfs: vi.fn().mockResolvedValue({ bavail: 1_000, bsize: 1 }),
    });
    const res = await request(app).post('/party-sessions/p1/chat').send({ text: 'x' });
    expect(res.status).toBe(507);
    expect(measureUser).toHaveBeenCalledWith(dir, 'usr_owner');
  });

  it('resolves existing Party mutations to the Party owner', async () => {
    const dataStore = {
      get: vi.fn().mockResolvedValue({ id: 'p1', ownerId: 'usr_owner' }),
    };
    const resolveOwner = createStorageOwnerResolver({ dataStore });
    expect(await resolveOwner({ path: '/party-sessions/p1/chat', userId: 'usr_actor' })).toBe('usr_owner');
    expect(dataStore.get).toHaveBeenCalledWith('sharedSessions/p1');
  });

  it('uses the actor for Party creation and unknown Party IDs', async () => {
    const dataStore = { get: vi.fn().mockResolvedValue(null) };
    const resolveOwner = createStorageOwnerResolver({ dataStore });
    expect(await resolveOwner({ path: '/party-sessions', userId: 'usr_actor' })).toBe('usr_actor');
    expect(await resolveOwner({ path: '/party-sessions/missing/chat', userId: 'usr_actor' })).toBe('usr_actor');
  });

  it('does not block reads, deletes, or in-memory heartbeat endpoints', async () => {
    const measureUser = vi.fn().mockResolvedValue(1_000);
    const app = appWithGuard({ maxUserBytes: 1, measureUser });
    expect((await request(app).get('/api/value')).status).toBe(200);
    expect((await request(app).delete('/api/value')).status).toBe(200);
    expect((await request(app).post('/api/party/presence')).status).toBe(200);
    expect((await request(app).post('/api/party/typing')).status).toBe(200);
    expect((await request(app).post('/text-operations/take-turn')).status).toBe(200);
    expect(measureUser).not.toHaveBeenCalled();
  });

  it('counts private files and owned Party data without double-counting membership indexes', async () => {
    await fs.mkdir(path.join(dir, 'users/usr_1/sharedSessions'), { recursive: true });
    await fs.mkdir(path.join(dir, 'sharedSessions/party_1'), { recursive: true });
    await fs.writeFile(path.join(dir, 'users/usr_1/profile.json'), '12345');
    await fs.writeFile(
      path.join(dir, 'users/usr_1/sharedSessions/party_1.json'),
      JSON.stringify({ ownerId: 'usr_1' }),
    );
    await fs.writeFile(path.join(dir, 'sharedSessions/party_1/snapshot.json'), '1234567');
    const userOnly = await userStorageBytes(dir, 'usr_1');
    expect(userOnly).toBe(
      Buffer.byteLength('12345')
      + Buffer.byteLength('1234567'),
    );
  });

  it('charges public snapshots to their publishing owner', async () => {
    await fs.mkdir(path.join(dir, 'public/novels/pub_1'), { recursive: true });
    await fs.mkdir(path.join(dir, 'public/novels/pub_other'), { recursive: true });
    const ownMeta = JSON.stringify({ publicId: 'pub_1', ownerId: 'usr_1' });
    const otherMeta = JSON.stringify({ publicId: 'pub_other', ownerId: 'usr_2' });
    await fs.writeFile(path.join(dir, 'public/novels/pub_1.json'), ownMeta);
    await fs.writeFile(path.join(dir, 'public/novels/pub_1/novel.md'), 'owned-public-text');
    await fs.writeFile(path.join(dir, 'public/novels/pub_other.json'), otherMeta);
    await fs.writeFile(path.join(dir, 'public/novels/pub_other/novel.md'), 'other-user-text');

    expect(await userStorageBytes(dir, 'usr_1')).toBe(
      Buffer.byteLength(ownMeta) + Buffer.byteLength('owned-public-text'),
    );
  });
});
