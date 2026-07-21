import { parseCharacterSheet } from './characterSheetParse.js';
import { getCharacter, putCharacterParsed } from './characterLibraryClient.js';
import { hashText } from '../utils/hashText.js';

export async function getOrParseCharacter(worldId, kind, name) {
  const character = await getCharacter(worldId, kind, name);
  const currentHash = hashText(character.raw);
  if (character.parsed && character.parsedHash === currentHash) {
    return character.parsed;
  }
  const parsed = await parseCharacterSheet(character.raw);
  await putCharacterParsed(worldId, kind, name, { parsed, parsedHash: currentHash });
  return parsed;
}
