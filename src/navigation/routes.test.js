import { describe, it, expect } from 'vitest';
import {
  parseRoute,
  buildHash,
  NAV_TABS,
  LIBRARY_TABS,
  navTabFor,
  isFocusRoute,
  crumbsFor,
  wantsDynamicCrumb,
} from './routes.js';

describe('parseRoute', () => {
  it('parses the home route', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
  });

  it('parses library routes and defaults the tab', () => {
    expect(parseRoute('#/library')).toEqual({ name: 'library', libraryTab: 'world', worldId: null });
    expect(parseRoute('#/library/character')).toEqual({
      name: 'library',
      libraryTab: 'character',
      worldId: null,
    });
    expect(parseRoute('#/library/character/w1')).toEqual({
      name: 'library',
      libraryTab: 'character',
      worldId: 'w1',
    });
  });

  it('falls back to the default library tab for unknown tabs', () => {
    expect(parseRoute('#/library/nope')).toEqual({ name: 'library', libraryTab: 'world', worldId: null });
  });

  it('keeps a worldId on the world tab, which opens that world for editing', () => {
    expect(parseRoute('#/library/world/w1')).toEqual({ name: 'library', libraryTab: 'world', worldId: 'w1' });
  });

  it('ignores a worldId on the ruleset tab, which is not world-scoped', () => {
    expect(parseRoute('#/library/ruleset/w1')).toEqual({ name: 'library', libraryTab: 'ruleset', worldId: null });
  });

  it('parses browse routes', () => {
    expect(parseRoute('#/browse')).toEqual({ name: 'browse', browseTab: 'starters', publicId: null });
    expect(parseRoute('#/browse/worlds')).toEqual({ name: 'browse', browseTab: 'worlds', publicId: null });
    expect(parseRoute('#/browse/worlds/pub_1')).toEqual({
      name: 'browse',
      browseTab: 'worlds',
      publicId: 'pub_1',
    });
  });

  it('drops a publicId on the starters tab, which has no detail view', () => {
    expect(parseRoute('#/browse/starters/pub_1')).toEqual({
      name: 'browse',
      browseTab: 'starters',
      publicId: null,
    });
  });

  it('parses records routes', () => {
    expect(parseRoute('#/records')).toEqual({ name: 'records', recordsTab: 'endings' });
    expect(parseRoute('#/records/achievements')).toEqual({ name: 'records', recordsTab: 'achievements' });
  });

  it('maps the legacy endings and achievements hashes onto records', () => {
    expect(parseRoute('#/endings')).toEqual({ name: 'records', recordsTab: 'endings' });
    expect(parseRoute('#/achievements')).toEqual({ name: 'records', recordsTab: 'achievements' });
  });

  it('parses the user route and keeps rejecting malformed ones', () => {
    expect(parseRoute('#/u/usr_ab12')).toEqual({ name: 'user', userId: 'usr_ab12' });
    expect(parseRoute('#/u/')).toBeNull();
    expect(parseRoute('#/u/../evil')).toBeNull();
    expect(parseRoute('#/u/..')).toBeNull();
  });

  it('parses setup and play routes', () => {
    expect(parseRoute('#/setup')).toEqual({ name: 'setup' });
    expect(parseRoute('#/play/ses_1')).toEqual({ name: 'play', sessionId: 'ses_1' });
    expect(parseRoute('#/play')).toBeNull();
  });

  it('returns null for unknown hashes and for extra segments', () => {
    expect(parseRoute('#/foo')).toBeNull();
    expect(parseRoute('#/setup/extra')).toBeNull();
    expect(parseRoute('#/library/character/w1/extra')).toBeNull();
  });
});

describe('buildHash', () => {
  it('builds the canonical hash for every route', () => {
    expect(buildHash({ name: 'home' })).toBe('#/');
    expect(buildHash({ name: 'library', libraryTab: 'world', worldId: null })).toBe('#/library/world');
    expect(buildHash({ name: 'library', libraryTab: 'character', worldId: 'w1' })).toBe(
      '#/library/character/w1'
    );
    expect(buildHash({ name: 'browse', browseTab: 'starters', publicId: null })).toBe('#/browse/starters');
    expect(buildHash({ name: 'browse', browseTab: 'worlds', publicId: 'pub_1' })).toBe(
      '#/browse/worlds/pub_1'
    );
    expect(buildHash({ name: 'records', recordsTab: 'achievements' })).toBe('#/records/achievements');
    expect(buildHash({ name: 'user', userId: 'usr_1' })).toBe('#/u/usr_1');
    expect(buildHash({ name: 'setup' })).toBe('#/setup');
    expect(buildHash({ name: 'play', sessionId: 'ses_1' })).toBe('#/play/ses_1');
    expect(buildHash(null)).toBe('#/');
  });

  it('round-trips every canonical hash', () => {
    const hashes = [
      '#/',
      '#/library/world',
      '#/library/character/w1',
      '#/browse/starters',
      '#/browse/worlds/pub_1',
      '#/records/endings',
      '#/records/achievements',
      '#/u/usr_1',
      '#/setup',
      '#/play/ses_1',
    ];
    for (const h of hashes) expect(buildHash(parseRoute(h))).toBe(h);
  });

  it('rewrites abbreviated and legacy hashes to their canonical form', () => {
    expect(buildHash(parseRoute('#/library'))).toBe('#/library/world');
    expect(buildHash(parseRoute('#/browse'))).toBe('#/browse/starters');
    expect(buildHash(parseRoute('#/endings'))).toBe('#/records/endings');
    expect(buildHash(parseRoute('#/achievements'))).toBe('#/records/achievements');
  });
});

