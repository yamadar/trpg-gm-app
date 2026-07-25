import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';
import { formatDate } from '../../utils/formatDate.js';
import AchievementIcon from './AchievementIcon.jsx';

// 図鑑の「直近の獲得」用。取得済みだけを並べる場所なので、進捗も未取得の表現も持たない。
export default function AchievementTile({ achievement }) {
  const { label, description, category, tier, icon, earnedAt } = achievement;
  return (
    <div
      data-testid="achievement-tile"
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 6,
        padding: '12px 10px',
        textAlign: 'center',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
        <AchievementIcon icon={icon} category={category} tier={tier} earned />
      </div>
      <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink }}>{label}</div>
      <div style={{ fontFamily: F_BODY, fontSize: 11, color: COLORS.inkSoft, lineHeight: 1.5, marginTop: 3 }}>
        {description}
      </div>
      <div style={{ fontFamily: F_MONO, fontSize: 10, color: COLORS.faint, marginTop: 6 }}>
        {formatDate(earnedAt)}
      </div>
    </div>
  );
}
