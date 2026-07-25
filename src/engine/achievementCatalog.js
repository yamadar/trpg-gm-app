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

// 同じキーに何件集まっているかの最大値。worldId/campaignId が無い記録は数えない
// (世界にもキャンペーンにも属さない単発セッションをまとめないため)。
function maxByKey(list, keyOf) {
  const counts = new Map();
  let max = 0;
  for (const e of list) {
    const k = keyOf(e);
    if (!k) continue;
    const n = (counts.get(k) || 0) + 1;
    counts.set(k, n);
    if (n > max) max = n;
  }
  return max;
}

function distinctCount(list, keyOf) {
  const set = new Set();
  for (const e of list) {
    const k = keyOf(e);
    if (k) set.add(k);
  }
  return set.size;
}

// 数えれば現在地が出る実績は、同じ計数関数を判定と進捗の両方に使う。
// 判定には接頭辞が、進捗には全記録が渡るが、関数の中身は同じでよい。
function counted(count, target) {
  return { isEarnedBy: (list) => count(list) >= target, progress: count, target };
}

const countOf = (list) => list.length;
const worldGroup = (list) => maxByKey(list, (e) => e.worldId);
const worldVariety = (list) => distinctCount(list, (e) => e.worldId);
const campaignGroup = (list) => maxByKey(list, (e) => e.campaignId);

export const CATALOG = [
  {
    id: 'first-ending',
    label: '初めての結末',
    description: '初めてエンディングに到達した',
    category: 'arrival',
    tier: 1,
    icon: 'flag',
    ...counted(countOf, 1),
  },
  {
    id: 'three-endings',
    label: '三つの結末',
    description: '3つのエンディングに到達した',
    category: 'arrival',
    tier: 1,
    icon: 'book',
    ...counted(countOf, 3),
  },
  {
    id: 'five-endings',
    label: '五つの結末',
    description: '5つのエンディングに到達した',
    category: 'arrival',
    tier: 1,
    icon: 'books',
    ...counted(countOf, 5),
  },
  {
    id: 'ten-endings',
    label: '十の結末',
    description: '10のエンディングに到達した',
    category: 'arrival',
    tier: 2,
    icon: 'library',
    ...counted(countOf, 10),
  },
  {
    id: 'endings-25',
    label: '二十五の結末',
    description: '25のエンディングに到達した',
    category: 'arrival',
    tier: 3,
    icon: 'library',
    ...counted(countOf, 25),
  },
  {
    id: 'endings-50',
    label: '五十の結末',
    description: '50のエンディングに到達した',
    category: 'arrival',
    tier: 3,
    icon: 'crown',
    ...counted(countOf, 50),
  },
  {
    id: 'world-trilogy',
    label: '一つの世界の三つの結末',
    description: '同じ世界で3つのエンディングに到達した',
    category: 'world',
    tier: 1,
    icon: 'globe',
    ...counted(worldGroup, 3),
  },
  {
    id: 'world-five',
    label: '一つの世界の五つの結末',
    description: '同じ世界で5つのエンディングに到達した',
    category: 'world',
    tier: 2,
    icon: 'globe',
    ...counted(worldGroup, 5),
  },
  {
    id: 'worlds-three',
    label: '三つの世界',
    description: '3つの異なる世界でエンディングに到達した',
    category: 'world',
    tier: 1,
    icon: 'map',
    ...counted(worldVariety, 3),
  },
  {
    id: 'worlds-five',
    label: '五つの世界',
    description: '5つの異なる世界でエンディングに到達した',
    category: 'world',
    tier: 2,
    icon: 'map',
    ...counted(worldVariety, 5),
  },
  {
    id: 'campaign-two',
    label: '章を重ねて',
    description: '同じキャンペーンで2つのエンディングに到達した',
    category: 'world',
    tier: 1,
    icon: 'compass',
    ...counted(campaignGroup, 2),
  },
  {
    id: 'campaign-four',
    label: '長い年代記',
    description: '同じキャンペーンで4つのエンディングに到達した',
    category: 'world',
    tier: 3,
    icon: 'crown',
    ...counted(campaignGroup, 4),
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
