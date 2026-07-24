import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MoodChips from './MoodChips.jsx';
import { MOODS } from '../../constants/moods.js';

describe('MoodChips', () => {
  it('renders every MOODS entry as a button', () => {
    render(<MoodChips selected={[]} onToggle={vi.fn()} />);
    MOODS.forEach((mood) => {
      expect(screen.getByRole('button', { name: mood })).toBeInTheDocument();
    });
  });

  it('marks selected chips with aria-pressed=true and others with aria-pressed=false', () => {
    render(<MoodChips selected={['ホラー', 'SF']} onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'ホラー', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SF', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '冒険', pressed: false })).toBeInTheDocument();
  });

  it('calls onToggle with the clicked mood', () => {
    const onToggle = vi.fn();
    render(<MoodChips selected={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByText('ミステリー'));
    expect(onToggle).toHaveBeenCalledWith('ミステリー');
  });
});
