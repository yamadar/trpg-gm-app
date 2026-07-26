import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import AppShell from './AppShell.jsx';
import { BreadcrumbProvider } from '../../navigation/BreadcrumbContext.jsx';
import { parseRoute } from '../../navigation/routes.js';
import { renderWithAuth } from '../../test/renderWithAuth.jsx';

function renderShell(hash, { user } = {}) {
  return renderWithAuth(
    <BreadcrumbProvider>
      <AppShell route={parseRoute(hash)}>
        <div>中身</div>
      </AppShell>
    </BreadcrumbProvider>,
    user === undefined ? {} : { user }
  );
}

describe('AppShell', () => {
  it('shows the global nav and breadcrumb on browsing routes', () => {
    renderShell('#/library/character');
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '現在地' })).toBeInTheDocument();
    expect(screen.getByText('中身')).toBeInTheDocument();
  });

  it('hides both navs on the play route', () => {
    renderShell('#/play/ses_1');
    expect(screen.queryByRole('navigation', { name: 'メインメニュー' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '現在地' })).not.toBeInTheDocument();
    expect(screen.getByText('中身')).toBeInTheDocument();
  });

  it('hides both navs on the setup route', () => {
    renderShell('#/setup');
    expect(screen.queryByRole('navigation', { name: 'メインメニュー' })).not.toBeInTheDocument();
    expect(screen.getByText('中身')).toBeInTheDocument();
  });

  it('highlights the nav tab that matches the route', () => {
    renderShell('#/browse/worlds');
    // パンくずの中間段も NAV_TABS からラベルを導出するため同名の「さがす」ボタンが
    // 別に存在する(Task 2 で承認済みの設計)。GlobalNav 側に絞って検証する。
    const nav = screen.getByRole('navigation', { name: 'メインメニュー' });
    expect(within(nav).getByRole('button', { name: 'さがす' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('keeps the nav visible on the user page, with no tab highlighted', () => {
    renderShell('#/u/usr_1');
    expect(screen.getByRole('navigation', { name: 'メインメニュー' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ホーム' })).not.toHaveAttribute('aria-current');
  });

  it('shows the account menu on browsing routes', () => {
    renderShell('#/', { user: { id: 'usr_1', displayName: 'テスト', avatarUrl: null } });
    expect(screen.getByText('テスト')).toBeInTheDocument();
  });

  it('offers a skip link to the main content', () => {
    renderShell('#/');
    const skip = screen.getByRole('link', { name: '本文へスキップ' });
    expect(skip).toHaveAttribute('href', '#main');
  });

  it('gives the content region an id the skip link can target', () => {
    const { container } = renderShell('#/');
    expect(container.querySelector('#main')).toBeInTheDocument();
  });
});
