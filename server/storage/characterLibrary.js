import { characterMetaKey, characterDocPath } from './paths.js';
import { summarizeSheet } from './characterSummary.js';

// sourcePublicId の扱いは saveWorld と同じ(取り込み元の印を編集保存で失わせない)。
export async function saveCharacter(dataStore, textStore, userId, { worldId, kind, name, raw, revealed, sourcePublicId }) {
  await textStore.write(characterDocPath(userId, worldId, kind, name), raw);
  const prev = await dataStore.get(characterMetaKey(userId, worldId, kind, name));
  const meta = {
    id: name,
    worldId,
    kind,
    name,
    revealed: kind === 'npc' ? !!revealed : null,
    sourcePublicId: sourcePublicId ?? prev?.sourcePublicId ?? null,
    parsed: null,
    parsedHash: null,
    updatedAt: Date.now(),
  };
  await dataStore.set(characterMetaKey(userId, worldId, kind, name), meta);
  return { ...meta, raw };
}

export async function getCharacter(dataStore, textStore, userId, worldId, kind, name) {
  const meta = await dataStore.get(characterMetaKey(userId, worldId, kind, name));
  if (!meta) return null;
  const raw = (await textStore.read(characterDocPath(userId, worldId, kind, name))) ?? '';
  return { ...meta, raw };
}

export async function listCharacters(dataStore, userId, worldId, kind) {
  const keys = await dataStore.list(`users/${userId}/worlds/${worldId}/${kind}`);
  const characters = await Promise.all(keys.map((k) => dataStore.get(k)));
  return characters.filter(Boolean);
}

// 一覧 + 本文からの見出し・抜粋。名前(=ストレージ上のid)しか見えないと、選ぶ側は
// どんなキャラクターなのか判断できない。表示名はシート本文の「PC名:」行を第一の根拠にし、
// 無ければAI解析(parsed.name)の結果、それも無ければidをそのまま使う。
export async function listCharacterSummaries(dataStore, textStore, userId, worldId, kind) {
  const metas = await listCharacters(dataStore, userId, worldId, kind);
  return Promise.all(
    metas.map(async (meta) => {
      const raw = (await textStore.read(characterDocPath(userId, worldId, kind, meta.name))) ?? '';
      const { displayName, excerpt } = summarizeSheet(raw);
      return { ...meta, displayName: displayName || meta.parsed?.name || '', excerpt };
    })
  );
}

export async function deleteCharacter(dataStore, textStore, userId, worldId, kind, name) {
  await dataStore.delete(characterMetaKey(userId, worldId, kind, name));
  await textStore.delete(characterDocPath(userId, worldId, kind, name));
}

export async function saveCharacterParsed(dataStore, userId, worldId, kind, name, { parsed, parsedHash }) {
  const meta = await dataStore.get(characterMetaKey(userId, worldId, kind, name));
  if (!meta) return null;
  const updated = { ...meta, parsed, parsedHash, updatedAt: Date.now() };
  await dataStore.set(characterMetaKey(userId, worldId, kind, name), updated);
  return updated;
}
