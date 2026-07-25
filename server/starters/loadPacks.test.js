// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadStarterPacks, STARTERS_DIR } from './loadPacks.js';
import { MOODS } from '../storage/moods.js';

const RULESET_IDS = ['simple', 'coc7e', 'dnd5e', 'gurps'];
const ID_RE = /^[A-Za-z0-9._-]+$/;

describe('loadStarterPacks', () => {
  it('loads every pack listed in index.json', async () => {
    const packs = await loadStarterPacks();
    expect(packs.length).toBeGreaterThan(0);
    expect(packs.map((p) => p.id)).toContain('arkham-1920s');
  });

  it('gives each pack a title, tagline and a nullable source', async () => {
    for (const pack of await loadStarterPacks()) {
      expect(pack.title.length, pack.id).toBeGreaterThan(0);
      expect(pack.tagline.length, pack.id).toBeGreaterThan(0);
      expect(pack.source === null || typeof pack.source === 'string', pack.id).toBe(true);
    }
  });

  it('uses only known moods and rulesets', async () => {
    for (const pack of await loadStarterPacks()) {
      expect(pack.moods.length, pack.id).toBeGreaterThan(0);
      for (const m of pack.moods) expect(MOODS, pack.id).toContain(m);
      expect(RULESET_IDS, pack.id).toContain(pack.recommendedRuleset);
    }
  });

  // キャラクター名はそのままURLパスになり isValidId(^[A-Za-z0-9._-]+$) で弾かれる。
  // 日本語名を入れると保存は通るのに以後のGETが400になるため、ここで止める。
  it('uses ASCII-safe ids for scenario and characters', async () => {
    for (const pack of await loadStarterPacks()) {
      expect(pack.scenario.id, pack.id).toMatch(ID_RE);
      for (const c of [...pack.pc, ...pack.npc]) expect(c.name, pack.id).toMatch(ID_RE);
    }
  });

  it('ships exactly two PCs and two NPCs per pack, all non-empty', async () => {
    for (const pack of await loadStarterPacks()) {
      expect(pack.pc.length, pack.id).toBe(2);
      expect(pack.npc.length, pack.id).toBe(2);
      expect(pack.worldRaw.trim().length, pack.id).toBeGreaterThan(0);
      expect(pack.scenario.raw.trim().length, pack.id).toBeGreaterThan(0);
      for (const c of [...pack.pc, ...pack.npc]) expect(c.raw.trim().length, `${pack.id}/${c.name}`).toBeGreaterThan(0);
    }
  });

  // サンプルは初回ユーザーが読む「お手本」でもあるので、プレイヤー可視/GM専用の分割を必須にする
  it('splits every scenario into player-visible and GM-only sections', async () => {
    for (const pack of await loadStarterPacks()) {
      expect(pack.scenario.raw, pack.id).toContain('## シナリオ概要');
      expect(pack.scenario.raw, pack.id).toContain('## GM専用情報');
    }
  });

  it('gives every PC a goal and bonds (they feed the parse pipeline)', async () => {
    for (const pack of await loadStarterPacks()) {
      for (const c of pack.pc) {
        expect(c.raw, `${pack.id}/${c.name}`).toContain('goal:');
        expect(c.raw, `${pack.id}/${c.name}`).toContain('bonds:');
      }
    }
  });

  it('throws naming the pack when pack.json is invalid', async () => {
    await expect(loadStarterPacks('/nonexistent/starters')).rejects.toThrow();
  });

  it('exports the content directory path', () => {
    expect(STARTERS_DIR).toMatch(/content[/\\]starters$/);
  });
});

