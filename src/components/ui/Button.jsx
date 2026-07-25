import { COLORS, F_MONO } from '../../theme.js';

export default function Button({ children, onClick, disabled, variant = 'primary', style }) {
  const base = {
    fontFamily: F_MONO,
    fontSize: 13,
    letterSpacing: 0.5,
    padding: '10px 16px',
    borderRadius: 4,
    cursor: disabled ? 'default' : 'pointer',
    border: 'none',
    opacity: disabled ? 0.5 : 1,
    transition: 'transform 0.1s ease',
  };
  const variants = {
    primary: { background: COLORS.ink, color: COLORS.paper },
    // 背景はbrass(#9C7A45)ではなくbrassDark。brassの上のpaper文字は3.20:1しかなく、
    // 13pxは大字扱いにならないためAAに届かない。brassDarkなら4.67:1。
    brass: { background: COLORS.brassDark, color: COLORS.paper },
    ghost: {
      background: 'transparent',
      color: COLORS.ink,
      border: `1px solid ${COLORS.lineStrong}`,
    },
  };
  return (
    <button
      // 既定のtypeはsubmit。<form>内に置いたButtonが意図せずフォーム送信するのを防ぐ。
      type="button"
      // styles.cssの:focus-visibleが、塗り系variantの上でリング色を紙色へ反転するのに使う。
      data-variant={variant}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = 'scale(0.97)';
      }}
      onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {children}
    </button>
  );
}
