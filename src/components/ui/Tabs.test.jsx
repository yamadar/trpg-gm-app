import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Tabs from './Tabs.jsx';

const TABS = [
  { key: 'a', label: 'おすすめ' },
  { key: 'b', label: '小説' },
  { key: 'c', label: '世界観' },
];

function Harness({ initial = 'a' }) {
  const [value, setValue] = useState(initial);
  return <Tabs tabs={TABS} value={value} onChange={setValue} label="公開物の種類" />;
}

describe('Tabs', () => {
  it('exposes a labelled tablist with tabs and selection state', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: '公開物の種類' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'おすすめ' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '小説' })).toHaveAttribute('aria-selected', 'false');
  });

  // roving tabindex: Tab キーで入るのは選択中の1つだけ。
  it('keeps only the selected tab in the tab order', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'おすすめ' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: '小説' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves the selection with the arrow keys and wraps around', () => {
    render(<Harness />);
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: '小説' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: '世界観' })).toHaveAttribute('aria-selected', 'true');
  });

  it('jumps to the first and last tab with Home and End', () => {
    render(<Harness initial="b" />);
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'End' });
    expect(screen.getByRole('tab', { name: '世界観' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(list, { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'おすすめ' })).toHaveAttribute('aria-selected', 'true');
  });

  it('still selects on click', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} value="a" onChange={onChange} label="公開物の種類" />);
    fireEvent.click(screen.getByRole('tab', { name: '世界観' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });
});
