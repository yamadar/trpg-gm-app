// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  applyPartyResolution,
  createPartySnapshot,
  normalizePartySettings,
  projectPartySession,
} from './partyState.js';

const pcs = [
  { id: 'pc1', characterName: 'カイ', raw: '秘密のシート1' },
  { id: 'pc2', characterName: 'ミナ', raw: '秘密のシート2' },
];

describe('partyState', () => {
  it('normalizes settings and initializes one shared scene with per-PC resources', () => {
    expect(normalizePartySettings({ maxPlayers: 99, actionTimeoutSeconds: 1 })).toMatchObject({
      maxPlayers: 6,
      actionTimeoutSeconds: 15,
      voteTimeoutSeconds: 30,
    });
    const snapshot = createPartySnapshot(pcs, { resourceDefs: [{ key: 'san', initial: 60, max: 99 }] }, 100);
    expect(snapshot.scenes.main.participantPcIds).toEqual(['pc1', 'pc2']);
    expect(snapshot.pcs.pc1.resources.san).toEqual({ value: 60, max: 99 });
    expect(snapshot.pcs.pc2.resources.san).not.toBe(snapshot.pcs.pc1.resources.san);
  });

  it('projects only the current user PC raw and audience-visible narratives', () => {
    const snapshot = createPartySnapshot(pcs, { resourceDefs: [] }, 100);
    snapshot.global.flags = { gmSecret: true };
    snapshot.scenes.hidden = { id: 'hidden', title: '地下室', location: '地下', participantPcIds: ['pc2'], summary: '秘密のScene' };
    snapshot.pcs.pc2.sceneId = 'hidden';
    snapshot.facts = {
      public: { id: 'public', text: '公開情報', audience: { kind: 'all', ids: [] } },
      pc2Secret: { id: 'pc2Secret', text: 'ミナの秘密', audience: { kind: 'pcs', ids: ['pc2'] } },
    };
    snapshot.pcs.pc1.knownFactIds = ['public', 'pc2Secret'];
    snapshot.pcs.pc2.knownFactIds = ['pc2Secret'];
    snapshot.choicesByPc = { pc1: ['正面へ'], pc2: ['地下へ'] };
    snapshot.narratives = [
      { id: 'all', audience: { kind: 'all', ids: [] }, text: '全員向け' },
      { id: 'pc1-only', audience: { kind: 'pcs', ids: ['pc1'] }, text: 'カイだけ' },
      { id: 'pc2-only', audience: { kind: 'pcs', ids: ['pc2'] }, text: 'ミナだけ' },
    ];
    const session = {
      id: 'party1', ownerId: 'u1', title: '卓', status: 'playing', settings: { viewPolicy: 'character' }, pcs,
      participants: [
        { userId: 'u1', role: 'host', pcId: 'pc1', displayName: 'A' },
        { userId: 'u2', role: 'player', pcId: 'pc2', displayName: 'B' },
      ],
    };
    const out = projectPartySession({
      session, snapshot, round: null, userId: 'u1',
      connectionOf: () => 'online', typingOf: () => false,
    });
    expect(out).not.toHaveProperty('gmSnapshot');
    expect(out.pcs.find((pc) => pc.id === 'pc1').raw).toBe('秘密のシート1');
    expect(out.pcs.find((pc) => pc.id === 'pc2')).not.toHaveProperty('raw');
    expect(out.snapshot.narratives.map((item) => item.id)).toEqual(['all', 'pc1-only']);
    expect(out.snapshot.global).not.toHaveProperty('flags');
    expect(out.snapshot.scenes).toEqual({ main: expect.objectContaining({ title: '冒頭' }) });
    expect(out.snapshot.facts).toEqual({ public: expect.objectContaining({ text: '公開情報' }) });
    expect(out.snapshot.pcs.pc1.knownFactIds).toEqual(['public']);
    expect(out.snapshot.pcs.pc2.knownFactIds).toEqual([]);
    expect(out.snapshot.choicesByPc).toEqual({ pc1: ['正面へ'] });
  });

  it('applies one result to shared state, PC scenes, resource effects and views', () => {
    const snapshot = createPartySnapshot(pcs, { resourceDefs: [{ key: 'san', initial: 60, max: 99 }] }, 100);
    const next = applyPartyResolution(snapshot, {
      globalUpdate: { time: '夕刻', historySummary: '門を越えた', tensionLevel: 4, endingReached: false, flags: { gate: 'open' } },
      sceneUpdates: [{ sceneId: 'forest', title: '森', location: '北の森', participantPcIds: ['pc2'], summary: '別行動' }],
      pcUpdates: [{ pcId: 'pc2', sceneId: 'forest', conditionChanges: ['疲労'], newlyKnownFactIds: ['fact1'] }],
      checkResults: [{ pcId: 'pc1', resourceEffect: { key: 'san', value: 55 } }],
      narratives: [{ id: 'n1', audience: { kind: 'pcs', ids: ['pc2'] }, text: '森へ入った' }],
      choicesByPc: [{ pcId: 'pc2', choices: ['進む'] }],
      autoActions: [],
    }, { roundId: 'round_1', now: 200 });
    expect(next.global).toMatchObject({ time: '夕刻', flags: { gate: 'open' } });
    expect(next.pcs.pc2).toMatchObject({ sceneId: 'forest', conditions: ['疲労'] });
    expect(next.pcs.pc1.resources.san.value).toBe(55);
    expect(next.stateRevision).toBe(1);
  });
});
