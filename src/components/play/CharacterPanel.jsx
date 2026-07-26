import { useState } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../../theme.js';
import { getAdapter } from '../../engine/rulesetAdapters.js';

const PANEL_WIDTH = 320;

export default function CharacterPanel({ session, docked, onClose, onRecall }) {
  const growthUnit = session.ruleset?.growthUnit || '経験値';
  const xp = session.state?.xp || 0;
  const resources = session.state?.resources || {};
  const adapter = getAdapter(session.ruleset?.formula);
  const raw = session.pc?.raw?.trim();
  const goal = session.pc?.goal;
  const bonds = session.pc?.bonds;

  const [recallText, setRecallText] = useState(null);
  const [recalling, setRecalling] = useState(false);
  const [recallError, setRecallError] = useState(null);

  async function handleRecall() {
    if (recalling) return;
    setRecalling(true);
    setRecallError(null);
    try {
      setRecallText(await onRecall());
    } catch (e) {
      setRecallError('思い出せなかった: ' + e.message);
    } finally {
      setRecalling(false);
    }
  }

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
        // 非ドック時はモーダルのスクリム(Play.jsx, zIndex: 31)より上に出し、
        // 見出しと閉じるボタンがFocusHeaderやスクリムに隠れないようにする。
        // ドック時は他の重なりが無いのでこの値のままで問題ない。
        zIndex: 32,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontFamily: F_DISPLAY, fontSize: 16, color: COLORS.ink }}>PCシート</div>
        {!docked && (
          <button
            type="button"
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

      {Object.entries(resources).map(([key, r]) => (
        <div key={key} style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.stampDark, marginBottom: 12 }}>
          {adapter.resourceDefs.find((d) => d.key === key)?.label || key}: {r.value}/{r.max}
        </div>
      ))}

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

      {onRecall && (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            onClick={handleRecall}
            disabled={recalling}
            style={{
              fontFamily: F_MONO,
              fontSize: 12,
              color: COLORS.brassDark,
              background: 'none',
              border: `1px solid ${COLORS.line}`,
              borderRadius: 4,
              padding: '6px 10px',
              cursor: recalling ? 'default' : 'pointer',
            }}
          >
            {recalling ? '思い出している…' : 'これまでを思い出す'}
          </button>
          {recallText && (
            <div
              style={{
                fontFamily: F_BODY,
                fontSize: 13,
                lineHeight: 1.7,
                color: COLORS.inkSoft,
                whiteSpace: 'pre-wrap',
                marginTop: 10,
              }}
            >
              {recallText}
            </div>
          )}
          {recallError && <div style={{ color: COLORS.stamp, fontSize: 12, marginTop: 8 }}>{recallError}</div>}
        </div>
      )}
    </div>
  );
}
