// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createCharactersRouter } from './characters.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { publishCharacter, getPublicItem } from '../storage/shareLibrary.js';

let dir;
let app;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'characters-route-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createCharactersRouter({ dataStore, textStore }));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('characters routes', () => {
  it('returns 404 for a missing character', async () => {
    const res = await request(app).get('/api/worlds/w1/characters/pc/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a pc', async () => {
    await request(app).put('/api/worlds/w1/characters/pc/alice').send({ raw: 'PC名: アリス' });
    const res = await request(app).get('/api/worlds/w1/characters/pc/alice');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'alice', kind: 'pc', raw: 'PC名: アリス', revealed: null });
  });

  it('saves an npc with revealed', async () => {
    await request(app).put('/api/worlds/w1/characters/npc/villain').send({ raw: 'x', revealed: true });
    const res = await request(app).get('/api/worlds/w1/characters/npc/villain');
    expect(res.body.revealed).toBe(true);
  });

  it('lists characters scoped to world and kind', async () => {
    await request(app).put('/api/worlds/w1/characters/pc/alice').send({ raw: 'a' });
    await request(app).put('/api/worlds/w1/characters/npc/villain').send({ raw: 'v' });
    const res = await request(app).get('/api/worlds/w1/characters/pc');
    expect(res.body.map((c) => c.name)).toEqual(['alice']);
  });

  it('deletes a character', async () => {
    await request(app).put('/api/worlds/w1/characters/pc/alice').send({ raw: 'a' });
    const del = await request(app).delete('/api/worlds/w1/characters/pc/alice');
    expect(del.status).toBe(204);
    const get = await request(app).get('/api/worlds/w1/characters/pc/alice');
    expect(get.status).toBe(404);
  });

  it('returns 404 when updating parsed for a missing character', async () => {
    const res = await request(app)
      .put('/api/worlds/w1/characters/pc/missing/parsed')
      .send({ parsed: { goal: 'x', bonds: 'y' }, parsedHash: 'h' });
    expect(res.status).toBe(404);
  });

  it('updates parsed and parsedHash without requiring raw', async () => {
    await request(app).put('/api/worlds/w1/characters/pc/alice').send({ raw: '原文' });
    const res = await request(app)
      .put('/api/worlds/w1/characters/pc/alice/parsed')
      .send({ parsed: { goal: '目標', bonds: '因縁' }, parsedHash: 'abc' });
    expect(res.status).toBe(200);
    expect(res.body.parsed).toEqual({ goal: '目標', bonds: '因縁' });

    const get = await request(app).get('/api/worlds/w1/characters/pc/alice');
    expect(get.body.raw).toBe('原文');
  });

  it('unpublishes a public character when it is deleted (cascade)', async () => {
    await request(app).put('/api/worlds/w1/characters/pc/alice').send({ raw: 'PC名: アリス' });
    const owner = { id: 'usr_test', displayName: 'テストユーザー' };
    const { meta } = await publishCharacter(dataStore, textStore, 'usr_test', 'w1', 'pc', 'alice', owner);
    expect(await getPublicItem(dataStore, textStore, 'characters', meta.publicId)).not.toBeNull();

    await request(app).delete('/api/worlds/w1/characters/pc/alice');

    expect(await getPublicItem(dataStore, textStore, 'characters', meta.publicId)).toBeNull();
  });
});
