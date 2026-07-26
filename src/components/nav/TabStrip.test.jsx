import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabStrip from './TabStrip.jsx';
import { COLORS } from '../../theme.js';

const TABS = [
  { key: 'a', label: 'あ' },
  { key: 'b', label: 'い' },
];

describe('TabStrip', () => {
  it('marks only the active tab with aria-current', () => {
    render(<TabStrip tabs={TABS} active="b" onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: 'い' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'あ' })).not.toHaveAttribute('aria-current');
  });

  it('distinguishes the active tab by weight as well as colour', () => {
    // 色だけで現在地を示さない(設計書のa11y要求)。
    render(<TabStrip tabs={TABS} active="b" onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: 'い' }).style.fontWeight).toBe('600');
    expect(screen.getByRole('button', { name: 'あ' }).style.fontWeight).toBe('400');
  });

  it('gives every tab a 44px minimum tap target', () => {
    render(<TabStrip tabs={TABS} active="a" onSelect={() => {}} />);
    for (const label of ['あ', 'い']) {
      expect(screen.getByRole('button', { name: label }).style.minHeight).toBe('44px');
    }
  });

  it('reports the selected key and never submits a surrounding form', () => {
    const onSelect = vi.fn();
    render(<TabStrip tabs={TABS} active="a" onSelect={onSelect} />);
    const tab = screen.getByRole('button', { name: 'い' });
    expect(tab).toHaveAttribute('type', 'button');
    fireEvent.click(tab);
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('keeps inactive labels readable, not faint', () => {
    // 非選択タブも押せる文字。COLORS.faint は card 上で約1.9:1しかなく AA(4.5:1)に
    // 届かないため使わない。現在地は色ではなく反転と太字で示している。
    render(<TabStrip tabs={TABS} active="a" onSelect={() => {}} />);
    const inactive = screen.getByRole('button', { name: 'い' });
    expect(inactive).toHaveStyle({ color: COLORS.brassDark });
    expect(inactive).not.toHaveStyle({ color: COLORS.faint });
  });
});
