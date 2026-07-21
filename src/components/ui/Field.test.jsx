import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Field from './Field.jsx';

describe('Field', () => {
  it('renders label, hint, and children', () => {
    render(
      <Field label="世界観" hint="資料を貼る">
        <input aria-label="input" />
      </Field>
    );
    expect(screen.getByText('世界観')).toBeInTheDocument();
    expect(screen.getByText('資料を貼る')).toBeInTheDocument();
    expect(screen.getByLabelText('input')).toBeInTheDocument();
  });

  it('omits the hint element when no hint is given', () => {
    render(<Field label="世界観">child</Field>);
    expect(screen.queryByText('資料を貼る')).not.toBeInTheDocument();
  });
});
