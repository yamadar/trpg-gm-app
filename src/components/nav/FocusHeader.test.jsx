import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FocusHeader, { FOCUS_HEADER_HEIGHT } from './FocusHeader.jsx';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('FocusHeader', () => {
  it('renders the title', () => {
    render(<FocusHeader title="丘の上の写真館" />);
    expect(screen.getByText('丘の上の写真館')).toBeInTheDocument();
  });

  it('navigates home when the exit button is pressed and no handler is given', () => {
    render(<FocusHeader title="丘の上の写真館" />);
    fireEvent.click(screen.getByRole('button', { name: 'ホーム' }));
    expect(window.location.hash).toBe('#/');
  });

  it('calls the supplied handler instead of navigating', () => {
    const onExit = vi.fn();
    render(<FocusHeader title="新規プレイ" exitLabel="やめる" onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
  });

  it('renders every step and marks the current one', () => {
    render(
      <FocusHeader title="新規プレイ" steps={['世界観', 'シナリオ', 'ルール', 'PC', '確認']} currentStep={3} />
    );
    for (const s of ['世界観', 'シナリオ', 'ルール', 'PC', '確認']) {
      expect(screen.getByText(s)).toBeInTheDocument();
    }
    expect(screen.getByText('PC')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('世界観')).not.toHaveAttribute('aria-current');
  });

  it('omits the step indicator when no steps are given', () => {
    render(<FocusHeader title="丘の上の写真館" />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('gives the exit button a tap target of at least 44px', () => {
    render(<FocusHeader title="丘の上の写真館" />);
    const button = screen.getByRole('button', { name: 'ホーム' });
    expect(parseInt(button.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
  });

  it('stays pinned to the top of the viewport', () => {
    render(<FocusHeader title="丘の上の写真館" />);
    const header = screen.getByText('丘の上の写真館').closest('div[style*="sticky"]');
    expect(header).not.toBeNull();
    expect(header.style.position).toBe('sticky');
    expect(header.style.top).toBe('0px');
  });

  it('has a height matching the exported FOCUS_HEADER_HEIGHT constant', () => {
    render(<FocusHeader title="丘の上の写真館" />);
    const header = screen.getByText('丘の上の写真館').closest('div[style*="sticky"]');
    expect(header.style.height).toBe(`${FOCUS_HEADER_HEIGHT}px`);
  });
});
