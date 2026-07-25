import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RollStatsLine from './RollStatsLine.jsx';

const SIMPLE = {
  total: 4,
  successes: 2,
  successRate: 0.5,
  byDegree: { fumble: 1, fail: 1, success: 1, critical: 1 },
  degrees: ['fumble', 'fail', 'success', 'critical'],
  resources: {},
};

describe('RollStatsLine', () => {
  it('renders nothing without stats', () => {
    const { container } = render(<RollStatsLine />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the roll count and the success rate as a percentage', () => {
    render(<RollStatsLine stats={SIMPLE} />);
    expect(screen.getByText(/判定 4回/)).toBeInTheDocument();
    expect(screen.getByText(/成功率 50%/)).toBeInTheDocument();
  });

  it('shows only degrees that actually occurred', () => {
    render(<RollStatsLine stats={{ ...SIMPLE, byDegree: { fumble: 0, fail: 3, success: 1, critical: 0 } }} />);
    expect(screen.getByText(/失敗 3/)).toBeInTheDocument();
    expect(screen.queryByText(/ファンブル/)).not.toBeInTheDocument();
  });

  it('shows coc7e-only degrees with their labels', () => {
    render(
      <RollStatsLine
        stats={{
          total: 2,
          successes: 2,
          successRate: 1,
          byDegree: { fumble: 0, fail: 0, success: 0, hard: 1, extreme: 1, critical: 0 },
          degrees: ['fumble', 'fail', 'success', 'hard', 'extreme', 'critical'],
          resources: {},
        }}
      />
    );
    expect(screen.getByText(/ハード成功 1/)).toBeInTheDocument();
    expect(screen.getByText(/イクストリーム成功 1/)).toBeInTheDocument();
  });

  it('shows resources the session had', () => {
    render(<RollStatsLine stats={{ ...SIMPLE, resources: { san: { label: '正気度', value: 12, max: 99 } } }} />);
    expect(screen.getByText(/正気度 12\/99/)).toBeInTheDocument();
  });

  it('handles a session with no rolls', () => {
    render(<RollStatsLine stats={{ total: 0, successes: 0, successRate: 0, byDegree: {}, degrees: [], resources: {} }} />);
    expect(screen.getByText(/判定 0回/)).toBeInTheDocument();
  });
});
