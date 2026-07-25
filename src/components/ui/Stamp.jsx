import { useEffect, useState } from 'react';
import { COLORS, F_MONO, motionAllowed } from '../../theme.js';

// degree別の演出色。文字と枠を揃え、critical/extremeは真鍮系で強調する。
const DEGREE_COLORS = {
  critical: { fg: COLORS.brassDark, border: COLORS.brass },
  extreme: { fg: COLORS.brassDark, border: COLORS.brass },
  hard: { fg: COLORS.stamp, border: COLORS.stamp },
  success: { fg: COLORS.stamp, border: COLORS.stamp },
  fail: { fg: COLORS.stamp, border: COLORS.line },
  fumble: { fg: COLORS.stampDark, border: COLORS.stampDark },
};

const DEGREE_LABELS = {
  critical: '会心',
  extreme: 'イクストリーム',
  hard: 'ハード成功',
  success: '成功',
  fail: '失敗',
  fumble: '大失敗',
};

const KEYFRAMES_ID = 'trpg-stamp-anim';
const KEYFRAMES = `
@keyframes trpg-stamp-in {
  0% { transform: scale(1.8) rotate(-10deg); opacity: 0; }
  60% { transform: scale(0.95) rotate(-2deg); opacity: 1; }
  100% { transform: scale(1) rotate(-3deg); opacity: 0.9; }
}
@keyframes trpg-stamp-shake {
  0%, 100% { transform: translateX(0) rotate(-3deg); }
  25% { transform: translateX(-2px) rotate(-4deg); }
  75% { transform: translateX(2px) rotate(-2deg); }
}`;

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

// phase: rolling(数字回転) -> settled(出目停止) -> stamped(押印=最終表示)
export default function Stamp({ roll, animate = false }) {
  const animating = animate && motionAllowed();
  const [phase, setPhase] = useState(animating ? 'rolling' : 'stamped');
  const [shownRoll, setShownRoll] = useState(roll ? roll.roll : 0);

  useEffect(() => {
    if (phase !== 'rolling' || !roll) return;
    ensureKeyframes();
    const spin = setInterval(() => setShownRoll(Math.floor(Math.random() * 100) + 1), 50);
    const settle = setTimeout(() => {
      clearInterval(spin);
      setShownRoll(roll.roll);
      setPhase('settled');
    }, 800);
    return () => {
      clearInterval(spin);
      clearTimeout(settle);
    };
  }, [phase, roll]);

  useEffect(() => {
    if (phase !== 'settled') return;
    const t = setTimeout(() => setPhase('stamped'), 250);
    return () => clearTimeout(t);
  }, [phase]);

  if (!roll) return null;

  const label = DEGREE_LABELS[roll.degree] || (roll.success ? '成功' : '失敗');
  const colors = DEGREE_COLORS[roll.degree] || DEGREE_COLORS.success;
  const stamped = phase === 'stamped';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        transform: 'rotate(-3deg)',
        border: `2px solid ${stamped ? colors.border : COLORS.line}`,
        color: stamped ? colors.fg : COLORS.faint,
        borderRadius: 4,
        padding: '4px 10px',
        fontFamily: F_MONO,
        fontWeight: 600,
        fontSize: 12,
        letterSpacing: 1,
        marginBottom: 8,
        opacity: 0.9,
      }}
    >
      <span>{roll.check_label}</span>
      <span style={{ opacity: 0.6 }}>|</span>
      <span>
        {phase === 'rolling' ? shownRoll : roll.roll}/{roll.success_percent}
      </span>
      <span style={{ opacity: 0.6 }}>|</span>
      {stamped ? (
        <>
          <span
            style={{
              display: 'inline-block',
              animation: animating
                ? `trpg-stamp-in 0.25s ease-out${roll.degree === 'fumble' ? ', trpg-stamp-shake 0.3s ease-in-out 0.25s' : ''}`
                : undefined,
            }}
          >
            {label}
          </span>
          {roll.resourceChange && roll.resourceChange.delta !== 0 && (
            <>
              <span style={{ opacity: 0.6 }}>|</span>
              <span style={{ color: COLORS.stampDark }}>
                {roll.resourceChange.label} {roll.resourceChange.delta}
              </span>
            </>
          )}
        </>
      ) : (
        <span style={{ opacity: 0.5 }}>…</span>
      )}
    </div>
  );
}
