import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ScenarioTab from './ScenarioTab.jsx';
import * as scenarioLibraryClient from '../../api/scenarioLibraryClient.js';
import * as shareClient from '../../api/shareClient.js';
import { renderWithAuth } from '../../test/renderWithAuth.jsx';
import { RULESETS } from '../../data/rulesets.js';

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
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'coc7e' } });
    fireEvent.click(screen.getByText('作成する'));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('w1', 'sc1', {
        title: '失踪事件',
        raw: '## 概要',
        recommendedRuleset: 'coc7e',
      })
    );
  });

  describe('推奨ルール(select)', () => {
    it('offers 未設定 plus every RULESETS entry as options in the create form', async () => {
      vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
      render(<ScenarioTab worldId="w1" />);
      await waitFor(() => expect(scenarioLibraryClient.listScenarios).toHaveBeenCalled());

      fireEvent.click(screen.getByText('+ 新規Scenario'));
      const select = screen.getByRole('combobox');
      expect(select.querySelector('option[value=""]').textContent).toBe('未設定');
      RULESETS.forEach((r) => {
        expect(select.querySelector(`option[value="${r.id}"]`).textContent).toBe(r.label);
      });
    });

    it("keeps a legacy free-text recommendedRuleset (not in RULESETS) selected as its own option when opening the editor, instead of blanking it", async () => {
      vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
        { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: 'my-custom-system' },
      ]);
      vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
        title: '失踪事件',
        raw: '## 概要',
        recommendedRuleset: 'my-custom-system',
      });

      render(<ScenarioTab worldId="w1" />);
      await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
      fireEvent.click(screen.getByText('失踪事件'));
      await waitFor(() => expect(screen.getByDisplayValue('## 概要')).toBeInTheDocument());

      const select = screen.getByRole('combobox');
      expect(select.value).toBe('my-custom-system');
      expect(select.querySelector('option[value="my-custom-system"]')).not.toBeNull();
    });

    it('overwrites a legacy recommendedRuleset only when the user actively picks a different option', async () => {
      vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
        { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: 'my-custom-system' },
      ]);
      vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
        title: '失踪事件',
        raw: '## 概要',
        recommendedRuleset: 'my-custom-system',
        moods: [],
      });
      const putSpy = vi.spyOn(scenarioLibraryClient, 'putScenario').mockResolvedValue({});

      render(<ScenarioTab worldId="w1" />);
      await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
      fireEvent.click(screen.getByText('失踪事件'));
      await waitFor(() => expect(screen.getByDisplayValue('## 概要')).toBeInTheDocument());

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dnd5e' } });
      fireEvent.click(screen.getByText('保存する'));

      await waitFor(() =>
        expect(putSpy).toHaveBeenCalledWith('w1', 'sc1', {
          title: '失踪事件',
          raw: '## 概要',
          recommendedRuleset: 'dnd5e',
          moods: [],
        })
      );
    });
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

  describe('雰囲気(moods)', () => {
    it("pre-selects a scenario's saved moods when the editor opens", async () => {
      vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
        { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: null, moods: ['SF', '日常'] },
      ]);
      vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
        title: '失踪事件',
        raw: '## 概要',
        recommendedRuleset: null,
        moods: ['SF', '日常'],
      });

      render(<ScenarioTab worldId="w1" />);
      await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
      fireEvent.click(screen.getByText('失踪事件'));
      await waitFor(() => expect(screen.getByDisplayValue('## 概要')).toBeInTheDocument());

      expect(screen.getByRole('button', { name: 'SF', pressed: true })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '日常', pressed: true })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'ホラー', pressed: false })).toBeInTheDocument();
    });

    it('includes the selected moods in the PUT body when saving', async () => {
      vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
        { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: null, moods: [] },
      ]);
      vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
        title: '失踪事件',
        raw: '## 概要',
        recommendedRuleset: null,
        moods: [],
      });
      const putSpy = vi.spyOn(scenarioLibraryClient, 'putScenario').mockResolvedValue({});

      render(<ScenarioTab worldId="w1" />);
      await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
      fireEvent.click(screen.getByText('失踪事件'));
      await waitFor(() => expect(screen.getByDisplayValue('## 概要')).toBeInTheDocument());

      fireEvent.click(screen.getByText('ホラー'));
      fireEvent.click(screen.getByText('ミステリー'));
      fireEvent.click(screen.getByText('保存する'));

      await waitFor(() =>
        expect(putSpy).toHaveBeenCalledWith('w1', 'sc1', {
          title: '失踪事件',
          raw: '## 概要',
          recommendedRuleset: null,
          moods: ['ホラー', 'ミステリー'],
        })
      );
    });

    it('sends an empty moods array when none are selected', async () => {
      vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
        { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: null, moods: [] },
      ]);
      vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
        title: '失踪事件',
        raw: '## 概要',
        recommendedRuleset: null,
        moods: [],
      });
      const putSpy = vi.spyOn(scenarioLibraryClient, 'putScenario').mockResolvedValue({});

      render(<ScenarioTab worldId="w1" />);
      await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
      fireEvent.click(screen.getByText('失踪事件'));
      await waitFor(() => expect(screen.getByDisplayValue('## 概要')).toBeInTheDocument());
      fireEvent.click(screen.getByText('保存する'));

      await waitFor(() =>
        expect(putSpy).toHaveBeenCalledWith('w1', 'sc1', {
          title: '失踪事件',
          raw: '## 概要',
          recommendedRuleset: null,
          moods: [],
        })
      );
    });
  });

  describe('publish controls', () => {
    beforeEach(() => {
      vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
        { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: 'coc7e' },
        { id: 'sc2', worldId: 'w1', title: '呪われた宝石', recommendedRuleset: null },
      ]);
    });

    it('does not render publish controls or fetch published state when logged out', async () => {
      const publishedSpy = vi.spyOn(shareClient, 'publishedScenarios');
      render(<ScenarioTab worldId="w1" />);
      await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
      expect(screen.queryByText('公開')).not.toBeInTheDocument();
      expect(publishedSpy).not.toHaveBeenCalled();
    });

    it('shows a 公開中 badge for a published scenario and a 公開 button for an unpublished one', async () => {
      vi.spyOn(shareClient, 'publishedScenarios').mockResolvedValue({ sc1: 'pub-sc1' });
      renderWithAuth(<ScenarioTab worldId="w1" />);

      await waitFor(() => expect(shareClient.publishedScenarios).toHaveBeenCalledWith('w1'));
      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      expect(screen.getByText('再公開')).toBeInTheDocument();
      expect(screen.getByText('公開解除')).toBeInTheDocument();
      expect(screen.getAllByText('公開')).toHaveLength(1);
    });

    it('clicking 公開 calls publishScenario with worldId/scenarioId and flips to the badge', async () => {
      vi.spyOn(shareClient, 'publishedScenarios').mockResolvedValue({});
      const publishSpy = vi.spyOn(shareClient, 'publishScenario').mockResolvedValue({ publicId: 'pub-sc1' });
      renderWithAuth(<ScenarioTab worldId="w1" />);

      await waitFor(() => expect(screen.getAllByText('公開')).toHaveLength(2));
      fireEvent.click(screen.getAllByText('公開')[0]);

      await waitFor(() => expect(publishSpy).toHaveBeenCalledWith('w1', 'sc1'));
      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      expect(screen.getAllByText('公開')).toHaveLength(1);
    });

    it('clicking 公開解除 calls unpublishScenario and removes the badge', async () => {
      vi.spyOn(shareClient, 'publishedScenarios').mockResolvedValue({ sc1: 'pub-sc1' });
      const unpublishSpy = vi.spyOn(shareClient, 'unpublishScenario').mockResolvedValue();
      renderWithAuth(<ScenarioTab worldId="w1" />);

      await waitFor(() => expect(screen.getByText('公開中')).toBeInTheDocument());
      fireEvent.click(screen.getByText('公開解除'));

      await waitFor(() => expect(unpublishSpy).toHaveBeenCalledWith('w1', 'sc1'));
      await waitFor(() => expect(screen.queryByText('公開中')).not.toBeInTheDocument());
      expect(screen.getAllByText('公開')).toHaveLength(2);
    });
  });
});
