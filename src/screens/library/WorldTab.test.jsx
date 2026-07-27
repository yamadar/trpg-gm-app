import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorldTab from './WorldTab.jsx';
import * as worldLibraryClient from '../../api/worldLibraryClient.js';
import * as worldImport from '../../api/worldImport.js';
import * as shareClient from '../../api/shareClient.js';
import { renderWithAuth } from '../../test/renderWithAuth.jsx';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(worldLibraryClient, 'listRegions').mockResolvedValue([]);
  vi.spyOn(worldLibraryClient, 'listCategories').mockResolvedValue([]);
});

describe('WorldTab', () => {
  it('renders the world list', () => {
    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'World A', updatedAt: 1 }]}
        selectedWorldId={null}
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn()}
      />
    );
    expect(screen.getByText('World A')).toBeInTheDocument();
  });

  it('creates a new world via importWorld and notifies the parent', async () => {
    const importSpy = vi
      .spyOn(worldImport, 'importWorld')
      .mockResolvedValue({ world: '目次', regions: [], categories: [] });
    const onWorldsChanged = vi.fn().mockResolvedValue();
    const onSelectWorld = vi.fn();

    render(
      <WorldTab worlds={[]} selectedWorldId={null} onSelectWorld={onSelectWorld} onWorldsChanged={onWorldsChanged} />
    );

    fireEvent.click(screen.getByText('+ 新規World'));
    fireEvent.change(screen.getByPlaceholderText('例: waterdeep-campaign'), { target: { value: 'w1' } });
    fireEvent.change(screen.getByPlaceholderText('World名'), { target: { value: 'Waterdeep' } });
    fireEvent.change(screen.getByPlaceholderText('世界観の資料を貼る'), { target: { value: '長い原文' } });
    fireEvent.click(screen.getByText('作成する'));

    await waitFor(() => expect(importSpy).toHaveBeenCalledWith('w1', 'Waterdeep', '長い原文'));
    expect(onWorldsChanged).toHaveBeenCalled();
    expect(onSelectWorld).toHaveBeenCalledWith('w1');
  });

  it('loads and shows the selected world for editing, with region/category breakdown after a reimport', async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '原文' });
    const putWorldSourceSpy = vi.spyOn(worldLibraryClient, 'putWorldSource').mockResolvedValue({});
    const reimportSpy = vi.spyOn(worldImport, 'reimportWorld').mockResolvedValue({
      world: '目次',
      regions: [{ id: 'harbor', title: '港', content: '港の詳細' }],
      categories: [],
    });

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('保存して再分割'));

    // reimportWorldは(worldId, title, adjustmentRequest, moods)で呼ばれる。moodsは1回のPUTに
    // まとめて渡されるようになったため、editMoodsの初期値(未設定=[])も併せて検証する。
    await waitFor(() => expect(reimportSpy).toHaveBeenCalledWith('w1', 'Waterdeep', undefined, []));
    await waitFor(() => expect(screen.getByText('港')).toBeInTheDocument());
    expect(putWorldSourceSpy).not.toHaveBeenCalled();
  });

  it('persists edited raw text via putWorldSource before reimporting when editRaw was changed', async () => {
    const user = userEvent.setup();
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '原文' });
    const putWorldSourceSpy = vi.spyOn(worldLibraryClient, 'putWorldSource').mockResolvedValue({});
    const reimportSpy = vi.spyOn(worldImport, 'reimportWorld').mockResolvedValue({
      world: '目次',
      regions: [],
      categories: [],
    });

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
    const markdownEditor = screen.getByLabelText('World本文');
    await user.clear(markdownEditor);
    await user.type(markdownEditor, '編集後の本文');
    await user.click(screen.getByText('保存して再分割'));

    await waitFor(() => expect(putWorldSourceSpy).toHaveBeenCalledWith('w1', '編集後の本文'));
    await waitFor(() => expect(reimportSpy).toHaveBeenCalledWith('w1', 'Waterdeep', undefined, []));

    const putOrder = putWorldSourceSpy.mock.invocationCallOrder[0];
    const reimportOrder = reimportSpy.mock.invocationCallOrder[0];
    expect(putOrder).toBeLessThan(reimportOrder);
  });

  it('renders escaped Markdown line breaks and headings as structured editable content', async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({
      id: 'w1',
      title: 'Waterdeep',
      raw: '# 世界概要\\n\\n## 地域\\n港町の説明',
    });

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    const editor = await screen.findByLabelText('World本文');
    expect(editor.querySelector('h1')).toHaveTextContent('世界概要');
    expect(editor.querySelector('h2')).toHaveTextContent('地域');
    expect(editor.querySelector('p')).toHaveTextContent('港町の説明');
  });

  describe('雰囲気(moods)', () => {
    it('pre-selects the world\'s saved moods when the editor opens', async () => {
      vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({
        id: 'w1',
        title: 'Waterdeep',
        raw: '原文',
        moods: ['SF', 'コメディ'],
      });

      render(
        <WorldTab
          worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
          selectedWorldId="w1"
          onSelectWorld={vi.fn()}
          onWorldsChanged={vi.fn().mockResolvedValue()}
        />
      );

      await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'SF', pressed: true })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'コメディ', pressed: true })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'ホラー', pressed: false })).toBeInTheDocument();
    });

    it('passes the selected moods into reimportWorld so they are saved in the single World PUT', async () => {
      vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({
        id: 'w1',
        title: 'Waterdeep',
        raw: '原文',
        moods: [],
      });
      vi.spyOn(worldLibraryClient, 'putWorldSource').mockResolvedValue({});
      const reimportSpy = vi
        .spyOn(worldImport, 'reimportWorld')
        .mockResolvedValue({ world: '目次', regions: [], categories: [] });

      render(
        <WorldTab
          worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
          selectedWorldId="w1"
          onSelectWorld={vi.fn()}
          onWorldsChanged={vi.fn().mockResolvedValue()}
        />
      );

      await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
      fireEvent.click(screen.getByText('ホラー'));
      fireEvent.click(screen.getByText('冒険'));
      fireEvent.click(screen.getByText('保存して再分割'));

      await waitFor(() =>
        expect(reimportSpy).toHaveBeenCalledWith('w1', 'Waterdeep', undefined, ['ホラー', '冒険'])
      );
    });

    it('passes an empty moods array into reimportWorld when none are selected', async () => {
      vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({
        id: 'w1',
        title: 'Waterdeep',
        raw: '原文',
        moods: [],
      });
      vi.spyOn(worldLibraryClient, 'putWorldSource').mockResolvedValue({});
      const reimportSpy = vi
        .spyOn(worldImport, 'reimportWorld')
        .mockResolvedValue({ world: '目次', regions: [], categories: [] });

      render(
        <WorldTab
          worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
          selectedWorldId="w1"
          onSelectWorld={vi.fn()}
          onWorldsChanged={vi.fn().mockResolvedValue()}
        />
      );

      await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
      fireEvent.click(screen.getByText('保存して再分割'));

      await waitFor(() => expect(reimportSpy).toHaveBeenCalledWith('w1', 'Waterdeep', undefined, []));
    });

    it('persists moods through the reimport save path (single PUT, no separate putWorld call)', async () => {
      // Unlike the tests above, this one does NOT mock worldImport.reimportWorld — it lets the
      // real implementation run so we can prove moods actually reach worldLibraryClient.putWorld
      // in the one and only PUT, with no second putWorld call following it.
      vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({
        id: 'w1',
        title: 'Waterdeep',
        raw: '原文',
        moods: [],
      });
      vi.spyOn(worldLibraryClient, 'getWorldSource').mockResolvedValue({ raw: '原文' });
      const worldSplitModule = await import('../../api/worldSplit.js');
      vi.spyOn(worldSplitModule, 'splitWorld').mockResolvedValue({ world: '目次', regions: [], categories: [] });
      const putWorldSpy = vi.spyOn(worldLibraryClient, 'putWorld').mockResolvedValue({});

      render(
        <WorldTab
          worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
          selectedWorldId="w1"
          onSelectWorld={vi.fn()}
          onWorldsChanged={vi.fn().mockResolvedValue()}
        />
      );

      await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
      fireEvent.click(screen.getByText('ホラー'));
      fireEvent.click(screen.getByText('冒険'));
      fireEvent.click(screen.getByText('保存して再分割'));

      await waitFor(() =>
        expect(putWorldSpy).toHaveBeenCalledWith('w1', {
          title: 'Waterdeep',
          raw: '目次',
          moods: ['ホラー', '冒険'],
        })
      );
      expect(putWorldSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('deletes a world after confirmation', async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '原文' });
    const deleteSpy = vi.spyOn(worldLibraryClient, 'deleteWorld').mockResolvedValue();
    const onWorldsChanged = vi.fn().mockResolvedValue();

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={onWorldsChanged}
      />
    );

    await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('削除'));
    expect(screen.getByText(/を削除する。よいか?/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('削除する'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('w1'));
    expect(onWorldsChanged).toHaveBeenCalled();
  });

  it('ignores a stale getWorld response when the selected world changes before it resolves', async () => {
    let resolveA;
    const promiseA = new Promise((resolve) => {
      resolveA = resolve;
    });
    const getWorldSpy = vi.spyOn(worldLibraryClient, 'getWorld').mockImplementation((id) => {
      if (id === 'w1') return promiseA;
      if (id === 'w2') return Promise.resolve({ id: 'w2', title: 'Neverwinter', raw: '原文2' });
      return Promise.reject(new Error('unexpected id: ' + id));
    });

    const worlds = [
      { id: 'w1', title: 'Waterdeep', updatedAt: 1 },
      { id: 'w2', title: 'Neverwinter', updatedAt: 2 },
    ];

    const { rerender } = render(
      <WorldTab
        worlds={worlds}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(getWorldSpy).toHaveBeenCalledWith('w1'));

    rerender(
      <WorldTab
        worlds={worlds}
        selectedWorldId="w2"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(getWorldSpy).toHaveBeenCalledWith('w2'));
    await waitFor(() => expect(screen.getByDisplayValue('Neverwinter')).toBeInTheDocument());

    await act(async () => {
      resolveA({ id: 'w1', title: 'Waterdeep', raw: '原文' });
      await promiseA;
    });

    expect(screen.getByDisplayValue('Neverwinter')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Waterdeep')).not.toBeInTheDocument();
  });

  it('shows region/category display titles instead of filename ids for a pre-existing world', async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '原文' });
    worldLibraryClient.listRegions.mockResolvedValue([{ id: 'harbor', title: '港湾地区' }]);
    worldLibraryClient.listCategories.mockResolvedValue([{ id: 'magic-system', title: '魔法体系' }]);

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(screen.getByDisplayValue('Waterdeep')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('港湾地区')).toBeInTheDocument());
    expect(screen.getByText('魔法体系')).toBeInTheDocument();
    expect(screen.queryByText('harbor')).not.toBeInTheDocument();
    expect(screen.queryByText('magic-system')).not.toBeInTheDocument();
  });

  it("lazily fetches a region's content via getRegion when editing one sourced from the id-only list", async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '原文' });
    worldLibraryClient.listRegions.mockResolvedValue(['harbor']);
    const getRegionSpy = vi.spyOn(worldLibraryClient, 'getRegion').mockResolvedValue({ id: 'harbor', raw: '港の詳細本文' });

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await waitFor(() => expect(screen.getByText('harbor')).toBeInTheDocument());
    fireEvent.click(screen.getByText('編集'));

    await waitFor(() => expect(getRegionSpy).toHaveBeenCalledWith('w1', 'harbor'));
    await waitFor(() => expect(screen.getByLabelText('harborの本文')).toHaveTextContent('港の詳細本文'));
  });

  it('saves an edited region title with its Markdown body and updates the list label', async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '原文' });
    worldLibraryClient.listRegions.mockResolvedValue([{ id: 'harbor', title: '港' }]);
    vi.spyOn(worldLibraryClient, 'getRegion').mockResolvedValue({
      id: 'harbor',
      title: '港',
      raw: '港の詳細本文',
    });
    const putRegionSpy = vi.spyOn(worldLibraryClient, 'putRegion').mockResolvedValue({});

    render(
      <WorldTab
        worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
        selectedWorldId="w1"
        onSelectWorld={vi.fn()}
        onWorldsChanged={vi.fn().mockResolvedValue()}
      />
    );

    await screen.findByText('港');
    fireEvent.click(screen.getByText('編集'));
    const titleInput = await screen.findByLabelText('地域タイトル');
    fireEvent.change(titleInput, { target: { value: 'ウォーターディープ港' } });
    fireEvent.click(screen.getByText('保存'));

    await waitFor(() =>
      expect(putRegionSpy).toHaveBeenCalledWith('w1', 'harbor', {
        title: 'ウォーターディープ港',
        raw: '港の詳細本文',
      })
    );
    expect(screen.getByText('ウォーターディープ港')).toBeInTheDocument();
  });

  it('does not apply a late getRegion result after the world was switched', async () => {
    vi.spyOn(worldLibraryClient, 'getWorld').mockImplementation((id) =>
      Promise.resolve({ id, title: id === 'w1' ? 'Waterdeep' : 'Neverwinter', raw: '原文' })
    );
    // Both worlds happen to have a region called "harbor" (same id, different content) —
    // this is what makes the leak observable: without the fix, the stale w1 draft would
    // render straight into w2's identically-named region.
    worldLibraryClient.listRegions.mockResolvedValue(['harbor']);
    worldLibraryClient.listCategories.mockResolvedValue([]);
    let resolveRegion;
    vi.spyOn(worldLibraryClient, 'getRegion').mockReturnValue(
      new Promise((r) => {
        resolveRegion = r;
      })
    );

    const worlds = [
      { id: 'w1', title: 'Waterdeep', updatedAt: 1 },
      { id: 'w2', title: 'Neverwinter', updatedAt: 2 },
    ];
    const { rerender } = render(
      <WorldTab worlds={worlds} selectedWorldId="w1" onSelectWorld={vi.fn()} onWorldsChanged={vi.fn().mockResolvedValue()} />
    );
    await waitFor(() => expect(screen.getByText('harbor')).toBeInTheDocument());
    fireEvent.click(screen.getByText('編集'));
    // まだgetRegionは未解決。この間にWorldを切り替える。
    rerender(
      <WorldTab worlds={worlds} selectedWorldId="w2" onSelectWorld={vi.fn()} onWorldsChanged={vi.fn().mockResolvedValue()} />
    );
    await waitFor(() => expect(screen.getByDisplayValue('Neverwinter')).toBeInTheDocument());
    // 遅れてw1のregionが解決しても、編集テキストエリアには反映されない。
    await act(async () => {
      resolveRegion({ id: 'harbor', raw: 'w1の港の本文(stale)' });
    });
    expect(screen.queryByText('w1の港の本文(stale)')).not.toBeInTheDocument();
  });

  it('discards a stale getRegion resolution after re-editing the same region id in a different world (epoch guard)', async () => {
    // Both worlds have a region literally called "shared" (same id, different content).
    // w1's fetch is left pending while we switch to w2 and re-open the SAME region id
    // there (w2's fetch resolves immediately). If the epoch guard in startEditingRegion
    // were missing, w1's late resolution would clobber the textarea that is now showing
    // w2's freshly-fetched content — even though editingRegionId ('shared') never changed
    // across the switch, so a state-reset-only test would never observe the leak.
    vi.spyOn(worldLibraryClient, 'getWorld').mockImplementation((id) =>
      Promise.resolve({ id, title: id === 'w1' ? 'Waterdeep' : 'Neverwinter', raw: '原文' })
    );
    worldLibraryClient.listRegions.mockResolvedValue(['shared']);
    worldLibraryClient.listCategories.mockResolvedValue([]);

    let resolveW1Region;
    const w1RegionPromise = new Promise((r) => {
      resolveW1Region = r;
    });
    vi.spyOn(worldLibraryClient, 'getRegion').mockImplementation((worldId, regionId) => {
      if (worldId === 'w1' && regionId === 'shared') return w1RegionPromise;
      if (worldId === 'w2' && regionId === 'shared') return Promise.resolve({ id: 'shared', raw: 'w2の共有本文' });
      return Promise.reject(new Error('unexpected getRegion call: ' + worldId + '/' + regionId));
    });

    const worlds = [
      { id: 'w1', title: 'Waterdeep', updatedAt: 1 },
      { id: 'w2', title: 'Neverwinter', updatedAt: 2 },
    ];

    const { rerender } = render(
      <WorldTab worlds={worlds} selectedWorldId="w1" onSelectWorld={vi.fn()} onWorldsChanged={vi.fn().mockResolvedValue()} />
    );
    await waitFor(() => expect(screen.getByText('shared')).toBeInTheDocument());

    // Start editing w1's "shared" region; getRegion('w1', 'shared') stays pending.
    fireEvent.click(screen.getByText('編集'));

    // Switch to w2 before w1's fetch resolves. The [selectedWorldId] effect resets
    // editingRegionId to null and bumps worldEpochRef.current.
    rerender(
      <WorldTab worlds={worlds} selectedWorldId="w2" onSelectWorld={vi.fn()} onWorldsChanged={vi.fn().mockResolvedValue()} />
    );
    await waitFor(() => expect(screen.getByDisplayValue('Neverwinter')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('shared')).toBeInTheDocument());

    // Re-enter edit mode on w2's "shared" region (same id). getRegion('w2', 'shared')
    // resolves immediately, so the Markdown editor shows w2's content again.
    fireEvent.click(screen.getByText('編集'));
    await waitFor(() => expect(screen.getByLabelText('sharedの本文')).toHaveTextContent('w2の共有本文'));

    // Now let w1's stale fetch resolve late.
    await act(async () => {
      resolveW1Region({ id: 'shared', raw: 'w1の共有本文(stale)' });
      await w1RegionPromise;
    });

    // The epoch guard must discard w1's stale resolution; w2's visible edit stays intact.
    expect(screen.getByLabelText('sharedの本文')).toHaveTextContent('w2の共有本文');
    expect(screen.queryByText('w1の共有本文(stale)')).not.toBeInTheDocument();
  });

  describe('publish controls', () => {
    it('does not render publish controls or fetch published state when logged out', async () => {
      const publishedSpy = vi.spyOn(shareClient, 'publishedWorlds');
      render(
        <WorldTab
          worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
          selectedWorldId={null}
          onSelectWorld={vi.fn()}
          onWorldsChanged={vi.fn()}
        />
      );
      expect(screen.getByText('Waterdeep')).toBeInTheDocument();
      expect(screen.queryByText('公開')).not.toBeInTheDocument();
      expect(publishedSpy).not.toHaveBeenCalled();
    });

    it('shows a 公開中 badge for a published world and a 公開 button for an unpublished one', async () => {
      vi.spyOn(shareClient, 'publishedWorlds').mockResolvedValue({ w1: 'pub-w1' });
      renderWithAuth(
        <WorldTab
          worlds={[
            { id: 'w1', title: 'Waterdeep', updatedAt: 1 },
            { id: 'w2', title: 'Neverwinter', updatedAt: 2 },
          ]}
          selectedWorldId={null}
          onSelectWorld={vi.fn()}
          onWorldsChanged={vi.fn()}
        />
      );
      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      expect(screen.getByText('再公開')).toBeInTheDocument();
      expect(screen.getByText('公開解除')).toBeInTheDocument();
      expect(screen.getAllByText('公開')).toHaveLength(1);
    });

    it('clicking 公開 calls publishWorld with the world id and flips to the badge', async () => {
      vi.spyOn(shareClient, 'publishedWorlds').mockResolvedValue({});
      const publishSpy = vi.spyOn(shareClient, 'publishWorld').mockResolvedValue({ publicId: 'pub-w1' });
      renderWithAuth(
        <WorldTab
          worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
          selectedWorldId={null}
          onSelectWorld={vi.fn()}
          onWorldsChanged={vi.fn()}
        />
      );
      await waitFor(() => expect(shareClient.publishedWorlds).toHaveBeenCalled());
      fireEvent.click(screen.getByText('公開'));

      await waitFor(() => expect(publishSpy).toHaveBeenCalledWith('w1'));
      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      expect(screen.queryByText('公開')).not.toBeInTheDocument();
    });

    it('clicking 公開解除 calls unpublishWorld and removes the badge', async () => {
      vi.spyOn(shareClient, 'publishedWorlds').mockResolvedValue({ w1: 'pub-w1' });
      const unpublishSpy = vi.spyOn(shareClient, 'unpublishWorld').mockResolvedValue();
      renderWithAuth(
        <WorldTab
          worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
          selectedWorldId={null}
          onSelectWorld={vi.fn()}
          onWorldsChanged={vi.fn()}
        />
      );
      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      fireEvent.click(screen.getByText('公開解除'));

      await waitFor(() => expect(unpublishSpy).toHaveBeenCalledWith('w1'));
      await waitFor(() => expect(screen.queryByText('公開中')).not.toBeInTheDocument());
      expect(screen.getByText('公開')).toBeInTheDocument();
    });

    it('shows an error message when publishWorld fails', async () => {
      vi.spyOn(shareClient, 'publishedWorlds').mockResolvedValue({});
      vi.spyOn(shareClient, 'publishWorld').mockRejectedValue(new Error('boom'));
      renderWithAuth(
        <WorldTab
          worlds={[{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]}
          selectedWorldId={null}
          onSelectWorld={vi.fn()}
          onWorldsChanged={vi.fn()}
        />
      );
      await waitFor(() => expect(shareClient.publishedWorlds).toHaveBeenCalled());
      fireEvent.click(screen.getByText('公開'));

      await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
    });
  });
});
