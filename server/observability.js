import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage();

// Only operational metadata: never prompts, responses, headers, query strings or error messages.
const FIELDS = new Set([
  'requestId', 'sessionId', 'roundId', 'resolutionId', 'phase', 'stage', 'model',
  'durationMs', 'waitMs', 'status', 'method', 'route', 'errorName', 'errorCode',
  'reason', 'inputTokens', 'outputTokens', 'thinkingTokens', 'inputChars', 'outputChars',
  'attempt', 'eventSeq', 'retry',
]);

export function createLogger(write = (line) => process.stdout.write(line + '\n')) {
  return (event, fields = {}) => {
    const safe = Object.fromEntries(Object.entries(fields).filter(([key, value]) => (
      FIELDS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)
    )).map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 200) : value]));
    try { write(JSON.stringify({ timestamp: new Date().toISOString(), event, ...requestContext.getStore(), ...safe })); } catch { /* logging must not interrupt play */ }
  };
}

export const logEvent = createLogger();

export function errorMetadata(error) {
  return {
    errorName: error?.name || 'Error',
    errorCode: error?.code || 'UNCLASSIFIED',
    status: error?.status,
    reason: error?.reason,
  };
}

export function requestLogging(logger = logEvent) {
  return (req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.set('X-Request-ID', req.requestId);
    const started = performance.now();
    let finished = false;
    const record = (event) => {
      if (finished) return;
      finished = true;
      logger(event, {
        requestId: req.requestId, method: req.method,
        sessionId: req.route?.path?.startsWith('/party-sessions/:id') ? req.params.id : undefined,
        route: req.route?.path || '(unmatched)', status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      });
    };
    res.once('finish', () => record('http.completed'));
    res.once('close', () => record('http.disconnected'));
    requestContext.run({ requestId: req.requestId }, next);
  };
}
