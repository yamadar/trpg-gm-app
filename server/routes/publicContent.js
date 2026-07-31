import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { queryPublic, getPublicWorld, getPublicItem } from '../storage/shareLibrary.js';
import { getUser } from '../auth/users.js';
import {
  profileImageDir,
  publicAttachmentDir,
  publicMetaKey,
  publicNovelImagePath,
  starterManifestKey,
} from '../storage/paths.js';
import { readAttachmentVariant } from '../storage/attachmentLibrary.js';

const TYPES = new Set(['worlds', 'characters', 'scenarios', 'novels']);

export function createPublicContentRouter({ dataStore, textStore, imageStore }) {
  const router = Router();
  router.param('publicId', idParamGuard);
  router.param('imageId', idParamGuard);

  // 未シードは正常系。404にすると「まだ無い」を UI がエラーとして扱わざるを得なくなる。
  router.get('/starters', asyncHandler(async (req, res) => {
    res.json((await dataStore.get(starterManifestKey())) ?? { packs: [], seededAt: null });
  }));

  router.get('/public/:type', asyncHandler(async (req, res) => {
    if (!TYPES.has(req.params.type)) {
      res.status(404).json({ error: 'unknown type' });
      return;
    }
    const moods = String(req.query.moods ?? '').split(',').filter(Boolean);
    res.json(
      await queryPublic(
        dataStore,
        req.params.type,
        {
          q: req.query.q,
          moods,
          ruleset: req.query.ruleset || undefined,
          ownerId: req.query.ownerId || undefined,
          limit: req.query.limit,
          offset: req.query.offset,
        },
        textStore
      )
    );
  }));

  router.get('/public/novels/:publicId/images/:imageId', asyncHandler(async (req, res) => {
    const meta = await dataStore.get(publicMetaKey('novels', req.params.publicId));
    if (!meta || !Array.isArray(meta.imageIds) || !meta.imageIds.includes(req.params.imageId) || !imageStore) {
      res.status(404).json({ error: 'image not found' });
      return;
    }
    const image = await imageStore.read(publicNovelImagePath(req.params.publicId, req.params.imageId));
    if (!image) {
      res.status(404).json({ error: 'image not found' });
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(image);
  }));

  router.get('/public/:type/:publicId/attachments/:imageId/:variant', asyncHandler(async (req, res) => {
    if (!TYPES.has(req.params.type)) {
      res.status(404).json({ error: 'unknown type' });
      return;
    }
    const meta = await dataStore.get(publicMetaKey(req.params.type, req.params.publicId));
    if (!meta || !Array.isArray(meta.attachments) || !meta.attachments.some((item) => item.id === req.params.imageId)) {
      res.status(404).json({ error: 'attachment not found' });
      return;
    }
    const image = await readAttachmentVariant(
      dataStore,
      imageStore,
      publicAttachmentDir(req.params.type, req.params.publicId),
      req.params.imageId,
      req.params.variant,
    );
    if (!image) {
      res.status(404).json({ error: 'attachment not found' });
      return;
    }
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(image);
  }));

  router.get('/public/:type/:publicId', asyncHandler(async (req, res) => {
    const { type, publicId } = req.params;
    if (!TYPES.has(type)) {
      res.status(404).json({ error: 'unknown type' });
      return;
    }
    const item = type === 'worlds'
      ? await getPublicWorld(dataStore, textStore, publicId)
      : await getPublicItem(dataStore, textStore, type, publicId);
    if (!item) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(item);
  }));

  router.param('userId', idParamGuard);

  router.get('/users/:userId', asyncHandler(async (req, res) => {
    const user = await getUser(dataStore, req.params.userId);
    if (!user) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    res.json({ id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl, bio: user.bio });
  }));

  router.get('/users/:userId/profile-image/:imageId/:variant', asyncHandler(async (req, res) => {
    const user = await getUser(dataStore, req.params.userId);
    if (!user) {
      res.status(404).json({ error: 'user not found' });
      return;
    }
    const image = await readAttachmentVariant(
      dataStore,
      imageStore,
      profileImageDir(req.params.userId),
      req.params.imageId,
      req.params.variant,
    );
    if (!image) {
      res.status(404).json({ error: 'profile image not found' });
      return;
    }
    res.setHeader('Content-Type', 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(image);
  }));

  return router;
}
