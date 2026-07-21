import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Card from './Card.jsx';

describe('Card', () => {
  it('renders its children', () => {
    render(<Card>hello</Card>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
