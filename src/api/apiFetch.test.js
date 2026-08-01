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

  it('returns undefined for a successful response without content', async () => {
    stubFetch(204, '');
    await expect(apiFetch('/api/x', { method: 'DELETE' })).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/x', {
      method: 'DELETE',
      headers: { 'X-GMDesk-CSRF': '1' },
    });
  });

  it('preserves caller headers and adds the CSRF header to mutations only', async () => {
    stubFetch(200, '{}');
    await apiFetch('/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(fetch).toHaveBeenCalledWith('/api/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-GMDesk-CSRF': '1' },
    });
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

  it('does not map an unrelated 429 to the user daily-limit message', async () => {
    stubFetch(429, '{"error":"upstream rate limited"}');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toContain('AIサービス側の利用枠');
    expect(err.message).not.toContain('本日のAI利用上限');
    expect(err.status).toBe(429);
  });

  it('maps a structured upstream rate-limit error to an AI service message', async () => {
    stubFetch(502, '{"error":"ai_service_rate_limited","upstreamStatus":429}');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toContain('AIサービス側の利用枠');
    expect(err.message).not.toContain('本日のAI利用上限');
    expect(err.status).toBe(502);
  });

  it('maps 502 to a retry message without exposing an html response', async () => {
    stubFetch(502, '<!DOCTYPE html><html><title>502</title></html>');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toBe(
      'サーバーが一時的に応答できません。少し時間をおいてから、もう一度お試しください。'
    );
    expect(err.message).not.toContain('<!DOCTYPE html>');
    expect(err.status).toBe(502);
  });

  it('maps 503 to a retry message without exposing the response body', async () => {
    stubFetch(503, '{"error":{"message":"high demand"}}');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toBe(
      'サーバーが一時的に応答できません。少し時間をおいてから、もう一度お試しください。'
    );
    expect(err.message).not.toContain('high demand');
    expect(err.status).toBe(503);
  });

  it('keeps the generic message for other errors', async () => {
    stubFetch(500, 'boom');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toContain('API error 500');
    expect(err.status).toBe(500);
  });

  it('does not expose an html response for other error statuses', async () => {
    stubFetch(500, '  <html><body>internal proxy error</body></html>');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.message).toBe('API error 500');
    expect(err.message).not.toContain('<html>');
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

  // JSONとしては妥当でも構造を持たない本文は、添えると呼び出し側の err.body?.error が
  // 「本文なし」と区別できなくなる。素の値は本文なしと同じ扱いにする。
  it('leaves the body null for json payloads that are not objects', async () => {
    for (const payload of ['"boom"', '123', 'true', 'null']) {
      stubFetch(500, payload);
      const err = await apiFetch('/api/x').catch((e) => e);
      expect(err.body).toBeNull();
    }
  });

  it('attaches a json array error body', async () => {
    stubFetch(422, '[{"field":"title"}]');
    const err = await apiFetch('/api/x').catch((e) => e);
    expect(err.body).toEqual([{ field: 'title' }]);
  });
});
