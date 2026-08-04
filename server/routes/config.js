import { Router } from 'express';

export function createConfigRouter({ imageGenEnabled = false, maintenanceMode = 'off' } = {}) {
  const router = Router();
  router.get('/config', (req, res) => {
    // 保守切替は起動中のクライアントにも早く反映させる。古いoff応答がブラウザや
    // CDNに残ると、更新操作を試すまでバナーが出ないためキャッシュさせない。
    res.set('Cache-Control', 'no-store');
    res.json({
      imageGen: !!imageGenEnabled,
      maintenanceMode,
    });
  });
  return router;
}
