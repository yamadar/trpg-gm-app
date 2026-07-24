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
  publicListPrefix,
  publicMetaKey,
  publicWorldDocsPrefix,
  publicWorldDocPath,
  publicRegionDocPath,
  publicCategoryDocPath,
  publicCharacterDocsPrefix,
  publicCharacterDocPath,
  publicScenarioDocsPrefix,
  publicScenarioDocPath,
  publicNovelDocsPrefix,
  publicNovelDocPath,
  publishWorldMapKey,
  publishWorldListPrefix,
  publishCharacterMapKey,
  publishCharacterListPrefix,
  publishScenarioMapKey,
  publishScenarioListPrefix,
  publishNovelMapKey,
  publishNovelListPrefix,
  sessionImageDir,
  sessionImagePath,
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

  it('builds the session image dir and file path', () => {
    expect(sessionImageDir('usr_1', 's1')).toBe('users/usr_1/sessions/s1/images');
    expect(sessionImagePath('usr_1', 's1', 'img_1')).toBe('users/usr_1/sessions/s1/images/img_1.png');
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

describe('public/publish paths', () => {
  it('builds public tree keys', () => {
    expect(publicListPrefix('worlds')).toBe('public/worlds');
    expect(publicMetaKey('novels', 'pub_abc')).toBe('public/novels/pub_abc');
    expect(publicWorldDocsPrefix('pub_abc')).toBe('public/worlds/pub_abc');
    expect(publicWorldDocPath('pub_abc')).toBe('public/worlds/pub_abc/world.md');
    expect(publicRegionDocPath('pub_abc', 'north')).toBe('public/worlds/pub_abc/regions/north.md');
    expect(publicCategoryDocPath('pub_abc', 'magic')).toBe('public/worlds/pub_abc/categories/magic.md');
    expect(publicCharacterDocPath('pub_abc')).toBe('public/characters/pub_abc/sheet.md');
    expect(publicScenarioDocPath('pub_abc')).toBe('public/scenarios/pub_abc/scenario.md');
    expect(publicNovelDocPath('pub_abc')).toBe('public/novels/pub_abc/novel.md');
  });

  it('builds publish mapping keys under the user namespace', () => {
    expect(publishWorldMapKey('usr_1', 'w1')).toBe('users/usr_1/publish/worlds/w1');
    expect(publishWorldListPrefix('usr_1')).toBe('users/usr_1/publish/worlds');
    expect(publishCharacterMapKey('usr_1', 'w1', 'pc', 'alice')).toBe('users/usr_1/publish/worlds/w1/characters/pc/alice');
    expect(publishCharacterListPrefix('usr_1', 'w1', 'npc')).toBe('users/usr_1/publish/worlds/w1/characters/npc');
    expect(publishScenarioMapKey('usr_1', 'w1', 's1')).toBe('users/usr_1/publish/worlds/w1/scenarios/s1');
    expect(publishScenarioListPrefix('usr_1', 'w1')).toBe('users/usr_1/publish/worlds/w1/scenarios');
    expect(publishNovelMapKey('usr_1', 'sess1')).toBe('users/usr_1/publish/sessions/sess1');
    expect(publishNovelListPrefix('usr_1')).toBe('users/usr_1/publish/sessions');
  });
});
