// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMessagesRouter } from './messages.js';

let app;

function buildApp(opts = {}) {
  const apiKey = 'apiKey' in opts ? opts.apiKey : 'test-key';
  const { fetchImpl = vi.fn(), usage, model = 'gemini-text', retryBaseDelayMs = 0 } = opts;
  app = express();
  app.use(express.json());
  app.use('/api', createMessagesRouter({ apiKey, model, fetchImpl, usage, retryBaseDelayMs }));
}

describe('POST /messages', () => {
  it('calls Gemini with the text api key and returns a compatible response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      }),
    });
    buildApp({ apiKey: 'test-key', fetchImpl });

    const res = await request(app).post('/api/messages').send({ model: 'x', messages: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-text:generateContent',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-goog-api-key': 'test-key' }),
      })
    );
  });

  it('returns 500 when no api key is configured', async () => {
    buildApp({ apiKey: undefined, fetchImpl: vi.fn() });

    const res = await request(app).post('/api/messages').send({});

    expect(res.status).toBe(500);
  });

  it('returns 502 when the upstream request throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    buildApp({ apiKey: 'test-key', fetchImpl });

    const res = await request(app).post('/api/messages').send({ model: 'x', messages: [] });

    expect(res.status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries Gemini generation up to three attempts and returns a successful retry', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('temporary failure 1'))
      .mockRejectedValueOnce(new Error('temporary failure 2'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'recovered' }] }, finishReason: 'STOP' }],
        }),
      });
    buildApp({ fetchImpl });

    const res = await request(app).post('/api/messages').send({ messages: [] });

    expect(res.status).toBe(200);
    expect(res.body.content[0].text).toBe('recovered');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('returns the last Gemini error after three consecutive failures', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('first error'))
      .mockRejectedValueOnce(new Error('second error'))
      .mockRejectedValueOnce(new Error('last error'));
    buildApp({ fetchImpl });

    const res = await request(app).post('/api/messages').send({ messages: [] });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'last error' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('returns a structured overload error when Gemini responds with 503', async () => {
    const upstreamBody = JSON.stringify({
      error: {
        code: 503,
        message: 'This model is currently experiencing high demand.',
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => upstreamBody,
    });
    buildApp({ fetchImpl });

    const res = await request(app).post('/api/messages').send({ messages: [] });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'ai_service_overloaded', upstreamStatus: 503 });
    expect(JSON.stringify(res.body)).not.toContain('high demand');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('returns 502 with the block reason when Gemini rejects the prompt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }),
    });
    buildApp({ apiKey: 'test-key', fetchImpl });

    const res = await request(app).post('/api/messages').send({ messages: [] });

    expect(res.status).toBe(502);
    expect(res.body.error).toContain('SAFETY');
  });

  it('returns 400 when messages is not an array', async () => {
    buildApp({ apiKey: 'k', fetchImpl: vi.fn() });
    const res = await request(app).post('/api/messages').send({ model: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns 502 when the upstream fetch is aborted (timeout)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    buildApp({ apiKey: 'test-key', fetchImpl });

    const res = await request(app).post('/api/messages').send({ model: 'x', messages: [] });

    expect(res.status).toBe(502);
  });

  it('returns 429 when the daily message limit is exhausted', async () => {
    const usage = { consume: async () => ({ ok: false, resetAt: 123 }) };
    buildApp({ usage });
    const res = await request(app).post('/api/messages').send({ messages: [] });
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'daily limit reached', resetAt: 123 });
  });

  it('consumes usage with the messages kind and proceeds when allowed', async () => {
    const consume = vi.fn().mockResolvedValue({ ok: true });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }),
    });
    buildApp({ usage: { consume }, fetchImpl });
    await request(app).post('/api/messages').send({ messages: [] });
    expect(consume).toHaveBeenCalledWith(undefined, 'messages'); // req.userIdはスタブなしなのでundefined
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('returns an error status instead of hanging when usage.consume rejects', async () => {
    const usage = { consume: vi.fn().mockRejectedValue(new Error('disk full')) };
    buildApp({ usage, fetchImpl: vi.fn() });
    const res = await request(app).post('/api/messages').send({ messages: [] });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body).toHaveProperty('error');
  });
});
