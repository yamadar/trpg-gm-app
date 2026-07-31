import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard, kindParamGuard } from './validateId.js';
import { processUploadedImage, MAX_IMAGE_BYTES } from '../imageProcessing.js';
import {
  addAttachment,
  deleteAttachment,
  deleteAttachmentCollection,
  getAttachmentCollection,
  readAttachmentVariant,
  setTopAttachment,
  updateAttachmentDescription,
} from '../storage/attachmentLibrary.js';
import {
  characterAttachmentDir,
  characterMetaKey,
  novelAttachmentDir,
  profileImageDir,
  scenarioAttachmentDir,
  scenarioMetaKey,
  sessionNovelDocPath,
  worldAttachmentDir,
  worldMetaKey,
} from '../storage/paths.js';
import { getUser, updateUserProfile } from '../auth/users.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 2 },
});

function singleUpload(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'image must be at most 10 MB' : error.message });
  });
}

function contentType(res) {
  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
}

export function createAttachmentsRouter({ dataStore, textStore, imageStore }) {
  const router = Router();
  for (const name of ['worldId', 'scenarioId', 'name', 'sessionId', 'attachmentId']) {
    router.param(name, idParamGuard);
  }
  router.param('kind', kindParamGuard);

  const owners = [
    {
      prefix: '/worlds/:worldId',
      dir: (req) => worldAttachmentDir(req.userId, req.params.worldId),
      exists: (req) => dataStore.get(worldMetaKey(req.userId, req.params.worldId)),
    },
    {
      prefix: '/worlds/:worldId/scenarios/:scenarioId',
      dir: (req) => scenarioAttachmentDir(req.userId, req.params.worldId, req.params.scenarioId),
      exists: (req) => dataStore.get(scenarioMetaKey(req.userId, req.params.worldId, req.params.scenarioId)),
    },
    {
      prefix: '/worlds/:worldId/characters/:kind/:name',
      dir: (req) => characterAttachmentDir(req.userId, req.params.worldId, req.params.kind, req.params.name),
      exists: (req) => dataStore.get(characterMetaKey(req.userId, req.params.worldId, req.params.kind, req.params.name)),
    },
    {
      prefix: '/sessions/:sessionId/novel',
      dir: (req) => novelAttachmentDir(req.userId, req.params.sessionId),
      exists: async (req) => (await textStore.read(sessionNovelDocPath(req.userId, req.params.sessionId))) !== null,
    },
  ];

  for (const owner of owners) {
    const ensureOwner = async (req, res) => {
      if (await owner.exists(req)) return true;
      res.status(404).json({ error: 'attachment owner not found' });
      return false;
    };

    router.get(`${owner.prefix}/attachments`, asyncHandler(async (req, res) => {
      if (!(await ensureOwner(req, res))) return;
      res.json(await getAttachmentCollection(dataStore, owner.dir(req)));
    }));

    router.post(`${owner.prefix}/attachments`, singleUpload, asyncHandler(async (req, res) => {
      if (!(await ensureOwner(req, res))) return;
      const processed = await processUploadedImage(req.file?.buffer);
      const result = await addAttachment(dataStore, imageStore, owner.dir(req), processed, {
        description: req.body?.description,
      });
      res.status(201).json(result);
    }));

    router.patch(`${owner.prefix}/attachments/:attachmentId`, asyncHandler(async (req, res) => {
      if (!(await ensureOwner(req, res))) return;
      const result = await updateAttachmentDescription(
        dataStore,
        owner.dir(req),
        req.params.attachmentId,
        req.body?.description,
      );
      if (!result) {
        res.status(404).json({ error: 'attachment not found' });
        return;
      }
      res.json(result);
    }));

    router.delete(`${owner.prefix}/attachments/:attachmentId`, asyncHandler(async (req, res) => {
      if (!(await ensureOwner(req, res))) return;
      const deleted = await deleteAttachment(dataStore, imageStore, owner.dir(req), req.params.attachmentId);
      if (!deleted) {
        res.status(404).json({ error: 'attachment not found' });
        return;
      }
      res.status(204).end();
    }));

    router.put(`${owner.prefix}/attachments/top`, asyncHandler(async (req, res) => {
      if (!(await ensureOwner(req, res))) return;
      const imageId = req.body?.imageId ?? null;
      if (imageId !== null && typeof imageId !== 'string') {
        res.status(400).json({ error: 'imageId must be a string or null' });
        return;
      }
      const collection = await setTopAttachment(dataStore, owner.dir(req), imageId);
      if (!collection) {
        res.status(400).json({ error: 'top image must belong to this item' });
        return;
      }
      res.json(collection);
    }));

    router.get(`${owner.prefix}/attachments/:attachmentId/:variant`, asyncHandler(async (req, res) => {
      if (!(await ensureOwner(req, res))) return;
      const image = await readAttachmentVariant(
        dataStore,
        imageStore,
        owner.dir(req),
        req.params.attachmentId,
        req.params.variant,
      );
      if (!image) {
        res.status(404).json({ error: 'attachment not found' });
        return;
      }
      contentType(res);
      res.send(image);
    }));
  }

  router.get('/me/profile-image', asyncHandler(async (req, res) => {
    res.json(await getAttachmentCollection(dataStore, profileImageDir(req.userId)));
  }));

  router.post('/me/profile-image', singleUpload, asyncHandler(async (req, res) => {
    const processed = await processUploadedImage(req.file?.buffer, { profile: true });
    const result = await addAttachment(dataStore, imageStore, profileImageDir(req.userId), processed, {
      replace: true,
      makeTop: true,
    });
    await updateUserProfile(dataStore, req.userId, {});
    res.status(201).json({ ...result, user: await getUser(dataStore, req.userId) });
  }));

  router.delete('/me/profile-image', asyncHandler(async (req, res) => {
    await deleteAttachmentCollection(dataStore, imageStore, profileImageDir(req.userId));
    await updateUserProfile(dataStore, req.userId, {});
    res.json({ user: await getUser(dataStore, req.userId) });
  }));

  return router;
}
