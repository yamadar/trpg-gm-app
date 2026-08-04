import { COLORS, F_BODY, F_MONO } from '../theme.js';

export default function MaintenanceBanner({ mode }) {
  if (mode !== 'read-only') return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      style={{
        position: 'sticky',
        top: 'var(--shell-header-height, 0px)',
        zIndex: 80,
        background: COLORS.paperDark,
        borderBottom: `2px solid ${COLORS.stamp}`,
        boxShadow: '0 2px 8px rgba(31, 42, 56, 0.12)',
        padding: '10px 16px',
        color: COLORS.ink,
        textAlign: 'center',
      }}
    >
      <strong style={{ fontFamily: F_MONO, fontSize: 13, letterSpacing: 0.4 }}>
        メンテナンス中
      </strong>
      <span style={{ fontFamily: F_BODY, fontSize: 13, marginLeft: 10 }}>
        現在は閲覧のみ利用できます。新規作成・編集・ゲーム進行は保存できません。
      </span>
    </aside>
  );
}
