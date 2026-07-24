import { describe, it, expect, vi, beforeEach } from 'vitest';
import { summarizeWorld, generateScenario, takeTurn, recallMemory, advanceCampaignPc } from './session.js';
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

  it('includes the goal/bonds hook instruction only when a PC sheet is provided', async () => {
    const callClaudeMock = vi
      .spyOn(client, 'callClaude')
      .mockResolvedValue({ content: [{ type: 'text', text: 'x' }] });
    await generateScenario('推理物', 'PC設定', '世界観要約');
    expect(callClaudeMock.mock.calls[0][0].system).toContain('hook');
    await generateScenario('推理物', '', '世界観要約');
    expect(callClaudeMock.mock.calls[1][0].system).not.toContain('hook');
  });

  it('throws when the response was truncated by max_tokens', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: '途中まで' }],
      stop_reason: 'max_tokens',
    });
    await expect(generateScenario('推理物', 'PC設定', '世界観要約')).rejects.toThrow(/max_tokens/);
  });
});

describe('takeTurn', () => {
  it('returns the parsed result without a roll when no tool_use happens', async () => {
    const callClaudeMock = vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: '{"narrative": "静かな朝。", "state_update": {}, "choices": []}' }],
    });

    const { result, roll } = await takeTurn(makeSession(), '周りを見渡す');

    expect(result.narrative).toBe('静かな朝。');
    expect(roll).toBeNull();
    const request = callClaudeMock.mock.calls[0][0];
    // 動的状態はsystemではなくuserメッセージ側に入る
    expect(request.messages[0].content).toContain('# プレイヤーの行動\n周りを見渡す');
    expect(request.messages[0].content).toContain('シーン: 冒頭');
    expect(request.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(request.output_config.format.type).toBe('json_schema');
  });

  it('converts structured-output flags array into a plain object', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            narrative: '扉が開いた。',
            state_update: {
              current_scene: '書庫',
              flags: [
                { key: 'door_opened', value: true },
                { key: 'clue', value: '血痕' },
              ],
              history_summary: '要約',
              xp_gained: 0,
            },
            choices: [],
          }),
        },
      ],
    });

    const { result } = await takeTurn(makeSession(), '扉を開ける');

    expect(result.state_update.flags).toEqual({ door_opened: true, clue: '血痕' });
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

describe('recallMemory', () => {
  it('/api/messages経由で回想を生成し、systemに翻訳指示・userにhistory/flagsを含める', async () => {
    const spy = vi
      .spyOn(client, 'callClaude')
      .mockResolvedValue({ content: [{ type: 'text', text: '  カイは村長の依頼を思い返した。  ' }] });
    const session = makeSession({
      pc: { raw: 'PC名: カイ', goal: '村を守る', bonds: '村長は恩人' },
      state: { history_summary: '廃坑を調査中', flags: { goblins_present: true }, recent_log: [] },
    });
    const out = await recallMemory(session);
    expect(out).toBe('カイは村長の依頼を思い返した。');
    const body = spy.mock.calls[0][0];
    expect(body.system).toContain('翻訳');
    expect(body.messages[0].content).toContain('廃坑を調査中');
    expect(body.messages[0].content).toContain('goblins_present');
  });
  it('空レスポンスはフォールバック文言を返す', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({ content: [{ type: 'text', text: '' }] });
    expect(await recallMemory(makeSession())).toBe('(まだ特に思い出すことはない)');
  });
});

describe('advanceCampaignPc', () => {
  it('更新版PCシートとxpを返し、systemに持ち越し指示・userに元シート/履歴/フラグを含める', async () => {
    const spy = vi
      .spyOn(client, 'callClaude')
      .mockResolvedValue({ content: [{ type: 'text', text: '  PC名: カイ(熟練の猟師)\n持ち物: 銀の矢  ' }] });
    const session = makeSession({
      pc: { raw: 'PC名: カイ', goal: '村を守る', bonds: '村長は恩人' },
      state: { history_summary: '廃坑の小鬼を退けた', flags: { silver_arrow_found: true }, recent_log: [], xp: 12 },
    });
    const out = await advanceCampaignPc(session);
    expect(out).toEqual({ pcRaw: 'PC名: カイ(熟練の猟師)\n持ち物: 銀の矢', xp: 12 });
    const body = spy.mock.calls[0][0];
    expect(body.system).toContain('次の冒険');
    expect(body.messages[0].content).toContain('PC名: カイ');
    expect(body.messages[0].content).toContain('廃坑の小鬼を退けた');
    expect(body.messages[0].content).toContain('silver_arrow_found');
  });
  it('空レスポンスは元のpc.rawへフォールバックする', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({ content: [{ type: 'text', text: '' }] });
    const out = await advanceCampaignPc(makeSession({ pc: { raw: '元シート' }, state: { xp: 5, flags: {}, recent_log: [] } }));
    expect(out).toEqual({ pcRaw: '元シート', xp: 5 });
  });
});
