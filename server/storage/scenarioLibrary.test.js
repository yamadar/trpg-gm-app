// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsTextStore } from './textStore.js';
import { saveScenario, getScenario, listScenarios, deleteScenario } from './scenarioLibrary.js';

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
    expect(await getScenario(dataStore, textStore, 'w1', 'missing')).toBeNull();
  });

  it('saves and retrieves a scenario with its raw text', async () => {
    await saveScenario(dataStore, textStore, { worldId: 'w1', id: 'sc1', title: '失踪事件', raw: '## シナリオ概要' });
    const scenario = await getScenario(dataStore, textStore, 'w1', 'sc1');
    expect(scenario).toMatchObject({ id: 'sc1', worldId: 'w1', title: '失踪事件', raw: '## シナリオ概要' });
  });

  it('lists scenarios scoped to a world', async () => {
    await saveScenario(dataStore, textStore, { worldId: 'w1', id: 'sc1', title: 'A', raw: 'a' });
    await saveScenario(dataStore, textStore, { worldId: 'w1', id: 'sc2', title: 'B', raw: 'b' });
    await saveScenario(dataStore, textStore, { worldId: 'w2', id: 'sc3', title: 'C', raw: 'c' });
    const scenarios = await listScenarios(dataStore, 'w1');
    expect(scenarios.map((s) => s.id).sort()).toEqual(['sc1', 'sc2']);
  });

  it('deletes a scenario and its raw text', async () => {
    await saveScenario(dataStore, textStore, { worldId: 'w1', id: 'sc1', title: 'A', raw: 'a' });
    await deleteScenario(dataStore, textStore, 'w1', 'sc1');
    expect(await getScenario(dataStore, textStore, 'w1', 'sc1')).toBeNull();
  });
});
