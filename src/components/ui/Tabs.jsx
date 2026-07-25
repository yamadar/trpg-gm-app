import { useRef } from 'react';
import { COLORS, F_MONO } from '../../theme.js';

// Gallery / UserPage のタブ。以前は <div onClick> の羅列で、キーボードからは
// 一切到達できなかった(WCAG 2.1.1 / 4.1.2)。
//
// WAI-ARIA APG の Tabs パターンに合わせる:
//   - コンテナに role="tablist"、各タブに role="tab" + aria-selected
//   - Tab キーでは「選択中のタブ1つ」だけに入る(roving tabindex)
//   - 左右/Home/End で選択を移す
//
// 本アプリのタブは選択と同時にパネル内容を差し替える「自動アクティベーション」型。
// パネル取得が非同期でも即時に切り替わるため、APG 的にもこの形で問題ない。
export default function Tabs({ tabs, value, onChange, label }) {
  const refs = useRef({});

  function focusTab(key) {
    onChange(key);
    // 選択の移動に合わせてフォーカスも運ぶ(roving tabindex)。
    requestAnimationFrame(() => refs.current[key]?.focus());
  }

  function handleKeyDown(e) {
    const keys = tabs.map((t) => t.key);
    const i = keys.indexOf(value);
    if (i === -1) return;
    let next;
    if (e.key === 'ArrowRight') next = keys[(i + 1) % keys.length];
    else if (e.key === 'ArrowLeft') next = keys[(i - 1 + keys.length) % keys.length];
    else if (e.key === 'Home') next = keys[0];
    else if (e.key === 'End') next = keys[keys.length - 1];
    else return;
    e.preventDefault();
    focusTab(next);
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      style={{ display: 'flex', gap: 6, marginBottom: 16, fontFamily: F_MONO, fontSize: 12, flexWrap: 'wrap' }}
    >
      {tabs.map((t) => {
        const selected = value === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${t.key}`}
            // 選択中のタブだけが Tab キーの停止点になる。
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              refs.current[t.key] = el;
            }}
            onClick={() => onChange(t.key)}
            style={{
              fontFamily: F_MONO,
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 3,
              cursor: 'pointer',
              background: selected ? COLORS.ink : 'transparent',
              color: selected ? COLORS.paper : COLORS.inkSoft,
              border: `1px solid ${selected ? COLORS.ink : COLORS.lineStrong}`,
              // モバイルで「おす/すめ」のように語中で折り返していたため禁止する。
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
