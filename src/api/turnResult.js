const NARRATIVE_FALLBACK = '(描写を取得できませんでした)';
const TENSION_LEVELS = ['low', 'medium', 'high'];

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function normalizeTurnResult(result) {
  const r = isPlainObject(result) ? result : {};
  const su = isPlainObject(r.state_update) ? r.state_update : {};

  // 空文字・空白のみも「取得できなかった」として扱う。型だけ見て通すと、地の文の無い
  // GMカードが黙って描かれ、プレイヤーには不具合と「何も起きなかった」の区別が付かない。
  const narrative =
    typeof r.narrative === 'string' && r.narrative.trim().length > 0 ? r.narrative : NARRATIVE_FALLBACK;
  // 空文字の選択肢はラベルの無いボタンになり、押すと空の行動がGMへ送られるため落とす。
  const choices = Array.isArray(r.choices)
    ? r.choices.filter((c) => typeof c === 'string' && c.trim().length > 0)
    : [];

  const current_scene =
    typeof su.current_scene === 'string' && su.current_scene.length > 0 ? su.current_scene : null;
  const flags = isPlainObject(su.flags) ? su.flags : null;
  const history_summary = typeof su.history_summary === 'string' ? su.history_summary : null;

  const rawXp = Number(su.xp_gained);
  const xpGain = Number.isFinite(rawXp) ? Math.max(0, rawXp) : 0;

  const tension_level = TENSION_LEVELS.includes(su.tension_level) ? su.tension_level : null;

  // 誤検知を避けるため、真偽値のtrue以外は全てfalseとして扱う。
  const endingReached = su.ending_reached === true;
  const newlyExplainedTerms = Array.isArray(su.newly_explained_terms)
    ? [
        ...new Set(
          su.newly_explained_terms
            .filter((term) => typeof term === 'string')
            .map((term) => term.trim())
            .filter(Boolean)
        ),
      ]
    : [];

  return {
    narrative,
    choices,
    stateUpdate: {
      current_scene,
      flags,
      history_summary,
      xpGain,
      tension_level,
      endingReached,
      newlyExplainedTerms,
    },
  };
}
