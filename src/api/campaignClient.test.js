import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listCampaigns, getCampaign, putCampaign, deleteCampaign } from './campaignClient.js';

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
});
