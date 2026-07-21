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
    brass: { background: COLORS.brass, color: COLORS.paper },
    ghost: {
      background: 'transparent',
      color: COLORS.ink,
      border: `1px solid ${COLORS.line}`,
    },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
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
