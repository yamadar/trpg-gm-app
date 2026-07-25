import { COLORS, F_MONO } from '../../theme.js';

// degreeの日本語ラベル。判定式ごとに語彙が違う(hard/extremeはCoC7e風のみ)ため、
// stats.degrees に含まれるものだけを引く。
const DEGREE_LABELS = {
  critical: 'クリティカル',
  extreme: 'イクストリーム成功',
  hard: 'ハード成功',
  success: '成功',
  fail: '失敗',
  fumble: 'ファンブル',
};

export default function RollStatsLine({ stats }) {
  if (!stats) return null;

  const parts = [`判定 ${stats.total}回`, `成功率 ${Math.round((stats.successRate || 0) * 100)}%`];
  // 0回のdegreeは並べても情報にならないので出さない。
  for (const degree of stats.degrees || []) {
    const count = stats.byDegree?.[degree] || 0;
    if (count > 0) parts.push(`${DEGREE_LABELS[degree] || degree} ${count}`);
  }
  for (const res of Object.values(stats.resources || {})) {
    parts.push(`${res.label} ${res.value}/${res.max}`);
  }

  return (
    <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark, lineHeight: 1.8 }}>
      {parts.join(' ・ ')}
    </div>
  );
}
