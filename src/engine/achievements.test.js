import { describe, it, expect } from 'vitest';
import { evaluateAchievements } from './achievements.js';
import { CATALOG } from './achievementCatalog.js';

function ending(overrides = {}) {
  return {
    sessionId: 's1',
    endedAt: 1000,
    worldId: null,
    campaignId: null,
    stats: { total: 20, byDegree: { fumble: 1, fail: 5, success: 13, critical: 1 }, resources: {} },
    ...overrides,
  };
}

function find(list, id) {
  return list.find((a) => a.id === id);
}

describe('evaluateAchievements', () => {
  it('returns the whole catalogue unearned for an empty collection', () => {
    const result = evaluateAchievements([]);
    expect(result.length).toBe(CATALOG.length);
    expect(result.every((a) => a.earned === false)).toBe(true);
    expect(result.every((a) => a.earnedAt === null && a.sessionId === null)).toBe(true);
    expect(result.every((a) => typeof a.label === 'string' && typeof a.description === 'string')).toBe(true);
  });

  it('tolerates a null collection', () => {
    expect(evaluateAchievements(null).length).toBe(CATALOG.length);
  });

  it('earns 初めての結末 on the first ending', () => {
    const result = evaluateAchievements([ending({ sessionId: 'a', endedAt: 5 })]);
    expect(find(result, 'first-ending')).toMatchObject({ earned: true, earnedAt: 5, sessionId: 'a' });
  });

  it('earns 三つの結末 only at the third ending, crediting that ending', () => {
    const two = [ending({ sessionId: 'a', endedAt: 1 }), ending({ sessionId: 'b', endedAt: 2 })];
    expect(find(evaluateAchievements(two), 'three-endings').earned).toBe(false);

    const three = [...two, ending({ sessionId: 'c', endedAt: 3 })];
    expect(find(evaluateAchievements(three), 'three-endings')).toMatchObject({
      earned: true,
      earnedAt: 3,
      sessionId: 'c',
    });
  });

  it('credits the earliest qualifying ending regardless of input order', () => {
    const result = evaluateAchievements([
      ending({ sessionId: 'late', endedAt: 900 }),
      ending({ sessionId: 'early', endedAt: 100 }),
    ]);
    expect(find(result, 'first-ending')).toMatchObject({ earnedAt: 100, sessionId: 'early' });
  });

  it('earns 一つの世界の三つの結末 only when three endings share a world', () => {
    const mixed = [
      ending({ sessionId: 'a', endedAt: 1, worldId: 'w1' }),
      ending({ sessionId: 'b', endedAt: 2, worldId: 'w1' }),
      ending({ sessionId: 'c', endedAt: 3, worldId: 'w2' }),
    ];
    expect(find(evaluateAchievements(mixed), 'world-trilogy').earned).toBe(false);

    const sameWorld = [...mixed, ending({ sessionId: 'd', endedAt: 4, worldId: 'w1' })];
    expect(find(evaluateAchievements(sameWorld), 'world-trilogy')).toMatchObject({ earned: true, sessionId: 'd' });
  });

  it('does not group endings that have no world', () => {
    const noWorld = [
      ending({ sessionId: 'a', endedAt: 1, worldId: null }),
      ending({ sessionId: 'b', endedAt: 2, worldId: null }),
      ending({ sessionId: 'c', endedAt: 3, worldId: null }),
    ];
    expect(find(evaluateAchievements(noWorld), 'world-trilogy').earned).toBe(false);
  });

  it('earns 無傷の旅路 only when the ending had rolls and no fumble', () => {
    const clean = ending({ stats: { total: 5, byDegree: { fumble: 0, fail: 2, success: 3, critical: 0 }, resources: {} } });
    expect(find(evaluateAchievements([clean]), 'flawless').earned).toBe(true);

    const fumbled = ending({ stats: { total: 5, byDegree: { fumble: 1, fail: 1, success: 3, critical: 0 }, resources: {} } });
    expect(find(evaluateAchievements([fumbled]), 'flawless').earned).toBe(false);

    const noRolls = ending({ stats: { total: 0, byDegree: { fumble: 0, fail: 0, success: 0, critical: 0 }, resources: {} } });
    expect(find(evaluateAchievements([noRolls]), 'flawless').earned).toBe(false);
  });

  it('earns 豪運 at three criticals, not two', () => {
    const two = ending({ stats: { total: 9, byDegree: { fumble: 0, fail: 4, success: 3, critical: 2 }, resources: {} } });
    expect(find(evaluateAchievements([two]), 'lucky').earned).toBe(false);

    const three = ending({ stats: { total: 9, byDegree: { fumble: 0, fail: 3, success: 3, critical: 3 }, resources: {} } });
    expect(find(evaluateAchievements([three]), 'lucky').earned).toBe(true);
  });

  it('earns 厄日 at three fumbles, not two', () => {
    const two = ending({ stats: { total: 9, byDegree: { fumble: 2, fail: 4, success: 3, critical: 0 }, resources: {} } });
    expect(find(evaluateAchievements([two]), 'cursed').earned).toBe(false);

    const three = ending({ stats: { total: 9, byDegree: { fumble: 3, fail: 3, success: 3, critical: 0 }, resources: {} } });
    expect(find(evaluateAchievements([three]), 'cursed').earned).toBe(true);
  });

  it('earns 瀬戸際の生還 at sanity 10, not 11', () => {
    const eleven = ending({ stats: { total: 5, byDegree: {}, resources: { san: { label: '正気度', value: 11, max: 99 } } } });
    expect(find(evaluateAchievements([eleven]), 'brink').earned).toBe(false);

    const ten = ending({ stats: { total: 5, byDegree: {}, resources: { san: { label: '正気度', value: 10, max: 99 } } } });
    expect(find(evaluateAchievements([ten]), 'brink').earned).toBe(true);
  });

  it('never earns 瀬戸際の生還 for a ruleset without sanity', () => {
    expect(find(evaluateAchievements([ending()]), 'brink').earned).toBe(false);
  });

  it('earns 短編 at ten rolls, not eleven, and not zero', () => {
    const ten = ending({ stats: { total: 10, byDegree: {}, resources: {} } });
    expect(find(evaluateAchievements([ten]), 'short-story').earned).toBe(true);

    const eleven = ending({ stats: { total: 11, byDegree: {}, resources: {} } });
    expect(find(evaluateAchievements([eleven]), 'short-story').earned).toBe(false);

    const zero = ending({ stats: { total: 0, byDegree: {}, resources: {} } });
    expect(find(evaluateAchievements([zero]), 'short-story').earned).toBe(false);
  });

  it('tolerates a record with no stats at all', () => {
    const bare = { sessionId: 'x', endedAt: 1, worldId: null };
    const result = evaluateAchievements([bare]);
    expect(find(result, 'first-ending').earned).toBe(true);
    expect(find(result, 'flawless').earned).toBe(false);
    expect(find(result, 'brink').earned).toBe(false);
  });

  it('carries the catalogue metadata through to the result', () => {
    const result = evaluateAchievements([]);
    // first-ending は Task 2 で計数対象になったので progress も検証する
    // (未着手なら current: 0)。progress を持たない実績は別途 'brink' で確認する。
    const first = result.find((a) => a.id === 'first-ending');
    expect(first).toMatchObject({ category: 'arrival', tier: 1, icon: 'flag', progress: { current: 0, target: 1 } });
    expect(find(result, 'brink').progress).toBeNull();
  });

  it('returns entries in catalogue order', () => {
    expect(evaluateAchievements([]).map((a) => a.id)).toEqual(CATALOG.map((a) => a.id));
  });
});

