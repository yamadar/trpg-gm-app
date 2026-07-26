import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import Library from './Library.jsx';
import { renderWithAuth } from '../test/renderWithAuth.jsx';
import { parseRoute } from '../navigation/routes.js';
import { BreadcrumbProvider } from '../navigation/BreadcrumbContext.jsx';
import Breadcrumb from '../components/nav/Breadcrumb.jsx';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', window.location.pathname);
});

function stubFetch(worlds = []) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => worlds }));
}

describe('Library', () => {
  it('shows the World tab when the route selects it', async () => {
    stubFetch([]);
    renderWithAuth(<Library route={parseRoute('#/library/world')} />);
    await waitFor(() => expect(screen.getByText('World一覧')).toBeInTheDocument());
  });

  // world/character/scenario/campaign は WORLD_SCOPED_LIBRARY_TABS。ruleset だけ対象外。
  it('shows a world-selector dropdown on World-scoped tabs but not on Ruleset', async () => {
    stubFetch([{ id: 'w1', title: 'World A', updatedAt: 1 }]);
    renderWithAuth(<Library route={parseRoute('#/library/ruleset')} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ruleset' })).toBeInTheDocument());
    expect(screen.queryByText('World: 選択してください')).not.toBeInTheDocument();
  });

  // World タブは WorldTab 自身が World のカード一覧を描画するため、
  // ピッカーの二重表示になってはいけない(WORLD_SCOPED_LIBRARY_TABS には
  // world が含まれるが、それは URL の worldId セグメントを許すためだけの話)。
  it('does not show a world-selector dropdown on the World tab', async () => {
    stubFetch([{ id: 'w1', title: 'World A', updatedAt: 1 }]);
    renderWithAuth(<Library route={parseRoute('#/library/world')} />);
    await waitFor(() => expect(screen.getByText('World一覧')).toBeInTheDocument());
    expect(screen.queryByText('World: 選択してください')).not.toBeInTheDocument();
  });

  it('shows the world selector on the Character tab', async () => {
    stubFetch([{ id: 'w1', title: 'World A', updatedAt: 1 }]);
    renderWithAuth(<Library route={parseRoute('#/library/character')} />);
    await waitFor(() => expect(screen.getByText('World: 選択してください')).toBeInTheDocument());
  });

  it('shows guidance in the Character tab when no world is selected', async () => {
    stubFetch([]);
    renderWithAuth(<Library route={parseRoute('#/library/character')} />);
    await waitFor(() =>
      expect(screen.getByText('先にWorldタブでWorldを作成・選択してください。')).toBeInTheDocument()
    );
  });

  it('shows an error banner when listWorlds fails on mount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }));
    renderWithAuth(<Library route={parseRoute('#/library/world')} />);
    await waitFor(() => expect(screen.getByText(/World一覧の取得に失敗した/)).toBeInTheDocument());
  });

  it('shows a login prompt instead of tabs when logged out', () => {
    renderWithAuth(<Library route={parseRoute('#/library/world')} />, { user: null });
    expect(screen.getByText(/ログインが必要/)).toBeInTheDocument();
    expect(screen.queryByText('World')).not.toBeInTheDocument();
  });

  it('drives the tab from the route instead of local state', async () => {
    renderWithAuth(<Library route={parseRoute('#/library/ruleset')} />);
    expect(await screen.findByRole('button', { name: 'Ruleset' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('button', { name: 'World' })).not.toHaveAttribute('aria-current');
  });

  it('pushes the tab into the URL when a tab is pressed', async () => {
    renderWithAuth(<Library route={parseRoute('#/library/world')} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Character' }));
    expect(window.location.hash).toBe('#/library/character');
  });

  it('no longer renders a close button', () => {
    renderWithAuth(<Library route={parseRoute('#/library/world')} />);
    expect(screen.queryByText('閉じる')).not.toBeInTheDocument();
  });

  it('puts the selected world into the URL', async () => {
    stubFetch([{ id: 'w1', title: 'World A', updatedAt: 1 }]);
    renderWithAuth(<Library route={parseRoute('#/library/character')} />);
    const select = await screen.findByRole('combobox');
    await waitFor(() => expect(screen.getByText('World A')).toBeInTheDocument());
    fireEvent.change(select, { target: { value: 'w1' } });
    expect(window.location.hash).toBe('#/library/character/w1');
  });

  it('drops the worldId when moving to a tab that is not World-scoped', async () => {
    renderWithAuth(<Library route={parseRoute('#/library/character/w1')} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ruleset' }));
    expect(window.location.hash).toBe('#/library/ruleset');
  });

  it('keeps the worldId when moving between two World-scoped tabs', async () => {
    renderWithAuth(<Library route={parseRoute('#/library/character/w1')} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Scenario' }));
    expect(window.location.hash).toBe('#/library/scenario/w1');
  });

  it('never exposes the raw worldId in the breadcrumb when it is absent from the fetched World list', async () => {
    stubFetch([{ id: 'w2', title: 'World B', updatedAt: 1 }]);
    const route = parseRoute('#/library/character/w1');
    renderWithAuth(
      <BreadcrumbProvider>
        <Breadcrumb route={route} />
        <Library route={route} />
      </BreadcrumbProvider>
    );
    // World一覧の取得完了を待つ(w1 はこのリストに含まれない)。
    await waitFor(() => expect(screen.getByText('World B')).toBeInTheDocument());
    expect(screen.queryByText('w1')).not.toBeInTheDocument();
  });
});
