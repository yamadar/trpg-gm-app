// 実績はエンディング記録のコレクションから導出する。独立した保存を持たないので、
// 定義を後から足しても過去の記録に遡って付き、マイグレーションが要らない。
//
// isEarnedBy は「endedAt昇順で先頭からi番目までの記録」を受け取り、その時点で
// 条件が成立したかを返す。単体条件の実績は末尾の記録だけを見ればよい
// (それ以前の記録で成立していれば、より早い反復で確定しているため)。

function last(list) {
  return list[list.length - 1];
}

function degreeCount(ending, degree) {
  return ending.stats?.byDegree?.[degree] ?? 0;
}

function rollTotal(ending) {
  return ending.stats?.total ?? 0;
}

const CATALOG = [
  {
    id: 'first-ending',
    label: '初めての結末',
    description: '初めてエンディングに到達した',
    isEarnedBy: (list) => list.length >= 1,
  },
  {
    id: 'three-endings',
    label: '三つの結末',
    description: '3つのエンディングに到達した',
    isEarnedBy: (list) => list.length >= 3,
  },
  {
    id: 'world-trilogy',
    label: '一つの世界の三つの結末',
    description: '同じ世界で3つのエンディングに到達した',
    isEarnedBy: (list) => {
      const counts = {};
      for (const e of list) {
        if (!e.worldId) continue; // 世界に属さない単発セッションはまとめない
        counts[e.worldId] = (counts[e.worldId] || 0) + 1;
        if (counts[e.worldId] >= 3) return true;
      }
      return false;
    },
  },
  {
    id: 'flawless',
    label: '無傷の旅路',
    description: 'ファンブルを1度も出さずに完結した',
    isEarnedBy: (list) => rollTotal(last(list)) >= 1 && degreeCount(last(list), 'fumble') === 0,
  },
  {
    id: 'lucky',
    label: '豪運',
    description: '1つの物語でクリティカルを3回以上出した',
    isEarnedBy: (list) => degreeCount(last(list), 'critical') >= 3,
  },
  {
    id: 'cursed',
    label: '厄日',
    description: '1つの物語でファンブルを3回以上出した',
    isEarnedBy: (list) => degreeCount(last(list), 'fumble') >= 3,
  },
  {
    id: 'brink',
    label: '瀬戸際の生還',
    description: '正気度10以下で完結した',
    isEarnedBy: (list) => {
      const value = last(list).stats?.resources?.san?.value;
      return typeof value === 'number' && value <= 10;
    },
  },
  {
    id: 'short-story',
    label: '短編',
    description: '判定10回以下で完結した',
    isEarnedBy: (list) => {
      const total = rollTotal(last(list));
      return total >= 1 && total <= 10;
    },
  },
];

export function evaluateAchievements(endings) {
  const ascending = [...(endings || [])].sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
  return CATALOG.map(({ id, label, description, isEarnedBy }) => {
    for (let i = 0; i < ascending.length; i++) {
      if (isEarnedBy(ascending.slice(0, i + 1))) {
        return {
          id,
          label,
          description,
          earned: true,
          earnedAt: ascending[i].endedAt ?? null,
          sessionId: ascending[i].sessionId ?? null,
        };
      }
    }
    return { id, label, description, earned: false, earnedAt: null, sessionId: null };
  });
}
