import { describe, it, expect } from 'vitest';
import { evaluateAchievements } from './achievements.js';
import { CATALOG } from './achievementCatalog.js';
import { MOODS } from '../constants/moods.js';

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

describe('mood achievements', () => {
  it('earns the per-mood achievement from any ending carrying that mood', () => {
    const list = [ending({ sessionId: 'a', endedAt: 1, moods: ['ホラー', 'ミステリー'] })];
    expect(find(evaluateAchievements(list), 'mood-horror')).toMatchObject({ earned: true, sessionId: 'a' });
    expect(find(evaluateAchievements(list), 'mood-mystery').earned).toBe(true);
    expect(find(evaluateAchievements(list), 'mood-comedy').earned).toBe(false);
  });

  it('earns 八色の物語 only when all eight moods have been reached', () => {
    const seven = MOODS.slice(0, 7).map((m, i) => ending({ sessionId: `s${i}`, endedAt: i + 1, moods: [m] }));
    expect(find(evaluateAchievements(seven), 'mood-all')).toMatchObject({
      earned: false,
      progress: { current: 7, target: 8 },
    });

    const eight = [...seven, ending({ sessionId: 'last', endedAt: 8, moods: [MOODS[7]] })];
    expect(find(evaluateAchievements(eight), 'mood-all')).toMatchObject({ earned: true, sessionId: 'last' });
  });

  it('earns 混ざりあう色 from a single ending with three moods', () => {
    const two = [ending({ sessionId: 'a', endedAt: 1, moods: ['ホラー', 'SF'] })];
    expect(find(evaluateAchievements(two), 'mood-blend').earned).toBe(false);

    const three = [ending({ sessionId: 'a', endedAt: 1, moods: ['ホラー', 'SF', '日常'] })];
    expect(find(evaluateAchievements(three), 'mood-blend').earned).toBe(true);
  });

  it('tolerates endings without moods', () => {
    const list = [ending({ sessionId: 'a', endedAt: 1 })];
    expect(find(evaluateAchievements(list), 'mood-horror').earned).toBe(false);
  });
});

describe('roll achievements', () => {
  function withStats(stats, overrides = {}) {
    return ending({ stats: { byDegree: {}, resources: {}, ...stats }, ...overrides });
  }

  it('earns 長編 at fifty rolls, not at forty-nine', () => {
    expect(find(evaluateAchievements([withStats({ total: 49 })]), 'long-story').earned).toBe(false);
    expect(find(evaluateAchievements([withStats({ total: 50 })]), 'long-story').earned).toBe(true);
  });

  it('sums rolls across endings for 百の判定 and caps the progress', () => {
    const list = [
      withStats({ total: 60 }, { sessionId: 'a', endedAt: 1 }),
      withStats({ total: 39 }, { sessionId: 'b', endedAt: 2 }),
    ];
    expect(find(evaluateAchievements(list), 'rolls-100')).toMatchObject({
      earned: false,
      progress: { current: 99, target: 100 },
    });

    const third = [...list, withStats({ total: 1 }, { sessionId: 'c', endedAt: 3 })];
    expect(find(evaluateAchievements(third), 'rolls-100')).toMatchObject({ earned: true, sessionId: 'c' });
  });

  it('earns 手練れ at a success rate of exactly 0.8 with enough rolls', () => {
    expect(find(evaluateAchievements([withStats({ total: 10, successRate: 0.79 })]), 'adept').earned).toBe(false);
    expect(find(evaluateAchievements([withStats({ total: 10, successRate: 0.8 })]), 'adept').earned).toBe(true);
    // 判定が少ないうちは成功率が偶然に振れるので、10回に満たない記録では成立させない
    expect(find(evaluateAchievements([withStats({ total: 9, successRate: 1 })]), 'adept').earned).toBe(false);
  });

  it('earns 苦難の道 at a success rate of exactly 0.3', () => {
    expect(find(evaluateAchievements([withStats({ total: 10, successRate: 0.31 })]), 'ordeal').earned).toBe(false);
    expect(find(evaluateAchievements([withStats({ total: 10, successRate: 0.3 })]), 'ordeal').earned).toBe(true);
  });
});