describe('NAV_TABS', () => {
  it('exposes exactly the four primary destinations with canonical hashes', () => {
    expect(NAV_TABS.map((t) => t.key)).toEqual(['home', 'library', 'browse', 'records']);
    expect(NAV_TABS.map((t) => t.label)).toEqual(['ホーム', '素材', 'さがす', '記録']);
    for (const t of NAV_TABS) expect(buildHash(parseRoute(t.hash))).toBe(t.hash);
  });

  it('re-exports the library tabs', () => {
    expect(LIBRARY_TABS.map((t) => t.key)).toEqual([
      'world',
      'character',
      'scenario',
      'campaign',
      'ruleset',
    ]);
  });
});

describe('navTabFor', () => {
  it('maps browsing routes onto their nav tab', () => {
    expect(navTabFor(parseRoute('#/'))).toBe('home');
    expect(navTabFor(parseRoute('#/library/character'))).toBe('library');
    expect(navTabFor(parseRoute('#/browse/worlds'))).toBe('browse');
    expect(navTabFor(parseRoute('#/records/achievements'))).toBe('records');
  });

  it('returns null where no tab should be highlighted', () => {
    expect(navTabFor(parseRoute('#/setup'))).toBeNull();
    expect(navTabFor(parseRoute('#/play/ses_1'))).toBeNull();
    expect(navTabFor(parseRoute('#/u/usr_1'))).toBeNull();
    expect(navTabFor(null)).toBeNull();
  });
});

describe('isFocusRoute', () => {
  it('treats setup and play as focus mode', () => {
    expect(isFocusRoute(parseRoute('#/setup'))).toBe(true);
    expect(isFocusRoute(parseRoute('#/play/ses_1'))).toBe(true);
  });

  it('treats every other route as browsing mode', () => {
    expect(isFocusRoute(parseRoute('#/'))).toBe(false);
    expect(isFocusRoute(parseRoute('#/library/world'))).toBe(false);
    expect(isFocusRoute(parseRoute('#/u/usr_1'))).toBe(false);
    expect(isFocusRoute(null)).toBe(false);
  });
});

describe('crumbsFor', () => {
  it('returns a single home crumb on the home route', () => {
    expect(crumbsFor(parseRoute('#/'))).toEqual([{ key: 'home', label: 'ホーム', hash: '#/' }]);
  });

  it('builds library crumbs from the tab labels', () => {
    expect(crumbsFor(parseRoute('#/library/character/w1'))).toEqual([
      { key: 'home', label: 'ホーム', hash: '#/' },
      { key: 'library', label: '素材', hash: '#/library/world' },
      { key: 'libraryTab', label: 'Character', hash: '#/library/character' },
    ]);
  });

  it('builds browse crumbs from the gallery tab labels', () => {
    expect(crumbsFor(parseRoute('#/browse/worlds/pub_1'))).toEqual([
      { key: 'home', label: 'ホーム', hash: '#/' },
      { key: 'browse', label: 'さがす', hash: '#/browse/starters' },
      { key: 'browseTab', label: '世界観', hash: '#/browse/worlds' },
    ]);
  });

  it('builds records crumbs', () => {
    expect(crumbsFor(parseRoute('#/records/achievements'))).toEqual([
      { key: 'home', label: 'ホーム', hash: '#/' },
      { key: 'records', label: '記録', hash: '#/records/endings' },
      { key: 'recordsTab', label: '実績', hash: '#/records/achievements' },
    ]);
  });

  it('returns only the home crumb for the user route, whose name is supplied dynamically', () => {
    expect(crumbsFor(parseRoute('#/u/usr_1'))).toEqual([{ key: 'home', label: 'ホーム', hash: '#/' }]);
  });
});

describe('wantsDynamicCrumb', () => {
  it('is true exactly where a name must come from the screen', () => {
    expect(wantsDynamicCrumb(parseRoute('#/library/character/w1'))).toBe(true);
    expect(wantsDynamicCrumb(parseRoute('#/browse/worlds/pub_1'))).toBe(true);
    expect(wantsDynamicCrumb(parseRoute('#/u/usr_1'))).toBe(true);
  });

  it('is false where the URL already names the location', () => {
    expect(wantsDynamicCrumb(parseRoute('#/library/character'))).toBe(false);
    expect(wantsDynamicCrumb(parseRoute('#/browse/worlds'))).toBe(false);
    expect(wantsDynamicCrumb(parseRoute('#/records/endings'))).toBe(false);
    expect(wantsDynamicCrumb(null)).toBe(false);
  });
});
