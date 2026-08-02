import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { sessionKey, sessionImagePath } from '../storage/paths.js';
import { analyzeScene } from '../sceneAnalysis.js';
import { buildImagePrompt, buildPortraitPrompt } from '../imagePrompt.js';
import { generateImage } from '../imageProvider.js';

const IMAGE_ID_RE = /^img_[A-Za-z0-9-]+$/;

function newImageId() {
  return 'img_' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
}

export function createSceneImagesRouter({
  dataStore,
  imageStore,
  geminiTextApiKey,
  geminiTextModel,
  geminiImageApiKey,
  geminiImageModel,
  fetchImpl = fetch,
  usage,
}) {
  const router = Router();
  router.param('id', idParamGuard);

  router.post('/sessions/:id/images', asyncHandler(async (req, res) => {
    if (!geminiImageApiKey) {
      res.status(501).json({ error: 'image generation is not configured' });
      return;
    }
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    const logIndex = Number(req.body?.logIndex);
    const entry = Number.isInteger(logIndex) ? session.log?.[logIndex] : undefined;
    if (!entry || entry.role !== 'gm') {
      res.status(400).json({ error: 'logIndex must reference a gm log entry' });
      return;
    }
    if (usage) {
      const check = await usage.consume(req.userId, 'images');
      if (!check.ok) {
        res.status(429).json({ error: 'daily limit reached', resetAt: check.resetAt });
        return;
      }
    }
    const registry = session.appearances || {};
    const { presentNames, newAppearances } = await analyzeScene({
      narrative: entry.text,
      registry,
      pcRaw: session.pc?.raw || '',
      apiKey: geminiTextApiKey,
      model: geminiTextModel,
      fetchImpl,
    });
    // 新キャラのポートレートを自動生成(非致命)。1枚=1ユニット消費、上限到達・失敗はスキップ。
    const enrichedNew = [];
    for (const a of newAppearances) {
      let portraitId = null;
      let allowed = true;
      if (usage) {
        try {
          const check = await usage.consume(req.userId, 'images');
          allowed = check.ok;
        } catch {
          allowed = false;
        }
      }
      if (allowed) {
        try {
          const img = await generateImage({
            prompt: buildPortraitPrompt({ name: a.name, description: a.description, moods: session.moods }),
            apiKey: geminiImageApiKey,
            model: geminiImageModel,
            fetchImpl,
          });
          portraitId = newImageId();
          await imageStore.write(sessionImagePath(req.userId, req.params.id, portraitId), Buffer.from(img.base64, 'base64'));
        } catch {
          portraitId = null; // 非致命: テキストのみの一貫性へフォールバック
        }
      }
      enrichedNew.push(portraitId ? { ...a, imageId: portraitId } : a);
    }

    const merged = { ...registry };
    for (const a of enrichedNew) {
      merged[a.name] = { name: a.name, description: a.description, ...(a.imageId ? { imageId: a.imageId } : {}) };
    }
    const appearances = presentNames.map((n) => merged[n]).filter(Boolean);

    // 登場キャラのポートレートを参照画像として集める(最大3枚)
    const referenceImages = [];
    for (const a of appearances) {
      if (referenceImages.length >= 3) break;
      if (!a.imageId) continue;
      const refBuf = await imageStore.read(sessionImagePath(req.userId, req.params.id, a.imageId));
      if (refBuf) referenceImages.push({ base64: refBuf.toString('base64'), mimeType: 'image/png' });
    }

    const prompt = buildImagePrompt({
      narrative: entry.text,
      moods: session.moods,
      appearances,
      hasReferences: referenceImages.length > 0,
    });
    let image;
    try {
      image = await generateImage({
        prompt,
        apiKey: geminiImageApiKey,
        model: geminiImageModel,
        fetchImpl,
        referenceImages,
      });
    } catch {
      res.status(502).json({ error: 'image generation failed', code: 'IMAGE_GENERATION_FAILED' });
      return;
    }
    const imageId = newImageId();
    const buf = Buffer.from(image.base64, 'base64');
    await imageStore.write(sessionImagePath(req.userId, req.params.id, imageId), buf);
    res.json({ imageId, newAppearances: enrichedNew });
  }));

  router.get('/sessions/:id/images/:imageId', asyncHandler(async (req, res) => {
    if (!IMAGE_ID_RE.test(req.params.imageId)) {
      res.status(400).json({ error: 'invalid imageId' });
      return;
    }
    const buf = await imageStore.read(sessionImagePath(req.userId, req.params.id, req.params.imageId));
    if (buf === null) {
      res.status(404).json({ error: 'image not found' });
      return;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.send(buf);
  }));

  return router;
}
