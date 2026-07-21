// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { saveRuleset, getRuleset, listRulesets, deleteRuleset } from './rulesetLibrary.js';

let dir;
let dataStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ruleset-library-test-'));
  dataStore = createFsDataStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Ruleset library functions', () => {
  it('returns null for a missing ruleset', async () => {
    expect(await getRuleset(dataStore, 'missing')).toBeNull();
  });

  it('saves and retrieves a ruleset', async () => {
    await saveRuleset(dataStore, {
      id: 'homebrew',
      label: '自作ルール',
      desc: '独自ルール',
      hint: '演出ヒント',
      growthUnit: 'CP',
    });
    const ruleset = await getRuleset(dataStore, 'homebrew');
    expect(ruleset).toMatchObject({
      id: 'homebrew',
      label: '自作ルール',
      desc: '独自ルール',
      hint: '演出ヒント',
      growthUnit: 'CP',
    });
    expect(typeof ruleset.updatedAt).toBe('number');
  });

  it('lists saved rulesets', async () => {
    await saveRuleset(dataStore, { id: 'a', label: 'A', desc: 'a', hint: '' });
    await saveRuleset(dataStore, { id: 'b', label: 'B', desc: 'b', hint: '' });
    const rulesets = await listRulesets(dataStore);
    expect(rulesets.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('deletes a ruleset', async () => {
    await saveRuleset(dataStore, { id: 'a', label: 'A', desc: 'a', hint: '' });
    await deleteRuleset(dataStore, 'a');
    expect(await getRuleset(dataStore, 'a')).toBeNull();
  });
});
