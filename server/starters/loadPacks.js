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
  if (!meta.scenario || !isValidId(meta.scenario.id)) fail(packId, 'scenario.id is not a valid id');
  requireNonEmptyString(packId, meta.scenario.title, 'scenario.title');

  const worldRaw = await readDoc(packId, path.join(dir, 'world.md'));
  const scenarioRaw = await readDoc(packId, path.join(dir, 'scenario.md'));
  if (!scenarioRaw.includes('## シナリオ概要') || !scenarioRaw.includes('## GM専用情報')) {
    fail(packId, 'scenario.md must contain both "## シナリオ概要" and "## GM専用情報"');
  }

  return {
    id: packId,
    title: meta.title,
    tagline: meta.tagline,
    source: meta.source ?? null,
    moods: meta.moods,
    recommendedRuleset: meta.recommendedRuleset,
    worldRaw,
    scenario: { id: meta.scenario.id, title: meta.scenario.title, raw: scenarioRaw },
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
