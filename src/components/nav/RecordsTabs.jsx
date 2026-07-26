import { navigate } from '../../navigation/useRoute.js';
import { COLORS, F_MONO } from '../../theme.js';

// 「記録」タブ配下の内部タブ。Library / Gallery のタブ列と同じ見た目に揃える。
const TABS = [
  { key: 'endings', label: 'エンディング図鑑' },
  { key: 'achievements', label: '実績' },
];

export default function RecordsTabs({ active }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            onClick={() => navigate({ name: 'records', recordsTab: t.key })}
            aria-current={isActive ? 'page' : undefined}
            style={{
              minHeight: 44,
              padding: '6px 14px',
              borderRadius: 3,
              cursor: 'pointer',
              fontFamily: F_MONO,
              fontSize: 12,
              background: isActive ? COLORS.ink : 'transparent',
              color: isActive ? COLORS.paper : COLORS.faint,
              fontWeight: isActive ? 600 : 400,
              border: `1px solid ${isActive ? COLORS.ink : COLORS.line}`,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
