import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AchievementProgressBar from './AchievementProgressBar.jsx';

describe('AchievementProgressBar', () => {
  it('exposes the position to assistive technology', () => {
    render(<AchievementProgressBar current={3} target={10} label="十の結末の進捗" />);
    const bar = screen.getByRole('progressbar', { name: '十の結末の進捗' });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '10');
  });

  it('fills in proportion to the target', () => {
    const { container } = render(<AchievementProgressBar current={3} target={10} label="進捗" />);
    expect(container.querySelector('div > div').style.width).toBe('30%');
  });

  it('never overflows when current exceeds target', () => {
    const { container } = render(<AchievementProgressBar current={30} target={10} label="進捗" />);
    expect(container.querySelector('div > div').style.width).toBe('100%');
  });

  it('stays at zero when the target is zero', () => {
    const { container } = render(<AchievementProgressBar current={0} target={0} label="進捗" />);
    expect(container.querySelector('div > div').style.width).toBe('0%');
  });
});
