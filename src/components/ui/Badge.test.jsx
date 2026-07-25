import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from './Badge.jsx';

describe('Badge', () => {
  it('renders its label as a non-interactive span', () => {
    render(<Badge>完結</Badge>);
    const el = screen.getByText('完結');
    expect(el.tagName).toBe('SPAN');
    expect(el.style.cursor).toBe('default');
  });

  it('fills the background for the brass variant', () => {
    render(<Badge variant="brass">完結</Badge>);
    expect(screen.getByText('完結').style.background).not.toBe('transparent');
  });

  it('keeps the background transparent for outline and faint variants', () => {
    render(
      <>
        <Badge variant="outline">公開中</Badge>
        <Badge variant="faint">挿絵あり</Badge>
      </>
    );
    expect(screen.getByText('公開中').style.background).toBe('transparent');
    expect(screen.getByText('挿絵あり').style.background).toBe('transparent');
  });

  it('falls back to the outline variant for an unknown variant', () => {
    render(<Badge variant="nope">未知</Badge>);
    expect(screen.getByText('未知').style.background).toBe('transparent');
  });

  it('merges a caller-supplied style', () => {
    render(<Badge style={{ marginLeft: 4 }}>完結</Badge>);
    expect(screen.getByText('完結').style.marginLeft).toBe('4px');
  });
});
