import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AchievementRow from './AchievementRow.jsx';

function achievement(overrides = {}) {
  return {
    id: 'ten-endings',
    label: '十の結末',
    description: '10のエンディングに到達した',
    category: 'arrival',
    tier: 2,
    icon: 'library',
    earned: false,
    earnedAt: null,
    sessionId: null,
    progress: { current: 3, target: 10 },
    ...overrides,
  };
}

describe('AchievementRow', () => {
  it('shows the label and the condition', () => {
    render(<AchievementRow achievement={achievement()} />);
    expect(screen.getByText('十の結末')).toBeInTheDocument();
    expect(screen.getByText('10のエンディングに到達した')).toBeInTheDocument();
  });

  it('shows the earned date once earned, and no progress bar', () => {
    render(
      <AchievementRow
        achievement={achievement({ earned: true, earnedAt: new Date(2026, 6, 12, 9).getTime() })}
      />
    );
    expect(screen.getByText('2026-07-12')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows the count and a progress bar while unearned', () => {
    render(<AchievementRow achievement={achievement()} />);
    expect(screen.getByText('3 / 10')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '十の結末の進捗' })).toBeInTheDocument();
  });

  it('says 未取得 when there is nothing to count', () => {
    render(<AchievementRow achievement={achievement({ progress: null })} />);
    expect(screen.getByText('未取得')).toBeInTheDocument();
  });

  it('falls back to 取得済み when the record has no date', () => {
    render(<AchievementRow achievement={achievement({ earned: true, earnedAt: null })} />);
    expect(screen.getByText('取得済み')).toBeInTheDocument();
  });
});
