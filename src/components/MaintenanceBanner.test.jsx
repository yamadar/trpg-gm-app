import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MaintenanceBanner from './MaintenanceBanner.jsx';

describe('MaintenanceBanner', () => {
  it('renders nothing while maintenance is off', () => {
    const { container } = render(<MaintenanceBanner mode="off" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces read-only maintenance and explains blocked actions', () => {
    render(<MaintenanceBanner mode="read-only" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('メンテナンス中');
    expect(status).toHaveTextContent('閲覧のみ利用できます');
    expect(status).toHaveTextContent('ゲーム進行は保存できません');
  });
});
