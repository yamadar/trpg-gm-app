import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';
import { formatDate } from '../../utils/formatDate.js';
import AchievementIcon from './AchievementIcon.jsx';
import AchievementProgressBar from './AchievementProgressBar.jsx';

// ラベルと条件は書体で階層を分ける。同じ書体で2行並べると1件の切れ目が読み取れないため。
export default function AchievementRow({ achievement }) {
  const { label, description, category, tier, icon, earned, earnedAt, progress } = achievement;
  // 色だけに情報を載せないよう、右端には必ず状態をテキストで出す
  const status = earned ? formatDate(earnedAt) || '取得済み' : progress ? `${progress.current} / ${progress.target}` : '未取得';
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        alignItems: 'flex-start',
        padding: '10px 0',
        borderTop: `1px solid ${COLORS.line}`,
      }}
    >
      <AchievementIcon icon={icon} category={category} tier={tier} earned={earned} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: earned ? COLORS.ink : COLORS.inkSoft }}>{label}</div>
        <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft, lineHeight: 1.6, marginTop: 2 }}>
          {description}
        </div>
        {!earned && progress && (
          <div style={{ marginTop: 6 }}>
            <AchievementProgressBar
              current={progress.current}
              target={progress.target}
              label={`${label}の進捗`}
              width={180}
            />
          </div>
        )}
      </div>
      <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint, whiteSpace: 'nowrap', flex: 'none' }}>
        {status}
      </div>
    </div>
  );
}
