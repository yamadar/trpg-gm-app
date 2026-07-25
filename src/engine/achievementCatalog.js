// 実績カタログ。定義(データ)と評価(achievements.js)を分けているのは、件数が増えると
// どちらを読むときも他方が邪魔になるため。
//
// isEarnedBy は「endedAt昇順で先頭からi番目までの記録」を受け取り、その時点で条件が
// 成立したかを返す。単体条件の実績は末尾の記録だけを見ればよい(それ以前の記録で
// 成立していれば、より早い反復で確定しているため)。渡される配列は評価側が使い回すので
// 保持してはいけない。

import { MOODS } from '../constants/moods.js';

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

function successRate(ending) {
  return ending.stats?.successRate ?? 0;
}

function sumOf(list, pick) {
  let n = 0;
  for (const e of list) n += pick(e);
  return n;
}

const rollsTotal = (list) => sumOf(list, rollTotal);
const criticalsTotal = (list) => sumOf(list, (e) => degreeCount(e, 'critical'));

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

function moodsOf(ending) {
  return Array.isArray(ending.moods) ? ending.moods : [];
}

function hasMood(list, mood) {
  return list.some((e) => moodsOf(e).includes(mood));
}

const moodVariety = (list) => MOODS.filter((m) => hasMood(list, m)).length;

// 正気度は CoC7e風だけが持つ(他のルールセットは resourceDefs が空)。
// 記録が持たなければ条件を満たさないだけで、判定式の分岐は実績側に持ち込まない。
function sanOf(ending) {
  const san = ending.stats?.resources?.san;
  if (!san || typeof san.value !== 'number' || typeof san.max !== 'number' || san.max <= 0) return null;
  return san;
}

function sanAtMost(ending, ratio) {
  const san = sanOf(ending);
  return san !== null && san.value <= san.max * ratio;
}

function sanAtLeast(ending, ratio) {
  const san = sanOf(ending);
  return san !== null && san.value >= san.max * ratio;
}

// 判定式は src/data/rulesets.js が配っているもの。増えたらカタログのテストが落ちるので、
// そのとき「四つの流儀」のラベルと目標値を見直す。
export const FORMULAS = ['simple', 'coc7e', 'dnd5e', 'gurps'];

const formulaVariety = (list) => distinctCount(list, (e) => e.formula);

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// プレイヤーの体感時刻と一致させるため、日付の判定は全てローカルタイムゾーンで行う。
function localDayKey(ms) {
  return dayKey(new Date(ms));
}

function localMonthKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function hourOf(ms) {
  return new Date(ms).getHours();
}

const DAY_MS = 24 * 60 * 60 * 1000;

// 連続日の判定。より短い接頭辞は既に判定済みなので、末尾の記録が「新たに」成立させ得るのは
// その記録の日を含む連続日だけ。よって全記録を起点にする必要はなく、最新日を含む length 通りの
// 窓だけ見ればよい。最新日が窓の末尾とは限らない形で書いてあるのは、窓は高々 length 個しかなく
// 「窓の位置を求める」より総当たりの方が単純だからで、並び順を問わないという意味ではない。
// この関数はファイル冒頭の不変条件(endedAt昇順の接頭辞を順に評価する)に依存しており、
// 答えるのは「最新の記録の日が連続日を完成させたか」だけ。「このリストのどこかに length 連続日が
// あるか」を答える汎用関数ではないので、その用途には転用しないこと。同じ日に複数の記録があっても
// 日キーの集合は変わらないので、その場合は以前の反復で既に確定している。
function hasDayStreak(list, length) {
  const newest = last(list).endedAt;
  const base = new Date(newest);
  // 日キーの集合は末尾から集める。接頭辞は endedAt 昇順なので、最新から length+1 日より前まで
  // 遡ればそれ以上古い記録はどの窓にも入らない(+1日は夏時間で1日が24時間でない分の余裕)。
  const cutoff = newest - (length + 1) * DAY_MS;
  const days = new Set();
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i].endedAt;
    if (t < cutoff) break;
    days.add(localDayKey(t));
  }
  // offset は最新日が窓の何日目か(0なら窓の先頭、length-1なら窓の末尾)。
  for (let offset = 0; offset < length; offset++) {
    let run = true;
    for (let i = 0; i < length && run; i++) {
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset + i);
      run = days.has(dayKey(d));
    }
    if (run) return true;
  }
  return false;
}

