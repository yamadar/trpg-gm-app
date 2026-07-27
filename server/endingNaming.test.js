// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { nameEnding } from './endingNaming.js';

const SESSION = {
  id: 's1',
  title: '星降りの夜に',
  pc: { raw: '探索者アリス', goal: '真実を知る', bonds: '妹' },
  state: { history_summary: '廃坑の奥で灯りが消えた。' },
  log: [
    { role: 'gm', text: '一つ目の場面' },
    { role: 'player', text: '進む' },
    { role: 'gm', text: '最後の場面' },
  ],
};

function okFetch(payload) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: 'STOP' }],
    }),
  });
}

describe('nameEnding', () => {
  it('returns the title and summary produced by the model', async () => {
    const fetchImpl = okFetch({ ending_title: '灰は星を数えない', summary: '彼女は坑道を出た。夜は明けなかった。' });
    const out = await nameEnding({ session: SESSION, apiKey: 'k', fetchImpl });
    expect(out).toEqual({ endingTitle: '灰は星を数えない', summary: '彼女は坑道を出た。夜は明けなかった。' });
  });

  it('sends the story summary, the PC and the closing narration', async () => {
    const fetchImpl = okFetch({ ending_title: 'a', summary: 'b' });
    await nameEnding({ session: SESSION, apiKey: 'k', fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.contents[0].parts[0].text).toContain('廃坑の奥で灯りが消えた。');
    expect(body.contents[0].parts[0].text).toContain('探索者アリス');
    expect(body.contents[0].parts[0].text).toContain('最後の場面');
  });

  it('asks for structured output with both fields required', async () => {
    const fetchImpl = okFetch({ ending_title: 'a', summary: 'b' });
    await nameEnding({ session: SESSION, apiKey: 'k', fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.generationConfig.responseJsonSchema.required).toEqual(['ending_title', 'summary']);
  });

  it('trims whitespace around the model output', async () => {
    const fetchImpl = okFetch({ ending_title: '  題  ', summary: '  総括  ' });
    const out = await nameEnding({ session: SESSION, apiKey: 'k', fetchImpl });
    expect(out).toEqual({ endingTitle: '題', summary: '総括' });
  });

  it('throws when the upstream call fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(nameEnding({ session: SESSION, apiKey: 'k', fetchImpl })).rejects.toThrow('boom');
  });

  it('includes the HTTP status in the upstream-failure message, even with an empty body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '' });
    await expect(nameEnding({ session: SESSION, apiKey: 'k', fetchImpl })).rejects.toThrow(/503/);
  });

  it('throws a distinct truncation error when the model stops on max_tokens (not "invalid JSON")', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: '{"ending_title": "途中で切れ' }] },
          finishReason: 'MAX_TOKENS',
        }],
      }),
    });
    await expect(nameEnding({ session: SESSION, apiKey: 'k', fetchImpl })).rejects.toThrow(/max_tokens|truncat/);
  });

  it('throws when the model returns unparseable output', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'not json' }] }, finishReason: 'STOP' }],
      }),
    });
    await expect(nameEnding({ session: SESSION, apiKey: 'k', fetchImpl })).rejects.toThrow(/invalid/);
  });

  it('throws when the model returns an empty title', async () => {
    const fetchImpl = okFetch({ ending_title: '   ', summary: '総括' });
    await expect(nameEnding({ session: SESSION, apiKey: 'k', fetchImpl })).rejects.toThrow(/empty/);
  });

  it('tolerates a session with no summary, no pc and no log', async () => {
    const fetchImpl = okFetch({ ending_title: '題', summary: '総括' });
    const out = await nameEnding({ session: { id: 's', state: {}, log: [] }, apiKey: 'k', fetchImpl });
    expect(out.endingTitle).toBe('題');
  });
});
