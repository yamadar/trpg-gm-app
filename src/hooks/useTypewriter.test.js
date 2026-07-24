import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTypewriter } from './useTypewriter.js';

afterEach(() => vi.useRealTimers());

describe('useTypewriter', () => {
  it('enabled=falseなら最初から全文表示でdone', () => {
    const { result } = renderHook(() => useTypewriter('こんにちは', { enabled: false }));
    expect(result.current.shown).toBe('こんにちは');
    expect(result.current.done).toBe(true);
  });

  it('enabled=trueなら1文字ずつ増え、最後にdoneになる', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypewriter('abc', { speedMs: 10, enabled: true }));
    expect(result.current.shown).toBe('');
    expect(result.current.done).toBe(false);
    act(() => vi.advanceTimersByTime(10));
    expect(result.current.shown).toBe('a');
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.shown).toBe('abc');
    expect(result.current.done).toBe(true);
  });

  it('skip()で残りを即時表示する', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypewriter('abcdef', { speedMs: 10, enabled: true }));
    act(() => vi.advanceTimersByTime(10));
    expect(result.current.done).toBe(false);
    act(() => result.current.skip());
    expect(result.current.shown).toBe('abcdef');
    expect(result.current.done).toBe(true);
  });

  it('タイプ完了後にenabledがfalseへ変わっても全文表示を維持する', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ enabled }) => useTypewriter('ab', { speedMs: 10, enabled }), {
      initialProps: { enabled: true },
    });
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.done).toBe(true);
    rerender({ enabled: false });
    expect(result.current.shown).toBe('ab');
    expect(result.current.done).toBe(true);
  });

  it('空文字は即done', () => {
    const { result } = renderHook(() => useTypewriter('', { enabled: true }));
    expect(result.current.done).toBe(true);
  });
});
