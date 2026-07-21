import { COLORS, F_MONO } from '../../theme.js';

export default function Stamp({ roll }) {
  if (!roll) return null;
  const label =
    roll.degree === 'critical'
      ? '会心'
      : roll.degree === 'fumble'
      ? '大失敗'
      : roll.success
      ? '成功'
      : '失敗';
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        transform: 'rotate(-3deg)',
        border: `2px solid ${COLORS.stamp}`,
        color: COLORS.stamp,
        borderRadius: 4,
        padding: '4px 10px',
        fontFamily: F_MONO,
        fontWeight: 600,
        fontSize: 12,
        letterSpacing: 1,
        marginBottom: 8,
        opacity: 0.9,
      }}
    >
      <span>{roll.check_label}</span>
      <span style={{ opacity: 0.6 }}>|</span>
      <span>
        {roll.roll}/{roll.success_percent}
      </span>
      <span style={{ opacity: 0.6 }}>|</span>
      <span>{label}</span>
    </div>
  );
}
