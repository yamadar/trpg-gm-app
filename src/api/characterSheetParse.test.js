import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCharacterSheet } from './characterSheetParse.js';
import * as client from './client.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('parseCharacterSheet', () => {
  it('parses goal and bonds from the model response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ goal: '妹を救い出す', bonds: '幼馴染のNPC' }) }],
    });
    const result = await parseCharacterSheet('PC名: アリス\ngoal: 妹を救い出す\nbonds: 幼馴染のNPC');
    expect(result).toEqual({ goal: '妹を救い出す', bonds: '幼馴染のNPC' });
  });

  it('defaults goal and bonds to empty strings when the model omits them', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({}) }],
    });
    const result = await parseCharacterSheet('PC名: ボブ');
    expect(result).toEqual({ goal: '', bonds: '' });
  });

  it('sends the raw character sheet as the user message', async () => {
    const callClaudeMock = vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ goal: '', bonds: '' }) }],
    });
    await parseCharacterSheet('PC名: キャロル');
    expect(callClaudeMock.mock.calls[0][0].messages[0].content).toBe('PC名: キャロル');
  });
});
