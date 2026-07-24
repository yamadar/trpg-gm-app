const NARRATIVE_FALLBACK = '(描写を取得できませんでした)';
const TENSION_LEVELS = ['low', 'medium', 'high'];

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function normalizeTurnResult(result) {
  const r = isPlainObject(result) ? result : {};
  const su = isPlainObject(r.state_update) ? r.state_update : {};

  const narrative = typeof r.narrative === 'string' ? r.narrative : NARRATIVE_FALLBACK;
  const choices = Array.isArray(r.choices) ? r.choices.filter((c) => typeof c === 'string') : [];

  const current_scene =
    typeof su.current_scene === 'string' && su.current_scene.length > 0 ? su.current_scene : null;
  const flags = isPlainObject(su.flags) ? su.flags : null;
  const history_summary = typeof su.history_summary === 'string' ? su.history_summary : null;

  const rawXp = Number(su.xp_gained);
  const xpGain = Number.isFinite(rawXp) ? Math.max(0, rawXp) : 0;

  const tension_level = TENSION_LEVELS.includes(su.tension_level) ? su.tension_level : null;

  return {
    narrative,
    choices,
    stateUpdate: { current_scene, flags, history_summary, xpGain, tension_level },
  };
}
