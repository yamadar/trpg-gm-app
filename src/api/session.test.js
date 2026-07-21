import { describe, it, expect, vi, beforeEach } from 'vitest';
import { summarizeWorld, generateScenario, takeTurn } from './session.js';
import * as client from './client.js';

function makeSession(overrides = {}) {
  return {
    rulesetId: 'simple',
    world: { summary: 'x' },
    scenario: { raw: 'y' },
    pc: { raw: 'z' },
    state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('summarizeWorld', () => {
  it('returns the trimmed text of the response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({ content: [{ type: 'text', text: '  要約結果  ' }] });
    expect(await summarizeWorld('生の世界観テキスト')).toBe('要約結果');
  });
});

describe('generateScenario', () => {
  it('returns the trimmed text of the response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({ content: [{ type: 'text', text: '## シナリオ概要\n本文' }] });
    const scenario = await generateScenario('推理物', 'PC設定', '世界観要約');
    expect(scenario).toBe('## シナリオ概要\n本文');
  });
});

describe('takeTurn', () => {
  it('returns the parsed result without a roll when no tool_use happens', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: '{"narrative": "静かな朝。", "state_update": {}, "choices": []}' }],
    });

    const { result, roll } = await takeTurn(makeSession(), '周りを見渡す');

    expect(result.narrative).toBe('静かな朝。');
    expect(roll).toBeNull();
  });

  it('resolves a roll_check tool_use and sends the result back for the final narrative', async () => {
    const toolUseResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'roll_check',
          input: { check_label: '崖を登る', success_percent: 50 },
        },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "登り切った。", "state_update": {}, "choices": []}' }],
    };
    const callClaudeMock = vi
      .spyOn(client, 'callClaude')
      .mockResolvedValueOnce(toolUseResponse)
      .mockResolvedValueOnce(finalResponse);
    vi.spyOn(Math, 'random').mockReturnValue(0); // roll = 1 -> success

    const { result, roll } = await takeTurn(makeSession(), '崖を登る');

    expect(result.narrative).toBe('登り切った。');
    expect(roll.check_label).toBe('崖を登る');
    expect(roll.success).toBe(true);
    expect(callClaudeMock).toHaveBeenCalledTimes(2);
    const secondCallMessages = callClaudeMock.mock.calls[1][0].messages;
    expect(secondCallMessages.at(-1).content[0].type).toBe('tool_result');
  });
});
