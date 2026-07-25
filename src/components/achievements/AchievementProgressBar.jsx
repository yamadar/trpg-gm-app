import { COLORS } from '../../theme.js';

export default function AchievementProgressBar({ current, target, label, width }) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={0}
      aria-valuemax={target}
      aria-label={label}
      style={{ height: 4, borderRadius: 999, background: COLORS.paperDark, overflow: 'hidden', width }}
    >
      <div style={{ height: '100%', width: `${pct}%`, background: COLORS.brass }} />
    </div>
  );
}
