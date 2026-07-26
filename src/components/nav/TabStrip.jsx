import { COLORS, F_MONO } from '../../theme.js';

// 画面内のタブ列。素材ライブラリ・公開ギャラリー・記録タブが同じ見た目を
// 別々に持っていたので1か所にまとめた。グローバルナビ(4タブ)とは別物で、
// こちらは「いま居るタブの中での絞り込み」を表す。
// 現在地は aria-current="page" と、色に加えて太字・反転でも示す。
export default function TabStrip({ tabs, active, onSelect }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onSelect(t.key)}
            aria-current={isActive ? 'page' : undefined}
            style={{
              minHeight: 44,
              padding: '6px 14px',
              borderRadius: 3,
              cursor: 'pointer',
              fontFamily: F_MONO,
              fontSize: 12,
              background: isActive ? COLORS.ink : 'transparent',
              // 非選択もラベルは操作対象。faint(#B8AE93)は card 上で約1.9:1しかなく
              // WCAG AA(4.5:1)に届かないため、5.15:1 の brassDark を使う。
              color: isActive ? COLORS.paper : COLORS.brassDark,
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
