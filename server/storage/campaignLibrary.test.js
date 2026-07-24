// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { saveCampaign, getCampaign, listCampaigns, deleteCampaign } from './campaignLibrary.js';

let dir, dataStore;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'campaign-test-'));
  dataStore = createFsDataStore(dir);
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
    await saveCampaign(dataStore, 'u', { id: 'cp1', worldId: 'w1', title: 'A', carriedPc: { raw: 'x', xp: 0 }, chapters: [] });
    await saveCampaign(dataStore, 'u', { id: 'cp2', worldId: 'w1', title: 'B', carriedPc: { raw: 'y', xp: 0 }, chapters: [] });
    const list = await listCampaigns(dataStore, 'u', 'w1');
    expect(list.map((c) => c.id).sort()).toEqual(['cp1', 'cp2']);
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
});
