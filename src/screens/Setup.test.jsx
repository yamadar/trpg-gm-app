import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Setup from './Setup.jsx';
import * as worldLibraryClient from '../api/worldLibraryClient.js';
import * as worldImport from '../api/worldImport.js';
import * as scenarioLibraryClient from '../api/scenarioLibraryClient.js';
import * as characterLibraryClient from '../api/characterLibraryClient.js';
import * as sessionApi from '../api/session.js';
import * as rulesetLibraryClient from '../api/rulesetLibraryClient.js';
import * as characterSheetCache from '../api/characterSheetCache.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(worldLibraryClient, 'listWorlds').mockResolvedValue([]);
  // worldIdが確定するテスト(既存World選択・新規World作成)ではPCステップのuseEffectが
  // listCharacters(worldId, 'pc')を呼ぶため、未モックの実fetchを避けるデフォルトを用意する。
  vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([]);
  vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([]);
});

describe('Setup', () => {
  it('renders the first wizard step (世界観) with the three World-source mode buttons', async () => {
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(worldLibraryClient.listWorlds).toHaveBeenCalled());
    expect(screen.getByText('既存を選ぶ')).toBeInTheDocument();
    expect(screen.getByText('新規に用意する')).toBeInTheDocument();
    expect(screen.getByText('空欄のまま進める')).toBeInTheDocument();
  });

  it('shows the step indicator for all 5 steps', () => {
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    // ステップタブ("1. 世界観"等)とForm 0のField labelの両方が"世界観"を含みうるため、
    // 厳密一致のgetByTextではなく部分一致のgetAllByTextで存在確認する。
    ['世界観', 'シナリオ', 'ルール', 'PC', '確認'].forEach((label) => {
      expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    });
  });

  it('lists existing Worlds and loads the selected one', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });

    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalledWith('w1'));
  });

  it('disables the Scenario "既存を選ぶ" button until a World is selected', () => {
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('次へ')); // World(デフォルトskip) -> Scenario
    // 共有Buttonコンポーネント(src/components/ui/Button.jsx)はdisabled時にネイティブの
    // disabled属性を付与せず、onClickを無効化するのみ(Button.test.jsxの既存挙動と同じ)。
    // そのためtoBeDisabled()ではなく、クリックしても既存Scenario選択UIへ遷移しないことで検証する。
    fireEvent.click(screen.getByText('既存を選ぶ'));
    expect(screen.queryByText('既存Scenarioを選ぶ')).not.toBeInTheDocument();
  });

  it("carries the selected Scenario's recommendedRuleset through as the default Ruleset on session start", async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
      { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: 'coc7e' },
    ]);
    vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
      id: 'sc1',
      title: '失踪事件',
      raw: 'シナリオ本文',
      recommendedRuleset: 'coc7e',
    });
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World: 既存
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
    fireEvent.click(screen.getByText('失踪事件'));
    await waitFor(() => expect(scenarioLibraryClient.getScenario).toHaveBeenCalledWith('w1', 'sc1'));

    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.rulesetId).toBe('coc7e');
    expect(session.world.raw).toBe('要約本文');
    expect(session.scenario.raw).toBe('シナリオ本文');
    expect(session.ruleset.id).toBe('coc7e');
    expect(session.ruleset.label).toBe('CoC7e風');
    expect(session.ruleset.growthUnit).toBe('経験値');
    expect(session.state.xp).toBe(0);
  });

  it('既存World選択時はWorldのmoodsがsession.moodsへ継承される(Scenarioより優先)', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({
      id: 'w1',
      title: 'Waterdeep',
      raw: '要約本文',
      moods: ['ホラー', 'ミステリー'],
    });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
      { id: 'sc1', worldId: 'w1', title: '失踪事件' },
    ]);
    vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
      id: 'sc1',
      title: '失踪事件',
      raw: 'シナリオ本文',
      moods: ['コメディ'],
    });
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World: 既存
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
    fireEvent.click(screen.getByText('失踪事件'));
    await waitFor(() => expect(scenarioLibraryClient.getScenario).toHaveBeenCalledWith('w1', 'sc1'));

    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.moods).toEqual(['ホラー', 'ミステリー']);
  });

  it('respects a manual Ruleset pick made after a Scenario recommendedRuleset was applied, instead of reverting it', async () => {
    // 回帰テスト: allRulesetsがuseMemoで安定化される前は、毎render新しい配列参照になり、
    // それをdepsに持つuseEffectが毎render再実行されてrecommendedRulesetに巻き戻していた。
    // そのためユーザーがRulesetを手動で選び直しても、直後のrenderで上書きされてしまっていた。
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
      { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: 'coc7e' },
    ]);
    vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
      id: 'sc1',
      title: '失踪事件',
      raw: 'シナリオ本文',
      recommendedRuleset: 'coc7e',
    });
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World: 既存
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
    fireEvent.click(screen.getByText('失踪事件'));
    await waitFor(() => expect(scenarioLibraryClient.getScenario).toHaveBeenCalledWith('w1', 'sc1'));

    fireEvent.click(screen.getByText('次へ')); // -> Ruleset (coc7eが推奨として自動選択される)
    await waitFor(() => expect(screen.getByText('CoC7e風')).toBeInTheDocument());
    fireEvent.click(screen.getByText('シンプル')); // 手動でsimpleに選び直す

    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.rulesetId).toBe('simple');
    expect(session.rulesetId).not.toBe('coc7e');
    expect(session.ruleset.id).toBe('simple');
    expect(session.ruleset.label).toBe('シンプル');
  });

  it('creates a new World in the library and starts the session with the split summary', async () => {
    vi.spyOn(worldImport, 'importWorld').mockResolvedValue({ world: '分割済み要約', regions: [], categories: [] });
    // scenarioModeは既定の'paste'のままscenarioRawを空で進めるため、handleStart内の
    // フォールバック(自動生成)経路でgenerateScenarioが呼ばれる。未モックだと実fetchが走るため必ずモックする。
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('自動生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('新規に用意する'));
    // slugifyは英数字とハイフン以外を除去するため、日本語タイトルだと"untitled"にfallbackしてしまい
    // slugify自体の変換が検証できない。ここでは意図的にASCIIタイトルを使い、生成idの中身を検証する。
    fireEvent.change(screen.getByPlaceholderText('World名'), { target: { value: 'Test World' } });
    fireEvent.change(screen.getByPlaceholderText(/世界観の資料を貼る/), { target: { value: '世界観の原文' } });

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(worldImport.importWorld).toHaveBeenCalledWith(
      expect.stringMatching(/^testworld-\d+-[a-z0-9]{4}$/),
      'Test World',
      '世界観の原文'
    );
    const session = onStart.mock.calls[0][0];
    expect(session.world.summary).toBe('分割済み要約');
    expect(session.world.raw).toBe('世界観の原文');
    // 既存World/Scenarioを選んでいないのでmoodsは空
    expect(session.moods).toEqual([]);
  });

  it('does not block session start when a library save fails, and shows a non-fatal warning', async () => {
    vi.spyOn(worldImport, 'importWorld').mockRejectedValue(new Error('network down'));
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('新規に用意する'));
    fireEvent.change(screen.getByPlaceholderText('World名'), { target: { value: 'テスト世界' } });
    fireEvent.change(screen.getByPlaceholderText(/世界観の資料を貼る/), { target: { value: '世界観の原文' } });

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(screen.getByText(/素材ライブラリへの保存に失敗した/)).toBeInTheDocument();
    const session = onStart.mock.calls[0][0];
    expect(session.world.raw).toBe('世界観の原文');
    expect(session.world.summary).toBe('世界観の原文');
  });

  it('lists custom Rulesets from the library and embeds the resolved ruleset into the session', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([
      { id: 'homebrew', label: '自作ルール', desc: '独自ルール', hint: '独自の演出ヒント', updatedAt: 1 },
    ]);
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    await waitFor(() => expect(screen.getByText('自作ルール')).toBeInTheDocument());
    fireEvent.click(screen.getByText('自作ルール'));
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.rulesetId).toBe('homebrew');
    expect(session.ruleset).toEqual({
      id: 'homebrew',
      label: '自作ルール',
      desc: '独自ルール',
      hint: '独自の演出ヒント',
      growthUnit: '経験値',
    });
  });

  it("embeds the selected PC's parsed goal/bonds into the session when the PC is library-linked", async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    characterLibraryClient.listCharacters.mockResolvedValue([
      { id: 'w1/pc/alice', worldId: 'w1', kind: 'pc', name: 'alice', revealed: null },
    ]);
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw: 'PC名: アリス',
      revealed: null,
      name: 'alice',
    });
    vi.spyOn(characterSheetCache, 'getOrParseCharacter').mockResolvedValue({
      goal: '真相を暴く',
      bonds: '姉との再会',
    });
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
    fireEvent.click(screen.getByText('alice'));
    await waitFor(() => expect(characterLibraryClient.getCharacter).toHaveBeenCalledWith('w1', 'pc', 'alice'));

    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(characterSheetCache.getOrParseCharacter).toHaveBeenCalledWith('w1', 'pc', 'alice');
    const session = onStart.mock.calls[0][0];
    expect(session.pc.goal).toBe('真相を暴く');
    expect(session.pc.bonds).toBe('姉との再会');
  });

  it('does not attempt to resolve goal/bonds when the PC has no library link', async () => {
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const getOrParseSpy = vi.spyOn(characterSheetCache, 'getOrParseCharacter');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('次へ')); // World(skip) -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(getOrParseSpy).not.toHaveBeenCalled();
    const session = onStart.mock.calls[0][0];
    expect(session.pc.goal).toBeUndefined();
    expect(session.pc.bonds).toBeUndefined();
  });

  it('clears a previously selected Scenario when the World changes', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([
      { id: 'w1', title: 'World1', updatedAt: 1 },
      { id: 'w2', title: 'World2', updatedAt: 2 },
    ]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockImplementation((id) =>
      Promise.resolve({ id, title: id === 'w1' ? 'World1' : 'World2', raw: '要約' })
    );
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockImplementation((wid) =>
      Promise.resolve(wid === 'w1' ? [{ id: 'sc1', worldId: 'w1', title: 'シナリオ1', recommendedRuleset: null }] : [])
    );
    vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
      id: 'sc1',
      title: 'シナリオ1',
      raw: 'w1のシナリオ',
      recommendedRuleset: null,
    });
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成シナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('World1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('World1'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalledWith('w1'));
    fireEvent.click(screen.getByText('次へ')); // Scenario
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('シナリオ1')).toBeInTheDocument());
    fireEvent.click(screen.getByText('シナリオ1'));
    await waitFor(() => expect(scenarioLibraryClient.getScenario).toHaveBeenCalled());

    // Worldステップに戻り、別のWorldへ切り替える
    fireEvent.click(screen.getByText('戻る'));
    fireEvent.click(screen.getByText('World2'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalledWith('w2'));

    // 確認まで進めて開始 → World Aのシナリオは残っていない(生成側へ落ちる)
    fireEvent.click(screen.getByText('次へ')); // Scenario
    fireEvent.click(screen.getByText('次へ')); // Ruleset
    fireEvent.click(screen.getByText('次へ')); // PC
    fireEvent.click(screen.getByText('次へ')); // 確認
    fireEvent.click(screen.getByText('ゲーム開始'));
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.scenario.raw).not.toBe('w1のシナリオ');
  });

  it('campaignContextを渡すとworld/pc/rulesetを前埋めし、worldId/campaignId/xpをセッションへ反映する', async () => {
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成シナリオ');
    const onStart = vi.fn();
    const campaignContext = {
      worldId: 'w1',
      world: { raw: 'World原文', summary: 'World要約' },
      moods: [],
      pcRaw: 'PC名: カイ(熟練)',
      xp: 12,
      rulesetId: 'simple',
      campaignId: 'cp1',
    };
    render(<Setup onStart={onStart} onCancel={vi.fn()} campaignContext={campaignContext} />);
    // シナリオ→ルール→PC→確認→開始(Worldは前埋め済み)
    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));
    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.worldId).toBe('w1');
    expect(session.campaignId).toBe('cp1');
    expect(session.state.xp).toBe(12);
    expect(session.pc.raw).toContain('PC名: カイ(熟練)');
  });

  it('surfaces a fatal error and does not start the session when scenario generation fails', async () => {
    vi.spyOn(sessionApi, 'generateScenario').mockRejectedValue(new Error('LLM down'));
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    // World(既定skip) -> Scenario(既定paste空) -> Ruleset -> PC -> 確認
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(screen.getByText(/開始処理に失敗した/)).toBeInTheDocument());
    expect(onStart).not.toHaveBeenCalled();
    // busy解除でボタン文言が"ゲーム開始"へ戻る(準備中…のままにならない)
    expect(screen.getByText('ゲーム開始')).toBeInTheDocument();
  });
});
