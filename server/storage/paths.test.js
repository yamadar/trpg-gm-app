// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  sessionListPrefix,
  sessionKey,
  sessionNovelDocPath,
  sessionNovelMetaKey,
  worldListPrefix,
  worldMetaKey,
  worldDocPath,
  worldSourceDocPath,
  regionDocPath,
  categoryDocPath,
  characterDocPath,
  characterMetaKey,
  scenarioDocPath,
  scenarioMetaKey,
  campaignMetaKey,
  rulesetListPrefix,
  rulesetMetaKey,
} from './paths.js';

describe('storage paths', () => {
  it('builds a session list prefix', () => {
    expect(sessionListPrefix('usr_1')).toBe('users/usr_1/sessions');
  });

  it('builds a session key', () => {
    expect(sessionKey('usr_1', 's1')).toBe('users/usr_1/sessions/s1');
  });

  it('builds session novel paths', () => {
    expect(sessionNovelDocPath('usr_1', 's1')).toBe('users/usr_1/sessions/s1/novel.md');
    expect(sessionNovelMetaKey('usr_1', 's1')).toBe('users/usr_1/sessions/s1/novel');
  });

  it('builds a world list prefix', () => {
    expect(worldListPrefix('usr_1')).toBe('users/usr_1/worlds');
  });

  it('builds world paths', () => {
    expect(worldMetaKey('usr_1', 'waterdeep')).toBe('users/usr_1/worlds/waterdeep');
    expect(worldDocPath('usr_1', 'waterdeep')).toBe('users/usr_1/worlds/waterdeep/world.md');
    expect(worldSourceDocPath('usr_1', 'waterdeep')).toBe('users/usr_1/worlds/waterdeep/source.md');
  });

  it('builds region and category paths', () => {
    expect(regionDocPath('usr_1', 'waterdeep', 'dock-ward')).toBe(
      'users/usr_1/worlds/waterdeep/regions/dock-ward.md',
    );
    expect(categoryDocPath('usr_1', 'waterdeep', 'magic-system')).toBe(
      'users/usr_1/worlds/waterdeep/categories/magic-system.md',
    );
  });

  it('builds character paths for pc and npc', () => {
    expect(characterDocPath('usr_1', 'waterdeep', 'pc', 'alice')).toBe(
      'users/usr_1/worlds/waterdeep/pc/alice.md',
    );
    expect(characterDocPath('usr_1', 'waterdeep', 'npc', 'villain')).toBe(
      'users/usr_1/worlds/waterdeep/npc/villain.md',
    );
    expect(characterMetaKey('usr_1', 'waterdeep', 'pc', 'alice')).toBe(
      'users/usr_1/worlds/waterdeep/pc/alice.parsed',
    );
  });

  it('builds scenario and campaign paths', () => {
    expect(scenarioDocPath('usr_1', 'waterdeep', 'sc1')).toBe(
      'users/usr_1/worlds/waterdeep/scenarios/sc1/scenario.md',
    );
    expect(scenarioMetaKey('usr_1', 'waterdeep', 'sc1')).toBe(
      'users/usr_1/worlds/waterdeep/scenarios/sc1',
    );
    expect(campaignMetaKey('usr_1', 'waterdeep', 'cp1')).toBe(
      'users/usr_1/worlds/waterdeep/campaigns/cp1/campaign',
    );
  });

  it('builds a ruleset list prefix', () => {
    expect(rulesetListPrefix('usr_1')).toBe('users/usr_1/rulesets');
  });

  it('builds a ruleset key', () => {
    expect(rulesetMetaKey('usr_1', 'coc7e')).toBe('users/usr_1/rulesets/coc7e');
  });
});
