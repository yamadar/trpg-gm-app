import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOODS } from '../storage/moods.js';
import { isValidId } from '../routes/validateId.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const STARTERS_DIR = path.join(__dirname, '..', '..', 'content', 'starters');

const RULESET_IDS = new Set(['simple', 'coc7e', 'dnd5e', 'gurps']);

// シナリオ本文は session.scenario.raw として毎ターンのsystemプロンプトへ丸ごと入る
// (src/api/prompts.js)。切り詰めも要約もしないため、本文の長さがそのまま毎ターンの
// 入力トークンになる。日本語はおおよそ1文字≒1トークン。
// 既存パックは1,168〜1,922字、キャンペーン最長話が6,162字。8,000字はその上に取った
// 警告線で、失敗にはしない(1パックの超過で全パックのシードを止める方が害が大きい)。
// 実コンテンツが線を越えていないことは loadPacks.test.js で検査する。
export const SCENARIO_CHAR_BUDGET = 8000;
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

// 並列に待ちつつ、失敗時は「配列順で最初」の理由を投げる。Promise.allをそのまま使うと
// 時間的に最初に落ちた方が出るため、同じ壊れ方をしていても起動ごとにエラーメッセージが
// 変わりうる。診断を安定させるため順序を固定する。
async function allOrderedReject(promises) {
  const settled = await Promise.allSettled(promises);
  const failed = settled.find((s) => s.status === 'rejected');
  if (failed) throw failed.reason;
  return settled.map((s) => s.value);
}

// I/Oを一切伴わない検証。読み込みを投げる前にここを通すことで、idの打ち間違いのような
// 安価に分かる誤りが、存在しないファイルのI/Oエラーより先に報告される。
function validateCharacterNames(packId, kind, names) {
  if (!Array.isArray(names) || names.length !== 2) fail(packId, `${kind} must list exactly 2 characters`);
  const seen = new Set();
  for (const name of names) {
    if (!isValidId(name)) fail(packId, `${kind} name "${name}" is not a valid id`);
    // 同名を二重に指定すると同じファイルを読み込んで「2件」チェックを通り抜け、
    // 中身の同じPC/NPCスロットが2つできてしまうため、種別ごとに一意性を確認する。
    if (seen.has(name)) fail(packId, `${kind} has a duplicate name "${name}"`);
    seen.add(name);
  }
  return names;
}

async function loadCharacters(packId, dir, kind, names) {
  const raws = await allOrderedReject(
    names.map((name) => readDoc(packId, path.join(dir, kind, `${name}.md`))),
  );
  return names.map((name, i) => {
    const raw = raws[i];
    if (kind === 'pc' && (!raw.includes('goal:') || !raw.includes('bonds:'))) {
      fail(packId, `pc/${name}.md must declare goal: and bonds:`);
    }
    return { name, raw };
  });
}

function validateScenarioMeta(packId, scenario, field) {
  if (!scenario || !isValidId(scenario.id)) fail(packId, `${field}.id is not a valid id`);
  requireNonEmptyString(packId, scenario.title, `${field}.title`);
}

// I/Oを伴わない検証だけを行い、読むべき本文の一覧を返す。ファイルを開く前に
// id/title の妥当性を確定させることで、パス組み立て(scenarios/{id}.md)へ
// 不正なidが渡らないことも保証する。
function scenarioEntriesOf(packId, meta) {
  // 既存パックの singular `scenario` はそのまま受け付ける。キャンペーンパックだけ
  // `scenarios` を使い、各本文を scenarios/{id}.md に分ける。
  // `scenarios: null` を「未指定」と同じ旧形式として扱う。=== undefined だと null が
  // キャンペーン分岐へ落ち、単一シナリオしか宣言していないパックに対して
  // 「両方を宣言するな」という逆の内容のエラーが出てしまう。
  if (meta.scenarios == null) {
    validateScenarioMeta(packId, meta.scenario, 'scenario');
    return [{ id: meta.scenario.id, title: meta.scenario.title, file: 'scenario.md' }];
  }

  if (meta.scenario !== undefined) fail(packId, 'declare either scenario or scenarios, not both');
  if (!Array.isArray(meta.scenarios)) fail(packId, 'scenarios must be an array');
  if (meta.scenarios.length < 2) fail(packId, 'scenarios must list at least 2 scenarios');

  const seen = new Set();
  return meta.scenarios.map((scenario, i) => {
    validateScenarioMeta(packId, scenario, `scenarios[${i}]`);
    if (seen.has(scenario.id)) fail(packId, `scenarios has a duplicate id "${scenario.id}"`);
    seen.add(scenario.id);
    return { id: scenario.id, title: scenario.title, file: path.join('scenarios', `${scenario.id}.md`) };
  });
}

async function loadScenarios(packId, dir, entries) {
  const raws = await allOrderedReject(entries.map((e) => readDoc(packId, path.join(dir, e.file))));
  return entries.map(({ id, title, file }, i) => {
    const raw = raws[i];
    if (!raw.includes('## シナリオ概要') || !raw.includes('## GM専用情報')) {
      // メッセージ内のパスは常に / 区切りにする。path.joinはWindowsで \ になり、
      // エラー文言がプラットフォーム依存になってしまう。
      fail(packId, `${file.replace(/\\/g, '/')} must contain both "## シナリオ概要" and "## GM専用情報"`);
    }
    if (raw.length > SCENARIO_CHAR_BUDGET) {
      console.warn(
        `starter pack "${packId}": ${file.replace(/\\/g, '/')} is ${raw.length} chars ` +
          `(budget ${SCENARIO_CHAR_BUDGET}). This text is sent in the system prompt every turn.`,
      );
    }
    return { id, title, raw };
  });
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

  // I/Oを伴わない検証をすべて先に済ませる。ここを通過してから読み込みを投げることで、
  // ファイルが1つも無いパックでも「idが不正」のような本質的な誤りが先に報告される。
  const scenarioEntries = scenarioEntriesOf(packId, meta);
  const pcNames = validateCharacterNames(packId, 'pc', meta.pc);
  const npcNames = validateCharacterNames(packId, 'npc', meta.npc);

  // 1パック分の本文(world / 全話 / PC2体 / NPC2体)は互いに独立なので同時に読む。
  const [worldRaw, scenarios, pc, npc] = await allOrderedReject([
    readDoc(packId, path.join(dir, 'world.md')),
    loadScenarios(packId, dir, scenarioEntries),
    loadCharacters(packId, dir, 'pc', pcNames),
    loadCharacters(packId, dir, 'npc', npcNames),
  ]);

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
    pc,
    npc,
  };
}

export async function loadStarterPacks(rootDir = STARTERS_DIR) {
  const indexRaw = await fs.readFile(path.join(rootDir, 'index.json'), 'utf-8').catch(() => null);
  if (indexRaw === null) throw new Error(`starter index not found: ${path.join(rootDir, 'index.json')}`);
  const ids = JSON.parse(indexRaw);
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('starter index.json must be a non-empty array of pack ids');
  // パック同士も独立。index.json の順序は戻り値と、失敗時にどのパックのエラーを
  // 報告するかの両方で維持される(allOrderedRejectが順序を固定する)。
  return allOrderedReject(ids.map((id) => loadPack(rootDir, id)));
}
