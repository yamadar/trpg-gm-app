import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { sessionKey, sessionImagePath } from '../storage/paths.js';
import { analyzeScene } from '../sceneAnalysis.js';
import { buildImagePrompt } from '../imagePrompt.js';
import { generateImage } from '../imageProvider.js';

const IMAGE_ID_RE = /^img_[A-Za-z0-9-]+$/;

export function createSceneImagesRouter({ dataStore, imageStore, anthropicApiKey, geminiApiKey, geminiModel, fetchImpl = fetch, usage }) {
  const router = Router();
  router.param('id', idParamGuard);

  router.post('/sessions/:id/images', asyncHandler(async (req, res) => {
    if (!geminiApiKey) {
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
      apiKey: anthropicApiKey,
      fetchImpl,
    });
    const merged = { ...registry };
    for (const a of newAppearances) merged[a.name] = { name: a.name, description: a.description };
    const appearances = presentNames.map((n) => merged[n]).filter(Boolean);

    const prompt = buildImagePrompt({ narrative: entry.text, moods: session.moods, appearances });
    let image;
    try {
      image = await generateImage({ prompt, apiKey: geminiApiKey, model: geminiModel, fetchImpl });
    } catch (e) {
      res.status(502).json({ error: `image generation failed: ${e.message}` });
      return;
    }
    const imageId = 'img_' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const buf = Buffer.from(image.base64, 'base64');
    await imageStore.write(sessionImagePath(req.userId, req.params.id, imageId), buf);
    res.json({ imageId, newAppearances });
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
