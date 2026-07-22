export function rollD100() {
  return Math.floor(Math.random() * 100) + 1;
}

export function evaluateRoll(successPercent) {
  const raw = Number(successPercent);
  const p = Number.isFinite(raw) ? Math.max(1, Math.min(99, Math.round(raw))) : 50;
  const roll = rollD100();
  const success = roll <= p;
  let degree;
  if (success) {
    degree = roll <= Math.max(1, Math.round(p * 0.05)) ? 'critical' : 'success';
  } else {
    degree = roll >= 96 ? 'fumble' : 'fail';
  }
  return { roll, success_percent: p, success, degree };
}
