// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsTextStore } from './textStore.js';
import {
  saveWorldSource,
  getWorldSource,
  saveRegion,
  getRegion,
  listRegions,
  deleteRegion,
  saveCategory,
  getCategory,
  listCategories,
  deleteCategory,
} from './worldContentLibrary.js';

let dir;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'world-content-library-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('World source', () => {
  it('returns null for a missing source', async () => {
    expect(await getWorldSource(textStore, 'usr_1', 'w1')).toBeNull();
  });

  it('saves and retrieves the source text', async () => {
    await saveWorldSource(textStore, 'usr_1', 'w1', '長大な世界観の原文');
    expect(await getWorldSource(textStore, 'usr_1', 'w1')).toBe('長大な世界観の原文');
  });

  it('overwrites the source on save', async () => {
    await saveWorldSource(textStore, 'usr_1', 'w1', 'old');
    await saveWorldSource(textStore, 'usr_1', 'w1', 'new');
    expect(await getWorldSource(textStore, 'usr_1', 'w1')).toBe('new');
  });
});

describe('Region functions', () => {
  it('returns null for a missing region', async () => {
    expect(await getRegion(dataStore, textStore, 'usr_1', 'w1', 'missing')).toBeNull();
  });

  it('saves and retrieves a region', async () => {
    await saveRegion(dataStore, textStore, 'usr_1', 'w1', 'waterdeep', {
      title: 'ウォーターディープ',
      raw: '地域の詳細',
    });
    expect(await getRegion(dataStore, textStore, 'usr_1', 'w1', 'waterdeep')).toEqual({
      id: 'waterdeep',
      title: 'ウォーターディープ',
      raw: '地域の詳細',
    });
  });

  it('lists region ids and display titles scoped to a world', async () => {
    await saveRegion(dataStore, textStore, 'usr_1', 'w1', 'waterdeep', { title: 'ウォーターディープ', raw: 'a' });
    await saveRegion(dataStore, textStore, 'usr_1', 'w1', 'baldurs-gate', { title: 'バルダーズ・ゲート', raw: 'b' });
    await saveRegion(dataStore, textStore, 'usr_1', 'w2', 'other-world-region', { title: '別世界', raw: 'c' });
    const regions = await listRegions(dataStore, textStore, 'usr_1', 'w1');
    expect(regions.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'baldurs-gate', title: 'バルダーズ・ゲート' },
      { id: 'waterdeep', title: 'ウォーターディープ' },
    ]);
  });

  it('returns an empty list when a world has no regions', async () => {
    expect(await listRegions(dataStore, textStore, 'usr_1', 'w1')).toEqual([]);
  });

  it('deletes a region', async () => {
    await saveRegion(dataStore, textStore, 'usr_1', 'w1', 'waterdeep', { title: '港町', raw: 'a' });
    await deleteRegion(dataStore, textStore, 'usr_1', 'w1', 'waterdeep');
    expect(await getRegion(dataStore, textStore, 'usr_1', 'w1', 'waterdeep')).toBeNull();
  });

  it('derives a legacy region title from its Markdown heading', async () => {
    await textStore.write('users/usr_1/worlds/w1/regions/north.md', '# 北方地方\n\n雪原');
    expect(await listRegions(dataStore, textStore, 'usr_1', 'w1')).toEqual([{ id: 'north', title: '北方地方' }]);
  });
});

describe('Category functions', () => {
  it('returns null for a missing category', async () => {
    expect(await getCategory(dataStore, textStore, 'usr_1', 'w1', 'missing')).toBeNull();
  });

  it('saves and retrieves a category', async () => {
    await saveCategory(dataStore, textStore, 'usr_1', 'w1', 'magic-system', {
      title: '魔法体系',
      raw: 'カテゴリの詳細',
    });
    expect(await getCategory(dataStore, textStore, 'usr_1', 'w1', 'magic-system')).toEqual({
      id: 'magic-system',
      title: '魔法体系',
      raw: 'カテゴリの詳細',
    });
  });

  it('lists category ids and display titles scoped to a world', async () => {
    await saveCategory(dataStore, textStore, 'usr_1', 'w1', 'magic-system', { title: '魔法体系', raw: 'a' });
    await saveCategory(dataStore, textStore, 'usr_1', 'w1', 'history', { title: '世界史', raw: 'b' });
    const categories = await listCategories(dataStore, textStore, 'usr_1', 'w1');
    expect(categories.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'history', title: '世界史' },
      { id: 'magic-system', title: '魔法体系' },
    ]);
  });

  it('deletes a category', async () => {
    await saveCategory(dataStore, textStore, 'usr_1', 'w1', 'magic-system', { title: '魔法体系', raw: 'a' });
    await deleteCategory(dataStore, textStore, 'usr_1', 'w1', 'magic-system');
    expect(await getCategory(dataStore, textStore, 'usr_1', 'w1', 'magic-system')).toBeNull();
  });
});
