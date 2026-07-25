import { COLORS } from '../../theme.js';

export default function AchievementProgressBar({ current, target, label, width }) {
  const safeMax = Math.max(0, target);
  const safeNow = Math.max(0, Math.min(current, safeMax));
  const pct = safeMax > 0 ? Math.round((safeNow / safeMax) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={safeNow}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-label={label}
      style={{ height: 4, borderRadius: 999, background: COLORS.paperDark, overflow: 'hidden', width }}
    >
      <div style={{ height: '100%', width: `${pct}%`, background: COLORS.brass }} />
    </div>
  );
}
      aria-valuemin={0}
      aria-valuemax={target}
      aria-label={label}
      style={{ height: 4, borderRadius: 999, background: COLORS.paperDark, overflow: 'hidden', width }}
    >
      <div style={{ height: '100%', width: `${pct}%`, background: COLORS.brass }} />
    </div>
  );
}
