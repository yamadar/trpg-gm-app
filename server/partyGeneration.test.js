// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { generatePartyResolution } from './partyGeneration.js';

function geminiText(value) {
  return {
    ok: true,
    json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }),
  };
}

const session = {
  pcs: [
    { id: 'pc1', characterName: 'カイ', raw: '剣士' },
    { id: 'pc2', characterName: 'ミナ', raw: '学者' },
  ],
  gmSnapshot: {
    world: { raw: 'World秘密原文' },
    scenario: { raw: 'Scenario秘密原文' },
    ruleset: { id: 'simple', formula: 'simple' },
  },
};
const snapshot = {
  global: {}, scenes: { main: { participantPcIds: ['pc1', 'pc2'] } },
  pcs: { pc1: { resources: {} }, pc2: { resources: {} } },
};
const round = {
  intents: [
    { pcId: 'pc1', characterName: 'カイ', text: '扉を開く', source: 'human' },
    { pcId: 'pc2', characterName: 'ミナ', text: '罠を調べる', source: 'human' },
  ],
};

describe('partyGeneration', () => {
  it('plans all actions once, resolves code-owned checks, then creates shared and PC views', async () => {
    const plan = {
      resolution: 'advance', decisionQuestion: '', decisionOptions: [], autoActions: [],
      narratorBrief: '扉と罠の行動を裁定し、扉が開く。',
      checks: [{ pcId: 'pc1', checkLabel: '扉', successPercent: 70, checkKind: 'normal', supportPcIds: ['pc2'] }],
    };
    const outcome = {
      globalUpdate: { time: '直後', historySummary: '扉を開けた', tensionLevel: 2, endingReached: false, flagUpdates: [{ key: 'door', value: 'open' }] },
      sceneUpdates: [{ sceneId: 'main', title: '扉前', location: '遺跡', participantPcIds: ['pc1', 'pc2'], summary: '扉が開いた' }],
      pcUpdates: [
        { pcId: 'pc1', sceneId: 'main', conditionChanges: [], newlyKnownFactIds: [] },
        { pcId: 'pc2', sceneId: 'main', conditionChanges: [], newlyKnownFactIds: [] },
      ],
      narratives: { pc1: '扉が開く。', pc2: '罠の痕跡を見た。' },
      choicesByPc: [{ pcId: 'pc1', choices: ['入る'] }, { pcId: 'pc2', choices: ['調べる'] }],
      autoActions: [],
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(geminiText(plan))
      .mockResolvedValueOnce(geminiText(outcome));
    const result = await generatePartyResolution({
      session, snapshot, round, apiKey: 'key', model: 'model', fetchImpl, rng: () => 10,
    });
    expect(result.resolution).toBe('advance');
    expect(result.checkResults[0]).toMatchObject({ pcId: 'pc1', roll: 10, success: true });
    expect(result.narratives[1].audience).toEqual({ kind: 'pcs', ids: ['pc2'] });
    expect(result.globalUpdate.flags).toEqual({ door: 'open' });
    const firstPrompt = JSON.parse(fetchImpl.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(firstPrompt).toContain('扉を開く');
    expect(firstPrompt).toContain('罠を調べる');
    expect(firstPrompt).not.toContain('Partyチャット');
    expect(firstPrompt).not.toContain('Scenario秘密原文');
    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(firstBody.systemInstruction.parts[0].text).toContain('Scenario秘密原文');
    const secondBody = JSON.parse(fetchImpl.mock.calls[1][1].body);
    const secondBodyText = JSON.stringify(secondBody);
    expect(secondBodyText).not.toContain('Scenario秘密原文');
    expect(secondBody.systemInstruction.parts[0].text).not.toContain('扉を開く');
    expect(secondBody.systemInstruction.parts[0].text).not.toContain(plan.narratorBrief);
  });

  it('returns neutral vote options without generating an outcome when actions are exclusive', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(geminiText({
      resolution: 'decision_required',
      decisionQuestion: '船をどちらへ進める?',
      decisionOptions: [
        { id: 'north', label: '北へ', description: '' },
        { id: 'south', label: '南へ', description: '' },
      ],
      narratorBrief: '船の進路をPartyで選ぶ必要がある。',
      checks: [], autoActions: [],
    }));
    const result = await generatePartyResolution({ session, snapshot, round, apiKey: 'key', model: 'model', fetchImpl });
    expect(result).toMatchObject({ resolution: 'decision_required', decision: { question: '船をどちらへ進める?' } });
    expect(result.decision.options.map((item) => item.id)).toEqual(['option_1', 'option_2']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps PC-private facts out of the player-facing narrator context', async () => {
    const privateSnapshot = {
      ...snapshot,
      facts: {
        public: { text: '扉は古い', audience: { kind: 'all', ids: [] } },
        pc2Secret: { text: 'ミナだけが印章の正体を知る', audience: { kind: 'pcs', ids: ['pc2'] } },
      },
    };
    const plan = {
      resolution: 'advance', decisionQuestion: '', decisionOptions: [], autoActions: [],
      narratorBrief: '一行は扉を調べる。', checks: [],
    };
    const outcome = {
      globalUpdate: { time: '直後', historySummary: '扉を調べた', tensionLevel: 2, endingReached: false, flagUpdates: [] },
      sceneUpdates: [], pcUpdates: [],
      narratives: { pc1: '扉を調べる。', pc2: '罠の痕跡を見た。' },
      choicesByPc: [], autoActions: [],
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(geminiText(plan))
      .mockResolvedValueOnce(geminiText(outcome));

    await generatePartyResolution({
      session, snapshot: privateSnapshot, round, apiKey: 'key', model: 'model', fetchImpl,
    });

    const plannerBody = JSON.stringify(JSON.parse(fetchImpl.mock.calls[0][1].body));
    const narratorBody = JSON.stringify(JSON.parse(fetchImpl.mock.calls[1][1].body));
    expect(plannerBody).toContain('ミナだけが印章の正体を知る');
    expect(narratorBody).toContain('扉は古い');
    expect(narratorBody).not.toContain('ミナだけが印章の正体を知る');
  });

  it('blocks a privileged planner response that copies GM-only material', async () => {
    const secretSession = {
      ...session,
      gmSnapshot: {
        ...session.gmSnapshot,
        scenario: { raw: '## GM専用情報\nULTRA_SECRET_BLACK_DRAGON_92841 が黒幕。' },
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(geminiText({
      resolution: 'decision_required',
      decisionQuestion: 'どちらへ進む?',
      decisionOptions: [
        { id: 'a', label: '待つ', description: '' },
        { id: 'b', label: 'ULTRA_SECRET_BLACK_DRAGON_92841を倒す', description: '' },
      ],
      narratorBrief: '',
      checks: [],
      autoActions: [],
    }));
    await expect(generatePartyResolution({
      session: secretSession,
      snapshot,
      round,
      apiKey: 'key',
      model: 'model',
      fetchImpl,
    })).rejects.toMatchObject({ code: 'PARTY_SECRET_LEAK_BLOCKED' });
  });

  it('blocks player-facing narrative that copies GM-only material', async () => {
    const secret = 'ULTRA_SECRET_BLACK_DRAGON_92841';
    const secretSession = {
      ...session,
      gmSnapshot: {
        ...session.gmSnapshot,
        scenario: { raw: `## GM専用情報\n${secret} が黒幕。` },
      },
    };
    const plan = {
      resolution: 'advance',
      decisionQuestion: '',
      decisionOptions: [],
      narratorBrief: '扉を調べる。',
      checks: [],
      autoActions: [],
    };
    const outcome = {
      globalUpdate: { time: '直後', historySummary: '', tensionLevel: 1, endingReached: false, flagUpdates: [] },
      sceneUpdates: [],
      pcUpdates: [],
      narratives: { pc1: `${secret} が黒幕だ。`, pc2: '罠を見る。' },
      choicesByPc: [],
      autoActions: [],
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(geminiText(plan))
      .mockResolvedValueOnce(geminiText(outcome));
    await expect(generatePartyResolution({
      session: secretSession,
      snapshot,
      round,
      apiKey: 'key',
      model: 'model',
      fetchImpl,
    })).rejects.toMatchObject({ code: 'PARTY_SECRET_LEAK_BLOCKED' });
  });
});

it('reuses the saved plan and dice, makes one narrator call, and requires each PC view', async () => {
  const plan = { resolution: 'advance', sharedGoal: '帰路を見つける', narratorBrief: '', checks: [], autoActions: [], pcBriefs: [
    { pcId: 'pc1', text: '扉を見る', goal: '仲間を守る' }, { pcId: 'pc2', text: '壁を見る', goal: '文字を読む' },
  ] };
  const saved = { ...round, checkpoint: { plan, checkResults: [{ pcId: 'pc1', roll: 21, success: true }] } };
  const onProgress = vi.fn();
  const rng = vi.fn();
  const fetchImpl = vi.fn().mockResolvedValue(geminiText({
    globalUpdate: { flagUpdates: [] }, sceneUpdates: [], pcUpdates: [],
    narratives: { pc1: '仲間を守りつつ扉を押す。', pc2: '刻まれた文字を目で追う。' }, choicesByPc: [], autoActions: [],
  }));
  const result = await generatePartyResolution({ session, snapshot, round: saved, apiKey: 'key', model: 'gemini-3-flash-preview', fetchImpl, rng, onProgress });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(rng).not.toHaveBeenCalled();
  expect(result.checkResults).toEqual(saved.checkpoint.checkResults);
  expect(result.globalUpdate.sharedGoal).toBe('帰路を見つける');
  expect(result.goalsByPc.map((item) => item.goal)).toEqual(['仲間を守る', '文字を読む']);
  const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  expect(body.generationConfig.responseJsonSchema.properties.narratives.required).toEqual(['pc1', 'pc2']);
  fetchImpl.mockResolvedValue(geminiText({ narratives: { pc1: '一人分しかない' } }));
  await expect(generatePartyResolution({ session, snapshot, round: saved, apiKey: 'key', model: 'model', fetchImpl })).rejects.toMatchObject({ code: 'PARTY_MISSING_PC_VIEW' });
});

it('allows an existing personal goal only in its owner view, not the common brief or another view', async () => {
  const secret = 'ULTRA_SECRET_BLACK_DRAGON_92841';
  const ownSession = { ...session, pcs: [{ ...session.pcs[0], goal: secret }, session.pcs[1]], gmSnapshot: { ...session.gmSnapshot, scenario: { raw: `## GM専用情報\n${secret}` } } };
  const plan = { resolution: 'advance', sharedGoal: '帰る', narratorBrief: '', checks: [], autoActions: [], pcBriefs: [{ pcId: 'pc1', text: '', goal: secret }, { pcId: 'pc2', text: '', goal: '' }] };
  const response = { globalUpdate: { flagUpdates: [] }, narratives: { pc1: secret, pc2: '門を眺める。' }, pcUpdates: [], choicesByPc: [], autoActions: [] };
  const fetchImpl = vi.fn().mockResolvedValueOnce(geminiText(plan)).mockResolvedValueOnce(geminiText(response));
  await expect(generatePartyResolution({ session: ownSession, snapshot, round, apiKey: 'key', model: 'model', fetchImpl })).resolves.toMatchObject({ resolution: 'advance' });
  fetchImpl.mockResolvedValueOnce(geminiText(plan)).mockResolvedValueOnce(geminiText({ ...response, narratives: { pc1: '門を見る。', pc2: secret } }));
  await expect(generatePartyResolution({ session: ownSession, snapshot, round, apiKey: 'key', model: 'model', fetchImpl })).rejects.toMatchObject({ code: 'PARTY_SECRET_LEAK_BLOCKED' });
});
