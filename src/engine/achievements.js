import { CATALOG } from './achievementCatalog.js';

// 実績はエンディング記録のコレクションから導出する。独立した保存を持たないので、
// 定義を後から足しても過去の記録に遡って付き、マイグレーションが要らない。
export function evaluateAchievements(endings) {
  const all = [...(endings || [])].sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));

  // 記録の接頭辞を1本だけ伸ばし、その時点で未獲得の実績にだけ判定をかける。
  // 実績ごとに接頭辞をsliceし直すと、カタログが増えるほど無駄な配列コピーが増える。
  const earned = new Map();
  const prefix = [];
  let pending = CATALOG;
  for (const record of all) {
    if (pending.length === 0) break;
    prefix.push(record);
    const stillPending = [];
    for (const a of pending) {
      if (a.isEarnedBy(prefix)) {
        earned.set(a.id, { earnedAt: record.endedAt ?? null, sessionId: record.sessionId ?? null });
      } else {
        stillPending.push(a);
      }
    }
    pending = stillPending;
  }

  return CATALOG.map((a) => {
    const hit = earned.get(a.id);
    return {
      id: a.id,
      label: a.label,
      description: a.description,
      category: a.category,
      tier: a.tier,
      icon: a.icon,
      earned: Boolean(hit),
      earnedAt: hit ? hit.earnedAt : null,
      sessionId: hit ? hit.sessionId : null,
      // 進捗は「いま何本持っているか」なので、判定に使う接頭辞ではなく全記録で数える。
      progress: a.progress ? { current: Math.min(a.progress(all), a.target), target: a.target } : null,
    };
  });
}
