import { Router } from 'express';

export function createMessagesRouter({ apiKey, fetchImpl = fetch }) {
  const router = Router();

  router.post('/messages', async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
      return;
    }
    try {
      const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(req.body),
      });
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader('Content-Type', 'application/json');
      res.send(text);
    } catch (e) {
      res.status(502).json({ error: `upstream request failed: ${e.message}` });
    }
  });

  return router;
}
