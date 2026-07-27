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
    vi.spyOn(client, 'callTextModel').mockResolvedValue({ content: [{ type: 'text', text: '  要約結果  ' }] });
    expect(await summarizeWorld('生の世界観テキスト')).toBe('要約結果');
  });
});

describe('generateScenario', () => {
  it('returns the trimmed text of the response', async () => {
    vi.spyOn(client, 'callTextModel').mockResolvedValue({ content: [{ type: 'text', text: '## シナリオ概要\n本文' }] });
    const scenario = await generateScenario('推理物', 'PC設定', '世界観要約');
    expect(scenario).toBe('## シナリオ概要\n本文');
  });

  it('includes the goal/bonds hook instruction only when a PC sheet is provided', async () => {
    const callTextModelMock = vi
      .spyOn(client, 'callTextModel')
      .mockResolvedValue({ content: [{ type: 'text', text: 'x' }] });
    await generateScenario('推理物', 'PC設定', '世界観要約');
    expect(callTextModelMock.mock.calls[0][0].system).toContain('hook');
    await generateScenario('推理物', '', '世界観要約');
    expect(callTextModelMock.mock.calls[1][0].system).not.toContain('hook');
  });

  it('throws when the response was truncated by max_tokens', async () => {
    vi.spyOn(client, 'callTextModel').mockResolvedValue({
      content: [{ type: 'text', text: '途中まで' }],
      stop_reason: 'max_tokens',
    });
    await expect(generateScenario('推理物', 'PC設定', '世界観要約')).rejects.toThrow(/max_tokens/);
  });
});

