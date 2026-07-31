// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsImageStore } from './imageStore.js';
import {
  addAttachment,
  copyAttachmentCollection,
  deleteAttachment,
  getAttachmentCollection,
  readAttachmentVariant,
  setTopAttachment,
  updateAttachmentDescription,
} from './attachmentLibrary.js';

let dir;
let dataStore;
let imageStore;

const processed = {
  display: Buffer.from('display'),
  thumbnail: Buffer.from('thumbnail'),
  mimeType: 'image/webp',
  width: 800,
  height: 600,
  byteSize: 16,
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'attachment-library-test-'));
  dataStore = createFsDataStore(dir);
  imageStore = createFsImageStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('attachmentLibrary', () => {
  it('adds images, edits descriptions, and enforces top-image membership', async () => {
    const { item } = await addAttachment(dataStore, imageStore, 'users/u/worlds/w/attachments', processed, {
      description: '  城塞  ',
    });
    expect(item.id).toMatch(/^att_[0-9a-f]{16}$/);
    expect(item.description).toBe('城塞');
    expect((await getAttachmentCollection(dataStore, 'users/u/worlds/w/attachments')).topImageId).toBeNull();

    expect(await setTopAttachment(dataStore, 'users/u/worlds/w/attachments', 'att_missing')).toBeNull();
    const topped = await setTopAttachment(dataStore, 'users/u/worlds/w/attachments', item.id);
    expect(topped.topImageId).toBe(item.id);

    const edited = await updateAttachmentDescription(
      dataStore,
      'users/u/worlds/w/attachments',
      item.id,
      '夜の城塞',
    );
    expect(edited.item.description).toBe('夜の城塞');
    expect(await readAttachmentVariant(
      dataStore,
      imageStore,
      'users/u/worlds/w/attachments',
      item.id,
      'display',
    )).toEqual(processed.display);
  });

  it('clears topImageId when its image is deleted', async () => {
    const { item } = await addAttachment(dataStore, imageStore, 'a', processed);
    await setTopAttachment(dataStore, 'a', item.id);
    expect(await deleteAttachment(dataStore, imageStore, 'a', item.id)).toBe(true);
    expect(await getAttachmentCollection(dataStore, 'a')).toMatchObject({ topImageId: null, items: [] });
  });

  it('copies a complete independent collection', async () => {
    const { item } = await addAttachment(dataStore, imageStore, 'source', processed);
    await setTopAttachment(dataStore, 'source', item.id);
    const copied = await copyAttachmentCollection({ dataStore, imageStore, sourceDir: 'source', targetDir: 'target' });
    expect(copied.topImageId).toBe(item.id);
    expect(await readAttachmentVariant(dataStore, imageStore, 'target', item.id, 'thumbnail')).toEqual(
      processed.thumbnail,
    );
  });

  it('rejects descriptions over 500 characters', async () => {
    await expect(
      addAttachment(dataStore, imageStore, 'a', processed, { description: 'あ'.repeat(501) }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
