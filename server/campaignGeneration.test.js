// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  reconcileCampaignChapter,
  generateCampaignPitches,
  generateCampaignScenario,
} from './campaignGeneration.js';

function geminiText(text, finishReason = 'STOP') {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ finishReason, content: { parts: [{ text }] } }],
    }),
  };
}

const campaign = {
  id: 'cp1',
  title: '影の連鎖',
  canonRevision: 2,
  carriedPc: { raw: 'PC名: カイ', xp: 8 },
  chapters: [],
  currentState: { canonFacts: [], characters: [], factions: [], timeline: [], openThreads: [] },
};
const sources = { bible: '# 原典', cast: '# イリス', timeline: '# 三日後に儀式' };

describe('campaignGeneration', () => {
  it('sends the complete numbered session log and parses a reconciliation proposal', async () => {
    const output = {
      summary: '橋が落ちた。',
      proposed_pc_raw: 'PC名: カイ\n所持品: 印章',
      changes: [],
    };
    const fetchImpl = vi.fn().mockResolvedValue(geminiText(JSON.stringify(output)));
    const session = {
      pc: { raw: 'PC名: カイ' },
      scenario: { raw: '# 第一話' },
      state: { turn_count: 2 },
      log: [
        { role: 'gm', text: '追手が迫る。' },
        { role: 'player', text: '橋を爆破する。', roll: { check_label: '工作', roll: 12, degree: '成功' } },
        { role: 'player', source: 'auto', characterName: 'ミナ', text: '仲間を援護する。', reason: '締切まで入力がなかった' },
      ],
    };

    await expect(reconcileCampaignChapter({
      campaign,
      sources,
      worldRaw: '# World',
      session,
      apiKey: 'key',
      model: 'model',
      fetchImpl,
    })).resolves.toEqual(output);

    const upstreamBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const prompt = upstreamBody.contents[0].parts[0].text;
    expect(prompt).toContain('[0] GM: 追手が迫る。');
    expect(prompt).toContain('[1] PL: 橋を爆破する。 [判定: 工作 12 成功]');
    expect(prompt).toContain('[2] AI同行(ミナ): 仲間を援護する。 [理由: 締切まで入力がなかった]');
    expect(upstreamBody.generationConfig.responseMimeType).toBe('application/json');
  });

  it('parses structured next-story pitches grounded in the approved canon revision', async () => {
    const output = {
      pitches: [
        {
          title: '灰の密使', hook: '密使が来る', central_conflict: '印章争奪',
          involved_characters: ['密使'], threads: ['印章'], timeline_effects: [],
          continuity_reasons: ['前章の戦利品'], tone: '交渉', estimated_length: '2時間', consistency_notes: [],
        },
        {
          title: '川底の門', hook: '門が開く', central_conflict: '封印',
          involved_characters: [], threads: [], timeline_effects: [],
          continuity_reasons: ['橋の崩落'], tone: '探索', estimated_length: '3時間', consistency_notes: [],
        },
      ],
    };
    const fetchImpl = vi.fn().mockResolvedValue(geminiText(JSON.stringify(output)));

    await expect(generateCampaignPitches({
      campaign,
      sources,
      worldRaw: '# World',
      requestText: '交渉中心',
      apiKey: 'key',
      model: 'model',
      fetchImpl,
    })).resolves.toEqual(output);

    const prompt = JSON.parse(fetchImpl.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(prompt).toContain('# GM承認済み正史');
    expect(prompt).toContain('交渉中心');
  });

  it('returns editable Markdown for the selected pitch and rejects truncated output', async () => {
    const pitch = { id: 'p1', title: '灰の密使', hook: '密使が来る' };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(geminiText('```markdown\n## シナリオ概要\n密使を救う。\n```'))
      .mockResolvedValueOnce(geminiText('途中', 'MAX_TOKENS'));

    await expect(generateCampaignScenario({
      campaign,
      sources,
      worldRaw: '# World',
      pitch,
      instructions: '短編',
      apiKey: 'key',
      model: 'model',
      fetchImpl,
    })).resolves.toEqual({ title: '灰の密使', raw: '## シナリオ概要\n密使を救う。' });

    await expect(generateCampaignScenario({
      campaign,
      sources,
      worldRaw: '# World',
      pitch,
      instructions: '',
      apiKey: 'key',
      model: 'model',
      fetchImpl,
    })).rejects.toThrow('truncated');
  });
});
