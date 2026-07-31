import crypto from 'node:crypto';
import { attachmentManifestKey, attachmentVariantPath } from './paths.js';

export const MAX_ATTACHMENTS = 20;
export const MAX_DESCRIPTION_LENGTH = 500;

const locks = new Map();

function newAttachmentId() {
  return `att_${crypto.randomBytes(8).toString('hex')}`;
}

function emptyCollection() {
  return { schemaVersion: 1, topImageId: null, items: [], updatedAt: null };
}

function normalizeCollection(value) {
  if (!value || typeof value !== 'object') return emptyCollection();
  const items = Array.isArray(value.items) ? value.items.filter((item) => item?.id) : [];
  const topImageId = items.some((item) => item.id === value.topImageId) ? value.topImageId : null;
  return {
    schemaVersion: 1,
    topImageId,
    items,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : null,
  };
}

function normalizeDescription(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    const error = new Error('description must be a string');
    error.status = 400;
    throw error;
  }
  const description = value.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    const error = new Error(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters`);
    error.status = 400;
    throw error;
  }
  return description;
}

async function withLock(dir, operation) {
  const previous = locks.get(dir) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  locks.set(dir, current);
  try {
    return await current;
  } finally {
    if (locks.get(dir) === current) locks.delete(dir);
  }
}

export async function getAttachmentCollection(dataStore, dir) {
  return normalizeCollection(await dataStore.get(attachmentManifestKey(dir)));
}

export async function addAttachment(
  dataStore,
  imageStore,
  dir,
  processed,
  { description = '', replace = false, makeTop = false } = {},
) {
  const normalizedDescription = normalizeDescription(description);
  return withLock(dir, async () => {
    const previous = await getAttachmentCollection(dataStore, dir);
    if (!replace && previous.items.length >= MAX_ATTACHMENTS) {
      const error = new Error(`at most ${MAX_ATTACHMENTS} images can be attached`);
      error.status = 409;
      throw error;
    }
    const id = newAttachmentId();
    const now = Date.now();
    const item = {
      id,
      description: normalizedDescription,
      mimeType: processed.mimeType,
      width: processed.width,
      height: processed.height,
      byteSize: processed.byteSize,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await imageStore.write(attachmentVariantPath(dir, id, 'display'), processed.display);
      await imageStore.write(attachmentVariantPath(dir, id, 'thumbnail'), processed.thumbnail);
      const items = replace ? [item] : [...previous.items, item];
      const collection = {
        schemaVersion: 1,
        topImageId: replace || makeTop ? id : previous.topImageId,
        items,
        updatedAt: now,
      };
      await dataStore.set(attachmentManifestKey(dir), collection);
      if (replace) {
        await Promise.all(
          previous.items
            .filter((old) => old.id !== id)
            .map((old) => imageStore.deleteDir(`${dir}/${old.id}`)),
        );
      }
      return { collection, item };
    } catch (error) {
      await imageStore.deleteDir(`${dir}/${id}`);
      throw error;
    }
  });
}

export async function updateAttachmentDescription(dataStore, dir, attachmentId, description) {
  const normalizedDescription = normalizeDescription(description);
  return withLock(dir, async () => {
    const collection = await getAttachmentCollection(dataStore, dir);
    const index = collection.items.findIndex((item) => item.id === attachmentId);
    if (index < 0) return null;
    const now = Date.now();
    const item = { ...collection.items[index], description: normalizedDescription, updatedAt: now };
    const items = [...collection.items];
    items[index] = item;
    const updated = { ...collection, items, updatedAt: now };
    await dataStore.set(attachmentManifestKey(dir), updated);
    return { collection: updated, item };
  });
}

export async function setTopAttachment(dataStore, dir, imageId) {
  return withLock(dir, async () => {
    const collection = await getAttachmentCollection(dataStore, dir);
    if (imageId !== null && !collection.items.some((item) => item.id === imageId)) {
      return null;
    }
    const updated = { ...collection, topImageId: imageId, updatedAt: Date.now() };
    await dataStore.set(attachmentManifestKey(dir), updated);
    return updated;
  });
}

export async function deleteAttachment(dataStore, imageStore, dir, attachmentId) {
  return withLock(dir, async () => {
    const collection = await getAttachmentCollection(dataStore, dir);
    if (!collection.items.some((item) => item.id === attachmentId)) return false;
    const updated = {
      ...collection,
      topImageId: collection.topImageId === attachmentId ? null : collection.topImageId,
      items: collection.items.filter((item) => item.id !== attachmentId),
      updatedAt: Date.now(),
    };
    await dataStore.set(attachmentManifestKey(dir), updated);
    await imageStore.deleteDir(`${dir}/${attachmentId}`);
    return true;
  });
}

export async function deleteAttachmentCollection(dataStore, imageStore, dir) {
  await withLock(dir, async () => {
    if (imageStore) await imageStore.deleteDir(dir);
    await dataStore.delete(attachmentManifestKey(dir));
  });
}

export async function readAttachmentVariant(dataStore, imageStore, dir, attachmentId, variant) {
  if (variant !== 'display' && variant !== 'thumbnail') return null;
  const collection = await getAttachmentCollection(dataStore, dir);
  if (!collection.items.some((item) => item.id === attachmentId)) return null;
  return imageStore.read(attachmentVariantPath(dir, attachmentId, variant));
}

export async function copyAttachmentCollection({
  dataStore,
  imageStore,
  sourceDir,
  targetDir,
  sourceCollection,
}) {
  const collection = normalizeCollection(sourceCollection ?? await getAttachmentCollection(dataStore, sourceDir));
  const binaries = [];
  for (const item of collection.items) {
    const [display, thumbnail] = await Promise.all([
      imageStore.read(attachmentVariantPath(sourceDir, item.id, 'display')),
      imageStore.read(attachmentVariantPath(sourceDir, item.id, 'thumbnail')),
    ]);
    if (!display || !thumbnail) {
      const error = new Error(`attachment ${item.id} is missing`);
      error.status = 500;
      throw error;
    }
    binaries.push({ item, display, thumbnail });
  }
  await imageStore.deleteDir(targetDir);
  for (const { item, display, thumbnail } of binaries) {
    await imageStore.write(attachmentVariantPath(targetDir, item.id, 'display'), display);
    await imageStore.write(attachmentVariantPath(targetDir, item.id, 'thumbnail'), thumbnail);
  }
  const copied = { ...collection, items: collection.items.map((item) => ({ ...item })) };
  await dataStore.set(attachmentManifestKey(targetDir), copied);
  return copied;
}

export function topAttachmentOf(collection) {
  return collection?.items?.find((item) => item.id === collection.topImageId) ?? null;
}
