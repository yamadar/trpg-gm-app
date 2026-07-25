import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Stamp from './Stamp.jsx';

afterEach(() => {
  delete window.matchMedia;
  vi.useRealTimers();
});

describe('Stamp', () => {
  it('renders nothing when roll is null', () => {
    const { container } = render(<Stamp roll={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the check label, roll numbers, and success label', () => {
    render(
      <Stamp roll={{ check_label: '崖を登る', roll: 42, success_percent: 60, success: true, degree: 'success' }} />
    );
    expect(screen.getByText('崖を登る')).toBeInTheDocument();
    expect(screen.getByText('42/60')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
  });

  it('labels a fumble as 大失敗', () => {
    render(
      <Stamp roll={{ check_label: 'x', roll: 99, success_percent: 60, success: false, degree: 'fumble' }} />
    );
    expect(screen.getByText('大失敗')).toBeInTheDocument();
  });

  it('degree=critical のラベルは会心、fail のラベルは失敗', () => {
    render(<Stamp roll={{ check_label: 'a', roll: 1, success_percent: 60, success: true, degree: 'critical' }} />);
    expect(screen.getByText('会心')).toBeInTheDocument();
    render(<Stamp roll={{ check_label: 'b', roll: 80, success_percent: 60, success: false, degree: 'fail' }} />);
    expect(screen.getByText('失敗')).toBeInTheDocument();
  });

  it('animate指定でもmatchMedia非対応環境(jsdom既定)では即時に全要素を表示する', () => {
    render(
      <Stamp roll={{ check_label: '崖を登る', roll: 12, success_percent: 70, success: true, degree: 'success' }} animate />
    );
    expect(screen.getByText('12/70')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
  });

  it('animate時は回転中→出目停止→押印の順に進む', () => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }); // motion許可
    render(
      <Stamp roll={{ check_label: '崖を登る', roll: 12, success_percent: 70, success: true, degree: 'success' }} animate />
    );
    // 回転中: 結果ラベルはまだ出ない
    expect(screen.queryByText('成功')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(800)); // 出目停止
    expect(screen.getByText('12/70')).toBeInTheDocument();
    expect(screen.queryByText('成功')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(250)); // 押印
    expect(screen.getByText('成功')).toBeInTheDocument();
  });

  it('labels hard and extreme degrees (coc7e)', () => {
    render(<Stamp roll={{ check_label: 'a', roll: 25, success_percent: 60, success: true, degree: 'hard' }} />);
    expect(screen.getByText('ハード成功')).toBeInTheDocument();
    render(<Stamp roll={{ check_label: 'b', roll: 10, success_percent: 60, success: true, degree: 'extreme' }} />);
    expect(screen.getByText('イクストリーム')).toBeInTheDocument();
  });

  it('shows a resource note when the roll carries a non-zero resourceChange', () => {
    render(
      <Stamp
        roll={{
          check_label: '正気度チェック', roll: 80, success_percent: 50, success: false, degree: 'fail',
          resourceChange: { key: 'san', label: '正気度', delta: -4, before: 60, after: 56 },
        }}
      />
    );
    expect(screen.getByText('正気度 -4')).toBeInTheDocument();
  });

  it('does not reveal the resource note before the stamp lands (avoids spoiling fail vs fumble during rolling/settled)', () => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }); // motion許可
    render(
      <Stamp
        animate
        roll={{
          check_label: '正気度チェック', roll: 80, success_percent: 50, success: false, degree: 'fail',
          resourceChange: { key: 'san', label: '正気度', delta: -4, before: 60, after: 56 },
        }}
      />
    );
    // 回転中: ラベルも注記もまだ出ない
    expect(screen.queryByText('失敗')).not.toBeInTheDocument();
    expect(screen.queryByText('正気度 -4')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(800)); // 出目停止
    expect(screen.queryByText('失敗')).not.toBeInTheDocument();
    expect(screen.queryByText('正気度 -4')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(250)); // 押印
    expect(screen.getByText('失敗')).toBeInTheDocument();
    expect(screen.getByText('正気度 -4')).toBeInTheDocument();
  });

  it('hides the resource note when delta is 0', () => {
    render(
      <Stamp
        roll={{
          check_label: '正気度チェック', roll: 10, success_percent: 50, success: true, degree: 'extreme',
          resourceChange: { key: 'san', label: '正気度', delta: 0, before: 60, after: 60 },
        }}
      />
    );
    expect(screen.queryByText(/正気度 /)).not.toBeInTheDocument();
  });
});
