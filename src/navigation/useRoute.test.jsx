import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRoute, navigate, navigateHash, replace } from './useRoute.js';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

describe('useRoute', () => {
  it('reflects the current hash', () => {
    window.history.replaceState(null, '', '#/library/character/w1');
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'library', libraryTab: 'character', worldId: 'w1' });
  });

  it('returns the home route when there is no hash, without rewriting the URL', () => {
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'home' });
    expect(window.location.hash).toBe('');
  });

  it('follows hashchange', () => {
    const { result } = renderHook(() => useRoute());
    act(() => navigateHash('#/browse/worlds'));
    expect(result.current).toEqual({ name: 'browse', browseTab: 'worlds', publicId: null });
  });

  it('normalizes an abbreviated hash to its canonical form', async () => {
    window.history.replaceState(null, '', '#/library');
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'library', libraryTab: 'world', worldId: null });
    await act(async () => {});
    expect(window.location.hash).toBe('#/library/world');
  });

  it('redirects the legacy endings hash to the records route', async () => {
    window.history.replaceState(null, '', '#/endings');
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'records', recordsTab: 'endings' });
    await act(async () => {});
    expect(window.location.hash).toBe('#/records/endings');
  });

  it('falls back to home for an unknown hash', async () => {
    window.history.replaceState(null, '', '#/nope');
    const { result } = renderHook(() => useRoute());
    expect(result.current).toEqual({ name: 'home' });
    await act(async () => {});
    expect(window.location.hash).toBe('#/');
  });
});

describe('navigate', () => {
  it('pushes the canonical hash for a route', () => {
    navigate({ name: 'records', recordsTab: 'achievements' });
    expect(window.location.hash).toBe('#/records/achievements');
  });
});

describe('replace', () => {
  it('rewrites the hash without pushing a history entry', () => {
    const before = window.history.length;
    replace({ name: 'browse', browseTab: 'starters', publicId: null });
    expect(window.location.hash).toBe('#/browse/starters');
    expect(window.history.length).toBe(before);
  });
});
