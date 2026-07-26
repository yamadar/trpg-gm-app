import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetch } from './apiFetch.js';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status, body = '{}') {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(body),
    text: async () => body,
  }));
}

describe('apiFetch', () => {
  it('returns parsed json on success', async () => {
    stubFetch(200, '{"a":1}');
    expect(await apiFetch('/api/x')).toEqual({ a: 1 });
  });

  it('maps 401 to a login-required message', async () => {
    stubFetch(401, '{"error":"login required"}');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toContain('ログインが必要');
    expect(err.status).toBe(401);
  });

  it('maps 429 to a daily-limit message', async () => {
    stubFetch(429, '{"error":"daily limit reached","resetAt":1}');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toContain('本日のAI利用上限');
    expect(err.status).toBe(429);
  });

  it('keeps the generic message for other errors', async () => {
    stubFetch(500, 'boom');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toContain('API error 500');
    expect(err.status).toBe(500);
  });

  // 呼び出し側が message の文字列一致ではなくエラー種別で分岐できるようにする
  // (公開ギャラリーの取り込みは already_imported を見て確認モーダルを出す)。
  it('attaches the parsed json error body to the thrown error', async () => {
    stubFetch(409, '{"error":"already_imported","existing":{"id":"untitled"}}');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.body).toEqual({ error: 'already_imported', existing: { id: 'untitled' } });
  });

  it('leaves the body null when the error payload is not json', async () => {
    stubFetch(500, 'boom');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.body).toBeNull();
  });
});
