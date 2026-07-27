import { describe, it, expect } from 'vitest';
import {
  ROLL_TOOL,
  TURN_OUTPUT_FORMAT,
  buildSystemBlocks,
  buildTurnUserContent,
  buildRollTool,
  resolveAdapter,
} from './prompts.js';
import { getAdapter } from '../engine/rulesetAdapters.js';

function makeSession(overrides = {}) {
  return {
    rulesetId: 'coc7e',
    world: { summary: '霧深い港町' },
    scenario: { raw: '## シナリオ概要\n失踪事件' },
    pc: { raw: 'PC名: アリス' },
    state: {
      current_scene: '波止場',
      flags: { met_npc_a: true },
      history_summary: 'これまでのあらすじ',
      recent_log: [{ role: 'player', text: '波止場を調べる' }],
    },
    ...overrides,
  };
}

function staticText(session) {
  return buildSystemBlocks(session)[0].text;
}

describe('ROLL_TOOL', () => {
  it('declares check_label and success_percent as required inputs', () => {
    expect(ROLL_TOOL.name).toBe('roll_check');
    expect(ROLL_TOOL.input_schema.required).toEqual(['check_label', 'success_percent']);
  });

  it('bounds success_percent to 0-100 and limits rolls to one per turn', () => {
    expect(ROLL_TOOL.input_schema.properties.success_percent.minimum).toBe(0);
    expect(ROLL_TOOL.input_schema.properties.success_percent.maximum).toBe(100);
    expect(ROLL_TOOL.description).toContain('1ターンに最大1回');
  });

  it('reserves rolls for meaningful uncertainty and excludes natural conversation', () => {
    expect(ROLL_TOOL.description).toContain('物語上意味のある展開');
    expect(ROLL_TOOL.description).toContain('自然な会話の継続には使わず');
  });
});

describe('TURN_OUTPUT_FORMAT', () => {
  it('is a json_schema format requiring narrative, state_update, and choices', () => {
    expect(TURN_OUTPUT_FORMAT.type).toBe('json_schema');
    expect(TURN_OUTPUT_FORMAT.schema.required).toEqual(['narrative', 'state_update', 'choices']);
  });

  it('represents flags as an array of {key, value} pairs', () => {
    const flags = TURN_OUTPUT_FORMAT.schema.properties.state_update.properties.flags;
    expect(flags.type).toBe('array');
    expect(flags.items.required).toEqual(['key', 'value']);
  });

  it('state_updateにtension_level(enum, required)がある', () => {
    const su = TURN_OUTPUT_FORMAT.schema.properties.state_update;
    expect(su.properties.tension_level.enum).toEqual(['low', 'medium', 'high']);
    expect(su.required).toContain('tension_level');
  });
});

