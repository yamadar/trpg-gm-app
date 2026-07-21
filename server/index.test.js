// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';

let dir;
let app;
let fetchImpl;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'app-test-'));
  fetchImpl = vi.fn().mockResolvedValue({ status: 200, text: async () => '{}' });
  app = createApp({ apiKey: 'test-key', dataDir: dir, fetchImpl });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('createApp', () => {
  it('mounts the messages route and proxies via the injected fetchImpl', async () => {
    const res = await request(app).post('/api/messages').send({});
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.anything());
  });

  it('mounts the sessions route', async () => {
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('mounts the worlds route', async () => {
    const res = await request(app).get('/api/worlds');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('mounts the rulesets route', async () => {
    const res = await request(app).get('/api/rulesets');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('404s on unknown routes', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
  });
});
