import { slugify } from './slugify.js';
import { worldMetaKey, characterMetaKey, scenarioMetaKey } from './paths.js';
import { saveWorld } from './worldLibrary.js';
import { saveRegion, saveCategory } from './worldContentLibrary.js';
import { saveCharacter } from './characterLibrary.js';
import { saveScenario } from './scenarioLibrary.js';
import { getPublicWorld, getPublicItem } from './shareLibrary.js';

async function findAvailable(base, exists) {
  if (!(await exists(base))) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
}

// preferredId: 呼び出し側が id を指定できる。slugify は非ASCIIを全除去するため、
// 日本語タイトルのWorldは何を入れても 'untitled' に潰れてしまう。スターターパックの
// ように id が意味を持つ経路のための逃げ道であり、未指定なら従来どおり title から作る。
export async function importWorld(dataStore, textStore, userId, publicId, { preferredId } = {}) {
  const pub = await getPublicWorld(dataStore, textStore, publicId);
  if (!pub) return { ok: false, reason: 'not_found' };
  const base = typeof preferredId === 'string' && preferredId.length > 0 ? preferredId : slugify(pub.title);
  const id = await findAvailable(base, async (c) => (await dataStore.get(worldMetaKey(userId, c))) !== null);
  const world = await saveWorld(dataStore, textStore, userId, {
    id,
    title: pub.title,
    raw: pub.raw,
    moods: pub.moods ?? [],
  });
  for (const region of pub.regions) await saveRegion(textStore, userId, id, region.name, region.raw);
  for (const category of pub.categories) await saveCategory(textStore, userId, id, category.name, category.raw);
  return { ok: true, meta: world };
}

export async function importCharacter(dataStore, textStore, userId, publicId, targetWorldId) {
  const pub = await getPublicItem(dataStore, textStore, 'characters', publicId);
  if (!pub) return { ok: false, reason: 'not_found' };
  if ((await dataStore.get(worldMetaKey(userId, targetWorldId))) === null) return { ok: false, reason: 'target_not_found' };
  const name = await findAvailable(pub.name, async (c) => (await dataStore.get(characterMetaKey(userId, targetWorldId, pub.kind, c))) !== null);
  const character = await saveCharacter(dataStore, textStore, userId, {
    worldId: targetWorldId,
    kind: pub.kind,
    name,
    raw: pub.raw,
    revealed: false, // インポート先ではNPC秘匿情報を未開示に戻す
  });
  return { ok: true, meta: character };
}

// preferredId: importWorldと同じ逃げ道。スターターパックのシナリオは pack.json で
// 意味のあるidを宣言しているが、指定が無ければ従来どおりslugify(title)に潰れる。
export async function importScenario(dataStore, textStore, userId, publicId, targetWorldId, { preferredId } = {}) {
  const pub = await getPublicItem(dataStore, textStore, 'scenarios', publicId);
  if (!pub) return { ok: false, reason: 'not_found' };
  if ((await dataStore.get(worldMetaKey(userId, targetWorldId))) === null) return { ok: false, reason: 'target_not_found' };
  const base = typeof preferredId === 'string' && preferredId.length > 0 ? preferredId : slugify(pub.title);
  const id = await findAvailable(base, async (c) => (await dataStore.get(scenarioMetaKey(userId, targetWorldId, c))) !== null);
  const scenario = await saveScenario(dataStore, textStore, userId, {
    worldId: targetWorldId,
    id,
    title: pub.title,
    raw: pub.raw,
    recommendedRuleset: pub.recommendedRuleset ?? null,
    moods: pub.moods ?? [],
  });
  return { ok: true, meta: scenario };
}