// 上のテストは実在する arkham-1920s 一式に対する正常系だけを見ており、
// fail(...) の分岐を丸ごと消しても実コンテンツが全制約を満たすため通ってしまう。
// ここでは意図的に壊した最小パックを一時ディレクトリに作り、各分岐が本当に効いているか検証する。
describe('loadStarterPacks validation (malformed fixtures)', () => {
  const VALID_META = {
    id: 'sample',
    title: 'サンプル',
    tagline: 'サンプルのタグライン',
    source: null,
    moods: ['ホラー'],
    recommendedRuleset: 'coc7e',
    scenario: { id: 'sample-scenario', title: 'サンプルシナリオ' },
    pc: ['alice', 'bob'],
    npc: ['carol', 'dave'],
  };
  const VALID_PC = 'PC名: テスト\n\ngoal: 目標を書く\nbonds: 絆を書く\n';
  const VALID_NPC = 'NPC名: テスト\n\n本文\n';
  const VALID_WORLD = '# 世界\n\n本文。\n';
  const VALID_SCENARIO = '# シナリオ\n\n## シナリオ概要\n\n本文\n\n## GM専用情報\n\n秘密\n';

  let createdDirs = [];

  afterEach(async () => {
    await Promise.all(createdDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
    createdDirs = [];
  });

  // 妥当なパック一式を書き出し、overridesで狙った箇所だけを壊す。
  // world/scenarioDoc を null にすると「ファイルを置かない(missing)」、
  // '' にすると「空ファイル(empty)」を再現できる。
  async function writePack(rootDir, packId, overrides = {}) {
    const dir = path.join(rootDir, packId);
    await fs.mkdir(path.join(dir, 'pc'), { recursive: true });
    await fs.mkdir(path.join(dir, 'npc'), { recursive: true });

    const meta = { ...VALID_META, id: packId, ...overrides.meta };
    const metaRaw = 'metaRaw' in overrides ? overrides.metaRaw : JSON.stringify(meta);
    if (metaRaw !== null) await fs.writeFile(path.join(dir, 'pack.json'), metaRaw, 'utf-8');

    if (overrides.world !== null) {
      await fs.writeFile(path.join(dir, 'world.md'), overrides.world ?? VALID_WORLD, 'utf-8');
    }
    if (overrides.scenarioDoc !== null) {
      await fs.writeFile(path.join(dir, 'scenario.md'), overrides.scenarioDoc ?? VALID_SCENARIO, 'utf-8');
    }

    const pcFiles = overrides.pcFiles ?? {};
    const npcFiles = overrides.npcFiles ?? {};
    for (const name of Array.isArray(meta.pc) ? meta.pc : []) {
      if (pcFiles[name] === null) continue;
      await fs.writeFile(path.join(dir, 'pc', `${name}.md`), pcFiles[name] ?? VALID_PC, 'utf-8');
    }
    for (const name of Array.isArray(meta.npc) ? meta.npc : []) {
      if (npcFiles[name] === null) continue;
      await fs.writeFile(path.join(dir, 'npc', `${name}.md`), npcFiles[name] ?? VALID_NPC, 'utf-8');
    }
  }

  async function buildInvalidRoot(packId, overrides) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'starter-pack-test-'));
    createdDirs.push(dir);
    await writePack(dir, packId, overrides);
    await fs.writeFile(path.join(dir, 'index.json'), JSON.stringify([packId]), 'utf-8');
    return dir;
  }

  it('rejects when pack.json id does not match its directory name', async () => {
    const dir = await buildInvalidRoot('sample', { meta: { id: 'other-id' } });
    await expect(loadStarterPacks(dir)).rejects.toThrow(
      /starter pack "sample": pack\.json id "other-id" does not match its directory name/
    );
  });

  it('rejects an unknown mood', async () => {
    const dir = await buildInvalidRoot('sample', { meta: { moods: ['存在しない厨二ムード'] } });
    await expect(loadStarterPacks(dir)).rejects.toThrow(/starter pack "sample": unknown mood/);
  });

  it('rejects an unknown recommendedRuleset', async () => {
    const dir = await buildInvalidRoot('sample', { meta: { recommendedRuleset: 'pathfinder' } });
    await expect(loadStarterPacks(dir)).rejects.toThrow(
      /starter pack "sample": unknown recommendedRuleset "pathfinder"/
    );
  });

  it('rejects when pc or npc does not list exactly 2 entries', async () => {
    const dir1 = await buildInvalidRoot('sample', { meta: { pc: ['alice'] } });
    await expect(loadStarterPacks(dir1)).rejects.toThrow(
      /starter pack "sample": pc must list exactly 2 characters/
    );

    const dir2 = await buildInvalidRoot('sample', { meta: { npc: ['carol', 'dave', 'eve'] } });
    await expect(loadStarterPacks(dir2)).rejects.toThrow(
      /starter pack "sample": npc must list exactly 2 characters/
    );
  });

  // "old..house" は旧ID_RE(記号の許可集合)は通るが、本物の isValidId は ".." を含む値を
  // パストラバーサル対策として拒否する。finding1の修正で初めて検出できるようになったケース。
  it('rejects a character name that isValidId rejects (path-traversal-like ".." case)', async () => {
    const dir = await buildInvalidRoot('sample', { meta: { pc: ['old..house', 'bob'] } });
    await expect(loadStarterPacks(dir)).rejects.toThrow(
      /starter pack "sample": pc name "old\.\.house" is not a valid id/
    );
  });

  it('rejects duplicate character names within the same kind', async () => {
    const dir = await buildInvalidRoot('sample', { meta: { pc: ['alice', 'alice'] } });
    await expect(loadStarterPacks(dir)).rejects.toThrow(
      /starter pack "sample": pc has a duplicate name "alice"/
    );
  });

  it('rejects a PC sheet missing goal: or bonds:', async () => {
    const dir = await buildInvalidRoot('sample', {
      pcFiles: { alice: 'PC名: テスト\n\n目標も絆も書いていない\n' },
    });
    await expect(loadStarterPacks(dir)).rejects.toThrow(
      /starter pack "sample": pc\/alice\.md must declare goal: and bonds:/
    );
  });

  it('rejects a scenario.md missing "## GM専用情報"', async () => {
    const dir = await buildInvalidRoot('sample', {
      scenarioDoc: '# シナリオ\n\n## シナリオ概要\n\n本文のみで秘密パートがない\n',
    });
    await expect(loadStarterPacks(dir)).rejects.toThrow(
      /starter pack "sample": scenario\.md must contain both/
    );
  });

  it('rejects an empty document file', async () => {
    const dir = await buildInvalidRoot('sample', { world: '' });
    await expect(loadStarterPacks(dir)).rejects.toThrow(
      /starter pack "sample": missing or empty document/
    );
  });

  it('rejects a missing document file', async () => {
    const dir = await buildInvalidRoot('sample', { world: null });
    await expect(loadStarterPacks(dir)).rejects.toThrow(
      /starter pack "sample": missing or empty document/
    );
  });

  // JSON.parse は null / 数値 / 配列も通してしまうため、meta.id 参照より前に型を確認していないと
  // fail() の意図した「starter pack "sample": ...」ではなく素の TypeError が飛ぶ。
  it('rejects when pack.json is not a JSON object (null, number, array)', async () => {
    for (const metaRaw of ['null', '42', '[]']) {
      const dir = await buildInvalidRoot('sample', { metaRaw });
      await expect(loadStarterPacks(dir)).rejects.toThrow(
        /starter pack "sample": pack\.json must be a JSON object/
      );
    }
  });
});
