import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCharacterSheet, SHEET_PARSE_VERSION } from './characterSheetParse.js';
import * as client from './client.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('parseCharacterSheet', () => {
  it('parses name, goal and bonds from the model response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        { type: 'text', text: JSON.stringify({ name: 'アリス', goal: '妹を救い出す', bonds: '幼馴染のNPC' }) },
      ],
    });
    const result = await parseCharacterSheet('PC名: アリス\ngoal: 妹を救い出す\nbonds: 幼馴染のNPC');
    expect(result).toEqual({ name: 'アリス', goal: '妹を救い出す', bonds: '幼馴染のNPC' });
  });

  it('defaults every field to an empty string when the model omits them', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({}) }],
    });
    const result = await parseCharacterSheet('PC名: ボブ');
    expect(result).toEqual({ name: '', goal: '', bonds: '' });
  });

  it('sends the raw character sheet as the user message', async () => {
    const callClaudeMock = vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ name: '', goal: '', bonds: '' }) }],
    });
    await parseCharacterSheet('PC名: キャロル');
    expect(callClaudeMock.mock.calls[0][0].messages[0].content).toBe('PC名: キャロル');
  });

  it('asks the model for the name in the output schema', async () => {
    const callClaudeMock = vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ name: '', goal: '', bonds: '' }) }],
    });
    await parseCharacterSheet('PC名: キャロル');
    const schema = callClaudeMock.mock.calls[0][0].output_config.format.schema;
    expect(schema.properties).toHaveProperty('name');
    expect(schema.required).toContain('name');
  });

  // キャッシュの世代交代に使う。スキーマを変えたら必ず上げる。
  it('exposes a parser version above the original name-less schema', () => {
    expect(SHEET_PARSE_VERSION).toBeGreaterThanOrEqual(2);
  });
});