describe('buildSystemBlocks', () => {
  it('returns a single cacheable text block', () => {
    const blocks = buildSystemBlocks(makeSession());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
    expect(blocks[0]).toEqual(expect.objectContaining({ type: 'text' }));
  });

  it('includes the world summary, scenario, and pc sheet', () => {
    const text = staticText(makeSession());
    expect(text).toContain('霧深い港町');
    expect(text).toContain('失踪事件');
    expect(text).toContain('PC名: アリス');
  });

  it('does not include per-turn state (scene, flags, log)', () => {
    const text = staticText(makeSession());
    expect(text).not.toContain('波止場');
    expect(text).not.toContain('met_npc_a');
    expect(text).not.toContain('これまでのあらすじ');
  });

  it('includes the matching ruleset hint', () => {
    expect(staticText(makeSession({ rulesetId: 'coc7e' }))).toContain('SAN値チェック');
  });

  it('falls back to the simple ruleset when rulesetId is unknown', () => {
    expect(staticText(makeSession({ rulesetId: 'unknown' }))).toContain('特別な演出指定なし。');
  });

  it('uses session.ruleset when present, without falling back to the static RULESETS lookup', () => {
    const text = staticText(
      makeSession({
        rulesetId: 'unknown-static-id',
        ruleset: { id: 'homebrew', label: '自作ルール', desc: '独自ルール', hint: '独自の演出ヒント' },
      })
    );
    expect(text).toContain('ルール性向: 自作ルール');
    expect(text).toContain('独自の演出ヒント');
  });

  it('adds a goal/bonds section when present on session.pc', () => {
    const text = staticText(
      makeSession({ pc: { raw: 'PC名: アリス', goal: '真相を暴く', bonds: '姉との再会' } })
    );
    expect(text).toContain('# PCの目標・因縁(抽出済み)');
    expect(text).toContain('goal: 真相を暴く');
    expect(text).toContain('bonds: 姉との再会');
  });

  it('omits the goal/bonds section when absent on session.pc', () => {
    expect(staticText(makeSession({ pc: { raw: 'PC名: アリス' } }))).not.toContain('PCの目標・因縁');
  });

  it('instructs the GM to consider xp_gained using the growthUnit label', () => {
    const text = staticText(
      makeSession({ ruleset: { id: 'gurps', label: 'GURPS風', desc: '', hint: '', growthUnit: 'CP' } })
    );
    expect(text).toContain('xp_gained');
    expect(text).toContain('CP');
  });

  it('falls back to "経験値" as the growthUnit label when session.ruleset is absent', () => {
    expect(staticText(makeSession())).toContain('経験値');
  });

  it('システムプロンプトにtension_levelの出力指示が含まれる', () => {
    expect(staticText(makeSession())).toContain('tension_level');
  });

  it('instructs the GM on roll flow, player agency, and secret-info guarding', () => {
    const text = staticText(makeSession());
    expect(text).toContain('判定は1ターンに最大1回');
    expect(text).toContain('PCの行動・発言・感情を勝手に決めない');
    expect(text).toContain('narrative・choices・state_updateのいずれにも含めない');
    expect(text).toContain('fumble');
  });

  it('tells the GM to auto-resolve reasonable actions and continue natural NPC conversations', () => {
    const text = staticText(makeSession());
    expect(text).toContain('妥当なら判定せず');
    expect(text).toContain('迷った場合は判定しない');
    expect(text).toContain('PCとNPCの会話が自然に続いているだけなら判定しない');
    expect(text).toContain('利害の対立、明確な拒絶、秘密を明かさせる説得、欺瞞');
  });

  it('keeps narrative prose in plain form even when recent turns use polite form', () => {
    const session = makeSession({
      state: {
        current_scene: '波止場',
        flags: {},
        history_summary: '',
        recent_log: [{ role: 'gm', text: '港には深い霧が立ち込めています。' }],
      },
    });
    const text = staticText(session);
    const description = TURN_OUTPUT_FORMAT.schema.properties.narrative.description;

    expect(text).toContain('必ず常体');
    expect(text).toContain('直近のログが敬体でも引きずらず');
    expect(text).toContain('NPCの台詞はこの制約の対象外');
    expect(description).toContain('常体');
    expect(description).toContain('です・ます調は使わない');
  });
});

describe('ending_reached', () => {
  it('declares ending_reached as a required boolean in the turn schema', () => {
    const su = TURN_OUTPUT_FORMAT.schema.properties.state_update;
    expect(su.properties.ending_reached.type).toBe('boolean');
    expect(su.required).toContain('ending_reached');
  });

  it('tells the GM when to set ending_reached', () => {
    const session = {
      world: { summary: 'w' },
      scenario: { raw: 's' },
      pc: { raw: 'p' },
      rulesetId: 'simple',
      state: { current_scene: 'c' },
    };
    expect(buildSystemBlocks(session)[0].text).toContain('ending_reached');
  });
});

describe('resolveAdapter', () => {
  it('resolves the adapter from session.ruleset.formula', () => {
    expect(resolveAdapter({ ruleset: { id: 'x', formula: 'coc7e' } }).id).toBe('coc7e');
  });

  it('falls back to simple for legacy sessions without formula', () => {
    expect(resolveAdapter({ ruleset: { id: 'coc7e', label: 'CoC7e風' } }).id).toBe('simple');
    expect(resolveAdapter({ rulesetId: 'nonexistent' }).id).toBe('simple');
  });

  it('resolves builtin formula via rulesetId lookup when no snapshot exists', () => {
    expect(resolveAdapter({ rulesetId: 'dnd5e' }).id).toBe('dnd5e');
  });
});

