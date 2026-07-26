import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FocusHeader from './FocusHeader.jsx';
import { COLORS } from '../../theme.js';

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

  // 「高さ === エクスポートした定数」という同語反復ではなく、実際にDOMへ出た
  // 離脱ボタンのタップ域+上下padding+下枠線の実測値がヘッダーの高さぴったりに
  // 収まっていることを検証する。ボタンのminHeightやpaddingだけを変えて
  // heightの数値を追随させ忘れると、この検証で失敗する。
  it('sizes the header so the exit button tap target plus padding and border fit exactly', () => {
    render(<FocusHeader title="丘の上の写真館" />);
    const header = screen.getByText('丘の上の写真館').closest('div[style*="sticky"]');
    const button = screen.getByRole('button', { name: 'ホーム' });

    const buttonMinHeight = parseInt(button.style.minHeight, 10);
    const verticalPadding = parseInt(header.style.paddingTop, 10) + parseInt(header.style.paddingBottom, 10);
    const borderWidth = parseInt(header.style.borderBottomWidth, 10);

    expect(parseInt(header.style.height, 10)).toBe(buttonMinHeight + verticalPadding + borderWidth);
  });

  it('keeps the not-yet-current step labels readable, not faint', () => {
    // 未到達のステップも読ませる文字なので AA に届かない COLORS.faint は使わない。
    // 現在地は色ではなく太字と aria-current で示している。
    render(<FocusHeader title="準備" steps={['世界観', 'シナリオ']} currentStep={0} />);
    expect(screen.getByText('シナリオ')).toHaveStyle({ color: COLORS.brassDark });
    expect(screen.getByText('世界観').style.fontWeight).toBe('600');
  });
});
