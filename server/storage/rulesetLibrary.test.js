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
    expect(await getRuleset(dataStore, 'usr_1', 'missing')).toBeNull();
  });

  it('saves and retrieves a ruleset', async () => {
    await saveRuleset(dataStore, 'usr_1', {
      id: 'homebrew',
      label: '自作ルール',
      desc: '独自ルール',
      hint: '演出ヒント',
      growthUnit: 'CP',
    });
    const ruleset = await getRuleset(dataStore, 'usr_1', 'homebrew');
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
    await saveRuleset(dataStore, 'usr_1', { id: 'a', label: 'A', desc: 'a', hint: '' });
    await saveRuleset(dataStore, 'usr_1', { id: 'b', label: 'B', desc: 'b', hint: '' });
    const rulesets = await listRulesets(dataStore, 'usr_1');
    expect(rulesets.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });

  it('deletes a ruleset', async () => {
    await saveRuleset(dataStore, 'usr_1', { id: 'a', label: 'A', desc: 'a', hint: '' });
    await deleteRuleset(dataStore, 'usr_1', 'a');
    expect(await getRuleset(dataStore, 'usr_1', 'a')).toBeNull();
  });

  it('does not leak rulesets across users', async () => {
    await saveRuleset(dataStore, 'usr_1', { id: 'r1', label: 'A' });
    expect(await getRuleset(dataStore, 'usr_2', 'r1')).toBeNull();
    expect(await listRulesets(dataStore, 'usr_2')).toEqual([]);
  });
});
