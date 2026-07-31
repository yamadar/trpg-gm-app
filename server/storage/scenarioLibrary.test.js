// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsTextStore } from './textStore.js';
import { saveScenario, getScenario, listScenarios, deleteScenario } from './scenarioLibrary.js';
import { scenarioMetaKey } from './paths.js';

let dir;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scenario-library-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Scenario library functions', () => {
  it('returns null for a missing scenario', async () => {
    expect(await getScenario(dataStore, textStore, 'usr_1', 'w1', 'missing')).toBeNull();
  });

  it('saves and retrieves a scenario with its raw text', async () => {
    await saveScenario(dataStore, textStore, 'usr_1', { worldId: 'w1', id: 'sc1', title: '失踪事件', raw: '## シナリオ概要' });
    const scenario = await getScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1');
    expect(scenario).toMatchObject({ id: 'sc1', worldId: 'w1', title: '失踪事件', raw: '## シナリオ概要' });
  });

  it('keeps raw unchanged as source of truth and stores the derived director guide separately', async () => {
    const raw = '  自由記述\n改行もそのまま\n';
    const directorGuide = {
      schemaVersion: 1,
      player_goal: '事件を解決する',
      ending_signals: ['事件の結果を描写した'],
    };
    await saveScenario(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      id: 'sc1',
      title: 'A',
      raw,
      directorGuide,
    });

    const scenario = await getScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1');
    expect(scenario.raw).toBe(raw);
    expect(scenario.directorGuide).toEqual(directorGuide);
  });

  it('clears a stale director guide when raw is saved without a matching analysis', async () => {
    await saveScenario(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      id: 'sc1',
      title: 'A',
      raw: '旧原文',
      directorGuide: { schemaVersion: 1, player_goal: '旧目的' },
    });
    await saveScenario(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      id: 'sc1',
      title: 'A',
      raw: '新原文',
    });

    expect((await getScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1')).directorGuide).toBeNull();
  });

  it('lists scenarios scoped to a world', async () => {
    await saveScenario(dataStore, textStore, 'usr_1', { worldId: 'w1', id: 'sc1', title: 'A', raw: 'a' });
    await saveScenario(dataStore, textStore, 'usr_1', { worldId: 'w1', id: 'sc2', title: 'B', raw: 'b' });
    await saveScenario(dataStore, textStore, 'usr_1', { worldId: 'w2', id: 'sc3', title: 'C', raw: 'c' });
    const scenarios = await listScenarios(dataStore, 'usr_1', 'w1');
    expect(scenarios.map((s) => s.id).sort()).toEqual(['sc1', 'sc2']);
  });

  it('deletes a scenario and its raw text', async () => {
    await saveScenario(dataStore, textStore, 'usr_1', { worldId: 'w1', id: 'sc1', title: 'A', raw: 'a' });
    await deleteScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1');
    expect(await getScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1')).toBeNull();
  });

  it('saves a scenario with a recommended ruleset', async () => {
    await saveScenario(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      id: 'sc1',
      title: 'A',
      raw: 'a',
      recommendedRuleset: 'coc7e',
    });
    const scenario = await getScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1');
    expect(scenario.recommendedRuleset).toBe('coc7e');
  });

  it('defaults recommendedRuleset to null when not specified', async () => {
    await saveScenario(dataStore, textStore, 'usr_1', { worldId: 'w1', id: 'sc1', title: 'A', raw: 'a' });
    const scenario = await getScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1');
    expect(scenario.recommendedRuleset).toBeNull();
  });

  it('stores Campaign generation provenance without mixing it into raw text', async () => {
    await saveScenario(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      id: 'sc1',
      title: '灰の密使',
      raw: '# 本文',
      sourceCampaignId: 'cp1',
      sourceCampaignRevision: 4,
      generatedFromPitchId: 'pitch_1',
    });
    const scenario = await getScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1');
    expect(scenario).toMatchObject({
      raw: '# 本文',
      sourceCampaignId: 'cp1',
      sourceCampaignRevision: 4,
      generatedFromPitchId: 'pitch_1',
    });
  });

  it('round-trips moods and backfills [] for legacy records', async () => {
    await saveScenario(dataStore, textStore, 'usr_1', {
      worldId: 'w1',
      id: 'sc1',
      title: 'T',
      raw: '#',
      moods: ['ミステリー', 'シリアス'],
    });
    expect((await getScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1')).moods).toEqual(['ミステリー', 'シリアス']);

    // legacy record: meta persisted before moods existed (no moods key at all)
    const meta = await dataStore.get(scenarioMetaKey('usr_1', 'w1', 'sc1'));
    delete meta.moods;
    await dataStore.set(scenarioMetaKey('usr_1', 'w1', 'sc1'), meta);

    expect((await getScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1')).moods).toEqual([]);
    expect((await listScenarios(dataStore, 'usr_1', 'w1'))[0].moods).toEqual([]);
  });

  it('defaults moods to [] when not specified or not an array', async () => {
    await saveScenario(dataStore, textStore, 'usr_1', { worldId: 'w1', id: 'sc1', title: 'A', raw: 'a' });
    expect((await getScenario(dataStore, textStore, 'usr_1', 'w1', 'sc1')).moods).toEqual([]);

    await saveScenario(dataStore, textStore, 'usr_1', { worldId: 'w1', id: 'sc2', title: 'A', raw: 'a', moods: 'ホラー' });
    expect((await getScenario(dataStore, textStore, 'usr_1', 'w1', 'sc2')).moods).toEqual([]);
  });
});
