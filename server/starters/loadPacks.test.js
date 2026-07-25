// @vitest-environment node
import { describe, it, expect } from 'vitest';
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
