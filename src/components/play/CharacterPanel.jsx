import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';

const PANEL_WIDTH = 320;

export default function CharacterPanel({ session, docked, onClose }) {
  const growthUnit = session.ruleset?.growthUnit || '経験値';
  const xp = session.state?.xp || 0;
  const raw = session.pc?.raw?.trim();
  const goal = session.pc?.goal;
  const bonds = session.pc?.bonds;
  const flags = Object.entries(session.state?.flags || {});

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: PANEL_WIDTH,
        maxWidth: '85vw',
        background: COLORS.card,
        borderLeft: `1px solid ${COLORS.line}`,
        boxShadow: docked ? 'none' : '-8px 0 24px rgba(0,0,0,0.2)',
        overflowY: 'auto',
        padding: '20px 18px',
        boxSizing: 'border-box',
        zIndex: 20,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 16, color: COLORS.ink }}>PCシート</div>
        {!docked && (
          <button
            aria-label="パネルを閉じる"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 18, color: COLORS.faint, cursor: 'pointer' }}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brassDark, marginBottom: 12 }}>
        {growthUnit}: {xp}
      </div>

      {goal && (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.brassDark, marginBottom: 4 }}>目標: {goal}</div>
      )}
      {bonds && (
        <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.brassDark, marginBottom: 12 }}>因縁: {bonds}</div>
      )}

      <div
        style={{
          fontFamily: F_BODY,
          fontSize: 13,
          lineHeight: 1.7,
          color: COLORS.inkSoft,
          whiteSpace: 'pre-wrap',
          borderTop: `1px solid ${COLORS.line}`,
          paddingTop: 12,
          marginTop: 8,
        }}
      >
        {raw || '(PC設定なし)'}
      </div>

      <div style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.ink, marginTop: 16, marginBottom: 6 }}>
        入手情報
      </div>
      {flags.length === 0 ? (
        <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>まだなし</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {flags.map(([k, v]) => (
            <div key={k} style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.inkSoft }}>
              {k} = {String(v)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
