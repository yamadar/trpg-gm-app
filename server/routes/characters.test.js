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
    await request(app)
      .put('/api/worlds/w1/characters/pc/alice')
      .send({ characterName: 'アリス', raw: 'PC名: 別名' });
    const res = await request(app).get('/api/worlds/w1/characters/pc/alice');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'alice',
      kind: 'pc',
      characterName: 'アリス',
      raw: 'PC名: 別名',
      revealed: null,
    });
  });

  it('rejects a non-string user-entered character name', async () => {
    const res = await request(app)
      .put('/api/worlds/w1/characters/pc/alice')
      .send({ characterName: 123, raw: '本文' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('characterName must be a string');
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

  // 一覧はメタデータしか持たないため、これが無いと選ぶ側にはストレージ上の名前しか見えない。
  // PC選択のように「どんなキャラクターか」で選ぶ画面のために本文の要約を添える。
  it('adds a display name and an excerpt from the sheet to each listed character', async () => {
    await request(app)
      .put('/api/worlds/w1/characters/pc/howard-kane')
      .send({ raw: 'PC名: ハワード・ケイン\n新聞記者。兄の死の真相を追っている。' });

    const res = await request(app).get('/api/worlds/w1/characters/pc');

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      name: 'howard-kane',
      displayName: 'ハワード・ケイン',
      excerpt: '新聞記者。兄の死の真相を追っている。',
    });
  });

  it('uses the user-entered name before AI and sheet names in the list', async () => {
    await request(app)
      .put('/api/worlds/w1/characters/pc/alice')
      .send({ characterName: '手入力のアリス', raw: 'PC名: タグ名のアリス' });
    await request(app)
      .put('/api/worlds/w1/characters/pc/alice/parsed')
      .send({ parsed: { name: 'AIのアリス', goal: '', bonds: '' }, parsedHash: 'h1' });

    const res = await request(app).get('/api/worlds/w1/characters/pc');
    expect(res.body[0]).toMatchObject({
      characterName: '手入力のアリス',
      displayName: '手入力のアリス',
    });
  });

  // 「PC名:」行が無いシートでも一覧は壊れない。表示名はAI解析(parsed.name)があればそれを使う。
  it('falls back to the parsed name when the sheet has no PC名 line', async () => {
    await request(app).put('/api/worlds/w1/characters/pc/alice').send({ raw: '放浪の剣士。' });
    let res = await request(app).get('/api/worlds/w1/characters/pc');
    expect(res.body[0]).toMatchObject({ displayName: '', excerpt: '放浪の剣士。' });

    await request(app)
      .put('/api/worlds/w1/characters/pc/alice/parsed')
      .send({ parsed: { name: 'アリス', goal: '', bonds: '' }, parsedHash: 'h1' });

    res = await request(app).get('/api/worlds/w1/characters/pc');
    expect(res.body[0].displayName).toBe('アリス');
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
