import { ChevronLeft } from 'lucide-react';
import { navigateHash } from '../../navigation/useRoute.js';
import { COLORS, F_MONO, F_DISPLAY } from '../../theme.js';

// 集中モード(Play / Setup)のヘッダー。グローバルナビの代わりに
// 「離脱導線 + 現在地」だけを出す。回遊モードとの差はこの1点に限る。
export default function FocusHeader({ title, steps, currentStep = 0, exitLabel = 'ホーム', onExit }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 16px',
        borderBottom: `1px solid ${COLORS.line}`,
        background: COLORS.card,
      }}
    >
      <button
        onClick={() => (onExit ? onExit() : navigateHash('#/'))}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minHeight: 44,
          padding: '0 8px',
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontFamily: F_MONO,
          fontSize: 12,
          color: COLORS.inkSoft,
          whiteSpace: 'nowrap',
        }}
      >
        <ChevronLeft size={14} aria-hidden="true" />
        {exitLabel}
      </button>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: F_DISPLAY,
          fontSize: 16,
          color: COLORS.ink,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </div>

      {steps && steps.length > 0 && (
        <ol
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            listStyle: 'none',
            margin: 0,
            padding: 0,
            fontFamily: F_MONO,
            fontSize: 11,
          }}
        >
          {steps.map((label, i) => (
            <li key={label}>
              <span
                aria-current={i === currentStep ? 'step' : undefined}
                style={{
                  // 色だけに頼らず太さでも現在地を示す。
                  color: i === currentStep ? COLORS.ink : COLORS.faint,
                  fontWeight: i === currentStep ? 600 : 400,
                }}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
