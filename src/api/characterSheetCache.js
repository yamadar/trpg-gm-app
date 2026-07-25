import { parseCharacterSheet, SHEET_PARSE_VERSION } from './characterSheetParse.js';
import { getCharacter, putCharacterParsed } from './characterLibraryClient.js';
import { hashText } from '../utils/hashText.js';

export async function getOrParseCharacter(worldId, kind, name) {
  const character = await getCharacter(worldId, kind, name);
  // 原文だけでなくパーサのバージョンも鍵に含める。抽出項目を増やしたとき、
  // 原文が変わっていない既存キャッシュが古い形のまま使われ続けるのを防ぐ。
  const currentHash = hashText(`v${SHEET_PARSE_VERSION}\n${character.raw}`);
  if (character.parsed && character.parsedHash === currentHash) {
    return character.parsed;
  }
  const parsed = await parseCharacterSheet(character.raw);
  await putCharacterParsed(worldId, kind, name, { parsed, parsedHash: currentHash });
  return parsed;
}
