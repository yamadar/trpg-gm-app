import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';

const MESSAGES_TIMEOUT_MS = 120000;

export function createMessagesRouter({ apiKey, fetchImpl = fetch, usage }) {
  const router = Router();

  router.post('/messages', asyncHandler(async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
      return;
    }
    if (!Array.isArray(req.body?.messages)) {
      res.status(400).json({ error: 'messages must be an array' });
      return;
    }
    if (Number(req.body.max_tokens) > 16000) {
      res.status(400).json({ error: 'max_tokens too large' });
      return;
    }
    if (usage) {
      let check;
      try {
        check = await usage.consume(req.userId, 'messages');
      } catch (e) {
        res.status(502).json({ error: `usage check failed: ${e.message}` });
        return;
      }
      if (!check.ok) {
        res.status(429).json({ error: 'daily limit reached', resetAt: check.resetAt });
        return;
      }
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
        signal: AbortSignal.timeout(MESSAGES_TIMEOUT_MS),
      });
      const text = await upstream.text();
      res.status(upstream.status);
      res.setHeader('Content-Type', 'application/json');
      res.send(text);
    } catch (e) {
      res.status(502).json({ error: `upstream request failed: ${e.message}` });
    }
  }));

  return router;
}
