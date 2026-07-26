import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RecordsTabs from './RecordsTabs.jsx';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('RecordsTabs', () => {
  it('renders both records destinations', () => {
    render(<RecordsTabs active="endings" />);
    expect(screen.getByRole('button', { name: 'エンディング図鑑' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '実績' })).toBeInTheDocument();
  });

  it('marks the active tab', () => {
    render(<RecordsTabs active="achievements" />);
    expect(screen.getByRole('button', { name: '実績' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'エンディング図鑑' })).not.toHaveAttribute('aria-current');
  });

  it('navigates to the other records route', () => {
    render(<RecordsTabs active="endings" />);
    fireEvent.click(screen.getByRole('button', { name: '実績' }));
    expect(window.location.hash).toBe('#/records/achievements');
  });
});
