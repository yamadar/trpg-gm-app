import { Router } from 'express';

export function createConfigRouter({ imageGenEnabled = false } = {}) {
  const router = Router();
  router.get('/config', (req, res) => {
    res.json({ imageGen: !!imageGenEnabled });
  });
  return router;
}
