// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createConfigRouter } from './config.js';

function buildApp(opts) {
  const app = express();
  app.use('/api', createConfigRouter(opts));
  return app;
}

describe('GET /config', () => {
  it('reports imageGen true when enabled', async () => {
    const res = await request(buildApp({ imageGenEnabled: true })).get('/api/config');
    expect(res.body).toEqual({ imageGen: true });
  });
  it('reports imageGen false when disabled', async () => {
    const res = await request(buildApp({ imageGenEnabled: false })).get('/api/config');
    expect(res.body).toEqual({ imageGen: false });
  });
});
