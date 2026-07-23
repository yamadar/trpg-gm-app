// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMessagesRouter } from './messages.js';

let app;

function buildApp(opts = {}) {
  const apiKey = 'apiKey' in opts ? opts.apiKey : 'test-key';
  const { fetchImpl = vi.fn(), usage } = opts;
  app = express();
  app.use(express.json());
  app.use('/api', createMessagesRouter({ apiKey, fetchImpl, usage }));
}

describe('POST /messages', () => {
  it('proxies to Anthropic with the api key header and returns the upstream body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }),
    });
    buildApp({ apiKey: 'test-key', fetchImpl });

    const res = await request(app).post('/api/messages').send({ model: 'x', messages: [] });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ content: [{ type: 'text', text: 'hi' }] });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
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
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200, text: async () => '{}' });
    buildApp({ usage: { consume }, fetchImpl });
    await request(app).post('/api/messages').send({ messages: [] });
    expect(consume).toHaveBeenCalledWith(undefined, 'messages'); // req.userIdはスタブなしなのでundefined
    expect(fetchImpl).toHaveBeenCalled();
  });
});
