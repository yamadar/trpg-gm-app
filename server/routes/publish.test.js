// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createPublishRouter } from './publish.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { saveWorld } from '../storage/worldLibrary.js';
import { saveCharacter } from '../storage/characterLibrary.js';
import { saveScenario } from '../storage/scenarioLibrary.js';
import { findOrCreateUser } from '../auth/users.js';
import { sessionKey, sessionNovelDocPath, publicMetaKey } from '../storage/paths.js';

let dir;
let dataStore;
let textStore;
let app;
let userId;

function buildApp() {
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = userId;
    next();
  });
  app.use('/api', createPublishRouter({ dataStore, textStore }));
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'publish-route-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
  userId = 'usr_test';
  buildApp();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('publish routes', () => {
  describe('worlds', () => {
    it('publishes a world and returns its publicId; GET map reflects it', async () => {
      await saveWorld(dataStore, textStore, userId, { id: 'w1', title: 'World One', raw: '# World One' });

      const res = await request(app).post('/api/publish/worlds/w1');
      expect(res.status).toBe(200);
      expect(res.body.publicId).toMatch(/^pub_[0-9a-f]+$/);

      const map = await request(app).get('/api/publish/worlds');
      expect(map.status).toBe(200);
      expect(map.body).toEqual({ w1: res.body.publicId });
    });

    it('404 when publishing a missing world', async () => {
      const res = await request(app).post('/api/publish/worlds/missing');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('re-publishing keeps the same publicId', async () => {
      await saveWorld(dataStore, textStore, userId, { id: 'w1', title: 'World One', raw: '# World One' });
      const first = await request(app).post('/api/publish/worlds/w1');
      const second = await request(app).post('/api/publish/worlds/w1');
      expect(second.body.publicId).toBe(first.body.publicId);
    });

    it('DELETE unpublishes and is idempotent (204 twice)', async () => {
      await saveWorld(dataStore, textStore, userId, { id: 'w1', title: 'World One', raw: '# World One' });
      await request(app).post('/api/publish/worlds/w1');

      const first = await request(app).delete('/api/publish/worlds/w1');
      expect(first.status).toBe(204);
      const second = await request(app).delete('/api/publish/worlds/w1');
      expect(second.status).toBe(204);

      const map = await request(app).get('/api/publish/worlds');
      expect(map.body).toEqual({});
    });

    it('rejects a path-traversal worldId with 400', async () => {
      const res = await request(app).post('/api/publish/worlds/..%2F..%2Fescape');
      expect(res.status).toBe(400);
    });
  });

  describe('characters', () => {
    it('publishes a character and returns its publicId; GET map reflects it', async () => {
      await saveWorld(dataStore, textStore, userId, { id: 'w1', title: 'World One', raw: '# World One' });
      await saveCharacter(dataStore, textStore, userId, { worldId: 'w1', kind: 'pc', name: 'hero', raw: '## Hero' });

      const res = await request(app).post('/api/publish/worlds/w1/characters/pc/hero');
      expect(res.status).toBe(200);
      expect(res.body.publicId).toMatch(/^pub_[0-9a-f]+$/);

      const map = await request(app).get('/api/publish/worlds/w1/characters/pc');
      expect(map.status).toBe(200);
      expect(map.body).toEqual({ hero: res.body.publicId });
    });

    it('404 when publishing a missing character', async () => {
      await saveWorld(dataStore, textStore, userId, { id: 'w1', title: 'World One', raw: '# World One' });
      const res = await request(app).post('/api/publish/worlds/w1/characters/pc/missing');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('rejects invalid kind with 400', async () => {
      const res = await request(app).post('/api/publish/worlds/w1/characters/monster/hero');
      expect(res.status).toBe(400);
    });

    it('DELETE unpublishes a character and is idempotent', async () => {
      await saveWorld(dataStore, textStore, userId, { id: 'w1', title: 'World One', raw: '# World One' });
      await saveCharacter(dataStore, textStore, userId, { worldId: 'w1', kind: 'pc', name: 'hero', raw: '## Hero' });
      await request(app).post('/api/publish/worlds/w1/characters/pc/hero');

      const first = await request(app).delete('/api/publish/worlds/w1/characters/pc/hero');
      expect(first.status).toBe(204);
      const second = await request(app).delete('/api/publish/worlds/w1/characters/pc/hero');
      expect(second.status).toBe(204);

      const map = await request(app).get('/api/publish/worlds/w1/characters/pc');
      expect(map.body).toEqual({});
    });
  });

  describe('scenarios', () => {
    it('publishes a scenario and returns its publicId; GET map reflects it', async () => {
      await saveWorld(dataStore, textStore, userId, { id: 'w1', title: 'World One', raw: '# World One' });
      await saveScenario(dataStore, textStore, userId, { worldId: 'w1', id: 'sc1', title: 'Scenario One', raw: '## SC1' });

      const res = await request(app).post('/api/publish/worlds/w1/scenarios/sc1');
      expect(res.status).toBe(200);
      expect(res.body.publicId).toMatch(/^pub_[0-9a-f]+$/);

      const map = await request(app).get('/api/publish/worlds/w1/scenarios');
      expect(map.status).toBe(200);
      expect(map.body).toEqual({ sc1: res.body.publicId });
    });

    it('404 when publishing a missing scenario', async () => {
      await saveWorld(dataStore, textStore, userId, { id: 'w1', title: 'World One', raw: '# World One' });
      const res = await request(app).post('/api/publish/worlds/w1/scenarios/missing');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('DELETE unpublishes a scenario and is idempotent', async () => {
      await saveWorld(dataStore, textStore, userId, { id: 'w1', title: 'World One', raw: '# World One' });
      await saveScenario(dataStore, textStore, userId, { worldId: 'w1', id: 'sc1', title: 'Scenario One', raw: '## SC1' });
      await request(app).post('/api/publish/worlds/w1/scenarios/sc1');

      const first = await request(app).delete('/api/publish/worlds/w1/scenarios/sc1');
      expect(first.status).toBe(204);
      const second = await request(app).delete('/api/publish/worlds/w1/scenarios/sc1');
      expect(second.status).toBe(204);

      const map = await request(app).get('/api/publish/worlds/w1/scenarios');
      expect(map.body).toEqual({});
    });
  });

  describe('session novels', () => {
    it('publishes a novel and returns its publicId; GET map reflects it', async () => {
      await dataStore.set(sessionKey(userId, 'sess1'), { id: 'sess1', title: 'Session One' });
      await textStore.write(sessionNovelDocPath(userId, 'sess1'), '# Novel text');

      const res = await request(app).post('/api/publish/sessions/sess1/novel');
      expect(res.status).toBe(200);
      expect(res.body.publicId).toMatch(/^pub_[0-9a-f]+$/);

      const map = await request(app).get('/api/publish/sessions');
      expect(map.status).toBe(200);
      expect(map.body).toEqual({ sess1: res.body.publicId });
    });

    it('404 when publishing a missing session', async () => {
      const res = await request(app).post('/api/publish/sessions/missing/novel');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not found' });
    });

    it('409 when publishing a novel before novelize', async () => {
      await dataStore.set(sessionKey(userId, 'sess1'), { id: 'sess1', title: 'Session One' });
      // no novel doc written — novelize has not run yet

      const res = await request(app).post('/api/publish/sessions/sess1/novel');
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ error: 'novelize first' });
    });

    it('DELETE unpublishes a novel and is idempotent', async () => {
      await dataStore.set(sessionKey(userId, 'sess1'), { id: 'sess1', title: 'Session One' });
      await textStore.write(sessionNovelDocPath(userId, 'sess1'), '# Novel text');
      await request(app).post('/api/publish/sessions/sess1/novel');

      const first = await request(app).delete('/api/publish/sessions/sess1/novel');
      expect(first.status).toBe(204);
      const second = await request(app).delete('/api/publish/sessions/sess1/novel');
      expect(second.status).toBe(204);

      const map = await request(app).get('/api/publish/sessions');
      expect(map.body).toEqual({});
    });
  });

  describe('owner snapshot', () => {
    it('owner displayName is snapshotted into the public meta', async () => {
      const user = await findOrCreateUser(dataStore, {
        provider: 'google',
        providerUserId: 'owner-1',
        displayName: 'Ada Lovelace',
        avatarUrl: null,
      });
      userId = user.id;
      buildApp();

      await saveWorld(dataStore, textStore, userId, { id: 'w1', title: 'World One', raw: '# World One' });
      const res = await request(app).post('/api/publish/worlds/w1');
      expect(res.status).toBe(200);

      const meta = await dataStore.get(publicMetaKey('worlds', res.body.publicId));
      expect(meta.ownerId).toBe(user.id);
      expect(meta.ownerName).toBe('Ada Lovelace');
    });

    it('falls back to a default displayName when the user profile is missing', async () => {
      await saveWorld(dataStore, textStore, userId, { id: 'w1', title: 'World One', raw: '# World One' });
      const res = await request(app).post('/api/publish/worlds/w1');
      expect(res.status).toBe(200);

      const meta = await dataStore.get(publicMetaKey('worlds', res.body.publicId));
      expect(meta.ownerId).toBe('usr_test');
      expect(meta.ownerName).toBe('ユーザー');
    });
  });
});