describe('buildSystemBlocks adapter injection', () => {
  it('injects the simple promptText for legacy sessions', () => {
    const text = buildSystemBlocks({
      world: { summary: 'w' }, scenario: { raw: 's' }, pc: { raw: 'p' },
      rulesetId: 'simple',
    })[0].text;
    expect(text).toContain('critical=劇的な大成功');
    expect(text).not.toContain('# リソース');
  });

  it('injects coc7e degree text, sideEffectPrompt, and a resource section when the session actually has state.resources.san', () => {
    const text = buildSystemBlocks({
      world: { summary: 'w' }, scenario: { raw: 's' }, pc: { raw: 'p' },
      ruleset: { id: 'coc7e', label: 'CoC7e風', formula: 'coc7e' },
      state: { resources: { san: { value: 60, max: 99 } } },
    })[0].text;
    expect(text).toContain('ハード成功');
    expect(text).toContain('check_kind');
    expect(text).toContain('# リソース');
    expect(text).toContain('正気度');
  });

  it('omits the resource section and sideEffectPrompt for a coc7e-adapter session without state.resources (legacy session)', () => {
    const text = buildSystemBlocks({
      world: { summary: 'w' }, scenario: { raw: 's' }, pc: { raw: 'p' },
      ruleset: { id: 'coc7e', label: 'CoC7e風', formula: 'coc7e' },
    })[0].text;
    // degree語彙自体は判定式の一部なので出てよいが、実在しないSANの副作用指示は出してはいけない。
    expect(text).toContain('ハード成功');
    expect(text).not.toContain('# リソース');
    expect(text).not.toContain('check_kind');
  });

  it('omits the resource section for a coc7e-adapter session with an empty state.resources', () => {
    const text = buildSystemBlocks({
      world: { summary: 'w' }, scenario: { raw: 's' }, pc: { raw: 'p' },
      ruleset: { id: 'coc7e', label: 'CoC7e風', formula: 'coc7e' },
      state: { resources: {} },
    })[0].text;
    expect(text).not.toContain('# リソース');
    expect(text).not.toContain('check_kind');
  });
});

describe('buildTurnUserContent resources', () => {
  const base = {
    ruleset: { id: 'coc7e', formula: 'coc7e' },
    state: { current_scene: '冒頭', flags: {}, history_summary: '', recent_log: [] },
  };

  it('includes a resource line when state.resources exists', () => {
    const content = buildTurnUserContent(
      { ...base, state: { ...base.state, resources: { san: { value: 55, max: 99 } } } },
      '進む'
    );
    expect(content).toContain('リソース: 正気度 55/99');
  });

  it('omits the resource line when resources are absent or empty', () => {
    expect(buildTurnUserContent(base, '進む')).not.toContain('リソース:');
    expect(
      buildTurnUserContent({ ...base, state: { ...base.state, resources: {} } }, '進む')
    ).not.toContain('リソース:');
  });
});

describe('buildRollTool', () => {
  it('returns the plain ROLL_TOOL for adapters without side-effect kinds', () => {
    expect(buildRollTool(getAdapter('simple'))).toEqual(ROLL_TOOL);
    expect(buildRollTool(getAdapter('simple')).input_schema.properties.check_kind).toBeUndefined();
  });

  it('adds an optional check_kind enum for coc7e', () => {
    const tool = buildRollTool(getAdapter('coc7e'));
    expect(tool.input_schema.properties.check_kind.enum).toEqual(['normal', 'sanity']);
    expect(tool.input_schema.required).toEqual(['check_label', 'success_percent']); // check_kindは必須にしない
    expect(tool.input_schema.properties.success_percent).toBeDefined();
  });
});

describe('buildTurnUserContent', () => {
  it('includes the current scene, flags, summary, recent log, and player action', () => {
    const content = buildTurnUserContent(makeSession(), '周囲を警戒する');
    expect(content).toContain('シーン: 波止場');
    expect(content).toContain('met_npc_a=true');
    expect(content).toContain('物語要約: これまでのあらすじ');
    expect(content).toContain('PL: 波止場を調べる');
    expect(content).toContain('# プレイヤーの行動\n周囲を警戒する');
  });

  it('現在のテンションを含める(未設定はmedium)', () => {
    expect(buildTurnUserContent(makeSession(), '進む')).toContain('テンション: medium');
    const s = makeSession();
    s.state.tension_level = 'high';
    expect(buildTurnUserContent(s, '進む')).toContain('テンション: high');
  });

  it('falls back to placeholders when state is empty', () => {
    const content = buildTurnUserContent(
      makeSession({ state: { current_scene: 'x', flags: {}, history_summary: '', recent_log: [] } }),
      '行動'
    );
    expect(content).toContain('既知フラグ: (なし)');
    expect(content).toContain('物語要約: (まだなし)');
    expect(content).toContain('# 直近のログ\n(まだなし)');
  });
});
