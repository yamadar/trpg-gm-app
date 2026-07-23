import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext.jsx';

afterEach(() => vi.unstubAllGlobals());

function Probe() {
  const { user, loading, logout } = useAuth();
  if (loading) return <div>loading</div>;
  return (
    <div>
      <div>{user ? `hello ${user.displayName}` : 'logged out'}</div>
      <button onClick={logout}>logout</button>
    </div>
  );
}

describe('AuthContext', () => {
  it('loads the current user on mount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ user: { id: 'u1', displayName: '太郎' } }),
    }));
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('hello 太郎')).toBeInTheDocument());
  });

  it('treats a fetch failure as logged out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('logged out')).toBeInTheDocument());
  });

  it('logout clears the user even when the request fails', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: 'u1', displayName: '太郎' } }) })
      .mockRejectedValueOnce(new Error('down'));
    vi.stubGlobal('fetch', f);
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => screen.getByText('hello 太郎'));
    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByText('logged out')).toBeInTheDocument());
  });
});
