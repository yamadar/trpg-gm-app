import { describe, it, expect, vi, afterEach } from 'vitest';
import { getScenario, putScenario, listScenarios, deleteScenario } from './scenarioLibraryClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getScenario', () => {
  it('GETs a scenario', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sc1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getScenario('w1', 'sc1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/scenarios/sc1',
      expect.objectContaining({ method: 'GET' })
    );
    expect(result).toEqual({ id: 'sc1' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getScenario('w1', 'missing')).rejects.toThrow('API error 404: not found');
  });
});

describe('putScenario', () => {
  it('PUTs title, raw, ruleset, and Campaign generation provenance', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'sc1' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putScenario('w1', 'sc1', {
      title: '失踪事件',
      raw: '## シナリオ概要',
      recommendedRuleset: 'coc7e',
      sourceCampaignId: 'cp1',
      sourceCampaignRevision: 3,
      generatedFromPitchId: 'p1',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/scenarios/sc1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          title: '失踪事件',
          raw: '## シナリオ概要',
          recommendedRuleset: 'coc7e',
          sourceCampaignId: 'cp1',
          sourceCampaignRevision: 3,
          generatedFromPitchId: 'p1',
        }),
      })
    );
  });
});

describe('listScenarios', () => {
  it('GETs the list for a world', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: 'sc1' }] });
    vi.stubGlobal('fetch', fetchMock);
    const result = await listScenarios('w1');
    expect(fetchMock).toHaveBeenCalledWith('/api/worlds/w1/scenarios', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual([{ id: 'sc1' }]);
  });
});

describe('deleteScenario', () => {
  it('DELETEs a scenario and does not attempt to parse a body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteScenario('w1', 'sc1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w1/scenarios/sc1',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('throws on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteScenario('w1', 'sc1')).rejects.toThrow('API error 500: boom');
  });
});

describe('URL encoding', () => {
  it('encodes worldId/id segments for getScenario', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    await getScenario('w#1', 's/2');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/worlds/w%231/scenarios/s%2F2',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
