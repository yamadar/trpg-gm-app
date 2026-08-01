// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import {
  buildTextOperationRequest,
  createTextOperationsRouter,
  estimateTextOperationTokens,
} from './textOperations.js';

function buildApp(opts = {}) {
  const app = express();
  const apiKey = 'apiKey' in opts ? opts.apiKey : 'test-key';
  const {
    fetchImpl = vi.fn(),
    usage,
    model = 'gemini-text',
    maxConcurrent = 6,
    retryBaseDelayMs = 0,
  } = opts;
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createTextOperationsRouter({
    apiKey,
    model,
    fetchImpl,
    usage,
    maxConcurrent,
    retryBaseDelayMs,
  }));
  return app;
}

function successfulFetch(text = 'hi') {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    }),
  });
}

describe('POST /text-operations/:operation', () => {
  it('builds a fixed request and calls Gemini with the server model', async () => {
    const fetchImpl = successfulFetch();
    const app = buildApp({ fetchImpl });

    const res = await request(app)
      .post('/api/text-operations/summarize-world')
      .send({ input: { raw: '世界資料' }, max_tokens: 99_999, system: '攻撃者の指示' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' });
    const [, options] = fetchImpl.mock.calls[0];
    const upstream = JSON.parse(options.body);
    expect(upstream.generationConfig.maxOutputTokens).toBe(2000);
    expect(JSON.stringify(upstream)).not.toContain('攻撃者の指示');
    expect(fetchImpl.mock.calls[0][0]).toContain('/models/gemini-text:generateContent');
  });

  it('does not expose a generic messages endpoint', async () => {
    const app = buildApp({ fetchImpl: successfulFetch() });
    const res = await request(app).post('/api/messages').send({ messages: [] });
    expect(res.status).toBe(404);
  });

  it('rejects unknown operations and oversized operation input', async () => {
    const app = buildApp({ fetchImpl: successfulFetch() });
    const unknown = await request(app).post('/api/text-operations/arbitrary').send({ input: {} });
    const oversized = await request(app)
      .post('/api/text-operations/summarize-world')
      .send({ input: { raw: 'x'.repeat(500_001) } });
    expect(unknown.status).toBe(404);
    expect(oversized.status).toBe(400);
  });

  it('rejects client-controlled tool definitions and only enables the fixed roll tool', () => {
    const session = {
      world: { summary: '世界' },
      scenario: { raw: 'シナリオ' },
      pc: { raw: 'PC' },
      state: {
        flags: {},
        recent_log: [],
        current_scene: '導入',
        history_summary: '',
      },
      ruleset: { formula: 'd100' },
    };
    const built = buildTextOperationRequest('take-turn', {
      session,
      playerText: '調べる',
      allowRoll: true,
      tools: [{ name: 'arbitrary_proxy' }],
    });
    expect(built.tools.map((tool) => tool.name)).toEqual(['roll_check']);
    expect(built.max_tokens).toBe(2000);
  });

  it('returns a fixed error when no API key is configured', async () => {
    const app = buildApp({ apiKey: undefined });
    const res = await request(app)
      .post('/api/text-operations/summarize-world')
      .send({ input: { raw: '世界' } });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'ai_service_unavailable' });
  });

  it('does not retry ambiguous network failures and hides their messages', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('temporary secret 1'))
      .mockRejectedValueOnce(new Error('temporary secret 2'))
      .mockRejectedValueOnce(new Error('last upstream secret'));
    const app = buildApp({ fetchImpl });
    const res = await request(app)
      .post('/api/text-operations/summarize-world')
      .send({ input: { raw: '世界' } });
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'ai_service_error' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry deterministic Gemini 400 errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: 'invalid request secret' } }),
    });
    const app = buildApp({ fetchImpl });
    const res = await request(app)
      .post('/api/text-operations/summarize-world')
      .send({ input: { raw: '世界' } });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'ai_service_error' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns structured overload and rate-limit errors', async () => {
    for (const status of [429, 503]) {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: false,
        status,
        text: async () => JSON.stringify({ error: { message: 'upstream detail' } }),
      });
      const app = buildApp({ fetchImpl });
      const res = await request(app)
        .post('/api/text-operations/summarize-world')
        .send({ input: { raw: '世界' } });
      expect(res.status).toBe(502);
      expect(res.body).toEqual({
        error: status === 429 ? 'ai_service_rate_limited' : 'ai_service_overloaded',
        upstreamStatus: status,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(status === 503 ? 3 : 1);
    }
  });

  it('charges call, user token, and global token budgets', async () => {
    const consume = vi.fn().mockResolvedValue({ ok: true });
    const consumeGlobal = vi.fn().mockResolvedValue({ ok: true });
    const app = buildApp({ usage: { consume, consumeGlobal }, fetchImpl: successfulFetch() });
    await request(app)
      .post('/api/text-operations/summarize-world')
      .send({ input: { raw: '世界' } });
    const reservedTokens = estimateTextOperationTokens(
      buildTextOperationRequest('summarize-world', { raw: '世界' }),
    );
    expect(consume).toHaveBeenNthCalledWith(1, undefined, 'messages', 1);
    expect(reservedTokens).toBeGreaterThan(2000);
    expect(consume).toHaveBeenNthCalledWith(2, undefined, 'textTokens', reservedTokens);
    expect(consumeGlobal).toHaveBeenCalledWith('textTokens', reservedTokens);
  });

  it('rejects exhausted budgets before calling Gemini', async () => {
    const fetchImpl = successfulFetch();
    const usage = {
      consume: vi.fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: false, resetAt: 123 }),
      consumeGlobal: vi.fn().mockResolvedValue({ ok: true }),
    };
    const app = buildApp({ usage, fetchImpl });
    const res = await request(app)
      .post('/api/text-operations/summarize-world')
      .send({ input: { raw: '世界' } });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'daily limit reached', resetAt: 123 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caps concurrent upstream generations', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const fetchImpl = vi.fn().mockImplementation(() => pending);
    const app = buildApp({ fetchImpl, maxConcurrent: 1 });
    const first = request(app)
      .post('/api/text-operations/summarize-world')
      .send({ input: { raw: '世界1' } })
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await request(app)
      .post('/api/text-operations/summarize-world')
      .send({ input: { raw: '世界2' } });
    expect(second.status).toBe(503);
    expect(second.body).toEqual({ error: 'ai_service_busy' });
    release({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    });
    expect((await first).status).toBe(200);
  });
});
