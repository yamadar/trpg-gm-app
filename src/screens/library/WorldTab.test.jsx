import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WorldTab from './WorldTab.jsx';
import * as worldLibraryClient from '../../api/worldLibraryClient.js';
import * as worldImport from '../../api/worldImport.js';

beforeEach(() => {
  vi.restoreAllMocks();
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

    await waitFor(() => expect(reimportSpy).toHaveBeenCalledWith('w1', 'Waterdeep', undefined));
    await waitFor(() => expect(screen.getByText('港')).toBeInTheDocument());
    expect(putWorldSourceSpy).not.toHaveBeenCalled();
  });

  it('persists edited raw text via putWorldSource before reimporting when editRaw was changed', async () => {
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
    fireEvent.change(screen.getByDisplayValue('原文'), { target: { value: '編集後の本文' } });
    fireEvent.click(screen.getByText('保存して再分割'));

    await waitFor(() => expect(putWorldSourceSpy).toHaveBeenCalledWith('w1', '編集後の本文'));
    await waitFor(() => expect(reimportSpy).toHaveBeenCalledWith('w1', 'Waterdeep', undefined));

    const putOrder = putWorldSourceSpy.mock.invocationCallOrder[0];
    const reimportOrder = reimportSpy.mock.invocationCallOrder[0];
    expect(putOrder).toBeLessThan(reimportOrder);
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
});
