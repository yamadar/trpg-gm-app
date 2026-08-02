import crypto from 'node:crypto';
import path from 'node:path';

const MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeOwner(ownerId) {
  return typeof ownerId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(ownerId) ? ownerId : 'system';
}

function immutableObjectKey(ownerId, resourceKey, id) {
  const extension = path.posix.extname(resourceKey).toLowerCase();
  const safeExtension = MIME_TYPES.has(extension) ? extension : '.bin';
  return `media/${safeOwner(ownerId)}/${id}${safeExtension}`;
}

function mimeType(resourceKey) {
  return MIME_TYPES.get(path.posix.extname(resourceKey).toLowerCase()) || 'application/octet-stream';
}

function errorCode(error, fallback) {
  const raw = error?.name || error?.code;
  return typeof raw === 'string' && raw ? raw.slice(0, 128) : fallback;
}

export function createManagedImageStore({ objectStorage, mediaRepository, ownerForResource }) {
  async function deletePhysical(asset) {
    try {
      await objectStorage.delete(asset.objectKey);
      await mediaRepository.finishDelete(asset.id);
      return null;
    } catch (error) {
      return error;
    }
  }

  return {
    async write(resourceKey, value) {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const id = crypto.randomUUID();
      const ownerId = await ownerForResource(resourceKey);
      const hash = sha256(buffer);
      const asset = await mediaRepository.createPending({
        id,
        resourceKey,
        ownerId,
        objectKey: immutableObjectKey(ownerId, resourceKey, id),
        sha256: hash,
        bytes: buffer.length,
        mimeType: mimeType(resourceKey),
      });
      try {
        const receipt = await objectStorage.write(asset.objectKey, buffer);
        if (receipt.bytes !== buffer.length || receipt.sha256 !== hash) {
          throw new Error('object storage checksum mismatch');
        }
      } catch (error) {
        await mediaRepository.fail(id, errorCode(error, 'upload_failed'));
        throw error;
      }
      const activated = await mediaRepository.activate(id);
      if (!activated) throw new Error('media asset activation failed');
      if (activated.previous) await deletePhysical(activated.previous);
      return { key: resourceKey, bytes: buffer.length, sha256: hash };
    },

    async read(resourceKey) {
      const asset = await mediaRepository.get(resourceKey);
      if (!asset) return null;
      return objectStorage.read(asset.objectKey);
    },

    async stat(resourceKey) {
      const asset = await mediaRepository.get(resourceKey);
      if (!asset) return null;
      const physical = await objectStorage.stat(asset.objectKey);
      return physical ? { ...physical, key: resourceKey, assetId: asset.id } : null;
    },

    async list(prefix) {
      return mediaRepository.list(prefix);
    },

    async delete(resourceKey) {
      const asset = await mediaRepository.beginDelete(resourceKey);
      if (!asset) return;
      const error = await deletePhysical(asset);
      if (error) throw error;
    },

    async deleteDir(prefix) {
      const assets = await mediaRepository.beginDeletePrefix(prefix);
      const errors = [];
      for (const asset of assets) {
        const error = await deletePhysical(asset);
        if (error) errors.push(error);
      }
      if (errors.length) throw errors[0];
    },
  };
}

export async function reconcileMediaAssets({ objectStorage, mediaRepository }) {
  const report = { found: 0, activated: 0, failed: 0, deleted: 0 };
  const recoverable = await mediaRepository.listRecoverable();
  report.found = recoverable.length;
  for (const asset of recoverable) {
    if (asset.state === 'deleting') {
      try {
        await objectStorage.delete(asset.objectKey);
        await mediaRepository.finishDelete(asset.id);
        report.deleted += 1;
      } catch {
        report.failed += 1;
      }
      continue;
    }
    try {
      const current = await objectStorage.stat(asset.objectKey);
      if (current && current.bytes === asset.bytes && (!current.sha256 || current.sha256 === asset.sha256)) {
        await mediaRepository.activate(asset.id);
        report.activated += 1;
      } else {
        await mediaRepository.fail(asset.id, current ? 'checksum_mismatch' : 'object_missing');
        report.failed += 1;
      }
    } catch {
      report.failed += 1;
    }
  }
  return report;
}
