import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Setup from './Setup.jsx';
import * as worldLibraryClient from '../api/worldLibraryClient.js';
import * as worldImport from '../api/worldImport.js';
import * as scenarioLibraryClient from '../api/scenarioLibraryClient.js';
import * as characterLibraryClient from '../api/characterLibraryClient.js';
import * as sessionApi from '../api/session.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(worldLibraryClient, 'listWorlds').mockResolvedValue([]);
  // worldIdが確定するテスト(既存World選択・新規World作成)ではPCステップのuseEffectが
  // listCharacters(worldId, 'pc')を呼ぶため、未モックの実fetchを避けるデフォルトを用意する。
  vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([]);
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
      expect.stringMatching(/^testworld-\d+$/),
      'Test World',
      '世界観の原文'
    );
    const session = onStart.mock.calls[0][0];
    expect(session.world.summary).toBe('分割済み要約');
    expect(session.world.raw).toBe('世界観の原文');
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
});
