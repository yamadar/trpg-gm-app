import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { generateText, GeminiTextApiError } from '../textProvider.js';

const MESSAGES_TIMEOUT_MS = 120000;
const MAX_GENERATION_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1ターン1行。systemブロックはセッション中不変なので、暗黙キャッシュが効いていれば
// cached が input の大半になる。0が続くなら効いていないと判断できる。
// プロンプト本文は出さない(プレイ内容がログに残るため)。数値だけを残す。
function logUsage(usage) {
  if (!usage) return;
  console.log(
    `[text-usage] input=${usage.input_tokens} cached=${usage.cached_input_tokens} ` +
      `(${(usage.cache_hit_ratio * 100).toFixed(0)}%) output=${usage.output_tokens} ` +
      `thoughts=${usage.thoughts_tokens} total=${usage.total_tokens}`,
  );
}

export function createMessagesRouter({
  apiKey,
  model,
  fetchImpl = fetch,
  usage,
  retryBaseDelayMs = RETRY_BASE_DELAY_MS,
}) {
  const router = Router();

  router.post('/messages', asyncHandler(async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: 'GEMINI_TEXT_API_KEY is not configured on the server' });
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
      for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
        try {
          const data = await generateText({
            apiKey,
            model,
            request: req.body,
            fetchImpl,
            timeoutMs: MESSAGES_TIMEOUT_MS,
          });
          logUsage(data.usage);
          res.json(data);
          return;
        } catch (e) {
          if (attempt === MAX_GENERATION_ATTEMPTS) throw e;
          await wait(retryBaseDelayMs * attempt);
        }
      }
    } catch (e) {
      if (e instanceof GeminiTextApiError && (e.status === 429 || e.status === 503)) {
        const error = e.status === 429 ? 'ai_service_rate_limited' : 'ai_service_overloaded';
        res.status(502).json({ error, upstreamStatus: e.status });
        return;
      }
      const status = e instanceof GeminiTextApiError && e.status >= 400 && e.status < 500 ? e.status : 502;
      res.status(status).json({ error: e.message });
    }
  }));

  return router;
}
