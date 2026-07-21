import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App.jsx';

describe('App scaffold', () => {
  it('renders the placeholder', () => {
    render(<App />);
    expect(screen.getByText('Project scaffold ready.')).toBeInTheDocument();
  });
});
