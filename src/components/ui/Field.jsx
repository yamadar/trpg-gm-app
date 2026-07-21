import { COLORS, F_DISPLAY, F_BODY } from '../../theme.js';

export default function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontFamily: F_DISPLAY,
          fontSize: 13,
          color: COLORS.brassDark,
          marginBottom: 6,
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      {hint && (
        <div
          style={{
            fontFamily: F_BODY,
            fontSize: 12,
            color: COLORS.faint,
            marginBottom: 6,
          }}
        >
          {hint}
        </div>
      )}
      {children}
    </div>
  );
}
