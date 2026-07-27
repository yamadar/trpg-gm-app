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
import { COLORS } from '../theme.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(worldLibraryClient, 'listWorlds').mockResolvedValue([]);
  // worldIdが確定するテスト(既存World選択・新規World作成)ではPCステップのuseEffectが
  // listCharacters(worldId, 'pc')を呼ぶため、未モックの実fetchを避けるデフォルトを用意する。
  vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([]);
  vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([]);
  vi.spyOn(characterSheetCache, 'getOrParseCharacter').mockImplementation(async (_worldId, _kind, name) => ({
    name:
      name === 'alice'
        ? 'アリス'
        : name === 'howard'
          ? 'ハワード'
          : name === 'howard-kane'
            ? 'ハワード・ケイン'
          : name === 'mabel-thorne'
            ? 'メイベル'
            : '',
    goal: '',
    bonds: '',
  }));
});

describe('Setup', () => {
  it('shows every wizard step in the focus header and marks the current one', () => {
    render(<Setup onStart={() => {}} />);
    for (const s of ['世界観', 'シナリオ', 'ルール', 'PC', '確認']) {
      expect(screen.getByText(s)).toBeInTheDocument();
    }
    expect(screen.getByText('世界観')).toHaveAttribute('aria-current', 'step');
  });

  it('leaves the wizard through the focus header, from any step', () => {
    const { unmount } = render(<Setup onStart={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(window.location.hash).toBe('#/');
    window.history.replaceState(null, '', window.location.pathname);
    unmount();

    // 先のステップへ進んでも同じ離脱導線が同じ場所に出続けること
    // (以前は画面ごとの「閉じる」に頼っていて、ステップによって出方が違った)。
    render(<Setup onStart={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(screen.getByText('シナリオ')).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(window.location.hash).toBe('#/');
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('asks for confirmation before leaving once the wizard has unsaved input', () => {
    // 世界観の自由記述に何か入力されている状態で「やめる」を押すと、
    // 未入力のときと違って即離脱せず確認モーダルを挟む。
    render(<Setup onStart={() => {}} />);
    fireEvent.click(screen.getByText('新規に用意する'));
    fireEvent.change(screen.getByPlaceholderText('世界観の資料を貼る、ファイルを取り込む'), {
      target: { value: '中世風の島国' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));

    expect(screen.getByText('入力した内容を破棄してウィザードを離れる。よいか?')).toBeInTheDocument();
    expect(window.location.hash).not.toBe('#/');
  });

  it('leaves the wizard once the exit is confirmed from the modal', () => {
    render(<Setup onStart={() => {}} />);
    fireEvent.click(screen.getByText('新規に用意する'));
    fireEvent.change(screen.getByPlaceholderText('世界観の資料を貼る、ファイルを取り込む'), {
      target: { value: '中世風の島国' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));

    fireEvent.click(screen.getByRole('button', { name: '破棄して離れる' }));

    expect(window.location.hash).toBe('#/');
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('keeps the wizard and its input intact when the exit is cancelled from the modal', () => {
    render(<Setup onStart={() => {}} />);
    fireEvent.click(screen.getByText('新規に用意する'));
    fireEvent.change(screen.getByPlaceholderText('世界観の資料を貼る、ファイルを取り込む'), {
      target: { value: '中世風の島国' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));

    expect(window.location.hash).not.toBe('#/');
    expect(screen.queryByText('入力した内容を破棄してウィザードを離れる。よいか?')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('世界観の資料を貼る、ファイルを取り込む')).toHaveValue('中世風の島国');
  });

  it('keeps the footer back button as a step-level control', () => {
    render(<Setup onStart={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '次へ' }));
    expect(screen.getByText('シナリオ')).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.getByText('世界観')).toHaveAttribute('aria-current', 'step');
  });

  it('renders the first wizard step (世界観) with the three World-source mode buttons', async () => {
    render(<Setup onStart={vi.fn()} />);
    await waitFor(() => expect(worldLibraryClient.listWorlds).toHaveBeenCalled());
    expect(screen.getByText('既存を選ぶ')).toBeInTheDocument();
    expect(screen.getByText('新規に用意する')).toBeInTheDocument();
    expect(screen.getByText('空欄のまま進める')).toBeInTheDocument();
  });

  // 5段すべてが出ることの検証は、現在地の印まで見る
  // 'shows every wizard step in the focus header and marks the current one'
  // (このファイル冒頭)が引き継いだ。部分一致で存在だけを見る旧版はその真部分集合。

  it('lists existing Worlds and loads the selected one', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });

    render(<Setup onStart={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalledWith('w1'));
  });

  it('points the empty world state at the gallery', async () => {
    vi.spyOn(worldLibraryClient, 'listWorlds').mockResolvedValue([]);
    render(<Setup onStart={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ'));
    expect(await screen.findByText(/公開ギャラリーの「おすすめ」/)).toBeInTheDocument();
  });

  it('disables the Scenario "既存を選ぶ" button until a World is selected', () => {
    render(<Setup onStart={vi.fn()} />);
    fireEvent.click(screen.getByText('次へ')); // World(デフォルトskip) -> Scenario
    expect(screen.getByText('既存を選ぶ')).toBeDisabled();
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

    render(<Setup onStart={onStart} />);
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
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'テスト太郎' } });
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
    expect(session.ruleset.formula).toBe('coc7e');
    expect(session.state.resources).toEqual({ san: { value: 60, max: 99 } });
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

    render(<Setup onStart={onStart} />);
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
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'テスト太郎' } });
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

    render(<Setup onStart={onStart} />);
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
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'テスト太郎' } });
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.rulesetId).toBe('simple');
    expect(session.rulesetId).not.toBe('coc7e');
    expect(session.ruleset.id).toBe('simple');
    expect(session.ruleset.label).toBe('シンプル');
    expect(session.ruleset.formula).toBe('simple');
    expect('resources' in session.state).toBe(false);
  });

  it('creates a new World in the library and starts the session with the split summary', async () => {
    vi.spyOn(worldImport, 'importWorld').mockResolvedValue({ world: '分割済み要約', regions: [], categories: [] });
    // scenarioModeは既定の'paste'のままscenarioRawを空で進めるため、handleStart内の
    // フォールバック(自動生成)経路でgenerateScenarioが呼ばれる。未モックだと実fetchが走るため必ずモックする。
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('自動生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} />);
    fireEvent.click(screen.getByText('新規に用意する'));
    // slugifyは英数字とハイフン以外を除去するため、日本語タイトルだと"untitled"にfallbackしてしまい
    // slugify自体の変換が検証できない。ここでは意図的にASCIIタイトルを使い、生成idの中身を検証する。
    fireEvent.change(screen.getByPlaceholderText('World名'), { target: { value: 'Test World' } });
    fireEvent.change(screen.getByPlaceholderText(/世界観の資料を貼る/), { target: { value: '世界観の原文' } });

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'テスト太郎' } });
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

    render(<Setup onStart={onStart} />);
    fireEvent.click(screen.getByText('新規に用意する'));
    fireEvent.change(screen.getByPlaceholderText('World名'), { target: { value: 'テスト世界' } });
    fireEvent.change(screen.getByPlaceholderText(/世界観の資料を貼る/), { target: { value: '世界観の原文' } });

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'テスト太郎' } });
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

    render(<Setup onStart={onStart} />);

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    await waitFor(() => expect(screen.getByText('自作ルール')).toBeInTheDocument());
    fireEvent.click(screen.getByText('自作ルール'));
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'テスト太郎' } });
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

  // 名前(=ストレージ上のid)だけでは、並んだPCのどれが誰なのか分からない。
  // 一覧が返す表示名・抜粋・解析済みのgoal/bondsを、選ぶ前に見せる。
  it('shows what each existing PC is, not just its storage name', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    characterLibraryClient.listCharacters.mockResolvedValue([
      {
        worldId: 'w1',
        kind: 'pc',
        name: 'howard-kane',
        displayName: 'ハワード・ケイン',
        excerpt: '新聞記者。兄の死の真相を追っている。',
        parsed: null,
      },
      {
        worldId: 'w1',
        kind: 'pc',
        name: 'mabel-thorne',
        displayName: 'メイベル・ソーン',
        excerpt: '骨董商。',
        parsed: { name: 'メイベル・ソーン', goal: '禁書を取り戻す', bonds: '亡き師との約束' },
      },
    ]);

    render(<Setup onStart={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());
    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('既存を選ぶ'));

    expect(await screen.findByText('ハワード・ケイン')).toBeInTheDocument();
    expect(screen.getByText('新聞記者。兄の死の真相を追っている。')).toBeInTheDocument();
    expect(screen.getByText('目標: 禁書を取り戻す')).toBeInTheDocument();
    expect(screen.getByText('因縁: 亡き師との約束')).toBeInTheDocument();
    expect(screen.queryByText('howard-kane')).not.toBeInTheDocument();
  });

  it('uses the AI-extracted name when the list carries no display name', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    characterLibraryClient.listCharacters.mockResolvedValue([{ worldId: 'w1', kind: 'pc', name: 'alice' }]);
    vi.spyOn(characterSheetCache, 'getOrParseCharacter').mockResolvedValue({
      name: 'アリス',
      goal: '',
      bonds: '',
    });

    render(<Setup onStart={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('既存を選ぶ'));

    expect(await screen.findByText('アリス')).toBeInTheDocument();
    expect(screen.queryByText('alice')).not.toBeInTheDocument();
  });

  it("embeds the selected PC's parsed goal/bonds into the session when the PC is library-linked", async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    characterLibraryClient.listCharacters.mockResolvedValue([
      {
        id: 'w1/pc/alice',
        worldId: 'w1',
        kind: 'pc',
        name: 'alice',
        displayName: 'アリス',
        revealed: null,
      },
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

    render(<Setup onStart={onStart} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('アリス')).toBeInTheDocument());
    fireEvent.click(screen.getByText('アリス'));
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

    render(<Setup onStart={onStart} />);
    fireEvent.click(screen.getByText('次へ')); // World(skip) -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'テスト太郎' } });
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(getOrParseSpy).not.toHaveBeenCalled();
    const session = onStart.mock.calls[0][0];
    expect(session.pc.goal).toBeUndefined();
    expect(session.pc.bonds).toBeUndefined();
  });

  it('blocks the PC step until a PC name is entered in the new-PC mode', () => {
    render(<Setup onStart={vi.fn()} />);
    fireEvent.click(screen.getByText('次へ')); // World(skip) -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC

    expect(screen.getByText('次へ')).toBeDisabled();
    fireEvent.click(screen.getByText('次へ'));
    expect(screen.queryByText('セッション名')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'カイ' } });
    fireEvent.click(screen.getByText('次へ'));
    expect(screen.getByText('セッション名')).toBeInTheDocument();
  });

  it('does not block the PC step when an existing PC is picked from the library', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);

    render(<Setup onStart={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('既存を選ぶ')); // PC: 既存

    expect(screen.queryByPlaceholderText('例: カイ・アーレンス')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('次へ'));
    expect(screen.getByText('セッション名')).toBeInTheDocument();
  });

  // 回帰テスト: 既存PCモードのままPCを選ばずに開始すると、composePcRaw(pcName, pcRaw)が
  // 両方空で''を返し、GMプロンプトの「# PC設定」節が空になっていた(指摘1)。
  it('does not leave session.pc.raw empty when existing-PC mode is left without picking a PC', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('既存を選ぶ')); // PC: 既存(PCは選ばない)

    fireEvent.click(screen.getByText('次へ')); // -> 確認(pcNameMissingはnewモードにしか効かない)
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.pc.raw).not.toBe('');
    expect(session.pc.raw).toBe('(自由記述なし)');
  });

  // 回帰テスト: 既存PCを選んだ経路の名前解決がAI解析(getOrParseCharacter)だけに頼っていると、
  // オフライン・429・キー無しで黙って名前が落ちていた(指摘2)。シート本文の「PC名:」行が
  // フォールバックとして先に効くことを確認する。
  it("falls back to the sheet's PC名 line when getOrParseCharacter fails for an existing PC", async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    characterLibraryClient.listCharacters.mockResolvedValue([
      {
        id: 'w1/pc/howard',
        worldId: 'w1',
        kind: 'pc',
        name: 'howard',
        displayName: 'ハワード',
        revealed: null,
      },
    ]);
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw: 'PC名: ハワード',
      revealed: null,
      name: 'howard',
    });
    vi.spyOn(characterSheetCache, 'getOrParseCharacter').mockRejectedValue(new Error('network down'));
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('ハワード')).toBeInTheDocument());
    fireEvent.click(screen.getByText('ハワード'));
    await waitFor(() => expect(characterLibraryClient.getCharacter).toHaveBeenCalledWith('w1', 'pc', 'howard'));

    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(characterSheetCache.getOrParseCharacter).toHaveBeenCalled();
    const session = onStart.mock.calls[0][0];
    expect(session.pc.name).toBe('ハワード');
  });

  it('keeps the user-entered name when AI extracts a different name for an existing PC', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({
      id: 'w1',
      title: 'Waterdeep',
      raw: '要約本文',
    });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    characterLibraryClient.listCharacters.mockResolvedValue([
      {
        id: 'w1/pc/alice',
        worldId: 'w1',
        kind: 'pc',
        name: 'alice',
        characterName: '手入力のアリス',
        parsed: { name: 'AIのアリス', goal: '', bonds: '' },
      },
    ]);
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      name: 'alice',
      characterName: '手入力のアリス',
      raw: 'PC名: タグ名のアリス',
      revealed: null,
    });
    vi.spyOn(characterSheetCache, 'getOrParseCharacter').mockResolvedValue({
      name: 'AIのアリス',
      goal: '',
      bonds: '',
    });
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} />);
    fireEvent.click(screen.getByText('既存を選ぶ'));
    fireEvent.click(await screen.findByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('既存を選ぶ'));
    fireEvent.click(await screen.findByText('手入力のアリス'));
    await waitFor(() => expect(characterLibraryClient.getCharacter).toHaveBeenCalled());
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(onStart.mock.calls[0][0].pc.name).toBe('手入力のアリス');
  });

  // キャンペーンの章をまたぐたびに名前を打ち直させないための前埋め。
  it('prefills the PC name from the carried sheet when a campaignContext is given', async () => {
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    render(
      <Setup
        onStart={vi.fn()}
        campaignContext={{
          worldId: 'w1',
          world: { raw: 'World原文', summary: 'World要約' },
          moods: [],
          pcRaw: 'PC名: カイ(熟練)',
          xp: 12,
          rulesetId: 'simple',
          campaignId: 'cp1',
        }}
      />
    );
    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC

    expect(screen.getByPlaceholderText('例: カイ・アーレンス')).toHaveValue('カイ(熟練)');
  });

  it('carries the entered PC name into the session and prepends it to the sheet', async () => {
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} />);
    fireEvent.click(screen.getByText('次へ')); // World(skip) -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'カイ' } });
    fireEvent.change(screen.getByPlaceholderText(/能力値・スキル/), { target: { value: 'goal: 生き延びる' } });
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.pc.name).toBe('カイ');
    expect(session.pc.raw).toBe('PC名: カイ\ngoal: 生き延びる');
  });

  // 新規PC経路は入力欄の名前が確定値。AI解析の結果で上書きしない。
  it('keeps the entered PC name even when parsing returns a different name (new-PC path)', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacter').mockResolvedValue({});
    vi.spyOn(characterSheetCache, 'getOrParseCharacter').mockResolvedValue({
      name: '別の名前',
      goal: '',
      bonds: '',
    });
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC(新規作成が既定)
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'カイ' } });
    fireEvent.change(screen.getByPlaceholderText(/能力値・スキル/), { target: { value: 'goal: 生き延びる' } });
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(putSpy).toHaveBeenCalledWith(
      'w1',
      'pc',
      expect.stringMatching(/^pc-[0-9]+-[a-z0-9]{4}$/),
      {
        characterName: 'カイ',
        raw: 'PC名: カイ\ngoal: 生き延びる',
        revealed: undefined,
      }
    );
    expect(characterSheetCache.getOrParseCharacter).toHaveBeenCalled();
    const session = onStart.mock.calls[0][0];
    expect(session.pc.name).toBe('カイ');
  });

  it('does not duplicate a PC名 line that the player already wrote in the sheet', async () => {
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} />);
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'カイ' } });
    fireEvent.change(screen.getByPlaceholderText(/能力値・スキル/), {
      target: { value: 'PC名: ハワード\ngoal: 真相を暴く' },
    });
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.pc.raw).toBe('PC名: ハワード\ngoal: 真相を暴く');
    // 入力欄の「カイ」ではなく、本文に既にある「PC名:」行が優先される仕様を固定する。
    expect(session.pc.name).toBe('ハワード');
  });

  it("takes the session PC name from the library sheet's parsed name when an existing PC is picked", async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    characterLibraryClient.listCharacters.mockResolvedValue([
      {
        id: 'w1/pc/alice',
        worldId: 'w1',
        kind: 'pc',
        name: 'alice',
        displayName: 'アリス',
        revealed: null,
      },
    ]);
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw: 'PC名: アリス',
      revealed: null,
      name: 'alice',
    });
    vi.spyOn(characterSheetCache, 'getOrParseCharacter').mockResolvedValue({
      name: 'アリス',
      goal: '真相を暴く',
      bonds: '姉との再会',
    });
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('アリス')).toBeInTheDocument());
    fireEvent.click(screen.getByText('アリス'));
    await waitFor(() => expect(characterLibraryClient.getCharacter).toHaveBeenCalledWith('w1', 'pc', 'alice'));

    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.pc.name).toBe('アリス');
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

    render(<Setup onStart={onStart} />);
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
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'テスト太郎' } });
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
    render(<Setup onStart={onStart} campaignContext={campaignContext} />);
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

    render(<Setup onStart={onStart} />);
    // World(既定skip) -> Scenario(既定paste空) -> Ruleset -> PC -> 確認
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'テスト太郎' } });
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(screen.getByText(/開始処理に失敗した/)).toBeInTheDocument());
    expect(onStart).not.toHaveBeenCalled();
    // busy解除でボタン文言が"ゲーム開始"へ戻る(準備中…のままにならない)
    expect(screen.getByText('ゲーム開始')).toBeInTheDocument();
  });

  describe('starterContext', () => {
    const STARTER = {
      world: { id: 'arkham-1920s', title: 'アーカム 1920s', moods: ['ホラー'], raw: '# 世界本文' },
      scenario: {
        id: 'photo-studio-on-the-hill', worldId: 'arkham-1920s', title: '丘の上の写真館',
        recommendedRuleset: 'coc7e', moods: ['ホラー'], raw: '# シナリオ本文',
      },
      rulesetId: 'coc7e',
    };

    it('opens on the PC step with world, scenario and ruleset already chosen', async () => {
      vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([
        { name: 'howard-kane', displayName: 'ハワード' },
        { name: 'mabel-thorne', displayName: 'メイベル' },
      ]);
      // マウント時点でworldIdが既に埋まっているため、[worldId]のuseEffectが即listScenariosを
      // 呼ぶ。モックしないとjsdomで実fetchが失敗し、catchでerror stateへ吸収されてしまうため、
      // 既存テストの慣習(Worldが決まっている状態では必ずモックする)に倣う。
      vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([STARTER.scenario]);
      render(<Setup onStart={vi.fn()} starterContext={STARTER} />);

      // FocusHeaderのステップ表示は常に5段すべてのラベルを描き、現在地は
      // aria-current="step" で示す。ここで見たいのは本文まで開けていることなので、
      // PCステップでしか描かれないField labelで判定する。
      expect(await screen.findByText('PCの用意方法')).toBeInTheDocument();
      // PC一覧が選択済みWorldから取れている
      await waitFor(() => expect(characterLibraryClient.listCharacters).toHaveBeenCalledWith('arkham-1920s', 'pc'));
      expect(await screen.findByText('ハワード・ケイン')).toBeInTheDocument();
    });

    // worldId が最初から埋まっているので、マウント時に走る useEffect が選択を消してはいけない
    it('keeps the preselected scenario after mount', async () => {
      vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([]);
      // Scenarioステップの一覧はlistScenarios(worldId)の結果から描画されるため、既存テストの
      // 慣習(Worldが決まっている状態でScenarioステップへ進むテストは必ずモックする)に倣う。
      vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([STARTER.scenario]);
      render(<Setup onStart={vi.fn()} starterContext={STARTER} />);

      fireEvent.click(await screen.findByText('戻る')); // → ルール
      fireEvent.click(screen.getByText('戻る')); // → シナリオ
      // 一覧のタイトル文字列はlistScenariosのモック結果から誰でも描画されてしまい、
      // selectedScenarioがnullでも一致してしまう(=マウント時リセットのバグを検知できない)。
      // selectedScenarioがある場合にのみ変わるCardのborderColor(選択時COLORS.brass /
      // 未選択時COLORS.line)で検証することで、実際に選択状態が保持されていることを確かめる。
      const scenarioCard = (await screen.findByText('丘の上の写真館')).parentElement;
      expect(scenarioCard).toHaveStyle({ borderColor: COLORS.brass });
    });

    it('starts a session carrying the starter world, scenario, moods and ruleset', async () => {
      vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([
        { name: 'howard-kane', displayName: 'ハワード' },
      ]);
      vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({ name: 'howard-kane', raw: 'PC名: ハワード' });
      // マウント時点でworldIdが既に埋まっているため、[worldId]のuseEffectが即listScenariosを
      // 呼ぶ。モックしないとjsdomで実fetchが失敗し、catchでerror stateへ吸収されてしまうため、
      // 既存テストの慣習(Worldが決まっている状態では必ずモックする)に倣う。
      vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([STARTER.scenario]);
      const onStart = vi.fn();
      render(<Setup onStart={onStart} starterContext={STARTER} />);

      fireEvent.click(await screen.findByText('ハワード・ケイン'));
      fireEvent.click(screen.getByText('次へ')); // → 確認
      fireEvent.click(await screen.findByText('ゲーム開始'));

      await waitFor(() => expect(onStart).toHaveBeenCalled());
      const session = onStart.mock.calls[0][0];
      expect(session.worldId).toBe('arkham-1920s');
      expect(session.world.summary).toBe('# 世界本文');
      expect(session.scenario.raw).toBe('# シナリオ本文');
      expect(session.moods).toEqual(['ホラー']);
      expect(session.rulesetId).toBe('coc7e');
      expect(session.title).toContain('丘の上の写真館');
    });

    it('behaves exactly as before when starterContext is absent', () => {
      render(<Setup onStart={vi.fn()} />);
      // 0段目でしか描かれないField labelで、PCステップから開いていないことを示す。
      expect(screen.getByText('Worldの用意方法')).toBeInTheDocument();
      expect(screen.queryByText('PCの用意方法')).not.toBeInTheDocument();
    });
  });
});
