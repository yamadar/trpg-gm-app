// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './dataStore.js';
import { createFsTextStore } from './textStore.js';
import { saveCharacter, getCharacter, listCharacters, deleteCharacter, saveCharacterParsed } from './characterLibrary.js';

let dir;
let dataStore;
let textStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'character-library-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('Character library functions', () => {
  it('returns null for a missing character', async () => {
    expect(await getCharacter(dataStore, textStore, 'w1', 'pc', 'missing')).toBeNull();
  });

  it('saves and retrieves a pc, forcing revealed to null', async () => {
    await saveCharacter(dataStore, textStore, {
      worldId: 'w1',
      kind: 'pc',
      name: 'alice',
      raw: 'PC名: アリス',
      revealed: true,
    });
    const pc = await getCharacter(dataStore, textStore, 'w1', 'pc', 'alice');
    expect(pc).toMatchObject({
      id: 'alice',
      worldId: 'w1',
      kind: 'pc',
      name: 'alice',
      raw: 'PC名: アリス',
      revealed: null,
    });
  });

  it('saves an npc with revealed defaulting to false when not specified', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'npc', name: 'villain', raw: 'NPC名: 黒幕' });
    const npc = await getCharacter(dataStore, textStore, 'w1', 'npc', 'villain');
    expect(npc.revealed).toBe(false);
  });

  it('saves an npc with revealed set to true', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'npc', name: 'villain', raw: 'x', revealed: true });
    const npc = await getCharacter(dataStore, textStore, 'w1', 'npc', 'villain');
    expect(npc.revealed).toBe(true);
  });

  it('saves an npc with revealed explicitly set to false', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'npc', name: 'villain', raw: 'x', revealed: false });
    const npc = await getCharacter(dataStore, textStore, 'w1', 'npc', 'villain');
    expect(npc.revealed).toBe(false);
  });

  it('normalizes non-boolean truthy values to true when saving npc revealed', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'npc', name: 'villain', raw: 'x', revealed: 1 });
    const npc = await getCharacter(dataStore, textStore, 'w1', 'npc', 'villain');
    expect(npc.revealed).toBe(true);
  });

  it('lists characters scoped to a world and kind', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'bob', raw: 'b' });
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'npc', name: 'villain', raw: 'v' });
    const pcs = await listCharacters(dataStore, 'w1', 'pc');
    expect(pcs.map((c) => c.name).sort()).toEqual(['alice', 'bob']);
    const npcs = await listCharacters(dataStore, 'w1', 'npc');
    expect(npcs.map((c) => c.name)).toEqual(['villain']);
  });

  it('scopes listing to the given world (does not leak characters from other worlds)', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    await saveCharacter(dataStore, textStore, { worldId: 'w2', kind: 'pc', name: 'carol', raw: 'c' });
    const pcs = await listCharacters(dataStore, 'w1', 'pc');
    expect(pcs.map((c) => c.name)).toEqual(['alice']);
  });

  it('deletes a character', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    await deleteCharacter(dataStore, textStore, 'w1', 'pc', 'alice');
    expect(await getCharacter(dataStore, textStore, 'w1', 'pc', 'alice')).toBeNull();
  });

  it('initializes parsed and parsedHash to null on save', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'alice', raw: 'a' });
    const pc = await getCharacter(dataStore, textStore, 'w1', 'pc', 'alice');
    expect(pc.parsed).toBeNull();
    expect(pc.parsedHash).toBeNull();
  });
});

describe('saveCharacterParsed', () => {
  it('returns null when the character does not exist', async () => {
    const result = await saveCharacterParsed(dataStore, 'w1', 'pc', 'missing', {
      parsed: { goal: 'x', bonds: 'y' },
      parsedHash: 'h1',
    });
    expect(result).toBeNull();
  });

  it('updates parsed and parsedHash without touching raw text', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'pc', name: 'alice', raw: '原文' });

    const updated = await saveCharacterParsed(dataStore, 'w1', 'pc', 'alice', {
      parsed: { goal: '妹を救う', bonds: '幼馴染' },
      parsedHash: 'abc123',
    });
    expect(updated.parsed).toEqual({ goal: '妹を救う', bonds: '幼馴染' });
    expect(updated.parsedHash).toBe('abc123');

    const character = await getCharacter(dataStore, textStore, 'w1', 'pc', 'alice');
    expect(character.raw).toBe('原文');
    expect(character.parsed).toEqual({ goal: '妹を救う', bonds: '幼馴染' });
  });

  it('preserves other meta fields (revealed) when updating parsed', async () => {
    await saveCharacter(dataStore, textStore, { worldId: 'w1', kind: 'npc', name: 'villain', raw: 'x', revealed: true });
    await saveCharacterParsed(dataStore, 'w1', 'npc', 'villain', {
      parsed: { goal: 'a', bonds: 'b' },
      parsedHash: 'h',
    });
    const character = await getCharacter(dataStore, textStore, 'w1', 'npc', 'villain');
    expect(character.revealed).toBe(true);
  });
});
