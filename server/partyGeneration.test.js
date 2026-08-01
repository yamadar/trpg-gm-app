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
      checks: [{ pcId: 'pc1', checkLabel: '扉', successPercent: 70, checkKind: 'normal', supportPcIds: ['pc2'] }],
    };
    const outcome = {
      globalUpdate: { time: '直後', historySummary: '扉を開けた', tensionLevel: 2, endingReached: false, flagUpdates: [{ key: 'door', value: 'open' }] },
      sceneUpdates: [{ sceneId: 'main', title: '扉前', location: '遺跡', participantPcIds: ['pc1', 'pc2'], summary: '扉が開いた' }],
      pcUpdates: [
        { pcId: 'pc1', sceneId: 'main', conditionChanges: [], newlyKnownFactIds: [] },
        { pcId: 'pc2', sceneId: 'main', conditionChanges: [], newlyKnownFactIds: [] },
      ],
      narratives: [
        { id: 'shared', audienceKind: 'all', audienceIds: [], text: '扉が開く。' },
        { id: 'mina', audienceKind: 'pcs', audienceIds: ['pc2'], text: '罠の痕跡を見た。' },
      ],
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
  });

  it('returns neutral vote options without generating an outcome when actions are exclusive', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(geminiText({
      resolution: 'decision_required',
      decisionQuestion: '船をどちらへ進める?',
      decisionOptions: [
        { id: 'north', label: '北へ', description: '' },
        { id: 'south', label: '南へ', description: '' },
      ],
      checks: [], autoActions: [],
    }));
    const result = await generatePartyResolution({ session, snapshot, round, apiKey: 'key', model: 'model', fetchImpl });
    expect(result).toMatchObject({ resolution: 'decision_required', decision: { question: '船をどちらへ進める?' } });
    expect(result.decision.options.map((item) => item.id)).toEqual(['option_1', 'option_2']);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
