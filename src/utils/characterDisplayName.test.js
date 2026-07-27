import { describe, expect, it } from 'vitest';
import { characterDisplayName, unnamedCharacterLabel } from './characterDisplayName.js';

describe('characterDisplayName', () => {
  it('prefers the user-entered name over AI and tagged names', () => {
    expect(
      characterDisplayName({
        kind: 'pc',
        characterName: '手入力のアリス',
        parsed: { name: 'AIが拾ったアリス' },
        displayName: 'PC名タグのアリス',
      })
    ).toBe('手入力のアリス');
  });

  it('prefers the AI-parsed name over a tagged-name fallback', () => {
    expect(
      characterDisplayName({
        kind: 'pc',
        parsed: { name: 'AIが拾ったアリス' },
        displayName: 'PC名タグのアリス',
        name: 'alice.md',
      })
    ).toBe('AIが拾ったアリス');
  });

  it('uses the name extracted without AI when parsing is unavailable', () => {
    expect(characterDisplayName({ kind: 'npc', displayName: '名を告げぬ使者', name: 'messenger.md' })).toBe(
      '名を告げぬ使者'
    );
  });

  it('never exposes the storage identifier as fallback', () => {
    expect(characterDisplayName({ kind: 'pc', name: 'alice.md' })).toBe('名前未設定のPC');
    expect(unnamedCharacterLabel('npc')).toBe('名前未設定のNPC');
  });
});
