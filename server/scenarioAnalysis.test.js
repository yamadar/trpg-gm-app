// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  analyzeScenarioForPlay,
  SCENARIO_DIRECTOR_GUIDE_FORMAT,
} from './scenarioAnalysis.js';

const GUIDE = {
  summary: '村の井戸を巡る異変を解決する。',
  player_goal: '井戸の異変を解決する',
  opening_hook: '村人から調査を頼まれる',
  phases: [
    {
      title: '調査',
      purpose: '原因を知る',
      key_events: ['井戸を調べる'],
      clues: ['封印石'],
      completion_conditions: ['封印石を発見する'],
      next_phase_guidance: '井戸の底へ誘導する',
    },
  ],
  branches: [],
  climax: {
    trigger: '封印石へ到達する',
    required_setup: ['封印石を発見済み'],
    resolution_choices: ['封印を守る', '封印を解く'],
  },
  endings: [
    {
      title: '封印を守る',
      conditions: ['封印を守る選択をする'],
      outcome: '村に水が戻る',
    },
  ],
  ending_signals: ['封印への最終判断と結果の描写が完了する'],
  fail_forward: '別の村人が井戸の異変を知らせる',
};

describe('analyzeScenarioForPlay', () => {
  it('sends unchanged source text and returns a versioned director guide', async () => {
    const raw = '  ## GM専用情報\n封印石が原因。\n';
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: JSON.stringify(GUIDE) }] },
          },
        ],
      }),
    });

    const result = await analyzeScenarioForPlay({
      title: '涸れた井戸',
      raw,
      apiKey: 'key',
      model: 'model',
      fetchImpl,
    });

    expect(result).toEqual({ schemaVersion: 1, ...GUIDE });
    const upstreamBody = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(upstreamBody.contents[0].parts[0].text).toContain(raw);
    expect(upstreamBody.generationConfig.responseJsonSchema).toEqual(
      SCENARIO_DIRECTOR_GUIDE_FORMAT.schema,
    );
    expect(upstreamBody.systemInstruction.parts[0].text).toContain('source of truth');
    expect(upstreamBody.systemInstruction.parts[0].text).toContain('いつ物語を終えるか');
  });

  it('rejects truncated analysis instead of saving a partial guide', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            finishReason: 'MAX_TOKENS',
            content: { parts: [{ text: JSON.stringify(GUIDE) }] },
          },
        ],
      }),
    });

    await expect(
      analyzeScenarioForPlay({
        title: '題',
        raw: '原文',
        apiKey: 'key',
        model: 'model',
        fetchImpl,
      }),
    ).rejects.toThrow('truncated');
  });
});
