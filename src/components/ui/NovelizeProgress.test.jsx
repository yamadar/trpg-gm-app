import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NovelizeProgress, { formatElapsed } from './NovelizeProgress.jsx';

describe('formatElapsed', () => {
  it('formats milliseconds as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9000)).toBe('0:09');
    expect(formatElapsed(84000)).toBe('1:24');
    expect(formatElapsed(723000)).toBe('12:03');
  });

  it('clamps a negative elapsed time to zero', () => {
    // 受信時刻の補間で理論上わずかに負になりうる。マイナス表示は出さない。
    expect(formatElapsed(-500)).toBe('0:00');
  });
});

describe('NovelizeProgress', () => {
  it('shows the heading, the elapsed time and the estimate while running', () => {
    render(<NovelizeProgress elapsedMs={84000} />);
    expect(screen.getByRole('status')).toHaveTextContent('小説を執筆しています');
    expect(screen.getByText('1:24 経過 ・ 目安 2〜5分')).toBeInTheDocument();
    expect(
      screen.getByText('長い記録ほど時間がかかります。このまま他の画面に移っても生成は続きます。')
    ).toBeInTheDocument();
  });

  it('drops the estimate and explains the upper bound once it runs past five minutes', () => {
    render(<NovelizeProgress elapsedMs={432000} />); // 7:12
    expect(screen.getByText('7:12 経過')).toBeInTheDocument();
    expect(screen.queryByText(/目安/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        '長い記録、または生成中に追加ログを同期したため時間がかかっています。中断はされていません。'
      )
    ).toBeInTheDocument();
  });

  it('keeps the estimate exactly at the five minute mark', () => {
    // 「5分を超えたら」であって「5分になったら」ではない(境界の回帰防止)。
    render(<NovelizeProgress elapsedMs={300000} />);
    expect(screen.getByText('5:00 経過 ・ 目安 2〜5分')).toBeInTheDocument();
  });

  it('hides the elapsed time from assistive technology', () => {
    // 毎秒更新される値を読み上げ対象にすると連続読み上げになるため。
    const { container } = render(<NovelizeProgress elapsedMs={84000} />);
    const hidden = [...container.querySelectorAll('[aria-hidden="true"]')];
    expect(hidden.some((el) => el.textContent === '1:24 経過 ・ 目安 2〜5分')).toBe(true);
  });

  it('shows the completion message and no elapsed time when done', () => {
    render(<NovelizeProgress done elapsedMs={84000} />);
    expect(screen.getByRole('status')).toHaveTextContent('小説ができました');
    expect(screen.getByText('下の「小説をDL」から取り出せます')).toBeInTheDocument();
    expect(screen.queryByText(/経過/)).not.toBeInTheDocument();
  });
});
