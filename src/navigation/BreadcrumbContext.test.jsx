import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BreadcrumbProvider, useBreadcrumbLabel, useBreadcrumbTail } from './BreadcrumbContext.jsx';

function Tail() {
  return <div data-testid="tail">{useBreadcrumbTail() ?? '(none)'}</div>;
}

function Screen({ label }) {
  useBreadcrumbLabel(label);
  return null;
}

describe('BreadcrumbContext', () => {
  it('starts with no label', () => {
    render(
      <BreadcrumbProvider>
        <Tail />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('(none)');
  });

  it('exposes a label registered by a screen', () => {
    render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アーカム 1920s" />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('アーカム 1920s');
  });

  it('updates when the screen changes its label', () => {
    const { rerender } = render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アーカム 1920s" />
      </BreadcrumbProvider>
    );
    rerender(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アルデン辺境領" />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('アルデン辺境領');
  });

  it('clears the label when the screen unmounts', () => {
    const { rerender } = render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label="アーカム 1920s" />
      </BreadcrumbProvider>
    );
    rerender(
      <BreadcrumbProvider>
        <Tail />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('(none)');
  });

  it('treats an undefined label as absent', () => {
    render(
      <BreadcrumbProvider>
        <Tail />
        <Screen label={undefined} />
      </BreadcrumbProvider>
    );
    expect(screen.getByTestId('tail')).toHaveTextContent('(none)');
  });
});
