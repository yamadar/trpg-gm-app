import { useEffect, useRef } from 'react';
import { COLORS, F_BODY, motionAllowed } from '../../theme.js';

export const TOAST_TIMEOUT_MS = 6000;

// AuthBar(zIndex 90)とモーダル(100/1000)より下に置く。上から降りてくる位置も
// AuthBarと重ならないよう下げる。
const STACK_Z_INDEX = 80;
const STACK_TOP = 64;

const KEYFRAMES_ID = 'trpg-toast-anim';
const KEYFRAMES = `
@keyframes trpg-toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}`;

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

function ToastItem({ item, onDismiss }) {
  // onDismissは親の再描画ごとに新しい関数になる。これをeffectの依存に入れると
  // 経過時間の1秒更新のたびにタイマーが張り直され、自動消滅が永久に来なくなる。
  // 依存はidのみにし、最新のコールバックはrefから読む。
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const animating = motionAllowed();
    if (animating) ensureKeyframes();
    const timer = setTimeout(() => dismissRef.current(item.id), TOAST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [item.id]);

  const borderColor = item.tone === 'error' ? COLORS.stamp : COLORS.brass;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: COLORS.card,
        border: `1px solid ${borderColor}`,
        borderRadius: 4,
        boxShadow: '0 2px 6px rgba(31,42,56,0.12)',
        padding: '8px 12px',
        fontFamily: F_BODY,
        fontSize: 13,
        color: COLORS.ink,
        animation: motionAllowed() ? 'trpg-toast-in 200ms ease-out' : 'none',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
      <button
        type="button"
        aria-label="閉じる"
        onClick={() => onDismiss(item.id)}
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          color: COLORS.brassDark,
          fontSize: 14,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}

// 画面上部に積む通知。キューの管理(いつ足すか)は呼び出し側の責務。
export default function ToastStack({ items, onDismiss }) {
  if (!items.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: STACK_TOP,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: STACK_Z_INDEX,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        width: 'max-content',
        maxWidth: 'min(92vw, 420px)',
      }}
    >
      {items.map((item) => (
        <ToastItem key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
