// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLogger, requestLogging } from './observability.js';
import { generateText } from './textProvider.js';

describe('operational logs', () => {
  it('links HTTP completion to its response without recording query strings or headers', async () => {
    const lines = [];
    const app = express();
    app.use(requestLogging(createLogger((line) => lines.push(JSON.parse(line)))));
    app.get('/party-sessions/:id/snapshot', (_req, res) => res.json({ ok: true }));
    const res = await request(app).get('/party-sessions/p1/snapshot?inviteToken=SECRET').set('Cookie', 'SECRET');
    expect(lines).toEqual([expect.objectContaining({ event: 'http.completed', requestId: res.headers['x-request-id'], sessionId: 'p1', route: '/party-sessions/:id/snapshot', status: 200, durationMs: expect.any(Number) })]);
    expect(JSON.stringify(lines)).not.toContain('SECRET');
  });

  it('measures provider stages and usage, and records failures without provider response bodies', async () => {
    const lines = [];
    const logger = createLogger((line) => lines.push(JSON.parse(line)));
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'SECRET narrative' }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 30 },
    }) });
    const args = { apiKey: 'SECRET', model: 'model', logger, fetchImpl, telemetry: { sessionId: 'p1', roundId: 'r1', resolutionId: 'job1', stage: 'narrating' }, request: { system: 'SECRET prompt', messages: [] } };
    await generateText(args);
    expect(lines.at(-1)).toMatchObject({ event: 'ai.completed', resolutionId: 'job1', stage: 'narrating', durationMs: expect.any(Number), inputTokens: 10, outputTokens: 20, thinkingTokens: 30 });
    fetchImpl.mockResolvedValue({ ok: false, status: 503, text: async () => 'SECRET provider body' });
    await expect(generateText(args)).rejects.toMatchObject({ status: 503 });
    expect(lines.at(-1)).toMatchObject({ event: 'ai.failed', status: 503, errorName: 'GeminiTextApiError' });
    logger('test', { prompt: 'SECRET', headers: 'SECRET', body: 'SECRET' });
    expect(JSON.stringify(lines)).not.toContain('SECRET');
  });
});
