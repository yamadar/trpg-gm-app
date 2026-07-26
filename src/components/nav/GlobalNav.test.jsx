import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GlobalNav from './GlobalNav.jsx';
import { COLORS } from '../../theme.js';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('GlobalNav', () => {
  it('renders all four destinations as buttons', () => {
    render(<GlobalNav activeTab="home" />);
    for (const label of ['ホーム', '素材', 'さがす', '記録']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('marks only the active tab with aria-current', () => {
    render(<GlobalNav activeTab="library" />);
    expect(screen.getByRole('button', { name: '素材' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'ホーム' })).not.toHaveAttribute('aria-current');
  });

  it('marks nothing when no tab is active', () => {
    render(<GlobalNav activeTab={null} />);
    for (const label of ['ホーム', '素材', 'さがす', '記録']) {
      expect(screen.getByRole('button', { name: label })).not.toHaveAttribute('aria-current');
    }
  });

  it('navigates to the canonical hash of the tab that was pressed', () => {
    render(<GlobalNav activeTab="home" />);
    fireEvent.click(screen.getByRole('button', { name: 'さがす' }));
    expect(window.location.hash).toBe('#/browse/starters');
  });

  it('keeps every tab present when signed out, so the layout does not shift', () => {
    render(<GlobalNav activeTab={null} />);
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('exposes the tabs inside a labelled nav landmark', () => {
    render(<GlobalNav activeTab="home" />);
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();
  });

  it('gives every tab a tap target of at least 44px', () => {
    render(<GlobalNav activeTab="home" />);
    for (const button of screen.getAllByRole('button')) {
      expect(parseInt(button.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
      expect(parseInt(button.style.minWidth, 10)).toBeGreaterThanOrEqual(44);
    }
  });

  it('keeps inactive tab labels readable, not faint', () => {
    // 非選択タブも押せる文字なので AA に届かない COLORS.faint は使わない。
    // 現在地は色ではなく太字と下線(boxShadow)で示している。
    render(<GlobalNav activeTab="home" />);
    const inactive = screen.getByRole('button', { name: '素材' });
    expect(inactive).toHaveStyle({ color: COLORS.brassDark });
    expect(inactive.style.fontWeight).toBe('400');
    expect(screen.getByRole('button', { name: 'ホーム' }).style.fontWeight).toBe('600');
  });
});