// 雰囲気タグごとの実績。MOODS と1対1で対応させ、カタログのテストで取りこぼしを検出する。
export const MOOD_ENTRIES = [
  { mood: 'ホラー', id: 'mood-horror', icon: 'skull' },
  { mood: '冒険', id: 'mood-adventure', icon: 'map' },
  { mood: 'ミステリー', id: 'mood-mystery', icon: 'quill' },
  { mood: '日常', id: 'mood-daily', icon: 'heart' },
  { mood: 'SF', id: 'mood-sf', icon: 'sparkle' },
  { mood: 'ファンタジー', id: 'mood-fantasy', icon: 'star' },
  { mood: 'コメディ', id: 'mood-comedy', icon: 'mask' },
  { mood: 'シリアス', id: 'mood-serious', icon: 'scales' },
];

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
  ...MOOD_ENTRIES.map(({ mood, id, icon }) => ({
    id,
    label: `${mood}の結末`,
    description: `雰囲気「${mood}」の物語でエンディングに到達した`,
    category: 'mood',
    tier: 1,
    icon,
    // 末尾の記録だけ見る。以前の記録が同じ雰囲気を持つならその反復で確定しているので、
    // 接頭辞を走査し直しても結果は変わらない(hasMood は全件を見る moodVariety 用に残す)。
    isEarnedBy: (list) => moodsOf(last(list)).includes(mood),
  })),
  {
    id: 'mood-all',
    label: '八色の物語',
    description: 'すべての雰囲気でエンディングに到達した',
    category: 'mood',
    tier: 3,
    icon: 'crown',
    ...counted(moodVariety, MOODS.length),
  },
  {
    id: 'mood-blend',
    label: '混ざりあう色',
    description: '1つの物語に雰囲気を3つ以上つけて完結した',
    category: 'mood',
    tier: 1,
    icon: 'mask',
    isEarnedBy: (list) => moodsOf(last(list)).length >= 3,
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
    id: 'long-story',
    label: '長編',
    description: '判定50回以上で完結した',
    category: 'roll',
    tier: 2,
    icon: 'book',
    isEarnedBy: (list) => rollTotal(last(list)) >= 50,
  },
  {
    id: 'epic',
    label: '大長編',
    description: '判定100回以上で完結した',
    category: 'roll',
    tier: 3,
    icon: 'library',
    isEarnedBy: (list) => rollTotal(last(list)) >= 100,
  },
  {
    id: 'rolls-100',
    label: '百の判定',
    description: '通算100回の判定を行った',
    category: 'roll',
    tier: 1,
    icon: 'dice',
    ...counted(rollsTotal, 100),
  },
  {
    id: 'rolls-500',
    label: '五百の判定',
    description: '通算500回の判定を行った',
    category: 'roll',
    tier: 2,
    icon: 'dice',
    ...counted(rollsTotal, 500),
  },
  {
    id: 'adept',
    label: '手練れ',
    description: '判定10回以上、成功率8割以上で完結した',
    category: 'roll',
    tier: 2,
    icon: 'star',
    // 判定が少ないうちは成功率が偶然に振れるので、10回の下限を置く
    isEarnedBy: (list) => rollTotal(last(list)) >= 10 && successRate(last(list)) >= 0.8,
  },
  {
    id: 'ordeal',
    label: '苦難の道',
    description: '判定10回以上、成功率3割以下で完結した',
    category: 'roll',
    tier: 2,
    icon: 'hourglass',
    isEarnedBy: (list) => rollTotal(last(list)) >= 10 && successRate(last(list)) <= 0.3,
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
    id: 'flawless-long',
    label: '完全なる旅路',
    description: '判定30回以上、ファンブルを1度も出さずに完結した',
    category: 'fate',
    tier: 3,
    icon: 'shield',
    isEarnedBy: (list) => rollTotal(last(list)) >= 30 && degreeCount(last(list), 'fumble') === 0,
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
    id: 'lucky-five',
    label: '天佑',
    description: '1つの物語でクリティカルを5回以上出した',
    category: 'fate',
    tier: 2,
    icon: 'sparkle',
    isEarnedBy: (list) => degreeCount(last(list), 'critical') >= 5,
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
    id: 'cursed-five',
    label: '呪われた日',
    description: '1つの物語でファンブルを5回以上出した',
    category: 'fate',
    tier: 2,
    icon: 'skull',
    isEarnedBy: (list) => degreeCount(last(list), 'fumble') >= 5,
  },
  {
    id: 'tempest',
    label: '明暗',
    description: '1つの物語でクリティカルとファンブルを3回ずつ出した',
    category: 'fate',
    tier: 2,
    icon: 'scales',
    isEarnedBy: (list) => degreeCount(last(list), 'critical') >= 3 && degreeCount(last(list), 'fumble') >= 3,
  },
  {
    id: 'hard-three',
    label: '際どい成功',
    description: '1つの物語でハード成功を3回以上出した',
    category: 'fate',
    tier: 1,
    icon: 'dice',
    // hard/extreme を持たないルールセットでは degreeCount が0を返し、成立しないだけで壊れない
    isEarnedBy: (list) => degreeCount(last(list), 'hard') >= 3,
  },
  {
    id: 'extreme-one',
    label: '会心',
    description: 'イクストリーム成功を出した',
    category: 'fate',
    tier: 1,
    icon: 'star',
    isEarnedBy: (list) => degreeCount(last(list), 'extreme') >= 1,
  },
  {
    id: 'criticals-25',
    label: '積み重なる幸運',
    description: '通算25回のクリティカルを出した',
    category: 'fate',
    tier: 2,
    icon: 'sparkle',
    ...counted(criticalsTotal, 25),
  },
  {
    id: 'brink',
    label: '瀬戸際の生還',
    description: '正気度10以下で完結した',
    category: 'survival',
    tier: 1,
    icon: 'heart',
    isEarnedBy: (list) => {
      const san = sanOf(last(list));
      return san !== null && san.value <= 10;
    },
  },
  {
    id: 'shaken',
    label: '削られた精神',
    description: '判定10回以上、正気度が最大の3割以下で完結した',
    category: 'survival',
    tier: 1,
    icon: 'heart',
    isEarnedBy: (list) => rollTotal(last(list)) >= 10 && sanAtMost(last(list), 0.3),
  },
  {
    id: 'steady',
    label: '揺るがぬ精神',
    description: '判定10回以上、正気度が最大の6割以上で完結した',
    category: 'survival',
    tier: 2,
    icon: 'shield',
    isEarnedBy: (list) => rollTotal(last(list)) >= 10 && sanAtLeast(last(list), 0.6),
  },
  {
    id: 'sanity-zero',
    label: '正気の底',
    description: '正気度0で完結した',
    category: 'survival',
    tier: 3,
    icon: 'skull',
    isEarnedBy: (list) => {
      const san = sanOf(last(list));
      return san !== null && san.value === 0;
    },
  },
  {
    id: 'formula-two',
    label: '二つの流儀',
    description: '2種類の判定式でエンディングに到達した',
    category: 'trace',
    tier: 1,
    icon: 'scales',
    ...counted(formulaVariety, 2),
  },
  {
    id: 'formula-all',
    label: '四つの流儀',
    description: 'すべての判定式でエンディングに到達した',
    category: 'trace',
    tier: 3,
    icon: 'crown',
    ...counted(formulaVariety, FORMULAS.length),
  },
  {
    id: 'night-owl',
    label: '夜更かしの語り部',
    description: '0時から4時台に物語を終えた',
    category: 'trace',
    tier: 1,
    icon: 'moon',
    isEarnedBy: (list) => hourOf(last(list).endedAt) <= 4,
  },
  {
    id: 'dawn',
    label: '夜明けの結末',
    description: '5時から7時台に物語を終えた',
    category: 'trace',
    tier: 1,
    icon: 'sunrise',
    isEarnedBy: (list) => {
      const h = hourOf(last(list).endedAt);
      return h >= 5 && h <= 7;
    },
  },
  {
    id: 'same-day-two',
    label: '一日二作',
    description: '同じ日に2つのエンディングに到達した',
    category: 'trace',
    tier: 2,
    icon: 'clock',
    isEarnedBy: (list) => maxByKey(list, (e) => localDayKey(e.endedAt)) >= 2,
  },
  {
    id: 'streak-three',
    label: '三日連続',
    description: '3日続けてエンディングに到達した',
    category: 'trace',
    tier: 2,
    icon: 'calendar',
    isEarnedBy: (list) => hasDayStreak(list, 3),
  },
  {
    id: 'month-five',
    label: '実り月',
    description: '同じ月に5つのエンディングに到達した',
    category: 'trace',
    tier: 2,
    icon: 'calendar',
    isEarnedBy: (list) => maxByKey(list, (e) => localMonthKey(e.endedAt)) >= 5,
  },
];
