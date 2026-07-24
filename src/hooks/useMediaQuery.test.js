import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from './useMediaQuery.js';

afterEach(() => {
  delete window.matchMedia;
});

function mockMatchMedia(initialMatches) {
  let handler;
  const mql = {
    matches: initialMatches,
    addEventListener: (_e, h) => {
      handler = h;
    },
    removeEventListener: vi.fn(),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return {
    fire: (matches) => {
      mql.matches = matches;
      act(() => handler({ matches }));
    },
    mql,
  };
}

describe('useMediaQuery', () => {
  it('returns false when matchMedia is unavailable', () => {
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(false);
  });
  it('returns the initial matches value', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(true);
  });
  it('updates when the media query change event fires', () => {
    const ctrl = mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(false);
    ctrl.fire(true);
    expect(result.current).toBe(true);
  });
  it('matchMediaがリスナAPIを持たなくても例外を投げず初期値を返す', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }); // addEventListener等なし
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(true);
  });
  it('removes its listener on unmount', () => {
    const ctrl = mockMatchMedia(true);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    unmount();
    expect(ctrl.mql.removeEventListener).toHaveBeenCalled();
  });
});
