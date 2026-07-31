// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { createAttachmentsRouter } from './attachments.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';
import { createFsImageStore } from '../storage/imageStore.js';
import { userProfileKey } from '../auth/users.js';
import { worldMetaKey } from '../storage/paths.js';

let dir;
let dataStore;
let textStore;
let imageStore;
let app;
let png;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachments-route-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
  imageStore = createFsImageStore(dir);
  png = await sharp({
    create: { width: 100, height: 80, channels: 3, background: '#123456' },
  }).png().toBuffer();
  await dataStore.set(worldMetaKey('usr_test', 'w1'), { id: 'w1', title: '世界' });
  await dataStore.set(userProfileKey('usr_test'), {
    id: 'usr_test',
    displayName: 'テスト',
    avatarUrl: 'https://example.com/provider.png',
    bio: '',
    createdAt: 1,
    updatedAt: 1,
  });
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createAttachmentsRouter({ dataStore, textStore, imageStore }));
  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({ error: error.message });
  });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('attachments routes', () => {
  it('uploads, describes, selects, serves, and deletes a world image', async () => {
    const uploaded = await request(app)
      .post('/api/worlds/w1/attachments')
      .field('description', '古城')
      .attach('file', png, 'castle.png');
    expect(uploaded.status).toBe(201);
    const id = uploaded.body.item.id;
    expect(uploaded.body.item.description).toBe('古城');

    const topped = await request(app).put('/api/worlds/w1/attachments/top').send({ imageId: id });
    expect(topped.status).toBe(200);
    expect(topped.body.topImageId).toBe(id);

    const image = await request(app).get(`/api/worlds/w1/attachments/${id}/thumbnail`);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toMatch(/^image\/webp/);

    const edited = await request(app)
      .patch(`/api/worlds/w1/attachments/${id}`)
      .send({ description: '夜の古城' });
    expect(edited.body.item.description).toBe('夜の古城');

    expect((await request(app).delete(`/api/worlds/w1/attachments/${id}`)).status).toBe(204);
    expect((await request(app).get('/api/worlds/w1/attachments')).body).toMatchObject({
      topImageId: null,
      items: [],
    });
  });

  it('rejects unsupported input and missing owners', async () => {
    const invalid = await request(app)
      .post('/api/worlds/w1/attachments')
      .attach('file', Buffer.from('<svg/>'), 'bad.svg');
    expect(invalid.status).toBe(400);
    expect((await request(app).get('/api/worlds/missing/attachments')).status).toBe(404);
  });

  it('replaces profile images and returns a public image URL', async () => {
    const first = await request(app).post('/api/me/profile-image').attach('file', png, 'avatar.png');
    expect(first.status).toBe(201);
    expect(first.body.user.avatarUrl).toMatch(/^\/api\/users\/usr_test\/profile-image\/att_/);

    const removed = await request(app).delete('/api/me/profile-image');
    expect(removed.status).toBe(200);
    expect(removed.body.user.avatarUrl).toBe('https://example.com/provider.png');
  });
});
