import { slugify } from './slugify.js';
import { worldMetaKey, characterMetaKey, scenarioMetaKey } from './paths.js';
import { saveWorld, getWorld, listWorlds } from './worldLibrary.js';
import { saveRegion, saveCategory } from './worldContentLibrary.js';
import { saveCharacter, getCharacter, listCharacters } from './characterLibrary.js';
import { saveScenario, getScenario, listScenarios } from './scenarioLibrary.js';
import { getPublicWorld, getPublicItem } from './shareLibrary.js';

async function findAvailable(base, exists) {
  if (!(await exists(base))) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
}

// 同じ公開素材から取り込んだ既存の複製を探す。取り込み時に控えた sourcePublicId が
// 第一の手掛かり。それを持たない旧データのために、この取り込みが使うはずだった base の
// id を同じ表示名で占めているものも同一視する(その2つが揃うのは前回の取り込み跡だけ)。
//
// 複数見つかったら id の昇順で最初の1つ。既に -2 / -3 が生えている環境でも、
// 毎回いちばん最初に取り込んだものへ戻り、選び先が呼び出しごとに揺れないようにする。
function findReusable(metas, publicId, base, label, labelOf) {
  return (
    metas
      .filter((m) => (m.sourcePublicId ? m.sourcePublicId === publicId : m.id === base && labelOf(m) === label))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] ?? null
  );
}

// preferredId: 呼び出し側が id を指定できる。slugify は非ASCIIを全除去するため、
// 日本語タイトルのWorldは何を入れても 'untitled' に潰れてしまう。スターターパックの
// ように id が意味を持つ経路のための逃げ道であり、未指定なら従来どおり title から作る。
//
// reuseExisting: 同じ公開素材を既に取り込んでいたらそれを返し、新しい複製を作らない。
// スターターパックのように「同じ一式を何度でも始められる」入口のための指定で、
// 既存の中身には触れない(取り込み後にユーザーが書き換えた内容を上書きしないため)。
export async function importWorld(dataStore, textStore, userId, publicId, { preferredId, reuseExisting = false } = {}) {
  const pub = await getPublicWorld(dataStore, textStore, publicId);
  if (!pub) return { ok: false, reason: 'not_found' };
  const base = typeof preferredId === 'string' && preferredId.length > 0 ? preferredId : slugify(pub.title);
  if (reuseExisting) {
    const found = findReusable(await listWorlds(dataStore, userId), publicId, base, pub.title, (m) => m.title);
    if (found) return { ok: true, reused: true, meta: await getWorld(dataStore, textStore, userId, found.id) };
  }
  const id = await findAvailable(base, async (c) => (await dataStore.get(worldMetaKey(userId, c))) !== null);
  const world = await saveWorld(dataStore, textStore, userId, {
    id,
    title: pub.title,
    raw: pub.raw,
    moods: pub.moods ?? [],
    sourcePublicId: publicId,
  });
  for (const region of pub.regions) await saveRegion(textStore, userId, id, region.name, region.raw);
  for (const category of pub.categories) await saveCategory(textStore, userId, id, category.name, category.raw);
  return { ok: true, reused: false, meta: world };
}

export async function importCharacter(dataStore, textStore, userId, publicId, targetWorldId, { reuseExisting = false } = {}) {
  const pub = await getPublicItem(dataStore, textStore, 'characters', publicId);
  if (!pub) return { ok: false, reason: 'not_found' };
  if ((await dataStore.get(worldMetaKey(userId, targetWorldId))) === null) return { ok: false, reason: 'target_not_found' };
  if (reuseExisting) {
    const metas = await listCharacters(dataStore, userId, targetWorldId, pub.kind);
    const found = findReusable(metas, publicId, pub.name, pub.name, (m) => m.name);
    if (found) {
      return { ok: true, reused: true, meta: await getCharacter(dataStore, textStore, userId, targetWorldId, pub.kind, found.name) };
    }
  }
  const name = await findAvailable(pub.name, async (c) => (await dataStore.get(characterMetaKey(userId, targetWorldId, pub.kind, c))) !== null);
  const character = await saveCharacter(dataStore, textStore, userId, {
    worldId: targetWorldId,
    kind: pub.kind,
    name,
    raw: pub.raw,
    revealed: false, // インポート先ではNPC秘匿情報を未開示に戻す
    sourcePublicId: publicId,
  });
  return { ok: true, reused: false, meta: character };
}

// preferredId / reuseExisting は importWorld と同じ逃げ道。スターターパックのシナリオは
// pack.json で意味のあるidを宣言しているが、指定が無ければ従来どおりslugify(title)に潰れる。
export async function importScenario(dataStore, textStore, userId, publicId, targetWorldId, { preferredId, reuseExisting = false } = {}) {
  const pub = await getPublicItem(dataStore, textStore, 'scenarios', publicId);
  if (!pub) return { ok: false, reason: 'not_found' };
  if ((await dataStore.get(worldMetaKey(userId, targetWorldId))) === null) return { ok: false, reason: 'target_not_found' };
  const base = typeof preferredId === 'string' && preferredId.length > 0 ? preferredId : slugify(pub.title);
  if (reuseExisting) {
    const metas = await listScenarios(dataStore, userId, targetWorldId);
    const found = findReusable(metas, publicId, base, pub.title, (m) => m.title);
    if (found) {
      return { ok: true, reused: true, meta: await getScenario(dataStore, textStore, userId, targetWorldId, found.id) };
    }
  }
  const id = await findAvailable(base, async (c) => (await dataStore.get(scenarioMetaKey(userId, targetWorldId, c))) !== null);
  const scenario = await saveScenario(dataStore, textStore, userId, {
    worldId: targetWorldId,
    id,
    title: pub.title,
    raw: pub.raw,
    recommendedRuleset: pub.recommendedRuleset ?? null,
    moods: pub.moods ?? [],
    sourcePublicId: publicId,
  });
  return { ok: true, reused: false, meta: scenario };
}
