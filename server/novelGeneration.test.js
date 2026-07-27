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
        candidates: [{
          content: { parts: [{ text: r.text }] },
          finishReason: r.stop_reason === 'max_tokens' ? 'MAX_TOKENS' : 'STOP',
        }],
      }),
    };
  });
}

function bodyOf(fetchImpl, callIndex) {
  return JSON.parse(fetchImpl.mock.calls[callIndex][1].body);
}

const BASE = {
  transcript: 'PL: 進む\nGM: 扉があった。',
  hasImages: false,
  pov: 'third',
  apiKey: 'k',
  model: 'gemini-text',
};

function systemOf(fetchImpl, callIndex = 0) {
  return bodyOf(fetchImpl, callIndex).systemInstruction.parts[0].text;
}

describe('generateNovel', () => {
  it('returns the text as-is when the first response completes', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    const out = await generateNovel({ ...BASE, fetchImpl });

    expect(out).toEqual({ text: '本文', truncated: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('minimizes thinking on Gemini 3 so output tokens remain available for the novel', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, model: 'gemini-3.5-flash', fetchImpl });

    expect(bodyOf(fetchImpl, 0).generationConfig.thinkingConfig).toEqual({
      thinkingLevel: 'MINIMAL',
    });
  });

  it('does not send Gemini 3 thinking levels to older models', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, model: 'gemini-2.5-flash', fetchImpl });

    expect(bodyOf(fetchImpl, 0).generationConfig.thinkingConfig).toBeUndefined();
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

  // 最終modelターンのprefillに依存せず、継続は必ずuserターンで終える。
  it('ends the continuation request with a user turn, not an assistant prefill', async () => {
    const fetchImpl = sequenceFetch(
      { text: '途中', stop_reason: 'max_tokens' },
      { text: 'の続き', stop_reason: 'end_turn' },
    );
    await generateNovel({ ...BASE, fetchImpl });

    const messages = bodyOf(fetchImpl, 1).contents;
    expect(messages[messages.length - 1].role).toBe('user');
  });

  it('carries the text produced so far as an assistant turn in the continuation request', async () => {
    const fetchImpl = sequenceFetch(
      { text: '一回目', stop_reason: 'max_tokens' },
      { text: '二回目', stop_reason: 'max_tokens' },
      { text: '三回目', stop_reason: 'end_turn' },
    );
    await generateNovel({ ...BASE, fetchImpl });

    const second = bodyOf(fetchImpl, 1).contents;
    expect(second.find((m) => m.role === 'model').parts[0].text).toBe('一回目');
    // 2度目の継続では、それまでの全出力が渡る。
    const third = bodyOf(fetchImpl, 2).contents;
    expect(third.find((m) => m.role === 'model').parts[0].text).toBe('一回目二回目');
  });

  it('keeps narration in plain form on both initial and continuation requests', async () => {
    const fetchImpl = sequenceFetch(
      { text: '霧が立ち込めた。', stop_reason: 'max_tokens' },
      { text: '扉が開いた。', stop_reason: 'end_turn' },
    );
    await generateNovel({
      ...BASE,
      transcript: 'GM: 港には霧が立ち込めています。',
      fetchImpl,
    });

    const system = systemOf(fetchImpl);
    const continuation = bodyOf(fetchImpl, 1).contents.at(-1).parts[0].text;
    expect(system).toContain('全編を通して必ず常体');
    expect(system).toContain('進行ログが敬体でも引きずらず');
    expect(system).toContain('登場人物の台詞はこの制約の対象外');
    expect(continuation).toContain('常体');
    expect(continuation).toContain('です・ます調へ変えない');
  });

  it('requests readable Markdown structure and preserves it during continuations', async () => {
    const fetchImpl = sequenceFetch(
      { text: '## 霧の港\n\n**古い鍵**', stop_reason: 'max_tokens' },
      { text: 'が光った。', stop_reason: 'end_turn' },
    );
    await generateNovel({ ...BASE, fetchImpl });

    const system = systemOf(fetchImpl);
    const continuation = bodyOf(fetchImpl, 1).contents.at(-1).parts[0].text;
    expect(system).toContain('Markdown');
    expect(system).toContain('場面転換');
    expect(system).toContain('## 小見出し');
    expect(system).toContain('**太字**');
    expect(system).toContain('重要な固有名詞');
    expect(continuation).toContain('Markdown');
  });

  it('resends the same transcript on every request', async () => {
    const fetchImpl = sequenceFetch(
      { text: 'a', stop_reason: 'max_tokens' },
      { text: 'b', stop_reason: 'end_turn' },
    );
    await generateNovel({ ...BASE, fetchImpl });

    for (const i of [0, 1]) {
      expect(bodyOf(fetchImpl, i).contents[0].parts[0].text).toBe(BASE.transcript);
    }
  });

  // Geminiのimplicit cachingが共通prefixを認識できるよう、ログは先頭に置く。
  it('puts the transcript first for implicit prompt caching', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, fetchImpl });

    expect(bodyOf(fetchImpl, 0).contents[0].parts[0].text).toBe(BASE.transcript);
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
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '途中' }] }, finishReason: 'MAX_TOKENS' }],
          }),
        };
      }
      return { ok: false, status: 503, text: async () => 'upstream down' };
    });

    await expect(generateNovel({ ...BASE, fetchImpl })).rejects.toThrow(/upstream down/);
  });

  it('throws when the response has no text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] }),
    });
    await expect(generateNovel({ ...BASE, fetchImpl })).rejects.toThrow(/empty/);
  });

  it('includes the marker instruction only when the session has images', async () => {
    const withImages = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, hasImages: true, fetchImpl: withImages });
    expect(systemOf(withImages)).toContain('挿絵挿入位置');

    const withoutImages = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, fetchImpl: withoutImages });
    expect(systemOf(withoutImages)).not.toContain('挿絵挿入位置');
  });

  it('uses a first person prompt when pov is first', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, pov: 'first', fetchImpl });

    expect(systemOf(fetchImpl)).toContain('一人称');
  });

  it('names the protagonist in the system prompt when pcName is given', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, pcName: 'カイ', fetchImpl });

    expect(systemOf(fetchImpl)).toContain('主人公の名前は「カイ」である');
  });

  it('limits full names and epithets to places where they help the reader', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, pcName: '「不倒の」ジャッカル', fetchImpl });

    const system = systemOf(fetchImpl);
    expect(system).toContain('主人公の名前は「「不倒の」ジャッカル」である');
    expect(system).toContain('毎回そのまま繰り返す指定ではない');
    expect(system).toContain('姓名・二つ名・肩書きを含む完全な名前表記');
    expect(system).toContain('二つ名や肩書きを毎回付けないこと');
    expect(system).toContain('場面と人物同士の関係に自然な姓・名・略称');
  });

  // 名無しのまま遊び終わった既存セッションの救済。呼称をモデルに一つ決めさせる。
  it('tells the model to coin one consistent designation when pcName is empty', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, fetchImpl });

    const system = systemOf(fetchImpl);
    expect(system).toContain('一つだけ定め');
    expect(system).not.toContain('主人公の名前は「');
    // 基本呼称を作らせる前に、まずログから読み取れる名前を優先させる文言を検証する。
    // これが無いと旧文言(「名前はログに存在しない」と断言するだけ)でも通ってしまう。
    expect(system).toContain('ログから読み取れるならその名前を使い');
  });

  it('forbids receiving two people with 彼/彼女 in one paragraph, named or not', async () => {
    for (const pcName of ['カイ', '']) {
      const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
      await generateNovel({ ...BASE, pcName, fetchImpl });
      expect(systemOf(fetchImpl)).toContain('二人以上の人物を「彼」「彼女」で受けないこと');
    }
  });

  it('isolates speech patterns by speaker when novelizing multiple characters', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({
      ...BASE,
      transcript: [
        'PL: 任せるガル',
        'GM: ミケが「行くにゃ」と言った。ハンゾウは「承知したでござる」と応じた。',
      ].join('\n'),
      pcName: 'ジャッカル',
      fetchImpl,
    });

    const system = systemOf(fetchImpl);
    expect(system).toContain('一人のキャラクターだけに属する設定');
    expect(system).toContain('話者本人の台詞だけから口調を判断');
    expect(system).toContain('PCの口調をNPCへ、NPCの口調をPCや別のNPCへ転用しない');
    expect(system).toContain('PL行の語尾・口癖・方言・一人称は主人公本人だけ');
    expect(system).toContain('他の人物の特徴的な語尾・口癖・方言で補わない');
    expect(system).toContain('台詞が切り替わるたびに話者を再確認');
    expect(system).toContain('進行ログの一部で口調が別人物と混ざっていても');
  });

  it('keeps speaker-specific speech rules in continuation requests', async () => {
    const fetchImpl = sequenceFetch(
      { text: '「先へ行くにゃ」', stop_reason: 'max_tokens' },
      { text: 'とミケは言った。', stop_reason: 'end_turn' },
    );
    await generateNovel({ ...BASE, fetchImpl });

    const continuation = bodyOf(fetchImpl, 1).contents.at(-1).parts[0].text;
    expect(continuation).toContain('話者本人の口調だけを維持');
    expect(continuation).toContain('直前に話した別人物の語尾・口癖・方言を混ぜない');
  });

  // 一人称では主人公が「私」等になり、他の人物と衝突しない。主人公の行は不要。
  it('drops the protagonist rule in first person but keeps the rule for the rest of the cast', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, pov: 'first', pcName: 'カイ', fetchImpl });

    const system = systemOf(fetchImpl);
    expect(system).not.toContain('主人公の名前は「カイ」である');
    expect(system).not.toContain('一つだけ定め');
    expect(system).toContain('二人以上の人物を「彼」「彼女」で受けないこと');
  });

  // 挿絵マーカーの指示は書き分け規律の後ろに来る(既存の連結位置を変えていないことの確認)。
  it('keeps the marker instruction after the cast rules', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, hasImages: true, pcName: 'カイ', fetchImpl });

    const system = systemOf(fetchImpl);
    expect(system.indexOf('人物の書き分け')).toBeLessThan(system.indexOf('挿絵挿入位置'));
  });
});
