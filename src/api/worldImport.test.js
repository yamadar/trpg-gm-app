import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importWorld, reimportWorld } from './worldImport.js';
import * as worldSplit from './worldSplit.js';
import * as worldLibraryClient from './worldLibraryClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('importWorld', () => {
  it('splits the raw text, saves the source, and saves world/regions/categories', async () => {
    vi.spyOn(worldSplit, 'splitWorld').mockResolvedValue({
      world: '目次',
      regions: [{ id: 'waterdeep', title: 'A', content: '地域詳細' }],
      categories: [{ id: 'magic-system', title: 'B', content: 'カテゴリ詳細' }],
    });
    const putWorldSpy = vi.spyOn(worldLibraryClient, 'putWorld').mockResolvedValue({});
    const putSourceSpy = vi.spyOn(worldLibraryClient, 'putWorldSource').mockResolvedValue({});
    const putRegionSpy = vi.spyOn(worldLibraryClient, 'putRegion').mockResolvedValue({});
    const putCategorySpy = vi.spyOn(worldLibraryClient, 'putCategory').mockResolvedValue({});

    const result = await importWorld('w1', 'Waterdeep World', '長い原文');

    expect(putSourceSpy).toHaveBeenCalledWith('w1', '長い原文');
    expect(putWorldSpy).toHaveBeenCalledWith('w1', { title: 'Waterdeep World', raw: '目次' });
    expect(putRegionSpy).toHaveBeenCalledWith('w1', 'waterdeep', '地域詳細');
    expect(putCategorySpy).toHaveBeenCalledWith('w1', 'magic-system', 'カテゴリ詳細');
    expect(result.world).toBe('目次');
  });
});

describe('reimportWorld', () => {
  it('fetches the stored source, re-splits with the adjustment request, and re-saves', async () => {
    vi.spyOn(worldLibraryClient, 'getWorldSource').mockResolvedValue({ raw: '保存済み原文' });
    const splitSpy = vi.spyOn(worldSplit, 'splitWorld').mockResolvedValue({
      world: '更新後の目次',
      regions: [],
      categories: [],
    });
    const putWorldSpy = vi.spyOn(worldLibraryClient, 'putWorld').mockResolvedValue({});
    vi.spyOn(worldLibraryClient, 'listRegions').mockResolvedValue([]);
    vi.spyOn(worldLibraryClient, 'listCategories').mockResolvedValue([]);

    await reimportWorld('w1', 'Waterdeep World', '海沿いの街を追加して');

    expect(splitSpy).toHaveBeenCalledWith('保存済み原文', '海沿いの街を追加して');
    expect(putWorldSpy).toHaveBeenCalledWith('w1', { title: 'Waterdeep World', raw: '更新後の目次' });
  });

  it('includes moods in the single World PUT when a moods argument is passed, so they survive the reimport', async () => {
    vi.spyOn(worldLibraryClient, 'getWorldSource').mockResolvedValue({ raw: '保存済み原文' });
    vi.spyOn(worldSplit, 'splitWorld').mockResolvedValue({
      world: '更新後の目次',
      regions: [],
      categories: [],
    });
    const putWorldSpy = vi.spyOn(worldLibraryClient, 'putWorld').mockResolvedValue({});
    vi.spyOn(worldLibraryClient, 'listRegions').mockResolvedValue([]);
    vi.spyOn(worldLibraryClient, 'listCategories').mockResolvedValue([]);

    await reimportWorld('w1', 'Waterdeep World', '海沿いの街を追加して', ['ホラー', '冒険']);

    expect(putWorldSpy).toHaveBeenCalledTimes(1);
    expect(putWorldSpy).toHaveBeenCalledWith('w1', {
      title: 'Waterdeep World',
      raw: '更新後の目次',
      moods: ['ホラー', '冒険'],
    });
  });

  it('prunes regions/categories that are absent from the new split', async () => {
    vi.spyOn(worldLibraryClient, 'getWorldSource').mockResolvedValue({ raw: '原文' });
    vi.spyOn(worldSplit, 'splitWorld').mockResolvedValue({
      world: '目次',
      regions: [{ id: 'harbor', title: '港', content: 'x' }],
      categories: [],
    });
    vi.spyOn(worldLibraryClient, 'listRegions').mockResolvedValue(['harbor', 'old-region']);
    vi.spyOn(worldLibraryClient, 'listCategories').mockResolvedValue(['old-cat']);
    vi.spyOn(worldLibraryClient, 'putWorld').mockResolvedValue({});
    vi.spyOn(worldLibraryClient, 'putRegion').mockResolvedValue({});
    vi.spyOn(worldLibraryClient, 'putCategory').mockResolvedValue({});
    const delRegion = vi.spyOn(worldLibraryClient, 'deleteRegion').mockResolvedValue();
    const delCategory = vi.spyOn(worldLibraryClient, 'deleteCategory').mockResolvedValue();

    await reimportWorld('w1', 'W', undefined);

    expect(delRegion).toHaveBeenCalledWith('w1', 'old-region');
    expect(delRegion).not.toHaveBeenCalledWith('w1', 'harbor');
    expect(delCategory).toHaveBeenCalledWith('w1', 'old-cat');
  });
});
