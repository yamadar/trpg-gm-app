import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { parseHash, useHashRoute, navigateToUser, clearHash, navigateToEndings } from './useHashRoute.js';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('parseHash', () => {
  it('parses a user hash', () => {
    expect(parseHash('#/u/usr_ab12')).toEqual({ userId: 'usr_ab12', endings: false });
  });
  it('returns null for empty, unknown or malformed hashes', () => {
    expect(parseHash('')).toEqual({ userId: null, endings: false });
    expect(parseHash('#/other')).toEqual({ userId: null, endings: false });
    expect(parseHash('#/u/')).toEqual({ userId: null, endings: false });
    expect(parseHash('#/u/../evil')).toEqual({ userId: null, endings: false });
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

describe('endings route', () => {
  it('parses the endings hash', () => {
    expect(parseHash('#/endings')).toEqual({ userId: null, endings: true });
  });

  it('does not treat other hashes as the endings route', () => {
    expect(parseHash('#/endings/extra').endings).toBe(false);
    expect(parseHash('#/u/usr_1').endings).toBe(false);
    expect(parseHash('').endings).toBe(false);
  });

  it('still parses the user hash', () => {
    expect(parseHash('#/u/usr_1')).toEqual({ userId: 'usr_1', endings: false });
  });

  it('navigates to the endings route', () => {
    navigateToEndings();
    expect(window.location.hash).toBe('#/endings');
    expect(parseHash(window.location.hash).endings).toBe(true);
  });
});
