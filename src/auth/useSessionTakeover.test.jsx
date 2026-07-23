import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthContext } from './AuthContext.jsx';
import { useSessionTakeover } from './useSessionTakeover.js';

vi.mock('../storage/index.js', () => ({ listSessions: vi.fn() }));
vi.mock('../api/sessionSyncClient.js', () => ({
  listServerSessions: vi.fn(),
  putSessionToServer: vi.fn().mockResolvedValue({}),
}));
import { listSessions } from '../storage/index.js';
import { listServerSessions, putSessionToServer } from '../api/sessionSyncClient.js';

function wrapper(user) {
  return ({ children }) => (
    <AuthContext.Provider value={{ user, loading: false, refresh: async () => {}, logout: async () => {} }}>
      {children}
    </AuthContext.Provider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('useSessionTakeover', () => {
  it('counts local sessions missing on the server or locally newer', async () => {
    listSessions.mockResolvedValue([
      { id: 'a', updatedAt: 200 },
      { id: 'b', updatedAt: 100 },
      { id: 'c', updatedAt: 100 },
    ]);
    listServerSessions.mockResolvedValue([
      { id: 'b', updatedAt: 300 }, // サーバーが新しい → 対象外
      { id: 'c', updatedAt: 50 },  // ローカルが新しい → 対象
    ]);
    const { result } = renderHook(() => useSessionTakeover(), { wrapper: wrapper({ id: 'u1' }) });
    await waitFor(() => expect(result.current.pendingCount).toBe(2)); // a と c
  });

  it('confirm uploads the candidates and clears the count', async () => {
    listSessions.mockResolvedValue([{ id: 'a', updatedAt: 200 }]);
    listServerSessions.mockResolvedValue([]);
    const { result } = renderHook(() => useSessionTakeover(), { wrapper: wrapper({ id: 'u1' }) });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    await act(() => result.current.confirm());
    expect(putSessionToServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(result.current.pendingCount).toBe(0);
  });

  it('does nothing while logged out', async () => {
    listSessions.mockResolvedValue([{ id: 'a', updatedAt: 1 }]);
    const { result } = renderHook(() => useSessionTakeover(), { wrapper: wrapper(null) });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.pendingCount).toBe(0);
    expect(listServerSessions).not.toHaveBeenCalled();
  });

  it('dismiss clears without uploading', async () => {
    listSessions.mockResolvedValue([{ id: 'a', updatedAt: 200 }]);
    listServerSessions.mockResolvedValue([]);
    const { result } = renderHook(() => useSessionTakeover(), { wrapper: wrapper({ id: 'u1' }) });
    await waitFor(() => expect(result.current.pendingCount).toBe(1));
    act(() => result.current.dismiss());
    expect(result.current.pendingCount).toBe(0);
    expect(putSessionToServer).not.toHaveBeenCalled();
  });
});
