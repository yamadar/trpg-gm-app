import { COLORS, F_MONO } from '../../theme.js';
import { MOODS } from '../../constants/moods.js';

function moodChipStyle(active) {
  return {
    fontFamily: F_MONO,
    fontSize: 12,
    padding: '4px 10px',
    borderRadius: 3,
    cursor: 'pointer',
    background: active ? COLORS.ink : 'transparent',
    color: active ? COLORS.paper : COLORS.faint,
    border: `1px solid ${active ? COLORS.ink : COLORS.line}`,
  };
}

// MOODS全件をトグルチップとして描画する共通部品。WorldTab/ScenarioTab/PublicItemListで
// 重複していたスタイル定義とマークアップを集約する。aria-pressedを常に付与する。
export default function MoodChips({ selected, onToggle }) {
  return (
    <>
      {MOODS.map((mood) => (
        <button
          key={mood}
          type="button"
          onClick={() => onToggle(mood)}
          style={moodChipStyle(selected.includes(mood))}
          aria-pressed={selected.includes(mood)}
        >
          {mood}
        </button>
      ))}
    </>
  );
}
