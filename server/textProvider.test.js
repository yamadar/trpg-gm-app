// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  buildGeminiTextRequest,
  generateText,
  toCompatibleTextResponse,
} from './textProvider.js';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: 'string' } },
};

describe('buildGeminiTextRequest', () => {
  it('converts system, messages, token limit and structured output', () => {
    const body = buildGeminiTextRequest({
      max_tokens: 123,
      system: [{ type: 'text', text: 'system' }],
      messages: [{ role: 'user', content: 'hello' }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });

    expect(body.systemInstruction.parts[0].text).toBe('system');
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 123,
      responseMimeType: 'application/json',
      responseJsonSchema: SCHEMA,
    });
  });

  it('combines tools with structured output for Gemini 3.5', () => {
    const body = buildGeminiTextRequest({
      system: 'system',
      messages: [{ role: 'user', content: 'roll' }],
      tools: [{ name: 'roll_check', description: 'roll', input_schema: SCHEMA }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });

    expect(body.tools[0].functionDeclarations[0]).toEqual({
      name: 'roll_check',
      description: 'roll',
      parametersJsonSchema: SCHEMA,
    });
    expect(body.toolConfig.functionCallingConfig.mode).toBe('AUTO');
    expect(body.generationConfig).toEqual({
      responseMimeType: 'application/json',
      responseJsonSchema: SCHEMA,
    });
    expect(body.systemInstruction.parts[0].text).toBe('system');
  });

  it('maps a thinking level into Gemini generation config', () => {
    const body = buildGeminiTextRequest({
      messages: [{ role: 'user', content: 'name this ending' }],
      thinking_level: 'minimal',
    });

    expect(body.generationConfig.thinkingConfig).toEqual({
      thinkingLevel: 'MINIMAL',
    });
  });

  it('restores function call ids and thought signatures for a tool result turn', () => {
    const body = buildGeminiTextRequest({
      messages: [
        { role: 'user', content: 'roll' },
        {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'call-1',
            name: 'roll_check',
            input: { chance: 50 },
            thought_signature: 'signature',
          }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '{"success":true}' }],
        },
      ],
      tools: [{ name: 'roll_check', input_schema: SCHEMA }],
      tool_choice: { type: 'none' },
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });

    expect(body.tools).toBeUndefined();
    expect(body.contents[1].parts[0]).toEqual({
      functionCall: { name: 'roll_check', args: { chance: 50 }, id: 'call-1' },
      thoughtSignature: 'signature',
    });
    expect(body.contents[2].parts[0].functionResponse).toEqual({
      name: 'roll_check',
      response: { success: true },
      id: 'call-1',
    });
    expect(body.generationConfig.responseJsonSchema).toBe(SCHEMA);
  });
});

describe('toCompatibleTextResponse', () => {
  it('converts text and max-token finish reason', () => {
    expect(toCompatibleTextResponse({
      candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'MAX_TOKENS' }],
    })).toEqual({ content: [{ type: 'text', text: 'hello' }], stop_reason: 'max_tokens' });
  });

  it('converts function calls while preserving id and thought signature', () => {
    expect(toCompatibleTextResponse({
      candidates: [{
        content: {
          parts: [{
            functionCall: { name: 'roll_check', args: { chance: 50 }, id: 'call-1' },
            thoughtSignature: 'signature',
          }],
        },
        finishReason: 'STOP',
      }],
    })).toEqual({
      content: [{
        type: 'tool_use',
        id: 'call-1',
        name: 'roll_check',
        input: { chance: 50 },
        thought_signature: 'signature',
      }],
      stop_reason: 'tool_use',
    });
  });

  it('rejects a prompt blocked before candidates are generated', () => {
    expect(() => toCompatibleTextResponse({
      promptFeedback: { blockReason: 'SAFETY' },
    })).toThrow(/SAFETY/);
  });

  it('rejects a response without candidates', () => {
    expect(() => toCompatibleTextResponse({})).toThrow(/NO_CANDIDATES/);
  });

  it('rejects a candidate with a non-success finish reason', () => {
    expect(() => toCompatibleTextResponse({
      candidates: [{
        content: { parts: [] },
        finishReason: 'MALFORMED_FUNCTION_CALL',
        finishMessage: 'invalid arguments',
      }],
    })).toThrow(/MALFORMED_FUNCTION_CALL.*invalid arguments/);
  });

  // systemブロックはセッション中不変なので、暗黙キャッシュが効いていれば cached が
  // input の大半を占める。この内訳を見ないと削減策の効果を測れない。
  it('reports the token breakdown including the cached share of the input', () => {
    const res = toCompatibleTextResponse({
      candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      usageMetadata: {
        promptTokenCount: 10000,
        cachedContentTokenCount: 8000,
        candidatesTokenCount: 500,
        thoughtsTokenCount: 120,
        totalTokenCount: 10620,
      },
    });
    expect(res.usage).toEqual({
      input_tokens: 10000,
      cached_input_tokens: 8000,
      output_tokens: 500,
      thoughts_tokens: 120,
      total_tokens: 10620,
      cache_hit_ratio: 0.8,
    });
  });

  it('reports a zero cache ratio when nothing was served from cache', () => {
    const res = toCompatibleTextResponse({
      candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 12000, candidatesTokenCount: 300, totalTokenCount: 12300 },
    });
    expect(res.usage.cached_input_tokens).toBe(0);
    expect(res.usage.cache_hit_ratio).toBe(0);
  });

  // usageMetadata が無いレスポンスで usage キーが生えると、既存の toEqual 比較が
  // 一斉に壊れる。付けないことを明示的に守る。
  it('omits usage entirely when the response carries no usageMetadata', () => {
    const res = toCompatibleTextResponse({
      candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }],
    });
    expect(res).not.toHaveProperty('usage');
  });
});

describe('generateText', () => {
  it('uses configured model and API key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
      }),
    });

    await generateText({
      apiKey: 'text-key',
      model: 'gemini-text',
      request: { messages: [] },
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-text:generateContent',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goog-api-key': 'text-key' }),
      }),
    );
  });
});