describe('fate achievements', () => {
  function withDegrees(byDegree, overrides = {}) {
    return ending({ stats: { total: 30, byDegree, resources: {} }, ...overrides });
  }

  it('earns 完全なる旅路 only with thirty rolls and no fumble', () => {
    expect(find(evaluateAchievements([withDegrees({ fumble: 0 })]), 'flawless-long').earned).toBe(true);
    expect(
      find(evaluateAchievements([ending({ stats: { total: 29, byDegree: { fumble: 0 }, resources: {} } })]), 'flawless-long')
        .earned
    ).toBe(false);
    expect(find(evaluateAchievements([withDegrees({ fumble: 1 })]), 'flawless-long').earned).toBe(false);
  });

  it('earns 明暗 only when one ending has both three criticals and three fumbles', () => {
    expect(find(evaluateAchievements([withDegrees({ critical: 3, fumble: 2 })]), 'tempest').earned).toBe(false);
    expect(find(evaluateAchievements([withDegrees({ critical: 3, fumble: 3 })]), 'tempest').earned).toBe(true);
  });

  it('treats degrees missing from the ruleset as zero', () => {
    // simple/dnd5e/gurps は byDegree に hard/extreme を持たないので、成立しないだけで壊れない
    const result = evaluateAchievements([withDegrees({ fumble: 0, critical: 0 })]);
    expect(find(result, 'hard-three').earned).toBe(false);
    expect(find(result, 'extreme-one').earned).toBe(false);
  });

  it('earns 際どい成功 and 会心 from CoC7e-style degrees', () => {
    const result = evaluateAchievements([withDegrees({ hard: 3, extreme: 1 })]);
    expect(find(result, 'hard-three').earned).toBe(true);
    expect(find(result, 'extreme-one').earned).toBe(true);
  });

  it('sums criticals across endings for 積み重なる幸運', () => {
    const list = [
      withDegrees({ critical: 20 }, { sessionId: 'a', endedAt: 1 }),
      withDegrees({ critical: 4 }, { sessionId: 'b', endedAt: 2 }),
    ];
    expect(find(evaluateAchievements(list), 'criticals-25')).toMatchObject({
      earned: false,
      progress: { current: 24, target: 25 },
    });
  });
});

describe('survival achievements', () => {
  function withSan(value, total = 20) {
    return ending({ stats: { total, byDegree: {}, resources: { san: { label: '正気度', value, max: 99 } } } });
  }

  it('earns 瀬戸際の生還 at ten and not at eleven', () => {
    expect(find(evaluateAchievements([withSan(11)]), 'brink').earned).toBe(false);
    expect(find(evaluateAchievements([withSan(10)]), 'brink').earned).toBe(true);
  });

  it('earns 削られた精神 at three tenths of the maximum', () => {
    expect(find(evaluateAchievements([withSan(30)]), 'shaken').earned).toBe(false);
    expect(find(evaluateAchievements([withSan(29)]), 'shaken').earned).toBe(true);
  });

  it('needs ten rolls for 削られた精神 and 揺るがぬ精神', () => {
    expect(find(evaluateAchievements([withSan(29, 9)]), 'shaken').earned).toBe(false);
    expect(find(evaluateAchievements([withSan(90, 9)]), 'steady').earned).toBe(false);
  });

  it('earns 揺るがぬ精神 at six tenths of the maximum', () => {
    expect(find(evaluateAchievements([withSan(59)]), 'steady').earned).toBe(false);
    expect(find(evaluateAchievements([withSan(60)]), 'steady').earned).toBe(true);
  });

  it('earns 正気の底 only at zero', () => {
    expect(find(evaluateAchievements([withSan(1)]), 'sanity-zero').earned).toBe(false);
    expect(find(evaluateAchievements([withSan(0)]), 'sanity-zero').earned).toBe(true);
  });

  it('stays unearned for rulesets without the resource', () => {
    const result = evaluateAchievements([ending({ stats: { total: 20, byDegree: {}, resources: {} } })]);
    expect(result.filter((a) => a.category === 'survival').every((a) => a.earned === false)).toBe(true);
  });
});

