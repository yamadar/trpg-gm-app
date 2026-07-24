// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { analyzeScene } from './sceneAnalysis.js';

function anthropicJson(obj) {
  return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] }) };
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
      anthropicJson({ present_names: ['カイ', 'ゴブリンの長'], new_appearances: [{ name: 'ゴブリンの長', description: '緑の肌、赤い眼帯' }] })
    );
    const out = await analyzeScene({ narrative: '戦い', registry: {}, pcRaw: '', apiKey: 'k', fetchImpl });
    expect(out.presentNames).toEqual(['カイ', 'ゴブリンの長']);
    expect(out.newAppearances).toEqual([{ name: 'ゴブリンの長', description: '緑の肌、赤い眼帯' }]);
  });
  it('filters malformed entries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      anthropicJson({ present_names: ['A', 5], new_appearances: [{ name: 'A' }, { name: 'B', description: 'ok' }] })
    );
    const out = await analyzeScene({ narrative: 'x', apiKey: 'k', fetchImpl });
    expect(out.presentNames).toEqual(['A']);
    expect(out.newAppearances).toEqual([{ name: 'B', description: 'ok' }]);
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
