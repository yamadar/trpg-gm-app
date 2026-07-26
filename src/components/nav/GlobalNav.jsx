import { Home, Library, Compass, Trophy } from 'lucide-react';
import { NAV_TABS } from '../../navigation/routes.js';
import { navigateHash } from '../../navigation/useRoute.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import { COLORS, F_MONO } from '../../theme.js';

const ICONS = { home: Home, library: Library, browse: Compass, records: Trophy };

export default function GlobalNav({ activeTab }) {
  // PC は上部の横並び、スマホは下部固定。DOM は同一にしてスタイルだけ切り替える。
  const wide = useMediaQuery('(min-width: 768px)');

  const listStyle = wide
    ? { display: 'flex', gap: 4, alignItems: 'center' }
    : {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        justifyContent: 'space-around',
        background: COLORS.card,
        borderTop: `1px solid ${COLORS.line}`,
        padding: '4px 0 max(4px, env(safe-area-inset-bottom))',
        zIndex: 80,
      };

  return (
    <nav aria-label="メインメニュー">
      <div style={listStyle}>
        {NAV_TABS.map((tab) => {
          const Icon = ICONS[tab.key];
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => navigateHash(tab.hash)}
              aria-current={active ? 'page' : undefined}
              style={{
                display: 'flex',
                flexDirection: wide ? 'row' : 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: wide ? 6 : 2,
                minWidth: 44,
                minHeight: 44,
                padding: wide ? '8px 14px' : '4px 8px',
                background: 'transparent',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontFamily: F_MONO,
                fontSize: wide ? 13 : 10,
                letterSpacing: 0.5,
                // 色だけに頼らず太さと下線でも現在地を示す。非選択タブも押せる文字なので、
                // コントラストが AA に届かない faint ではなく brassDark(card 上 5.15:1)にする。
                color: active ? COLORS.ink : COLORS.brassDark,
                fontWeight: active ? 600 : 400,
                boxShadow: active ? `inset 0 -2px 0 ${COLORS.brass}` : 'none',
              }}
            >
              <Icon size={wide ? 16 : 20} aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
