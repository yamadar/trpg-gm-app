// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsTextStore } from './textStore.js';
import {
  saveCampaign,
  getCampaign,
  listCampaigns,
  deleteCampaign,
  saveCampaignSource,
  getCampaignSource,
  saveCampaignDraft,
  getCampaignDraft,
  saveCampaignPitches,
  getCampaignPitches,
} from './campaignLibrary.js';

let dir, dataStore, textStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'campaign-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('campaignLibrary', () => {
  it('saves and retrieves a campaign', async () => {
    const saved = await saveCampaign(dataStore, 'u', {
      id: 'cp1',
      worldId: 'w1',
      title: '影の連鎖',
      carriedPc: { raw: 'PC名: カイ', xp: 12 },
      chapters: [{ sessionId: 's1', title: '第一章', endedAt: 1 }],
    });
    expect(saved.updatedAt).toBeTypeOf('number');
    expect(saved.createdAt).toBeTypeOf('number');
    const got = await getCampaign(dataStore, 'u', 'w1', 'cp1');
    expect(got.title).toBe('影の連鎖');
    expect(got.carriedPc).toEqual({ raw: 'PC名: カイ', xp: 12 });
    expect(got.chapters).toHaveLength(1);
  });
  it('preserves createdAt on update and refreshes updatedAt', async () => {
    const first = await saveCampaign(dataStore, 'u', { id: 'cp1', worldId: 'w1', title: 'A', carriedPc: { raw: 'x', xp: 0 }, chapters: [] });
    const second = await saveCampaign(dataStore, 'u', { id: 'cp1', worldId: 'w1', title: 'B', carriedPc: { raw: 'y', xp: 3 }, chapters: [] });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.title).toBe('B');
  });
  it('lists campaigns for a world', async () => {
    await saveCampaign(dataStore, 'u', {
      id: 'cp1',
      worldId: 'w1',
      title: 'A',
      carriedPc: { raw: 'x', xp: 0 },
      chapters: [{ sessionId: 's1', outcome: { summary: '秘密の結末' } }],
      currentState: { canonFacts: [{ id: 'fact', title: '秘密' }] },
      directorGuide: { premise: '非公開' },
    });
    await saveCampaign(dataStore, 'u', { id: 'cp2', worldId: 'w1', title: 'B', carriedPc: { raw: 'y', xp: 0 }, chapters: [] });
    const list = await listCampaigns(dataStore, 'u', 'w1');
    expect(list.map((c) => c.id).sort()).toEqual(['cp1', 'cp2']);
    const first = list.find((campaign) => campaign.id === 'cp1');
    expect(first).not.toHaveProperty('currentState');
    expect(first).not.toHaveProperty('directorGuide');
    expect(first.chapters[0]).not.toHaveProperty('outcome');
  });
  it('returns null for a missing campaign', async () => {
    expect(await getCampaign(dataStore, 'u', 'w1', 'nope')).toBeNull();
  });
  it('deletes a campaign so it is no longer retrievable', async () => {
    await saveCampaign(dataStore, 'u', { id: 'cp1', worldId: 'w1', title: 'A', carriedPc: { raw: 'x', xp: 0 }, chapters: [] });
    await deleteCampaign(dataStore, 'u', 'w1', 'cp1');
    expect(await getCampaign(dataStore, 'u', 'w1', 'cp1')).toBeNull();
  });
  it('does not throw when deleting a missing campaign', async () => {
    await expect(deleteCampaign(dataStore, 'u', 'w1', 'nope')).resolves.toBeUndefined();
  });

  it('stores source documents, reconciliation drafts, and next pitches separately', async () => {
    await saveCampaignSource(textStore, 'u', 'w1', 'cp1', 'bible', '# 固定事項');
    await saveCampaignDraft(dataStore, 'u', 'w1', 'cp1', 's1', { status: 'ready' });
    await saveCampaignPitches(dataStore, 'u', 'w1', 'cp1', { basedOnCanonRevision: 2, pitches: [] });

    expect(await getCampaignSource(textStore, 'u', 'w1', 'cp1', 'bible')).toBe('# 固定事項');
    expect(await getCampaignDraft(dataStore, 'u', 'w1', 'cp1', 's1')).toEqual({ status: 'ready' });
    expect(await getCampaignPitches(dataStore, 'u', 'w1', 'cp1')).toEqual({
      basedOnCanonRevision: 2,
      pitches: [],
    });
  });

  it('deletes source documents, drafts, and pitches with the campaign', async () => {
    await saveCampaign(dataStore, 'u', {
      id: 'cp1', worldId: 'w1', title: 'A', carriedPc: { raw: 'x', xp: 0 }, chapters: [],
    });
    await saveCampaignSource(textStore, 'u', 'w1', 'cp1', 'cast', '# 人物');
    await saveCampaignDraft(dataStore, 'u', 'w1', 'cp1', 's1', { status: 'ready' });
    await saveCampaignPitches(dataStore, 'u', 'w1', 'cp1', { pitches: [{ id: 'p1' }] });

    await deleteCampaign(dataStore, textStore, 'u', 'w1', 'cp1');

    expect(await getCampaign(dataStore, 'u', 'w1', 'cp1')).toBeNull();
    expect(await getCampaignSource(textStore, 'u', 'w1', 'cp1', 'cast')).toBe('');
    expect(await getCampaignDraft(dataStore, 'u', 'w1', 'cp1', 's1')).toBeNull();
    expect(await getCampaignPitches(dataStore, 'u', 'w1', 'cp1')).toBeNull();
  });
});