describe('arrival achievements', () => {
  function endings(n) {
    return Array.from({ length: n }, (_, i) => ending({ sessionId: `s${i}`, endedAt: i + 1 }));
  }

  it('earns 十の結末 at the tenth ending, not the ninth', () => {
    expect(find(evaluateAchievements(endings(9)), 'ten-endings').earned).toBe(false);
    expect(find(evaluateAchievements(endings(10)), 'ten-endings')).toMatchObject({ earned: true, earnedAt: 10 });
  });

  it('reports progress toward the count and caps it at the target', () => {
    expect(find(evaluateAchievements(endings(3)), 'ten-endings').progress).toEqual({ current: 3, target: 10 });
    expect(find(evaluateAchievements(endings(12)), 'ten-endings').progress).toEqual({ current: 10, target: 10 });
  });

  it('leaves progress null for achievements that are not countable', () => {
    expect(find(evaluateAchievements(endings(1)), 'flawless').progress).toBeNull();
  });
});

describe('world achievements', () => {
  it('earns 一つの世界の五つの結末 only on the fifth ending in the same world', () => {
    const four = [1, 2, 3, 4].map((i) => ending({ sessionId: `s${i}`, endedAt: i, worldId: 'w1' }));
    expect(find(evaluateAchievements(four), 'world-five').earned).toBe(false);
    expect(find(evaluateAchievements(four), 'world-five').progress).toEqual({ current: 4, target: 5 });

    const five = [...four, ending({ sessionId: 's5', endedAt: 5, worldId: 'w1' })];
    expect(find(evaluateAchievements(five), 'world-five')).toMatchObject({ earned: true, sessionId: 's5' });
  });

  it('counts distinct worlds for 三つの世界 and ignores endings without a world', () => {
    const list = [
      ending({ sessionId: 'a', endedAt: 1, worldId: 'w1' }),
      ending({ sessionId: 'b', endedAt: 2, worldId: 'w2' }),
      ending({ sessionId: 'c', endedAt: 3, worldId: null }),
    ];
    expect(find(evaluateAchievements(list), 'worlds-three')).toMatchObject({
      earned: false,
      progress: { current: 2, target: 3 },
    });

    const withThird = [...list, ending({ sessionId: 'd', endedAt: 4, worldId: 'w3' })];
    expect(find(evaluateAchievements(withThird), 'worlds-three')).toMatchObject({ earned: true, sessionId: 'd' });
  });

  it('groups by campaign for 章を重ねて', () => {
    const one = [ending({ sessionId: 'a', endedAt: 1, campaignId: 'c1' })];
    expect(find(evaluateAchievements(one), 'campaign-two').earned).toBe(false);

    const two = [...one, ending({ sessionId: 'b', endedAt: 2, campaignId: 'c1' })];
    expect(find(evaluateAchievements(two), 'campaign-two')).toMatchObject({ earned: true, sessionId: 'b' });
  });
});
