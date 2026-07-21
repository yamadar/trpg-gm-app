import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App.jsx';

describe('App', () => {
  it('shows the home screen after the initial storage check completes', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("GM's Desk")).toBeInTheDocument());
    expect(screen.getByText('+ 新規プレイ')).toBeInTheDocument();
  });
});