describe('takeTurn', () => {
  // 判定対象の行動が無いターン(導入シーン)でroll_checkを開けておくと、モデルは
  // 「ダミー」等の空の見出しで判定を1回消費する。その見出しは判定スタンプとして
  // 場面の先頭に描かれるため、プレイヤーには意味不明な文字列として見える。
  it('does not offer the roll tool when the caller disallows a roll', async () => {
    const callTextModelMock = vi.spyOn(client, 'callTextModel').mockResolvedValue({
      content: [{ type: 'text', text: '{"narrative": "村の広場。", "state_update": {}, "choices": ["進む"]}' }],
    });

    await takeTurn(makeSession(), '(セッション開始。導入シーンを描写せよ)', { allowRoll: false });

    expect(callTextModelMock.mock.calls[0][0].tools).toBeUndefined();
  });

  it('offers the roll tool by default', async () => {
    const callTextModelMock = vi.spyOn(client, 'callTextModel').mockResolvedValue({
      content: [{ type: 'text', text: '{"narrative": "静かな朝。", "state_update": {}, "choices": []}' }],
    });

    await takeTurn(makeSession(), '周りを見渡す');

    expect(callTextModelMock.mock.calls[0][0].tools.map((t) => t.name)).toEqual(['roll_check']);
  });

  // 判定は1ターンに最大1回。ツールを開けたまま追撃すると、モデルが再度roll_checkを
  // 呼びつつ、structured outputsのスキーマを埋めるためだけの空JSON(narrative空・
  // choices空)を返すことがある。2度目の呼び出しは取りこぼされ、その空JSONが
  // そのままターンの内容として表示されてしまう。
  it('closes the tool on the follow-up call so the turn cannot be spent on a second roll', async () => {
    const toolUseResponse = {
      content: [
        { type: 'tool_use', id: 'tool_1', name: 'roll_check', input: { check_label: '崖を登る', success_percent: 50 } },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "登り切った。", "state_update": {}, "choices": ["進む"]}' }],
    };
    const callTextModelMock = vi
      .spyOn(client, 'callTextModel')
      .mockResolvedValueOnce(toolUseResponse)
      .mockResolvedValueOnce(finalResponse);

    await takeTurn(makeSession(), '崖を登る');

    expect(callTextModelMock.mock.calls[1][0].tool_choice).toEqual({ type: 'none' });
  });

  it('returns the parsed result without a roll when no tool_use happens', async () => {
    const callTextModelMock = vi.spyOn(client, 'callTextModel').mockResolvedValue({
      content: [{ type: 'text', text: '{"narrative": "静かな朝。", "state_update": {}, "choices": []}' }],
    });

    const { result, roll } = await takeTurn(makeSession(), '周りを見渡す');

    expect(result.narrative).toBe('静かな朝。');
    expect(roll).toBeNull();
    const request = callTextModelMock.mock.calls[0][0];
    // 動的状態はsystemではなくuserメッセージ側に入る
    expect(request.messages[0].content).toContain('# プレイヤーの行動\n周りを見渡す');
    expect(request.messages[0].content).toContain('シーン: 冒頭');
    expect(request.system[0]).toEqual(expect.objectContaining({ type: 'text' }));
    expect(request.output_config.format.type).toBe('json_schema');
  });

  it('converts structured-output flags array into a plain object', async () => {
    vi.spyOn(client, 'callTextModel').mockResolvedValue({
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
    const callTextModelMock = vi
      .spyOn(client, 'callTextModel')
      .mockResolvedValueOnce(toolUseResponse)
      .mockResolvedValueOnce(finalResponse);
    vi.spyOn(Math, 'random').mockReturnValue(0); // roll = 1 -> success

    const { result, roll } = await takeTurn(makeSession(), '崖を登る');

    expect(result.narrative).toBe('登り切った。');
    expect(roll.check_label).toBe('崖を登る');
    expect(roll.success).toBe(true);
    expect(callTextModelMock).toHaveBeenCalledTimes(2);
    const secondCallMessages = callTextModelMock.mock.calls[1][0].messages;
    expect(secondCallMessages.at(-1).content[0].type).toBe('tool_result');
  });

  it('uses the coc7e adapter formula for coc7e sessions', async () => {
    const toolUseResponse = {
      content: [
        { type: 'tool_use', id: 'tool_1', name: 'roll_check', input: { check_label: '調査', success_percent: 60 } },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "見つけた。", "state_update": {}, "choices": []}' }],
    };
    vi.spyOn(client, 'callTextModel').mockResolvedValueOnce(toolUseResponse).mockResolvedValueOnce(finalResponse);
    vi.spyOn(Math, 'random').mockReturnValue(0.11); // roll = 12 -> coc7eではextreme(<=ceil(60/5))

    const session = makeSession({ ruleset: { id: 'coc7e', formula: 'coc7e' } });
    const { roll } = await takeTurn(session, '調べる');
    expect(roll.degree).toBe('extreme');
  });

  it('applies a sanity side effect: computes resourceChange, informs the AI, and does not mutate the session', async () => {
    const toolUseResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'roll_check',
          input: { check_label: '正気度チェック', success_percent: 50, check_kind: 'sanity' },
        },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "膝が笑う。", "state_update": {}, "choices": []}' }],
    };
    const callTextModelMock = vi
      .spyOn(client, 'callTextModel')
      .mockResolvedValueOnce(toolUseResponse)
      .mockResolvedValueOnce(finalResponse);
    // roll = 80 -> fail(p=50)。副作用の1d6は rng()=80 -> 1+((80-1)%6)=1+1=2 -> delta -2
    vi.spyOn(Math, 'random').mockReturnValue(0.79);

    const session = makeSession({
      ruleset: { id: 'coc7e', formula: 'coc7e' },
      state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], resources: { san: { value: 60, max: 99 } } },
    });
    const { roll, resourceChange } = await takeTurn(session, '死体を見る');

    expect(resourceChange).toEqual({ key: 'san', label: '正気度', delta: -2, before: 60, after: 58 });
    expect(roll.resourceChange).toEqual(resourceChange);
    expect(session.state.resources.san.value).toBe(60); // 非破壊

    const toolResult = callTextModelMock.mock.calls[1][0].messages.at(-1).content[0];
    const payload = JSON.parse(toolResult.content);
    expect(payload.san_loss).toBe(2);
    expect(payload.san_now).toBe(58);
  });

  it('adds a madness note to the tool_result when sanity reaches 0', async () => {
    const toolUseResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'roll_check',
          input: { check_label: '正気度チェック', success_percent: 50, check_kind: 'sanity' },
        },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "闇。", "state_update": {}, "choices": []}' }],
    };
    const callTextModelMock = vi
      .spyOn(client, 'callTextModel')
      .mockResolvedValueOnce(toolUseResponse)
      .mockResolvedValueOnce(finalResponse);
    vi.spyOn(Math, 'random').mockReturnValue(0.79); // fail -> -2

    const session = makeSession({
      ruleset: { id: 'coc7e', formula: 'coc7e' },
      state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [], resources: { san: { value: 1, max: 99 } } },
    });
    const { resourceChange } = await takeTurn(session, '直視する');

    expect(resourceChange.after).toBe(0);
    expect(resourceChange.delta).toBe(-1); // clamp後の実効値
    const payload = JSON.parse(callTextModelMock.mock.calls[1][0].messages.at(-1).content[0].content);
    expect(payload.note).toContain('正気');
  });

  it('ignores check_kind for adapters without side effects and returns a null resourceChange', async () => {
    const toolUseResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'roll_check',
          input: { check_label: 'x', success_percent: 50, check_kind: 'sanity' },
        },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "何ともない。", "state_update": {}, "choices": []}' }],
    };
    vi.spyOn(client, 'callTextModel').mockResolvedValueOnce(toolUseResponse).mockResolvedValueOnce(finalResponse);
    vi.spyOn(Math, 'random').mockReturnValue(0.79);

    const { resourceChange } = await takeTurn(makeSession(), '見る');
    expect(resourceChange).toBeNull();
  });

  it('includes the gurps margin in the tool_result payload', async () => {
    const toolUseResponse = {
      content: [
        { type: 'tool_use', id: 'tool_1', name: 'roll_check', input: { check_label: '狙撃', success_percent: 60 } },
      ],
    };
    const finalResponse = {
      content: [{ type: 'text', text: '{"narrative": "命中。", "state_update": {}, "choices": []}' }],
    };
    const callTextModelMock = vi
      .spyOn(client, 'callTextModel')
      .mockResolvedValueOnce(toolUseResponse)
      .mockResolvedValueOnce(finalResponse);
    vi.spyOn(Math, 'random').mockReturnValue(0.39); // roll = 40 -> margin 20

    await takeTurn(makeSession({ ruleset: { id: 'gurps', formula: 'gurps' } }), '撃つ');
    const payload = JSON.parse(callTextModelMock.mock.calls[1][0].messages.at(-1).content[0].content);
    expect(payload.margin).toBe(20);
  });
});

describe('recallMemory', () => {
  it('/api/messages経由で回想を生成し、systemに翻訳指示・userにhistory/flagsを含める', async () => {
    const spy = vi
      .spyOn(client, 'callTextModel')
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
    vi.spyOn(client, 'callTextModel').mockResolvedValue({ content: [{ type: 'text', text: '' }] });
    expect(await recallMemory(makeSession())).toBe('(まだ特に思い出すことはない)');
  });
});

describe('advanceCampaignPc', () => {
  it('更新版PCシートとxpを返し、systemに持ち越し指示・userに元シート/履歴/フラグを含める', async () => {
    const spy = vi
      .spyOn(client, 'callTextModel')
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
    vi.spyOn(client, 'callTextModel').mockResolvedValue({ content: [{ type: 'text', text: '' }] });
    const out = await advanceCampaignPc(makeSession({ pc: { raw: '元シート' }, state: { xp: 5, flags: {}, recent_log: [] } }));
    expect(out).toEqual({ pcRaw: '元シート', xp: 5 });
  });
});
