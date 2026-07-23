import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { parseHash, useHashRoute, navigateToUser, clearHash } from './useHashRoute.js';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('parseHash', () => {
  it('parses a user hash', () => {
    expect(parseHash('#/u/usr_ab12')).toEqual({ userId: 'usr_ab12' });
  });
  it('returns null for empty, unknown or malformed hashes', () => {
    expect(parseHash('')).toEqual({ userId: null });
    expect(parseHash('#/other')).toEqual({ userId: null });
    expect(parseHash('#/u/')).toEqual({ userId: null });
    expect(parseHash('#/u/../evil')).toEqual({ userId: null });
  });
});

describe('useHashRoute', () => {
  it('reflects the current hash and follows hashchange', () => {
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.userId).toBeNull();
    act(() => navigateToUser('usr_1'));
    expect(result.current.userId).toBe('usr_1');
  });

  it('clearHash removes the hash and notifies subscribers', () => {
    const { result } = renderHook(() => useHashRoute());
    act(() => navigateToUser('usr_1'));
    expect(result.current.userId).toBe('usr_1');
    act(() => clearHash());
    expect(result.current.userId).toBeNull();
    expect(window.location.hash).toBe('');
  });
});
