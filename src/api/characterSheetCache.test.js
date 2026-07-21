import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrParseCharacter } from './characterSheetCache.js';
import * as characterSheetParse from './characterSheetParse.js';
import * as characterLibraryClient from './characterLibraryClient.js';
import { hashText } from '../utils/hashText.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getOrParseCharacter', () => {
  it('returns the cached parsed result when the hash matches', async () => {
    const raw = 'PC名: アリス\ngoal: 妹を救い出す';
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw,
      parsed: { goal: '妹を救い出す', bonds: '' },
      parsedHash: hashText(raw),
    });
    const parseSpy = vi.spyOn(characterSheetParse, 'parseCharacterSheet');
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed');

    const result = await getOrParseCharacter('w1', 'pc', 'alice');

    expect(result).toEqual({ goal: '妹を救い出す', bonds: '' });
    expect(parseSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('re-parses and saves when there is no cached parsed result', async () => {
    const raw = 'PC名: ボブ';
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({ raw, parsed: null, parsedHash: null });
    vi.spyOn(characterSheetParse, 'parseCharacterSheet').mockResolvedValue({ goal: 'x', bonds: 'y' });
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed').mockResolvedValue({});

    const result = await getOrParseCharacter('w1', 'pc', 'bob');

    expect(result).toEqual({ goal: 'x', bonds: 'y' });
    expect(putSpy).toHaveBeenCalledWith('w1', 'pc', 'bob', {
      parsed: { goal: 'x', bonds: 'y' },
      parsedHash: hashText(raw),
    });
  });

  it('re-parses when the stored hash does not match the current raw text', async () => {
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw: '新しい原文',
      parsed: { goal: '古い目標', bonds: '' },
      parsedHash: 'stale-hash',
    });
    vi.spyOn(characterSheetParse, 'parseCharacterSheet').mockResolvedValue({ goal: '新しい目標', bonds: '' });
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed').mockResolvedValue({});

    const result = await getOrParseCharacter('w1', 'pc', 'alice');

    expect(result).toEqual({ goal: '新しい目標', bonds: '' });
    expect(putSpy).toHaveBeenCalled();
  });
});
