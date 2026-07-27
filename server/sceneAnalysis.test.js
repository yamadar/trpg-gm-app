// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { analyzeScene } from './sceneAnalysis.js';

function geminiJson(obj) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }],
    }),
  };
}

describe('analyzeScene', () => {
  it('returns empty without calling the API when no key is set', async () => {
    const fetchImpl = vi.fn();
    const out = await analyzeScene({ narrative: 'x', apiKey: undefined, fetchImpl });
    expect(out).toEqual({ presentNames: [], newAppearances: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('parses present names and newly generated appearances', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      geminiJson({ present_names: ['カイ', 'ゴブリンの長'], new_appearances: [{ name: 'ゴブリンの長', description: '緑の肌、赤い眼帯' }] })
    );
    const out = await analyzeScene({ narrative: '戦い', registry: {}, pcRaw: '', apiKey: 'k', fetchImpl });
    expect(out.presentNames).toEqual(['カイ', 'ゴブリンの長']);
    expect(out.newAppearances).toEqual([{ name: 'ゴブリンの長', description: '緑の肌、赤い眼帯' }]);
  });
  it('filters malformed entries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      geminiJson({ present_names: ['A', 'B', 5], new_appearances: [{ name: 'A' }, { name: 'B', description: 'ok' }] })
    );
    const out = await analyzeScene({ narrative: 'x', apiKey: 'k', fetchImpl });
    expect(out.presentNames).toEqual(['A', 'B']);
    expect(out.newAppearances).toEqual([{ name: 'B', description: 'ok' }]);
  });
  it('drops appearances for characters who are only mentioned, not present', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      geminiJson({
        present_names: ['ゲオルク'],
        new_appearances: [
          { name: 'ゲオルク', description: '白髪の老人、厚手の外套' },
          { name: 'ハンス', description: 'ゲオルクの息子。この場面には登場せず言及されるのみ' },
        ],
      })
    );
    const out = await analyzeScene({ narrative: 'x', apiKey: 'k', fetchImpl });
    expect(out.newAppearances).toEqual([{ name: 'ゲオルク', description: '白髪の老人、厚手の外套' }]);
  });
  it('returns empty when the API responds not-ok', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await analyzeScene({ narrative: 'x', apiKey: 'k', fetchImpl })).toEqual({ presentNames: [], newAppearances: [] });
  });
  it('returns empty when the API throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('down'));
    expect(await analyzeScene({ narrative: 'x', apiKey: 'k', fetchImpl })).toEqual({ presentNames: [], newAppearances: [] });
  });
});
