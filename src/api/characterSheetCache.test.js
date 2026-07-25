import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrParseCharacter } from './characterSheetCache.js';
import * as characterSheetParse from './characterSheetParse.js';
import { SHEET_PARSE_VERSION } from './characterSheetParse.js';
import * as characterLibraryClient from './characterLibraryClient.js';
import { hashText } from '../utils/hashText.js';

// キャッシュの鍵は「パーサのバージョン + 原文」。抽出項目を増やしたときに
// 古い parsed が使われ続けないようにするための取り決め。
const versionedHash = (raw) => hashText(`v${SHEET_PARSE_VERSION}\n${raw}`);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getOrParseCharacter', () => {
  it('returns the cached parsed result when the hash matches', async () => {
    const raw = 'PC名: アリス\ngoal: 妹を救い出す';
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw,
      parsed: { name: 'アリス', goal: '妹を救い出す', bonds: '' },
      parsedHash: versionedHash(raw),
    });
    const parseSpy = vi.spyOn(characterSheetParse, 'parseCharacterSheet');
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed');

    const result = await getOrParseCharacter('w1', 'pc', 'alice');

    expect(result).toEqual({ name: 'アリス', goal: '妹を救い出す', bonds: '' });
    expect(parseSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('re-parses and saves when there is no cached parsed result', async () => {
    const raw = 'PC名: ボブ';
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({ raw, parsed: null, parsedHash: null });
    vi.spyOn(characterSheetParse, 'parseCharacterSheet').mockResolvedValue({ name: 'ボブ', goal: 'x', bonds: 'y' });
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed').mockResolvedValue({});

    const result = await getOrParseCharacter('w1', 'pc', 'bob');

    expect(result).toEqual({ name: 'ボブ', goal: 'x', bonds: 'y' });
    expect(putSpy).toHaveBeenCalledWith('w1', 'pc', 'bob', {
      parsed: { name: 'ボブ', goal: 'x', bonds: 'y' },
      parsedHash: versionedHash(raw),
    });
  });

  it('re-parses when the stored hash does not match the current raw text', async () => {
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw: '新しい原文',
      parsed: { name: '', goal: '古い目標', bonds: '' },
      parsedHash: 'stale-hash',
    });
    vi.spyOn(characterSheetParse, 'parseCharacterSheet').mockResolvedValue({
      name: '',
      goal: '新しい目標',
      bonds: '',
    });
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed').mockResolvedValue({});

    const result = await getOrParseCharacter('w1', 'pc', 'alice');

    expect(result).toEqual({ name: '', goal: '新しい目標', bonds: '' });
    expect(putSpy).toHaveBeenCalled();
  });

  // name抽出を足す前に保存されたキャッシュは、原文が同じでも作り直す必要がある。
  it('re-parses a cache written by the previous parser version', async () => {
    const raw = 'PC名: アリス';
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw,
      parsed: { goal: '妹を救い出す', bonds: '' },
      parsedHash: hashText(raw), // バージョンを含まない旧世代のハッシュ
    });
    const parseSpy = vi
      .spyOn(characterSheetParse, 'parseCharacterSheet')
      .mockResolvedValue({ name: 'アリス', goal: '妹を救い出す', bonds: '' });
    vi.spyOn(characterLibraryClient, 'putCharacterParsed').mockResolvedValue({});

    const result = await getOrParseCharacter('w1', 'pc', 'alice');

    expect(parseSpy).toHaveBeenCalled();
    expect(result.name).toBe('アリス');
  });
});
