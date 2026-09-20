import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage();
export const textGenerationContext = () => context.getStore();
export const withTextGenerationContext = (value, operation) => context.run(value, operation);

export function createTextLimiter(maxConcurrent = 6) {
  let active = 0;
  return async (operation) => {
    if (active >= maxConcurrent) throw Object.assign(new Error('ai_service_busy'), { status: 503, code: 'AI_BUSY' });
    active += 1;
    try { return await operation(); } finally { active -= 1; }
  };
}

export function rethrowTextLimit(error) {
  if (['AI_BUSY', 'AI_DAILY_LIMIT'].includes(error?.code)) throw error;
}