describe('trace achievements', () => {
  // ローカルタイムゾーンで判定するので、テストもローカル時刻からミリ秒を組み立てる
  function at(year, month, day, hour = 12) {
    return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
  }

  it('earns 二つの流儀 from two distinct formulas', () => {
    const one = [ending({ sessionId: 'a', endedAt: 1, formula: 'simple' })];
    expect(find(evaluateAchievements(one), 'formula-two')).toMatchObject({
      earned: false,
      progress: { current: 1, target: 2 },
    });

    const two = [...one, ending({ sessionId: 'b', endedAt: 2, formula: 'coc7e' })];
    expect(find(evaluateAchievements(two), 'formula-two')).toMatchObject({ earned: true, sessionId: 'b' });
  });

  it('earns 四つの流儀 only with every formula', () => {
    const list = ['simple', 'coc7e', 'dnd5e', 'gurps'].map((f, i) =>
      ending({ sessionId: f, endedAt: i + 1, formula: f })
    );
    expect(find(evaluateAchievements(list), 'formula-all')).toMatchObject({ earned: true, sessionId: 'gurps' });
    expect(find(evaluateAchievements(list.slice(0, 3)), 'formula-all').earned).toBe(false);
  });

  it('earns 夜更かしの語り部 between midnight and five', () => {
    expect(find(evaluateAchievements([ending({ endedAt: at(2026, 7, 1, 4) })]), 'night-owl').earned).toBe(true);
    expect(find(evaluateAchievements([ending({ endedAt: at(2026, 7, 1, 5) })]), 'night-owl').earned).toBe(false);
  });

  it('earns 夜明けの結末 between five and eight', () => {
    expect(find(evaluateAchievements([ending({ endedAt: at(2026, 7, 1, 5) })]), 'dawn').earned).toBe(true);
    // 7時台は取得できる最後の1時間。ここを見ないと上端がずれても気付けない
    expect(find(evaluateAchievements([ending({ endedAt: at(2026, 7, 1, 7) })]), 'dawn').earned).toBe(true);
    expect(find(evaluateAchievements([ending({ endedAt: at(2026, 7, 1, 8) })]), 'dawn').earned).toBe(false);
  });

  it('earns 一日二作 from two endings on the same local day', () => {
    const apart = [
      ending({ sessionId: 'a', endedAt: at(2026, 7, 1, 9) }),
      ending({ sessionId: 'b', endedAt: at(2026, 7, 2, 9) }),
    ];
    expect(find(evaluateAchievements(apart), 'same-day-two').earned).toBe(false);

    const together = [
      ending({ sessionId: 'a', endedAt: at(2026, 7, 1, 9) }),
      ending({ sessionId: 'b', endedAt: at(2026, 7, 1, 22) }),
    ];
    expect(find(evaluateAchievements(together), 'same-day-two').earned).toBe(true);
  });

  it('earns 三日連続 across a month boundary but not with a gap', () => {
    const gap = [at(2026, 7, 1), at(2026, 7, 2), at(2026, 7, 4)].map((ms, i) =>
      ending({ sessionId: `s${i}`, endedAt: ms })
    );
    expect(find(evaluateAchievements(gap), 'streak-three').earned).toBe(false);

    const straddle = [at(2026, 7, 30), at(2026, 7, 31), at(2026, 8, 1)].map((ms, i) =>
      ending({ sessionId: `s${i}`, endedAt: ms })
    );
    expect(find(evaluateAchievements(straddle), 'streak-three').earned).toBe(true);
  });

  it('earns 三日連続 across a year boundary', () => {
    // 年をまたぐと日キーの年も月も変わる。月境界とは別に固定しておく
    const straddle = [at(2026, 12, 30), at(2026, 12, 31), at(2027, 1, 1)].map((ms, i) =>
      ending({ sessionId: `s${i}`, endedAt: ms })
    );
    expect(find(evaluateAchievements(straddle), 'streak-three')).toMatchObject({
      earned: true,
      sessionId: 's2',
    });
  });

  it('earns 実り月 from five endings in the same month', () => {
    const four = [1, 2, 3, 4].map((d) => ending({ sessionId: `s${d}`, endedAt: at(2026, 7, d) }));
    expect(find(evaluateAchievements(four), 'month-five').earned).toBe(false);

    const five = [...four, ending({ sessionId: 's5', endedAt: at(2026, 7, 20) })];
    expect(find(evaluateAchievements(five), 'month-five').earned).toBe(true);
  });
});
