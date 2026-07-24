import { Router } from 'express';
import { saveCampaign, getCampaign, listCampaigns } from '../storage/campaignLibrary.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';

export function createCampaignsRouter({ dataStore }) {
  const router = Router();
  router.param('worldId', idParamGuard);
  router.param('id', idParamGuard);

  router.get('/worlds/:worldId/campaigns', asyncHandler(async (req, res) => {
    res.json(await listCampaigns(dataStore, req.userId, req.params.worldId));
  }));

  router.get('/worlds/:worldId/campaigns/:id', asyncHandler(async (req, res) => {
    const campaign = await getCampaign(dataStore, req.userId, req.params.worldId, req.params.id);
    if (!campaign) {
      res.status(404).json({ error: 'campaign not found' });
      return;
    }
    res.json(campaign);
  }));

  router.put('/worlds/:worldId/campaigns/:id', asyncHandler(async (req, res) => {
    const { title, carriedPc, chapters } = req.body || {};
    if (typeof title !== 'string' || typeof carriedPc?.raw !== 'string' || typeof carriedPc?.xp !== 'number') {
      res.status(400).json({ error: 'title and carriedPc { raw, xp } are required' });
      return;
    }
    const campaign = await saveCampaign(dataStore, req.userId, {
      id: req.params.id,
      worldId: req.params.worldId,
      title,
      carriedPc,
      chapters,
    });
    res.json(campaign);
  }));

  return router;
}
