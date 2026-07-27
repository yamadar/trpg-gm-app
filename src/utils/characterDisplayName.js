export function unnamedCharacterLabel(kind) {
  return kind === 'npc' ? '名前未設定のNPC' : '名前未設定のPC';
}

export function characterDisplayName(character, kind = character?.kind) {
  const explicitName = String(character?.characterName ?? '').trim();
  if (explicitName) return explicitName;

  const parsedName = String(character?.parsed?.name ?? '').trim();
  if (parsedName) return parsedName;

  const extractedName = String(character?.displayName ?? '').trim();
  if (extractedName) return extractedName;

  return unnamedCharacterLabel(kind);
}
