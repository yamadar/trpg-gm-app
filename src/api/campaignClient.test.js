import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listCampaigns,
  getCampaign,
  putCampaign,
  deleteCampaign,
  getCampaignSource,
  putCampaignSource,
  getCampaignReconciliation,
  reconcileCampaignChapter,
  acceptCampaignReconciliation,
  getCampaignPitches,
  generateCampaignPitches,
  generateCampaignScenario,
} from './campaignClient.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'cp1' }) }));
});

describe('campaignClient', () => {
  it('lists campaigns for a world', async () => {
    await listCampaigns('w 1');
    expect(fetch).toHaveBeenCalledWith('/api/worlds/w%201/campaigns', undefined);
  });
  it('gets a campaign', async () => {
    await getCampaign('w1', 'c 1');
    expect(fetch).toHaveBeenCalledWith('/api/worlds/w1/campaigns/c%201', undefined);
  });
  it('PUTs a campaign body', async () => {
    const payload = { title: 'A', carriedPc: { raw: 'x', xp: 1 }, chapters: [] };
    await putCampaign('w1', 'cp1', payload);
    expect(fetch).toHaveBeenCalledWith(
      '/api/worlds/w1/campaigns/cp1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(payload) })
    );
  });
  it('DELETEs a campaign', async () => {
    await deleteCampaign('w1', 'cp1');
    expect(fetch).toHaveBeenCalledWith('/api/worlds/w1/campaigns/cp1', { method: 'DELETE' });
  });
  it('throws when the DELETE response is not ok', async () => {
    fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'boom' });
    await expect(deleteCampaign('w1', 'cp1')).rejects.toThrow(/500/);
  });

  it('reads and writes Campaign source documents', async () => {
    await getCampaignSource('w1', 'cp1', 'bible');
    expect(fetch).toHaveBeenLastCalledWith('/api/worlds/w1/campaigns/cp1/source/bible', undefined);
    await putCampaignSource('w1', 'cp1', 'cast', '# 人物');
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/worlds/w1/campaigns/cp1/source/cast',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ raw: '# 人物' }) }),
    );
  });

  it('runs and accepts chapter reconciliation', async () => {
    await getCampaignReconciliation('w1', 'cp1', 's 1');
    expect(fetch).toHaveBeenLastCalledWith('/api/worlds/w1/campaigns/cp1/chapters/s%201/reconcile', undefined);
    await reconcileCampaignChapter('w1', 'cp1', 's1');
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/worlds/w1/campaigns/cp1/chapters/s1/reconcile',
      { method: 'POST' },
    );
    const body = { summary: '決着', changes: [] };
    await acceptCampaignReconciliation('w1', 'cp1', 's1', body);
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/worlds/w1/campaigns/cp1/chapters/s1/accept',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(body) }),
    );
  });

  it('gets and generates pitches, then generates a scenario', async () => {
    await getCampaignPitches('w1', 'cp1');
    expect(fetch).toHaveBeenLastCalledWith('/api/worlds/w1/campaigns/cp1/next-pitches', undefined);
    await generateCampaignPitches('w1', 'cp1', '交渉中心');
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/worlds/w1/campaigns/cp1/next-pitches',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ requestText: '交渉中心' }) }),
    );
    await generateCampaignScenario('w1', 'cp1', 'p1', '短編');
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/worlds/w1/campaigns/cp1/next-scenario',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ pitchId: 'p1', instructions: '短編' }) }),
    );
  });
});
