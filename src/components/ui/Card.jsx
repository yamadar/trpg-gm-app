import { COLORS } from '../../theme.js';

export default function Card({ children, style }) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 6,
        boxShadow: '0 1px 0 rgba(31,42,56,0.06)',
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
