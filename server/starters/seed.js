import { createHash } from 'node:crypto';
import { loadStarterPacks } from './loadPacks.js';
import { saveWorld } from '../storage/worldLibrary.js';
import { saveScenario } from '../storage/scenarioLibrary.js';
import { saveCharacter } from '../storage/characterLibrary.js';
import { publishWorld, publishScenario, publishCharacter } from '../storage/shareLibrary.js';
import { starterManifestKey, worldMetaKey } from '../storage/paths.js';
import { userProfileKey } from '../auth/users.js';

export const OFFICIAL_USER_ID = 'usr_official';
export const OFFICIAL_DISPLAY_NAME = '公式サンプル';

// シード処理が書き出す内容の形が変わったら上げる。内容ハッシュはコンテンツしか見ないため、
// コード側の出力形式を変えた場合(例: マニフェストへ新しいフィールドを足した場合)は
// これを上げないと既存デプロイが古い形のまま再シードを飛ばしてしまう。
export const SEED_VERSION = 1;

// 書き込みを飛ばしてよいかの判定材料。ロード済みパック(=シードの入力そのもの)から
// 作るので、content/starters 配下のどのファイルが変わっても必ず変化する。
function fingerprintOf(packs) {
  const hash = createHash('sha256');
  hash.update(`v${SEED_VERSION}\n`);
  for (const pack of packs) {
    hash.update(
      JSON.stringify([
        pack.id, pack.title, pack.tagline, pack.source, pack.moods, pack.recommendedRuleset,
        pack.worldRaw,
        // 単数 `scenario` だけのパックも同じ形へ寄せてから混ぜる。ここで直接
        // pack.scenarios を触ると旧形式のパックで落ちる。
        scenariosOf(pack).map((s) => [s.id, s.title, s.raw]),
        pack.pc.map((c) => [c.name, c.raw]),
        pack.npc.map((c) => [c.name, c.raw]),
      ]),
    );
  }
  return hash.digest('hex');
}

// auth/identities/* を作らないので、このアカウントには誰もログインできない。
// 公開ギャラリーの作者リンク(GET /api/users/:userId)からは通常どおり参照できる。
async function ensureOfficialUser(dataStore) {
  const existing = await dataStore.get(userProfileKey(OFFICIAL_USER_ID));
  if (existing) return existing;
  const now = Date.now();
  const user = {
    id: OFFICIAL_USER_ID,
    displayName: OFFICIAL_DISPLAY_NAME,
    avatarUrl: null,
    bio: 'はじめて遊ぶ人向けの世界観・シナリオ・キャラクターを配布しているアカウント。',
    createdAt: now,
    updatedAt: now,
  };
  await dataStore.set(userProfileKey(OFFICIAL_USER_ID), user);
  return user;
}

function publicIdOf(result, what) {
  if (!result.ok) throw new Error(`starter seed failed to publish ${what}: ${result.reason}`);
  return result.meta.publicId;
}

// loadStarterPacks は常に非空の `scenarios` を返すが、seedStarters は呼び出し側から
// packs を直接受け取れる(テスト・スクリプト経路)。どちらの形も持たないパックを
// [undefined] として通すと saveWorld の後に scenario.id で TypeError になり、
// パックidを含まないエラーで全パックのシードが巻き添えになるため、ここで弾く。
function scenariosOf(pack) {
  if (Array.isArray(pack.scenarios) && pack.scenarios.length > 0) return pack.scenarios;
  if (!pack.scenario) {
    throw new Error(`starter pack "${pack.id}": neither scenario nor a non-empty scenarios was provided`);
  }
  return [pack.scenario];
}

