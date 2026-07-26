import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ToastStack, { TOAST_TIMEOUT_MS } from './Toast.jsx';
import { SHELL_HEADER_HEIGHT_VAR } from '../nav/AppShell.jsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastStack', () => {
  it('keeps the live region mounted with no children when there are no items', () => {
    // ライブリージョンはDOMに既に存在していないとテキスト変化を検知できないため、
    // items が空でもコンテナ自体は消さない(空配列でnullを返す旧仕様からの意図的な変更)。
    render(<ToastStack items={[]} onDismiss={vi.fn()} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('renders one entry per item inside a polite live region', () => {
    render(
      <ToastStack
        items={[
          { id: 't1', text: '「A」の小説ができました', tone: 'success' },
          { id: 't2', text: '「B」の小説化に失敗しました', tone: 'error' },
        ]}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText('「A」の小説ができました')).toBeInTheDocument();
    expect(screen.getByText('「B」の小説化に失敗しました')).toBeInTheDocument();
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('derives its top offset from the shell header height instead of a fixed number', () => {
    // シェルのヘッダーは不透明な全幅の帯で、中身が折り返すと高くなる。固定値で
    // 見積もるとトーストがその裏に完全に隠れるため、AppShell が公開する実測値を参照する。
    render(<ToastStack items={[{ id: 't1', text: 'A' }]} onDismiss={vi.fn()} />);
    const top = screen.getByRole('status').style.top;
    expect(top).toContain(`var(${SHELL_HEADER_HEIGHT_VAR}`);
    expect(top).not.toBe('64px');
  });

  it('stacks above the shell header but below modals and menus', () => {
    // 実測値の反映が一瞬遅れても隠れないよう、位置だけでなく重なり順でもヘッダー
    // (zIndex 90)を上回る。ログインモーダル・アカウントメニュー(100)よりは下。
    render(<ToastStack items={[{ id: 't1', text: 'A' }]} onDismiss={vi.fn()} />);
    const z = Number(screen.getByRole('status').style.zIndex);
    expect(z).toBeGreaterThan(90);
    expect(z).toBeLessThan(100);
  });

  it('calls onDismiss with the item id when the close button is pressed', () => {
    const onDismiss = vi.fn();
    render(<ToastStack items={[{ id: 't1', text: 'A' }]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('閉じる'));
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('dismisses itself after the timeout', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ToastStack items={[{ id: 't1', text: 'A' }]} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS);
    });
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('does not restart its timer when the parent re-renders with a new onDismiss identity', () => {
    // 親(Home)は1秒ごとに再描画されるため、onDismissの参照が毎回変わる。
    // これをeffectの依存に入れるとタイマーが毎秒張り直され、永久に消えない。
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const items = [{ id: 't1', text: 'A' }];
    const { rerender } = render(<ToastStack items={items} onDismiss={() => onDismiss('t1')} />);

    for (let i = 0; i < 5; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      rerender(<ToastStack items={items} onDismiss={() => onDismiss('t1')} />);
    }
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onDismiss).toHaveBeenCalledWith('t1');
  });
});
