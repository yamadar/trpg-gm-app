import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import AppShell, { SHELL_HEADER_HEIGHT_VAR } from './AppShell.jsx';
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

// jsdom はレイアウトを持たず全ての要素の高さが0になるため、ヘッダーだけ実測値を装う。
function stubHeaderHeight(height) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return { height: this.tagName === 'HEADER' ? height : 0, width: 0, top: 0, left: 0, right: 0, bottom: 0 };
  });
}

describe('AppShell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty(SHELL_HEADER_HEIGHT_VAR);
    // hash を触るテストがあるため、次のテストへ持ち越さない。
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  });

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

  it('moves focus to the content region without disturbing the routing hash', () => {
    // hash はルーティングの入力そのものなので、スキップリンクが '#main' を書き込むと
    // parseRoute が解釈できずホームへ飛ばされる。href は残したまま遷移だけを止め、
    // フォーカスは自前で本文へ移す。
    window.location.hash = '#/library/world';
    renderShell('#/library/world');

    const skip = screen.getByRole('link', { name: '本文へスキップ' });
    // fireEvent は preventDefault されると false を返す。jsdom はアンカーの
    // フラグメント遷移を実行しないため、hash の比較だけでは既定動作の停止を確かめられない。
    expect(fireEvent.click(skip)).toBe(false);

    expect(window.location.hash).toBe('#/library/world');
    expect(document.getElementById('main')).toHaveFocus();
  });

  it('lets the content region receive focus without joining the tab order', () => {
    renderShell('#/');
    expect(document.getElementById('main')).toHaveAttribute('tabindex', '-1');
  });

  it('publishes the measured header height so fixed overlays can clear the header', () => {
    // ヘッダーは中身が折り返すと高くなるため、高さを定数で持てない。上部に固定配置する
    // もの(ToastStack 等)がその裏に隠れないよう、実測値をCSS変数として公開する。
    stubHeaderHeight(95);
    renderShell('#/library/world');
    expect(document.documentElement.style.getPropertyValue(SHELL_HEADER_HEIGHT_VAR)).toBe('95px');
  });

  it('publishes a zero header height in focus mode, where the shell renders no header', () => {
    stubHeaderHeight(95);
    renderShell('#/play/ses_1');
    expect(document.documentElement.style.getPropertyValue(SHELL_HEADER_HEIGHT_VAR)).toBe('0px');
  });

  it('reserves room for the bottom tab bar including the safe-area inset', () => {
    // jsdom には matchMedia が無いので useMediaQuery は false、つまり狭い幅の扱いになる。
    // 下部固定バーの下側 padding は max(4px, env(safe-area-inset-bottom)) なので、
    // 固定の64pxだけ空けるとホームインジケータのある端末で末尾が隠れる。
    renderShell('#/library/character');
    const main = document.getElementById('main');
    const padding = main.getAttribute('style');
    expect(padding).toContain('env(safe-area-inset-bottom)');
    expect(padding).toContain('64px');
  });

  it('gives the content region an id the skip link can target', () => {
    const { container } = renderShell('#/');
    expect(container.querySelector('#main')).toBeInTheDocument();
  });
});