async function seedPack(dataStore, textStore, owner, pack, imageStore) {
  const scenarios = scenariosOf(pack);
  await saveWorld(dataStore, textStore, OFFICIAL_USER_ID, {
    id: pack.id,
    title: pack.title,
    raw: pack.worldRaw,
    moods: pack.moods,
  });
  for (const scenario of scenarios) {
    await saveScenario(dataStore, textStore, OFFICIAL_USER_ID, {
      worldId: pack.id,
      id: scenario.id,
      title: scenario.title,
      raw: scenario.raw,
      recommendedRuleset: pack.recommendedRuleset,
      moods: pack.moods,
    });
  }
  for (const kind of ['pc', 'npc']) {
    for (const c of pack[kind]) {
      await saveCharacter(dataStore, textStore, OFFICIAL_USER_ID, {
        worldId: pack.id,
        kind,
        name: c.name,
        raw: c.raw,
        revealed: false,
      });
    }
  }

  const worldPublicId = publicIdOf(
    await publishWorld(dataStore, textStore, OFFICIAL_USER_ID, pack.id, owner, imageStore),
    `world ${pack.id}`,
  );
  const publishedScenarios = [];
  for (const scenario of scenarios) {
    publishedScenarios.push({
      id: scenario.id,
      title: scenario.title,
      publicId: publicIdOf(
        await publishScenario(dataStore, textStore, OFFICIAL_USER_ID, pack.id, scenario.id, owner, imageStore),
        `scenario ${scenario.id}`
      ),
    });
  }
  const characterIds = {};
  for (const kind of ['pc', 'npc']) {
    characterIds[kind] = [];
    for (const c of pack[kind]) {
      characterIds[kind].push(
        publicIdOf(
          await publishCharacter(dataStore, textStore, OFFICIAL_USER_ID, pack.id, kind, c.name, owner, imageStore),
          `${kind} ${c.name}`,
        )
      );
    }
  }

  return {
    packId: pack.id,
    title: pack.title,
    tagline: pack.tagline,
    source: pack.source,
    moods: pack.moods,
    recommendedRuleset: pack.recommendedRuleset,
    scenarioTitle: scenarios[0].title,
    scenarioCount: publishedScenarios.length,
    // インポート時にimportScenarioへpreferredIdとして渡す。無いとslugify(title)頼りになり
    // 日本語タイトルは'untitled'に潰れる(importWorldがpack.idを使うのと同じ理由)
    scenarioId: scenarios[0].id,
    worldPublicId,
    scenarioPublicId: publishedScenarios[0].publicId,
    scenarios: publishedScenarios,
    pcPublicIds: characterIds.pc,
    npcPublicIds: characterIds.npc,
  };
}

// 保存済みマニフェストをそのまま使ってよいか。内容ハッシュが一致していても、
// ディスクを作り直した直後などデータ本体だけ消えている場合があるため、実体の存在を
// 1件だけ確かめる。全パック確認しても正しいが、現実に起きるのはボリュームごと空になる
// ケースなので、176回の書き込みを省くために1回の読み取りを払う形で足りる。
async function reusableManifest(dataStore, storedManifest, fingerprint) {
  if (!storedManifest || storedManifest.contentHash !== fingerprint) return null;
  const first = storedManifest.packs?.[0];
  if (!first) return null;
  const world = await dataStore.get(worldMetaKey(OFFICIAL_USER_ID, first.packId));
  return world ? storedManifest : null;
}

export async function seedStarters(dataStore, textStore, { packs, imageStore, force = false } = {}) {
  const loaded = packs ?? (await loadStarterPacks());
  const fingerprint = fingerprintOf(loaded);

  // 内容が前回と同じなら書き込みを一切行わない。publishScenario等はpublicIdを再利用して
  // 同一バイト列を書き直すだけなので、再起動のたびに約176回のset(mkdir+write+rename)を
  // ネットワークディスクへ投げていた。起動はlisten()前にこれを待つため、そのまま起動時間になる。
  if (!force) {
    const reusable = await reusableManifest(
      dataStore,
      await dataStore.get(starterManifestKey()),
      fingerprint,
    );
    if (reusable) return reusable;
  }

  const owner = await ensureOfficialUser(dataStore);
  const entries = [];
  for (const pack of loaded) entries.push(await seedPack(dataStore, textStore, owner, pack, imageStore));
  const manifest = { packs: entries, seededAt: Date.now(), contentHash: fingerprint };
  await dataStore.set(starterManifestKey(), manifest);
  return manifest;
}
