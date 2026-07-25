import { COLORS } from '../../theme.js';

// 24×24・currentColorの単色線画。絵文字を使わないのは、紙とタイプライターの意匠に
// 合わないため。1つのグリフを複数の実績で使い回してよい。
export const ICONS = {
  flag: 'M6 3v18 M6 4h11l-2.5 4L17 12H6',
  book: 'M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z M7 20a2 2 0 0 1 0-4h11',
  books: 'M5 6h4v14H5z M11 6h4v14h-4z M17 7l3 11',
  library: 'M3 20h18 M6 20V10 M10 20V10 M14 20V10 M18 20V10 M3 10l9-6 9 6',
  crown: 'M4 8l3 9h10l3-9-4.5 3L12 5 8.5 11z M7 20h10',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c3 3.5 3 14.5 0 18 M12 3c-3 3.5-3 14.5 0 18',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z M9 4v14 M15 6v14',
  compass: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M15.5 8.5l-2 5-5 2 2-5z',
  mask: 'M4 5h16v6a8 8 0 0 1-8 9 8 8 0 0 1-8-9z M8.5 11h.01 M15.5 11h.01',
  skull: 'M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z M9.5 12h.01 M14.5 12h.01',
  star: 'M12 3l2.7 5.9 6.3.7-4.7 4.3 1.3 6.1L12 17l-5.6 3 1.3-6.1L3 9.6l6.3-.7z',
  sparkle: 'M12 4l1.8 4.7L18 10.5l-4.2 1.8L12 17l-1.8-4.7L6 10.5l4.2-1.8z M18 16l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z',
  moon: 'M20 14a8.5 8.5 0 0 1-10-10 8.5 8.5 0 1 0 10 10z',
  sunrise: 'M12 3v4 M5.5 9.5l2 2 M18.5 9.5l-2 2 M3 20h18 M7 17a5 5 0 0 1 10 0z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5.5l3.5 2',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  hourglass: 'M7 3h10 M7 21h10 M7 3c0 4 5 6 5 9 0-3 5-5 5-9 M7 21c0-4 5-6 5-9 0 3 5 5 5 9',
  dice: 'M5 5h14v14H5z M9 9h.01 M15 9h.01 M9 15h.01 M15 15h.01 M12 12h.01',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  heart: 'M12 20s-7-4.3-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.7-7 9-7 9z',
  quill: 'M4 20s2-8 8-12 8-4 8-4-1 6-5 9-9 4-9 4z M4 20l5.5-5.5',
  scales: 'M12 4v16 M6 20h12 M4 8h16 M4 8l-2.5 5.5a3 3 0 0 0 5 0z M20 8l2.5 5.5a3 3 0 0 1-5 0z',
};

// カタログはテストで実在するキーだけに縛られているが、実行時に穴を開けないための保険。
const CATEGORY_FALLBACK = {
  arrival: 'flag',
  world: 'globe',
  mood: 'mask',
  roll: 'dice',
  fate: 'sparkle',
  survival: 'heart',
  trace: 'clock',
};

// ティアの差が色だけに乗らないよう、枠の太さと本数も併せて変える。銅と未取得は
// どちらも淡いので、実線と破線で区別する。
const TIER_RINGS = {
  1: { border: `1.5px solid ${COLORS.line}`, color: COLORS.brassDark },
  2: { border: `2px solid ${COLORS.brass}`, color: COLORS.brassDark },
  3: { border: `3px double ${COLORS.stamp}`, color: COLORS.stamp }, // 紙に押した朱印の見立て
};

const LOCKED_RING = { border: `2px dashed ${COLORS.faint}`, color: COLORS.faint };

export default function AchievementIcon({ icon, category, tier = 1, earned = false, size = 42 }) {
  const key = ICONS[icon] ? icon : CATEGORY_FALLBACK[category] || 'flag';
  const ring = earned ? TIER_RINGS[tier] || TIER_RINGS[1] : LOCKED_RING;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        flex: 'none',
        border: ring.border,
        color: ring.color,
        background: earned ? COLORS.card : 'transparent',
      }}
    >
      <svg
        width={Math.round(size * 0.5)}
        height={Math.round(size * 0.5)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ICONS[key]} />
      </svg>
    </span>
  );
}
