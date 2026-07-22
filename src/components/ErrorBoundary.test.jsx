import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary.jsx';

function Boom() {
  throw new Error('boom');
}

describe('ErrorBoundary', () => {
  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>正常な内容</div>
      </ErrorBoundary>
    );
    expect(screen.getByText('正常な内容')).toBeInTheDocument();
  });

  it('renders a fallback when a child throws during render', () => {
    // Reactは捕捉したエラーをconsole.errorに出すため、テスト出力を汚さないよう抑止する。
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText(/表示中に問題が発生しました/)).toBeInTheDocument();
    spy.mockRestore();
  });
});
