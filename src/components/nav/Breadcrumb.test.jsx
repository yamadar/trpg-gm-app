import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Breadcrumb from './Breadcrumb.jsx';
import { BreadcrumbProvider, useBreadcrumbLabel } from '../../navigation/BreadcrumbContext.jsx';
import { parseRoute } from '../../navigation/routes.js';

afterEach(() => {
  window.history.replaceState(null, '', window.location.pathname);
});

function Register({ label }) {
  useBreadcrumbLabel(label);
  return null;
}

function renderCrumbs(hash, dynamicLabel) {
  return render(
    <BreadcrumbProvider>
      {dynamicLabel !== undefined && <Register label={dynamicLabel} />}
      <Breadcrumb route={parseRoute(hash)} />
    </BreadcrumbProvider>
  );
}

describe('Breadcrumb', () => {
  it('renders the static crumbs of the route', () => {
    renderCrumbs('#/library/character');
    expect(screen.getByText('ホーム')).toBeInTheDocument();
    expect(screen.getByText('素材')).toBeInTheDocument();
    expect(screen.getByText('Character')).toBeInTheDocument();
  });

  it('appends the dynamic label registered by the screen', () => {
    renderCrumbs('#/library/character/w1', 'アーカム 1920s');
    expect(screen.getByText('アーカム 1920s')).toBeInTheDocument();
  });

  it('does not expose the raw id while the dynamic label is missing', () => {
    renderCrumbs('#/library/character/w1');
    expect(screen.queryByText('w1')).not.toBeInTheDocument();
  });

  it('marks the last crumb as the current page and leaves it unclickable', () => {
    renderCrumbs('#/library/character');
    const current = screen.getByText('Character');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.tagName).toBe('SPAN');
  });

  it('navigates when an ancestor crumb is pressed', () => {
    renderCrumbs('#/library/character');
    fireEvent.click(screen.getByRole('button', { name: '素材' }));
    expect(window.location.hash).toBe('#/library/world');
  });

  it('marks the dynamic crumb as current when it is present', () => {
    renderCrumbs('#/browse/worlds/pub_1', '丘の上の写真館');
    expect(screen.getByText('丘の上の写真館')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '世界観' })).toBeInTheDocument();
  });

  it('shows the user display name as the only crumb below home', () => {
    renderCrumbs('#/u/usr_1', 'Xavier');
    expect(screen.getByRole('button', { name: 'ホーム' })).toBeInTheDocument();
    expect(screen.getByText('Xavier')).toHaveAttribute('aria-current', 'page');
  });

  it('exposes the trail inside a labelled nav landmark', () => {
    renderCrumbs('#/library/character');
    expect(screen.getByRole('navigation', { name: '現在地' })).toBeInTheDocument();
  });

  it('reserves a fixed height so the row does not jump when the label arrives', () => {
    const { container } = renderCrumbs('#/library/character/w1');
    expect(container.querySelector('nav').style.minHeight).toBe('32px');
  });
});
