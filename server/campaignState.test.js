// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { applyCampaignChanges, emptyCampaignState, normalizeCampaignState } from './campaignState.js';

describe('campaignState', () => {
  it('normalizes missing and malformed collections', () => {
    expect(normalizeCampaignState({ characters: null, timeline: [{ id: 'clock' }] })).toEqual({
      ...emptyCampaignState(),
      timeline: [{ id: 'clock' }],
    });
  });

  it('applies accepted facts, records, clocks, and threads', () => {
    const result = applyCampaignChanges(emptyCampaignState(), [
      { id: 'c1', kind: 'canon_fact_add', title: '橋が落ちた', details: '渡れない' },
      { id: 'c2', kind: 'character_upsert', targetId: 'npc_iris', title: 'イリス', status: 'missing' },
      { id: 'c3', kind: 'faction_upsert', targetId: 'guild', title: '商人組合', status: 'hostile' },
      { id: 'c4', kind: 'timeline_upsert', targetId: 'ritual', title: '儀式', status: 'delayed', progress: 140 },
      { id: 'c5', kind: 'thread_open', targetId: 'sigil', title: '黒い印章' },
    ]);

    expect(result.canonFacts[0]).toMatchObject({ id: 'c1', title: '橋が落ちた' });
    expect(result.characters[0]).toMatchObject({ id: 'npc_iris', status: 'missing' });
    expect(result.factions[0]).toMatchObject({ id: 'guild', status: 'hostile' });
    expect(result.timeline[0]).toMatchObject({ id: 'ritual', status: 'delayed', progress: 100 });
    expect(result.openThreads[0]).toMatchObject({ id: 'sigil', title: '黒い印章' });
  });

  it('upserts existing records and removes a resolved thread', () => {
    const current = {
      ...emptyCampaignState(),
      characters: [{ id: 'npc_iris', title: 'イリス', status: 'alive', details: '' }],
      openThreads: [{ id: 'sigil', title: '黒い印章' }],
    };
    const result = applyCampaignChanges(current, [
      { id: 'edit', kind: 'character_upsert', targetId: 'npc_iris', title: 'イリス', status: 'dead' },
      { id: 'resolve', kind: 'thread_resolve', targetId: 'sigil' },
    ]);

    expect(result.characters).toHaveLength(1);
    expect(result.characters[0].status).toBe('dead');
    expect(result.openThreads).toEqual([]);
  });
});
