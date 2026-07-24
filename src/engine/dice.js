export function rollD100() {
  return Math.floor(Math.random() * 100) + 1;
}

// success_percentの正規化(整数化・[1,99]クランプ・非有限は50)。
// 各ルールセットアダプタ(rulesetAdapters.js)も共通で使う。
export function normalizePercent(successPercent) {
  return typeof successPercent === 'number' && Number.isFinite(successPercent)
    ? Math.max(1, Math.min(99, Math.round(successPercent)))
    : 50;
}

// simple(現行)判定式。成功判定が先で、fumbleは失敗側でのみ発生する。
// rngはテストと上位アダプタから注入可能。
export function evaluateRoll(successPercent, rng = rollD100) {
  const p = normalizePercent(successPercent);
  const roll = rng();
  const success = roll <= p;
  let degree;
  if (success) {
    degree = roll <= Math.max(1, Math.round(p * 0.05)) ? 'critical' : 'success';
  } else {
    degree = roll >= 96 ? 'fumble' : 'fail';
  }
  return { roll, success_percent: p, success, degree };
}
