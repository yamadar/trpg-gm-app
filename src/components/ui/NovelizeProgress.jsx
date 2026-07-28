import { useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, motionAllowed } from '../../theme.js';

// 目安を外れたとみなす閾値。これを超えたら見積もりの提示自体をやめる。
// 一度外した見積もりを出し続けても信頼を損なうだけなので、代わりに上限を伝える。
const ESTIMATE_LIMIT_MS = 5 * 60 * 1000;

const OVER_ESTIMATE_NOTE =
  '長い記録、または生成中に追加ログを同期したため時間がかかっています。中断はされていません。';
const RUNNING_NOTE = '長い記録ほど時間がかかります。このまま他の画面に移っても生成は続きます。';
const DONE_NOTE = '下の「小説をDL」から取り出せます';

const KEYFRAMES_ID = 'trpg-novelize-anim';
const KEYFRAMES = `
@keyframes trpg-novelize-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}`;

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const BOX = {
  border: `1px dashed ${COLORS.line}`,
  borderRadius: 4,
  background: COLORS.paper,
  padding: '10px 12px',
  marginTop: 8,
};

// 小説化の待機中/完了直後にセッションカード内へ出す面。状態は持たず、
// 「いつ出すか」の判断は呼び出し側(Home)に置く。
export default function NovelizeProgress({ done = false, elapsedMs = 0 }) {
  const animating = !done && motionAllowed();
  useEffect(() => {
    if (animating) ensureKeyframes();
  }, [animating]);

  const overEstimate = elapsedMs > ESTIMATE_LIMIT_MS;

  return (
    <div style={BOX}>
      {/* 状態遷移(執筆中 → できました)を伝えるのはこの行だけなので、role はここに置く。 */}
      <div role="status" style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.brassDark }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            marginRight: 6,
            animation: animating ? 'trpg-novelize-pulse 1.6s ease-in-out infinite' : 'none',
          }}
        >
          {done ? '✓' : '●'}
        </span>
        {done ? '小説ができました' : '小説を執筆しています'}
      </div>

      {!done && (
        <div
          aria-hidden="true"
          style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brass, marginTop: 4 }}
        >
          {formatElapsed(elapsedMs)} 経過{overEstimate ? '' : ' ・ 目安 2〜5分'}
        </div>
      )}

      <div
        style={{
          fontFamily: F_BODY,
          fontSize: 12,
          color: COLORS.inkSoft,
          opacity: 0.8,
          marginTop: 4,
          lineHeight: 1.6,
        }}
      >
        {done ? DONE_NOTE : overEstimate ? OVER_ESTIMATE_NOTE : RUNNING_NOTE}
      </div>
    </div>
  );
}
