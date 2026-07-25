// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { generateNovel, NOVELIZE_MAX_CONTINUATIONS } from './novelGeneration.js';

// stop_reasonとtextの並びを与えて、順に返すfetchモックを作る。
function sequenceFetch(...responses) {
  let i = 0;
  return vi.fn().mockImplementation(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: r.text }],
        stop_reason: r.stop_reason,
      }),
    };
  });
}

function bodyOf(fetchImpl, callIndex) {
  return JSON.parse(fetchImpl.mock.calls[callIndex][1].body);
}

const BASE = { transcript: 'PL: 進む\nGM: 扉があった。', hasImages: false, pov: 'third', apiKey: 'k' };

describe('generateNovel', () => {
  it('returns the text as-is when the first response completes', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    const out = await generateNovel({ ...BASE, fetchImpl });

    expect(out).toEqual({ text: '本文', truncated: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('continues after a truncated response and joins the parts without a separator', async () => {
    const fetchImpl = sequenceFetch(
      { text: '前半のと', stop_reason: 'max_tokens' },
      { text: 'ころで扉が開いた。', stop_reason: 'end_turn' },
    );
    const out = await generateNovel({ ...BASE, fetchImpl });

    expect(out).toEqual({ text: '前半のところで扉が開いた。', truncated: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // Sonnet 5は末尾assistantターン(prefill)を400で拒否する。継続は必ずuserターンで終える。
  it('ends the continuation request with a user turn, not an assistant prefill', async () => {
    const fetchImpl = sequenceFetch(
      { text: '途中', stop_reason: 'max_tokens' },
      { text: 'の続き', stop_reason: 'end_turn' },
    );
    await generateNovel({ ...BASE, fetchImpl });

    const messages = bodyOf(fetchImpl, 1).messages;
    expect(messages[messages.length - 1].role).toBe('user');
  });

  it('carries the text produced so far as an assistant turn in the continuation request', async () => {
    const fetchImpl = sequenceFetch(
      { text: '一回目', stop_reason: 'max_tokens' },
      { text: '二回目', stop_reason: 'max_tokens' },
      { text: '三回目', stop_reason: 'end_turn' },
    );
    await generateNovel({ ...BASE, fetchImpl });

    const second = bodyOf(fetchImpl, 1).messages;
    expect(second.find((m) => m.role === 'assistant').content).toBe('一回目');
    // 2度目の継続では、それまでの全出力が渡る。
    const third = bodyOf(fetchImpl, 2).messages;
    expect(third.find((m) => m.role === 'assistant').content).toBe('一回目二回目');
  });

  it('resends the same transcript on every request', async () => {
    const fetchImpl = sequenceFetch(
      { text: 'a', stop_reason: 'max_tokens' },
      { text: 'b', stop_reason: 'end_turn' },
    );
    await generateNovel({ ...BASE, fetchImpl });

    for (const i of [0, 1]) {
      expect(bodyOf(fetchImpl, i).messages[0].content[0].text).toBe(BASE.transcript);
    }
  });

  // 継続のたびにtranscriptを再送するため、キャッシュが効かないと長いログほど高くつく。
  it('marks the transcript block for prompt caching', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, fetchImpl });

    expect(bodyOf(fetchImpl, 0).messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('gives up as truncated once the continuation limit is reached', async () => {
    const fetchImpl = sequenceFetch({ text: 'x', stop_reason: 'max_tokens' });
    const out = await generateNovel({ ...BASE, fetchImpl, maxContinuations: 2 });

    expect(out.truncated).toBe(true);
    expect(out.text).toBe('xxx'); // 初回 + 継続2回
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('defaults the continuation limit to NOVELIZE_MAX_CONTINUATIONS', async () => {
    const fetchImpl = sequenceFetch({ text: 'x', stop_reason: 'max_tokens' });
    await generateNovel({ ...BASE, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(NOVELIZE_MAX_CONTINUATIONS + 1);
  });

  it('throws when the upstream call is not ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(generateNovel({ ...BASE, fetchImpl })).rejects.toThrow(/boom/);
  });

  // 継続中の上流失敗は再実行で解決しうるので、部分的な結果を返さず失敗させる。
  it('throws when a continuation request fails', async () => {
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({ content: [{ type: 'text', text: '途中' }], stop_reason: 'max_tokens' }),
        };
      }
      return { ok: false, status: 503, text: async () => 'upstream down' };
    });

    await expect(generateNovel({ ...BASE, fetchImpl })).rejects.toThrow(/upstream down/);
  });

  it('throws when the response has no text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [], stop_reason: 'end_turn' }),
    });
    await expect(generateNovel({ ...BASE, fetchImpl })).rejects.toThrow(/empty/);
  });

  it('includes the marker instruction only when the session has images', async () => {
    const withImages = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, hasImages: true, fetchImpl: withImages });
    expect(bodyOf(withImages, 0).system).toContain('挿絵挿入位置');

    const withoutImages = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, fetchImpl: withoutImages });
    expect(bodyOf(withoutImages, 0).system).not.toContain('挿絵挿入位置');
  });

  it('uses a first person prompt when pov is first', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, pov: 'first', fetchImpl });

    expect(bodyOf(fetchImpl, 0).system).toContain('一人称');
  });

  it('names the protagonist in the system prompt when pcName is given', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, pcName: 'カイ', fetchImpl });

    expect(bodyOf(fetchImpl, 0).system).toContain('主人公の名前は「カイ」である');
  });

  // 名無しのまま遊び終わった既存セッションの救済。呼称をモデルに一つ決めさせる。
  it('tells the model to coin one consistent designation when pcName is empty', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, fetchImpl });

    const system = bodyOf(fetchImpl, 0).system;
    expect(system).toContain('一つだけ定め');
    expect(system).not.toContain('主人公の名前は「');
    // 固定の呼び名を作らせる前に、まずログから読み取れる名前を優先させる文言を検証する。
    // これが無いと旧文言(「名前はログに存在しない」と断言するだけ)でも通ってしまう。
    expect(system).toContain('ログから読み取れるならその名前を使い');
  });

  it('forbids receiving two people with 彼/彼女 in one paragraph, named or not', async () => {
    for (const pcName of ['カイ', '']) {
      const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
      await generateNovel({ ...BASE, pcName, fetchImpl });
      expect(bodyOf(fetchImpl, 0).system).toContain('二人以上の人物を「彼」「彼女」で受けないこと');
    }
  });

  // 一人称では主人公が「私」等になり、他の人物と衝突しない。主人公の行は不要。
  it('drops the protagonist rule in first person but keeps the rule for the rest of the cast', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, pov: 'first', pcName: 'カイ', fetchImpl });

    const system = bodyOf(fetchImpl, 0).system;
    expect(system).not.toContain('主人公の名前は「カイ」である');
    expect(system).not.toContain('一つだけ定め');
    expect(system).toContain('二人以上の人物を「彼」「彼女」で受けないこと');
  });

  // 挿絵マーカーの指示は書き分け規律の後ろに来る(既存の連結位置を変えていないことの確認)。
  it('keeps the marker instruction after the cast rules', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, hasImages: true, pcName: 'カイ', fetchImpl });

    const system = bodyOf(fetchImpl, 0).system;
    expect(system.indexOf('人物の書き分け')).toBeLessThan(system.indexOf('挿絵挿入位置'));
  });
});
