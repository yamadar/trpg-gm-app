import { rollD100, normalizePercent, evaluateRoll } from './dice.js';

// 共通のdegree語彙のうち、成功として扱うもの。
const SUCCESS_DEGREES = new Set(['critical', 'extreme', 'hard', 'success']);

// dnd5e/gurps共通の「固定バンド」degree判定(d20的意図: どんな達人でも5%は転ぶ)。
// 順序が重要: 固定バンド(critical/fumble)は成功率しきい値より先に判定する。
function fixedBandDegree(p, roll) {
  if (roll <= 5) return 'critical';
  if (roll >= 96) return 'fumble';
  if (roll <= p) return 'success';
  return 'fail';
}

const simple = {
  id: 'simple',
  degrees: ['fumble', 'fail', 'success', 'critical'],
  // 現行のevaluateRoll(dice.js)へ委譲。依存方向は adapters -> dice の一方向を保つ。
  evaluate: (successPercent, rng = rollD100) => evaluateRoll(successPercent, rng),
};

const coc7e = {
  id: 'coc7e',
  degrees: ['fumble', 'fail', 'success', 'hard', 'extreme', 'critical'],
  evaluate(successPercent, rng = rollD100) {
    const p = normalizePercent(successPercent);
    const roll = rng();
    let degree;
    if (roll === 1) degree = 'critical';
    else if (roll === 100 || (p < 50 && roll >= 96)) degree = 'fumble';
    else if (roll <= Math.ceil(p / 5)) degree = 'extreme';
    else if (roll <= Math.ceil(p / 2)) degree = 'hard';
    else if (roll <= p) degree = 'success';
    else degree = 'fail';
    return { roll, success_percent: p, success: SUCCESS_DEGREES.has(degree), degree };
  },
};

const dnd5e = {
  id: 'dnd5e',
  degrees: ['fumble', 'fail', 'success', 'critical'],
  // simpleと異なりfumble/criticalが成功判定より先(どんな達人でも5%は転ぶ、というd20的意図)。
  evaluate(successPercent, rng = rollD100) {
    const p = normalizePercent(successPercent);
    const roll = rng();
    const degree = fixedBandDegree(p, roll);
    return { roll, success_percent: p, success: SUCCESS_DEGREES.has(degree), degree };
  },
};

const gurps = {
  id: 'gurps',
  degrees: ['fumble', 'fail', 'success', 'critical'],
  evaluate(successPercent, rng = rollD100) {
    const p = normalizePercent(successPercent);
    const roll = rng();
    const degree = fixedBandDegree(p, roll);
    // margin(成功率-出目)は代償・成功度の描写材料としてAIへ渡す。
    return { roll, success_percent: p, success: SUCCESS_DEGREES.has(degree), degree, margin: p - roll };
  },
};

const ADAPTERS = { simple, coc7e, dnd5e, gurps };

export const KNOWN_FORMULAS = Object.keys(ADAPTERS);

export function getAdapter(formula) {
  return ADAPTERS[formula] || ADAPTERS.simple;
}
