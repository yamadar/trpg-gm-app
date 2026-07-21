export function rollD100() {
  return Math.floor(Math.random() * 100) + 1;
}

export function evaluateRoll(successPercent) {
  const p = Math.max(1, Math.min(99, Math.round(successPercent)));
  const roll = rollD100();
  const success = roll <= p;
  let degree = success ? 'success' : 'fail';
  if (roll <= Math.max(1, Math.round(p * 0.05))) degree = 'critical';
  if (roll >= 96) degree = 'fumble';
  return { roll, success_percent: p, success, degree };
}
