import { describe, it, expect, vi, afterEach } from 'vitest';
import { callTextModel, extractText, extractToolUse, parseJsonLoose } from './client.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callTextModel', () => {
  it('posts to /api/messages and returns the parsed json body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await callTextModel({ model: 'x' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/messages',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toEqual({ content: [] });
  });

  it('throws with the status and truncated body when the response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server exploded',
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(callTextModel({})).rejects.toThrow('API error 500: server exploded');
  });
});

describe('extractText', () => {
  it('joins text blocks and ignores other block types', () => {
    const content = [
      { type: 'text', text: 'line one' },
      { type: 'tool_use', name: 'roll_check' },
      { type: 'text', text: 'line two' },
    ];
    expect(extractText(content)).toBe('line one\nline two');
  });

  it('returns an empty string for null content', () => {
    expect(extractText(null)).toBe('');
  });
});

describe('extractToolUse', () => {
  it('finds the tool_use block', () => {
    const content = [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'roll_check' }];
    expect(extractToolUse(content)).toEqual({ type: 'tool_use', name: 'roll_check' });
  });

  it('returns undefined when there is no tool_use block', () => {
    expect(extractToolUse([{ type: 'text', text: 'x' }])).toBeUndefined();
  });
});

describe('parseJsonLoose', () => {
  it('parses raw JSON', () => {
    expect(parseJsonLoose('{"a": 1}')).toEqual({ a: 1 });
  });

  it('strips markdown code fences before parsing', () => {
    expect(parseJsonLoose('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it('throws when no JSON object is found', () => {
    expect(() => parseJsonLoose('no json here')).toThrow('JSON not found in response');
  });

  it('throws when the JSON object is truncated with no closing brace', () => {
    expect(() => parseJsonLoose('{"narrative": "途中で切れ')).toThrow('JSON not found in response');
  });

  it('extracts the object when prose follows the closing brace', () => {
    expect(parseJsonLoose('{"a": 1}\n以上です。よろしく。')).toEqual({ a: 1 });
  });

  it('extracts the object when a prologue precedes a fenced block', () => {
    expect(parseJsonLoose('了解しました。\n```json\n{"a": 1}\n```\nさらに続きます')).toEqual({ a: 1 });
  });
});
