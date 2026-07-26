// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApp } from './index.js';

let dir;
let dataDir;
let staticDir;

const INDEX_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';

async function buildStaticDir() {
  await fs.mkdir(path.join(staticDir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(staticDir, 'index.html'), INDEX_HTML);
  await fs.writeFile(path.join(staticDir, 'assets', 'app.js'), 'export default 1;\n');
}

function buildApp({ withStatic = true } = {}) {
  return createApp({
    apiKey: 'test-key',
    env: { BASE_URL: 'http://localhost:5173' },
    dataDir,
    staticDir: withStatic ? staticDir : null,
  });
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'static-serving-'));
  dataDir = path.join(dir, 'data');
  staticDir = path.join(dir, 'dist');
  await buildStaticDir();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('static serving', () => {
  it('serves index.html at the root', async () => {
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('id="root"');
  });

  it('serves built assets', async () => {
    const res = await request(buildApp()).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('export default 1;');
  });

  it('falls back to index.html for unknown client routes', async () => {
    const res = await request(buildApp()).get('/library');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('does not shadow public API routes', async () => {
    const res = await request(buildApp()).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ imageGen: false });
  });

  // 認証必須APIの401や未知APIの404がSPAのHTMLに化けると、クライアントが
  // ログイン切れを検知できなくなる。/api・/auth 配下はフォールバック対象外。
  it('keeps authenticated API routes returning JSON 401, not HTML', async () => {
    const res = await request(buildApp()).get('/api/sessions');
    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  // Expressの既定404ページ自体がtext/htmlなので、SPAシェルが返っていないことは
  // ステータスと本文で判定する。
  it('does not fall back for unknown /auth paths', async () => {
    const res = await request(buildApp()).get('/auth/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.text).not.toContain('id="root"');
  });

  it('does not fall back for non-GET requests to unknown paths', async () => {
    const res = await request(buildApp()).post('/library');
    expect(res.status).toBe(404);
  });

  it('serves nothing when no staticDir is configured (dev: Vite serves the client)', async () => {
    const res = await request(buildApp({ withStatic: false })).get('/');
    expect(res.status).toBe(404);
  });
});
