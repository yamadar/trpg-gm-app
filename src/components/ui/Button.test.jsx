import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Button from './Button.jsx';

describe('Button', () => {
  it('calls onClick when enabled', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByText('Go'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Go
      </Button>
    );
    fireEvent.click(screen.getByText('Go'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sets the native disabled attribute when disabled', () => {
    render(<Button disabled>Go</Button>);
    expect(screen.getByText('Go')).toBeDisabled();
  });
});
