import { characterMetaKey, characterDocPath } from './paths.js';
import { summarizeSheet } from './characterSummary.js';

// sourcePublicId の扱いは saveWorld と同じ(取り込み元の印を編集保存で失わせない)。
export async function saveCharacter(
  dataStore,
  textStore,
  userId,
  { worldId, kind, name, characterName, raw, revealed, sourcePublicId }
) {
  await textStore.write(characterDocPath(userId, worldId, kind, name), raw);
  const prev = await dataStore.get(characterMetaKey(userId, worldId, kind, name));
  // characterName未送信の旧クライアント・内部処理は既存値を維持する。
  // 空文字はユーザーによる明示解除としてnullへ正規化する。
  const resolvedCharacterName =
    characterName === undefined
      ? prev?.characterName ?? null
      : String(characterName).trim() || null;
  const meta = {
    id: name,
    worldId,
    kind,
    name,
    characterName: resolvedCharacterName,
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
// 手入力名を最優先し、無ければAI解析(parsed.name)、本文の明示名を使う。
// 内部id/nameは表示名へ使わない。
export async function listCharacterSummaries(dataStore, textStore, userId, worldId, kind) {
  const metas = await listCharacters(dataStore, userId, worldId, kind);
  return Promise.all(
    metas.map(async (meta) => {
      const raw = (await textStore.read(characterDocPath(userId, worldId, kind, meta.name))) ?? '';
      const { displayName, excerpt } = summarizeSheet(raw);
      return {
        ...meta,
        displayName: meta.characterName || meta.parsed?.name || displayName || '',
        excerpt,
      };
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
