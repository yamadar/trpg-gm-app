// 実績カタログ。定義(データ)と評価(achievements.js)を分けているのは、件数が増えると
// どちらを読むときも他方が邪魔になるため。
//
// isEarnedBy は「endedAt昇順で先頭からi番目までの記録」を受け取り、その時点で条件が
// 成立したかを返す。単体条件の実績は末尾の記録だけを見ればよい(それ以前の記録で
// 成立していれば、より早い反復で確定しているため)。渡される配列は評価側が使い回すので
// 保持してはいけない。

export const CATEGORIES = [
  { key: 'arrival', label: '到達' },
  { key: 'world', label: '世界' },
  { key: 'mood', label: '雰囲気' },
  { key: 'roll', label: '判定' },
  { key: 'fate', label: '運命' },
  { key: 'survival', label: '生還' },
  { key: 'trace', label: '軌跡' },
];

function last(list) {
  return list[list.length - 1];
}

function degreeCount(ending, degree) {
  return ending.stats?.byDegree?.[degree] ?? 0;
}

function rollTotal(ending) {
  return ending.stats?.total ?? 0;
}

export const CATALOG = [
  {
    id: 'first-ending',
    label: '初めての結末',
    description: '初めてエンディングに到達した',
    category: 'arrival',
    tier: 1,
    icon: 'flag',
    isEarnedBy: (list) => list.length >= 1,
  },
  {
    id: 'three-endings',
    label: '三つの結末',
    description: '3つのエンディングに到達した',
    category: 'arrival',
    tier: 1,
    icon: 'book',
    isEarnedBy: (list) => list.length >= 3,
  },
  {
    id: 'world-trilogy',
    label: '一つの世界の三つの結末',
    description: '同じ世界で3つのエンディングに到達した',
    category: 'world',
    tier: 1,
    icon: 'globe',
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
    id: 'short-story',
    label: '短編',
    description: '判定10回以下で完結した',
    category: 'roll',
    tier: 1,
    icon: 'quill',
    isEarnedBy: (list) => {
      const total = rollTotal(last(list));
      return total >= 1 && total <= 10;
    },
  },
  {
    id: 'flawless',
    label: '無傷の旅路',
    description: 'ファンブルを1度も出さずに完結した',
    category: 'fate',
    tier: 1,
    icon: 'shield',
    isEarnedBy: (list) => rollTotal(last(list)) >= 1 && degreeCount(last(list), 'fumble') === 0,
  },
  {
    id: 'lucky',
    label: '豪運',
    description: '1つの物語でクリティカルを3回以上出した',
    category: 'fate',
    tier: 1,
    icon: 'sparkle',
    isEarnedBy: (list) => degreeCount(last(list), 'critical') >= 3,
  },
  {
    id: 'cursed',
    label: '厄日',
    description: '1つの物語でファンブルを3回以上出した',
    category: 'fate',
    tier: 1,
    icon: 'skull',
    isEarnedBy: (list) => degreeCount(last(list), 'fumble') >= 3,
  },
  {
    id: 'brink',
    label: '瀬戸際の生還',
    description: '正気度10以下で完結した',
    category: 'survival',
    tier: 1,
    icon: 'heart',
    isEarnedBy: (list) => {
      const value = last(list).stats?.resources?.san?.value;
      return typeof value === 'number' && value <= 10;
    },
  },
];
