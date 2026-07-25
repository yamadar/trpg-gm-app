import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ToastStack, { TOAST_TIMEOUT_MS } from './Toast.jsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastStack', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<ToastStack items={[]} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
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
