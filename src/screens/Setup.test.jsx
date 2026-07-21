import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Setup from './Setup.jsx';

describe('Setup', () => {
  it('renders the first wizard step (世界観)', () => {
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('世界観')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/世界観の資料を貼る/)).toBeInTheDocument();
  });

  it('shows the step indicator for all 5 steps', () => {
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    // ステップタブ("1. 世界観"等)とForm 0のField labelの両方が"世界観"を含みうるため、
    // 厳密一致のgetByTextではなく部分一致のgetAllByTextで存在確認する。
    ['世界観', 'シナリオ', 'ルール', 'PC', '確認'].forEach((label) => {
      expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    });
  });
});
