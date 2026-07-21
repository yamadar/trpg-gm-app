// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  sessionKey,
  worldMetaKey,
  worldDocPath,
  regionDocPath,
  categoryDocPath,
  characterDocPath,
  characterMetaKey,
  scenarioDocPath,
  scenarioMetaKey,
  campaignMetaKey,
  rulesetMetaKey,
} from './paths.js';

describe('storage paths', () => {
  it('builds a session key', () => {
    expect(sessionKey('s1')).toBe('sessions/s1');
  });

  it('builds world paths', () => {
    expect(worldMetaKey('waterdeep')).toBe('worlds/waterdeep');
    expect(worldDocPath('waterdeep')).toBe('worlds/waterdeep/world.md');
  });

  it('builds region and category paths', () => {
    expect(regionDocPath('waterdeep', 'dock-ward')).toBe('worlds/waterdeep/regions/dock-ward.md');
    expect(categoryDocPath('waterdeep', 'magic-system')).toBe('worlds/waterdeep/categories/magic-system.md');
  });

  it('builds character paths for pc and npc', () => {
    expect(characterDocPath('waterdeep', 'pc', 'alice')).toBe('worlds/waterdeep/pc/alice.md');
    expect(characterDocPath('waterdeep', 'npc', 'villain')).toBe('worlds/waterdeep/npc/villain.md');
    expect(characterMetaKey('waterdeep', 'pc', 'alice')).toBe('worlds/waterdeep/pc/alice.parsed');
  });

  it('builds scenario and campaign paths', () => {
    expect(scenarioDocPath('waterdeep', 'sc1')).toBe('worlds/waterdeep/scenarios/sc1/scenario.md');
    expect(scenarioMetaKey('waterdeep', 'sc1')).toBe('worlds/waterdeep/scenarios/sc1');
    expect(campaignMetaKey('waterdeep', 'cp1')).toBe('worlds/waterdeep/campaigns/cp1/campaign');
  });

  it('builds a ruleset key', () => {
    expect(rulesetMetaKey('coc7e')).toBe('rulesets/coc7e');
  });
});
