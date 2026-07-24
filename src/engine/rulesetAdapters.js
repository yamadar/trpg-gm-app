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

// rollD100系rng(1-100)の値をsides面ダイスへ写像する。テストではrngを直接差し替える。
function rollDie(sides, rng) {
  return 1 + ((rng() - 1) % sides);
}

function noSideEffect() {
  return null;
}

const simple = {
  id: 'simple',
  degrees: ['fumble', 'fail', 'success', 'critical'],
  // 現行のevaluateRoll(dice.js)へ委譲。依存方向は adapters -> dice の一方向を保つ。
  evaluate: (successPercent, rng = rollD100) => evaluateRoll(successPercent, rng),
  resourceDefs: [],
  sideEffectKinds: [],
  sideEffect: noSideEffect,
  promptText:
    'ロール結果のdegreeは演出に反映する: critical=劇的な大成功、success=成功、fail=失敗、fumble=手痛い代償を伴う大失敗。',
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
  resourceDefs: [{ key: 'san', label: '正気度', max: 99, initial: 60 }],
  sideEffectKinds: ['sanity'],
  sideEffect(kind, degree, rng = rollD100) {
    if (kind !== 'sanity') return null;
    if (degree === 'critical' || degree === 'extreme' || degree === 'hard') return { key: 'san', delta: 0 };
    if (degree === 'success') return { key: 'san', delta: -1 };
    if (degree === 'fumble') return { key: 'san', delta: -rollDie(10, rng) };
    return { key: 'san', delta: -rollDie(6, rng) }; // fail
  },
  promptText:
    'ロール結果のdegreeはCoC7e風の成功度: critical=出目1の奇跡的成功、extreme=イクストリーム成功、hard=ハード成功、success=通常成功、fail=失敗、fumble=大失敗(手痛い代償)。degreeに応じて演出の強度を変えること。',
  sideEffectPrompt:
    '恐怖・正気を試される場面ではroll_checkのcheck_kindに"sanity"を指定すること。正気度(SAN)の減少量はエンジンが決定し、tool_resultのsan_loss/san_nowで通知されるので、narrativeにその影響を反映すること。san_nowが0のときPCは正気を完全に失っている——狂気に呑まれる描写をせよ(ただしセッションを機械的に終了はしない)。',
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
  resourceDefs: [],
  sideEffectKinds: [],
  sideEffect: noSideEffect,
  promptText:
    'ロール結果のdegreeはd20風: critical=会心(成功率に関わらず5%で発生する劇的大成功)、success=成功、fail=失敗、fumble=致命的失敗(成功率に関わらず5%で発生)。',
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
  resourceDefs: [],
  sideEffectKinds: [],
  sideEffect: noSideEffect,
  promptText:
    'ロール結果のdegreeを演出に反映する: critical=会心、success=成功、fail=失敗、fumble=大失敗。加えてtool_resultのmargin(成功率-出目)が大きいほど余裕のある成功、負に大きいほど手痛い失敗として、成果や代償の程度を具体的に描写すること。',
};

const ADAPTERS = { simple, coc7e, dnd5e, gurps };

export const KNOWN_FORMULAS = Object.keys(ADAPTERS);

export function getAdapter(formula) {
  return ADAPTERS[formula] || ADAPTERS.simple;
}
