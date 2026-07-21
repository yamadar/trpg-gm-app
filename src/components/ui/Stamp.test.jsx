import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Stamp from './Stamp.jsx';

describe('Stamp', () => {
  it('renders nothing when roll is null', () => {
    const { container } = render(<Stamp roll={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the check label, roll numbers, and success label', () => {
    render(
      <Stamp roll={{ check_label: '崖を登る', roll: 42, success_percent: 60, success: true, degree: 'success' }} />
    );
    expect(screen.getByText('崖を登る')).toBeInTheDocument();
    expect(screen.getByText('42/60')).toBeInTheDocument();
    expect(screen.getByText('成功')).toBeInTheDocument();
  });

  it('labels a fumble as 大失敗', () => {
    render(
      <Stamp roll={{ check_label: 'x', roll: 99, success_percent: 60, success: false, degree: 'fumble' }} />
    );
    expect(screen.getByText('大失敗')).toBeInTheDocument();
  });
});
