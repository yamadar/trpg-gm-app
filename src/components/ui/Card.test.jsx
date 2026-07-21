import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Card from './Card.jsx';

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>hello</Card>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('calls onClick when clicked anywhere in the card', () => {
    const onClick = vi.fn();
    render(<Card onClick={onClick}>hello</Card>);
    fireEvent.click(screen.getByText('hello'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
