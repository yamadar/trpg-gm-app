import { COLORS, F_MONO } from '../../theme.js';

// rest は aria-label / aria-pressed / title など、呼び出し側が付けたい属性を通すため。
// 同じ文言のボタンが並ぶ一覧で、アクセシブル名だけを個別化する用途が主。
export default function Button({ children, onClick, disabled, variant = 'primary', style, ...rest }) {
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
      {...rest}
      // HTMLの既定は submit で、<form>内に置くと意図せずフォーム送信してしまう。
      // 既定を button に倒しつつ、必要な呼び出し側は type を明示して上書きできる。
      type={rest.type || 'button'}
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
