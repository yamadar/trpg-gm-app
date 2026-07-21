// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'world-content-library-test-'));
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('World source', () => {
  it('returns null for a missing source', async () => {
    expect(await getWorldSource(textStore, 'w1')).toBeNull();
  });

  it('saves and retrieves the source text', async () => {
    await saveWorldSource(textStore, 'w1', '長大な世界観の原文');
    expect(await getWorldSource(textStore, 'w1')).toBe('長大な世界観の原文');
  });

  it('overwrites the source on save', async () => {
    await saveWorldSource(textStore, 'w1', 'old');
    await saveWorldSource(textStore, 'w1', 'new');
    expect(await getWorldSource(textStore, 'w1')).toBe('new');
  });
});

describe('Region functions', () => {
  it('returns null for a missing region', async () => {
    expect(await getRegion(textStore, 'w1', 'missing')).toBeNull();
  });

  it('saves and retrieves a region', async () => {
    await saveRegion(textStore, 'w1', 'waterdeep', '地域の詳細');
    expect(await getRegion(textStore, 'w1', 'waterdeep')).toBe('地域の詳細');
  });

  it('lists region ids scoped to a world', async () => {
    await saveRegion(textStore, 'w1', 'waterdeep', 'a');
    await saveRegion(textStore, 'w1', 'baldurs-gate', 'b');
    await saveRegion(textStore, 'w2', 'other-world-region', 'c');
    const regions = await listRegions(textStore, 'w1');
    expect(regions.sort()).toEqual(['baldurs-gate', 'waterdeep']);
  });

  it('returns an empty list when a world has no regions', async () => {
    expect(await listRegions(textStore, 'w1')).toEqual([]);
  });

  it('deletes a region', async () => {
    await saveRegion(textStore, 'w1', 'waterdeep', 'a');
    await deleteRegion(textStore, 'w1', 'waterdeep');
    expect(await getRegion(textStore, 'w1', 'waterdeep')).toBeNull();
  });
});

describe('Category functions', () => {
  it('returns null for a missing category', async () => {
    expect(await getCategory(textStore, 'w1', 'missing')).toBeNull();
  });

  it('saves and retrieves a category', async () => {
    await saveCategory(textStore, 'w1', 'magic-system', 'カテゴリの詳細');
    expect(await getCategory(textStore, 'w1', 'magic-system')).toBe('カテゴリの詳細');
  });

  it('lists category ids scoped to a world', async () => {
    await saveCategory(textStore, 'w1', 'magic-system', 'a');
    await saveCategory(textStore, 'w1', 'history', 'b');
    const categories = await listCategories(textStore, 'w1');
    expect(categories.sort()).toEqual(['history', 'magic-system']);
  });

  it('deletes a category', async () => {
    await saveCategory(textStore, 'w1', 'magic-system', 'a');
    await deleteCategory(textStore, 'w1', 'magic-system');
    expect(await getCategory(textStore, 'w1', 'magic-system')).toBeNull();
  });
});
