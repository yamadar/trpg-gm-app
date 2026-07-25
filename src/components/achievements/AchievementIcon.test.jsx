import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import AchievementIcon, { ICONS } from './AchievementIcon.jsx';
import { COLORS } from '../../theme.js';

function ring(container) {
  return container.firstChild;
}

// jsdomはstyle.borderの読み出し時に16進カラーをrgb()表記へ正規化する(実ブラウザの
// CSSOMシリアライズと同じ挙動)。COLORSは16進で定義しているため、期待値側もここで
// 変換して比較する。
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('AchievementIcon', () => {
  it('draws the requested glyph', () => {
    const { container } = render(<AchievementIcon icon="flag" category="arrival" earned />);
    expect(container.querySelector('path').getAttribute('d')).toBe(ICONS.flag);
  });

  it('falls back to the category glyph for an unknown name', () => {
    const { container } = render(<AchievementIcon icon="nope" category="fate" earned />);
    expect(container.querySelector('path').getAttribute('d')).toBe(ICONS.sparkle);
  });

  it('marks the ring solid when earned and dashed when locked', () => {
    const { container: earned } = render(<AchievementIcon icon="flag" category="arrival" tier={1} earned />);
    expect(ring(earned).style.border).toContain('solid');

    const { container: locked } = render(<AchievementIcon icon="flag" category="arrival" tier={1} />);
    expect(ring(locked).style.border).toContain('dashed');
  });

  it('distinguishes the three tiers by width and colour', () => {
    const { container: bronze } = render(<AchievementIcon icon="flag" category="arrival" tier={1} earned />);
    const { container: silver } = render(<AchievementIcon icon="flag" category="arrival" tier={2} earned />);
    const { container: gold } = render(<AchievementIcon icon="flag" category="arrival" tier={3} earned />);
    expect(ring(bronze).style.border).toBe(`1.5px solid ${hexToRgb(COLORS.line)}`);
    expect(ring(silver).style.border).toBe(`2px solid ${hexToRgb(COLORS.brass)}`);
    expect(ring(gold).style.border).toBe(`3px double ${hexToRgb(COLORS.stamp)}`);
  });

  it('hides itself from assistive technology', () => {
    const { container } = render(<AchievementIcon icon="flag" category="arrival" earned />);
    expect(ring(container).getAttribute('aria-hidden')).toBe('true');
  });
});
