import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import LoginModal from './LoginModal.jsx';

afterEach(() => vi.unstubAllGlobals());

describe('LoginModal', () => {
  it('lists configured providers and navigates on click', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: ['google', 'x'] }) })
    );
    // jsdom disallows reassigning window.location directly; delete then reassign.
    const assign = vi.fn();
    const original = window.location;
    delete window.location;
    window.location = { ...original, assign };

    render(<LoginModal onClose={() => {}} />);
    await waitFor(() => screen.getByText('Google でログイン'));
    expect(screen.queryByText(/Discord/)).toBeNull();
    expect(screen.getByText('X でログイン')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Google でログイン'));
    expect(assign).toHaveBeenCalledWith('/auth/google/start');

    window.location = original;
  });

  it('shows a message when no providers are configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [] }) })
    );
    render(<LoginModal onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('ログイン方法が設定されていません')).toBeInTheDocument()
    );
  });

  it('shows a message when fetching providers fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(<LoginModal onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText('ログイン方法が設定されていません')).toBeInTheDocument()
    );
  });

  it('does not close when the dialog body is clicked, but does via the overlay and the close button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: [] }) })
    );
    const onClose = vi.fn();
    const { container } = render(<LoginModal onClose={onClose} />);
    await waitFor(() => screen.getByText('ログイン方法が設定されていません'));

    fireEvent.click(screen.getByText('ログイン方法が設定されていません'));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('閉じる'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
