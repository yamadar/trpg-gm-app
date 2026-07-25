import { resolveAdapter } from './resolveRuleset.js';

// セッションのログからダイス統計を集計する。ルールセット差はアダプタのdegrees語彙で
// 吸収する: CoC7e風だけがhard/extremeを持つので、他のルールセットの記録には現れない。
export function summarizeRolls(session) {
  const adapter = resolveAdapter(session);
  const rolls = (session.log || []).map((e) => e.roll).filter(Boolean);
  const byDegree = Object.fromEntries(adapter.degrees.map((d) => [d, 0]));

  let successes = 0;
  for (const r of rolls) {
    // 語彙外のdegree(ルールセットを変えた等)は内訳には数えないが、
    // 判定が行われた事実は total と successes に残す。
    if (r.degree in byDegree) byDegree[r.degree] += 1;
    if (r.success) successes += 1;
  }

  // リソースはアダプタが定義していても、セッションが実際に持っていなければ出さない
  // (旧セッションは state.resources を持たない)。
  const sessionResources = session.state?.resources || {};
  const resources = {};
  for (const def of adapter.resourceDefs) {
    const res = sessionResources[def.key];
    if (res) resources[def.key] = { label: def.label, value: res.value, max: res.max };
  }

  const total = rolls.length;
  return {
    total,
    successes,
    successRate: total === 0 ? 0 : successes / total,
    byDegree,
    degrees: adapter.degrees,
    resources,
  };
}
