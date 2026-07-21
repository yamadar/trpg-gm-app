import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ScenarioTab from './ScenarioTab.jsx';
import * as scenarioLibraryClient from '../../api/scenarioLibraryClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ScenarioTab', () => {
  it('shows guidance when no world is selected', () => {
    render(<ScenarioTab worldId={null} />);
    expect(screen.getByText('先にWorldタブでWorldを作成・選択してください。')).toBeInTheDocument();
  });

  it('lists scenarios for the selected world with recommendedRuleset', async () => {
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
      { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: 'coc7e' },
    ]);
    render(<ScenarioTab worldId="w1" />);
    await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
    expect(screen.getByText(/coc7e/)).toBeInTheDocument();
  });

  it('creates a new scenario via putScenario', async () => {
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    const putSpy = vi.spyOn(scenarioLibraryClient, 'putScenario').mockResolvedValue({});
    render(<ScenarioTab worldId="w1" />);
    await waitFor(() => expect(scenarioLibraryClient.listScenarios).toHaveBeenCalled());

    fireEvent.click(screen.getByText('+ 新規Scenario'));
    fireEvent.change(screen.getByPlaceholderText('例: missing-heir'), { target: { value: 'sc1' } });
    fireEvent.change(screen.getByPlaceholderText('シナリオタイトル'), { target: { value: '失踪事件' } });
    fireEvent.change(screen.getByPlaceholderText('シナリオ本文'), { target: { value: '## 概要' } });
    fireEvent.change(screen.getByPlaceholderText('例: coc7e'), { target: { value: 'coc7e' } });
    fireEvent.click(screen.getByText('作成する'));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('w1', 'sc1', {
        title: '失踪事件',
        raw: '## 概要',
        recommendedRuleset: 'coc7e',
      })
    );
  });

  it('deletes a scenario after confirmation', async () => {
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
      { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: null },
    ]);
    vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
      title: '失踪事件',
      raw: '## 概要',
      recommendedRuleset: null,
    });
    const deleteSpy = vi.spyOn(scenarioLibraryClient, 'deleteScenario').mockResolvedValue();

    render(<ScenarioTab worldId="w1" />);
    await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
    fireEvent.click(screen.getByText('失踪事件'));
    await waitFor(() => expect(screen.getByText('削除')).toBeInTheDocument());
    fireEvent.click(screen.getByText('削除'));
    fireEvent.click(screen.getByText('削除する'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('w1', 'sc1'));
  });

  it('ignores a stale getScenario response when selection changes before it resolves', async () => {
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
      { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: null },
      { id: 'sc2', worldId: 'w1', title: '呪われた宝石', recommendedRuleset: null },
    ]);

    let resolveA;
    const promiseA = new Promise((resolve) => {
      resolveA = resolve;
    });
    const getSpy = vi.spyOn(scenarioLibraryClient, 'getScenario').mockImplementation((worldId, id) => {
      if (id === 'sc1') return promiseA;
      if (id === 'sc2') return Promise.resolve({ title: '呪われた宝石', raw: 'sc2の本文', recommendedRuleset: null });
      return Promise.reject(new Error('unexpected id: ' + id));
    });

    render(<ScenarioTab worldId="w1" />);
    await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());

    fireEvent.click(screen.getByText('失踪事件'));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('w1', 'sc1'));

    fireEvent.click(screen.getByText('呪われた宝石'));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('w1', 'sc2'));
    await waitFor(() => expect(screen.getByDisplayValue('sc2の本文')).toBeInTheDocument());

    await act(async () => {
      resolveA({ title: '失踪事件', raw: 'sc1の本文(stale)', recommendedRuleset: null });
      await promiseA;
    });

    expect(screen.getByDisplayValue('sc2の本文')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('sc1の本文(stale)')).not.toBeInTheDocument();
  });
});
