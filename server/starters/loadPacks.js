import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOODS } from '../storage/moods.js';
import { isValidId } from '../routes/validateId.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const STARTERS_DIR = path.join(__dirname, '..', '..', 'content', 'starters');

const RULESET_IDS = new Set(['simple', 'coc7e', 'dnd5e', 'gurps']);
// 独自の正規表現を再実装すると本物のバリデータと食い違う恐れがあるため、
// 実際にルーティングで使われる isValidId をそのまま再利用する。ここで弾いておかないと、
// 保存は通るのに GET /worlds/:id/characters/:kind/:name が400になる状態で出荷される。

function fail(packId, message) {
  throw new Error(`starter pack "${packId}": ${message}`);
}

async function readDoc(packId, file) {
  const raw = await fs.readFile(file, 'utf-8').catch(() => null);
  if (raw === null || raw.trim().length === 0) fail(packId, `missing or empty document: ${file}`);
  return raw;
}

function requireNonEmptyString(packId, value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) fail(packId, `${field} must be a non-empty string`);
  return value;
}

async function loadCharacters(packId, dir, kind, names) {
  if (!Array.isArray(names) || names.length !== 2) fail(packId, `${kind} must list exactly 2 characters`);
  const seen = new Set();
  const out = [];
  for (const name of names) {
    if (!isValidId(name)) fail(packId, `${kind} name "${name}" is not a valid id`);
    // 同名を二重に指定すると同じファイルを読み込んで「2件」チェックを通り抜け、
    // 中身の同じPC/NPCスロットが2つできてしまうため、種別ごとに一意性を確認する。
    if (seen.has(name)) fail(packId, `${kind} has a duplicate name "${name}"`);
    seen.add(name);
    const raw = await readDoc(packId, path.join(dir, kind, `${name}.md`));
    if (kind === 'pc' && (!raw.includes('goal:') || !raw.includes('bonds:'))) {
      fail(packId, `pc/${name}.md must declare goal: and bonds:`);
    }
    out.push({ name, raw });
  }
  return out;
}

function validateScenarioMeta(packId, scenario, field) {
  if (!scenario || !isValidId(scenario.id)) fail(packId, `${field}.id is not a valid id`);
  requireNonEmptyString(packId, scenario.title, `${field}.title`);
}

async function loadScenarios(packId, dir, meta) {
  // 既存パックの singular `scenario` はそのまま受け付ける。キャンペーンパックだけ
  // `scenarios` を使い、各本文を scenarios/{id}.md に分ける。
  // `scenarios: null` を「未指定」と同じ旧形式として扱う。=== undefined だと null が
  // キャンペーン分岐へ落ち、単一シナリオしか宣言していないパックに対して
  // 「両方を宣言するな」という逆の内容のエラーが出てしまう。
  if (meta.scenarios == null) {
    validateScenarioMeta(packId, meta.scenario, 'scenario');
    const raw = await readDoc(packId, path.join(dir, 'scenario.md'));
    if (!raw.includes('## シナリオ概要') || !raw.includes('## GM専用情報')) {
      fail(packId, 'scenario.md must contain both "## シナリオ概要" and "## GM専用情報"');
    }
    return [{ id: meta.scenario.id, title: meta.scenario.title, raw }];
  }

  if (meta.scenario !== undefined) fail(packId, 'declare either scenario or scenarios, not both');
  if (!Array.isArray(meta.scenarios)) fail(packId, 'scenarios must be an array');
  if (meta.scenarios.length < 2) fail(packId, 'scenarios must list at least 2 scenarios');

  const seen = new Set();
  const scenarios = [];
  for (let i = 0; i < meta.scenarios.length; i += 1) {
    const scenario = meta.scenarios[i];
    const field = `scenarios[${i}]`;
    validateScenarioMeta(packId, scenario, field);
    if (seen.has(scenario.id)) fail(packId, `scenarios has a duplicate id "${scenario.id}"`);
    seen.add(scenario.id);

    const file = path.join(dir, 'scenarios', `${scenario.id}.md`);
    const raw = await readDoc(packId, file);
    if (!raw.includes('## シナリオ概要') || !raw.includes('## GM専用情報')) {
      fail(packId, `scenarios/${scenario.id}.md must contain both "## シナリオ概要" and "## GM専用情報"`);
    }
    scenarios.push({ id: scenario.id, title: scenario.title, raw });
  }
  return scenarios;
}

async function loadPack(rootDir, packId) {
  const dir = path.join(rootDir, packId);
  const metaRaw = await fs.readFile(path.join(dir, 'pack.json'), 'utf-8').catch(() => null);
  if (metaRaw === null) fail(packId, 'pack.json not found');

  let meta;
  try {
    meta = JSON.parse(metaRaw);
  } catch (e) {
    fail(packId, `pack.json is not valid JSON: ${e.message}`);
  }

  // JSON.parseはnull/数値/配列も通してしまう。オブジェクトでない場合に後続の
  // meta.idアクセス等で素のTypeErrorになるのを防ぎ、fail()経由の一貫したエラーにする。
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    fail(packId, 'pack.json must be a JSON object');
  }

  if (meta.id !== packId) fail(packId, `pack.json id "${meta.id}" does not match its directory name`);
  requireNonEmptyString(packId, meta.title, 'title');
  requireNonEmptyString(packId, meta.tagline, 'tagline');
  if (meta.source !== null && typeof meta.source !== 'string') fail(packId, 'source must be a string or null');
  if (!Array.isArray(meta.moods) || meta.moods.length === 0) fail(packId, 'moods must be a non-empty array');
  for (const m of meta.moods) if (!MOODS.includes(m)) fail(packId, `unknown mood "${m}"`);
  if (!RULESET_IDS.has(meta.recommendedRuleset)) fail(packId, `unknown recommendedRuleset "${meta.recommendedRuleset}"`);
  const worldRaw = await readDoc(packId, path.join(dir, 'world.md'));
  const scenarios = await loadScenarios(packId, dir, meta);

  return {
    id: packId,
    title: meta.title,
    tagline: meta.tagline,
    source: meta.source ?? null,
    moods: meta.moods,
    recommendedRuleset: meta.recommendedRuleset,
    worldRaw,
    // `scenario` は開始シナリオを指す互換エイリアス。既存シード処理や呼び出し元を
    // 壊さず、複数話対応側は `scenarios` を使える。
    scenario: scenarios[0],
    scenarios,
    pc: await loadCharacters(packId, dir, 'pc', meta.pc),
    npc: await loadCharacters(packId, dir, 'npc', meta.npc),
  };
}

export async function loadStarterPacks(rootDir = STARTERS_DIR) {
  const indexRaw = await fs.readFile(path.join(rootDir, 'index.json'), 'utf-8').catch(() => null);
  if (indexRaw === null) throw new Error(`starter index not found: ${path.join(rootDir, 'index.json')}`);
  const ids = JSON.parse(indexRaw);
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('starter index.json must be a non-empty array of pack ids');
  const packs = [];
  for (const id of ids) packs.push(await loadPack(rootDir, id));
  return packs;
}
