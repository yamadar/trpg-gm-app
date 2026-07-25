import { COLORS, F_MONO } from '../../theme.js';

// 状態を表す小さなピル。押せる要素(Button)と見分けがつくよう、spanで描画し
// カーソルもdefaultに固定する。セッション一覧で「公開中」がボタンと混同された問題への対処。
const VARIANTS = {
  brass: { background: COLORS.brass, color: COLORS.paper, borderColor: COLORS.brass },
  outline: { background: 'transparent', color: COLORS.brassDark, borderColor: COLORS.brassDark },
  faint: { background: 'transparent', color: COLORS.faint, borderColor: COLORS.line },
};

export default function Badge({ children, variant = 'outline', style }) {
  const v = VARIANTS[variant] || VARIANTS.outline;
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: F_MONO,
        fontSize: 10,
        letterSpacing: 0.5,
        lineHeight: 1.6,
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid ${v.borderColor}`,
        background: v.background,
        color: v.color,
        whiteSpace: 'nowrap',
        cursor: 'default',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
