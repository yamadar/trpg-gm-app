import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import RulesetTab from './RulesetTab.jsx';
import * as rulesetLibraryClient from '../../api/rulesetLibraryClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('RulesetTab', () => {
  it('lists rulesets on mount', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([
      { id: 'homebrew', label: '自作ルール', desc: '独自ルール', hint: '' },
    ]);
    render(<RulesetTab />);
    await waitFor(() => expect(screen.getByText('自作ルール')).toBeInTheDocument());
  });

  it('creates a new ruleset via putRuleset', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([]);
    const putSpy = vi.spyOn(rulesetLibraryClient, 'putRuleset').mockResolvedValue({});
    render(<RulesetTab />);
    await waitFor(() => expect(rulesetLibraryClient.listRulesets).toHaveBeenCalled());

    fireEvent.click(screen.getByText('+ 新規Ruleset'));
    fireEvent.change(screen.getByPlaceholderText('例: homebrew'), { target: { value: 'homebrew' } });
    fireEvent.change(screen.getByPlaceholderText('ラベル'), { target: { value: '自作ルール' } });
    fireEvent.change(screen.getByPlaceholderText('説明'), { target: { value: '独自ルール' } });
    fireEvent.click(screen.getByText('作成する'));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('homebrew', { label: '自作ルール', desc: '独自ルール', hint: '' })
    );
  });

  it('deletes a ruleset after confirmation', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([
      { id: 'homebrew', label: '自作ルール', desc: '独自ルール', hint: '' },
    ]);
    vi.spyOn(rulesetLibraryClient, 'getRuleset').mockResolvedValue({
      label: '自作ルール',
      desc: '独自ルール',
      hint: '',
    });
    const deleteSpy = vi.spyOn(rulesetLibraryClient, 'deleteRuleset').mockResolvedValue();

    render(<RulesetTab />);
    await waitFor(() => expect(screen.getByText('自作ルール')).toBeInTheDocument());
    fireEvent.click(screen.getByText('自作ルール'));
    await waitFor(() => expect(screen.getByText('削除')).toBeInTheDocument());
    fireEvent.click(screen.getByText('削除'));
    fireEvent.click(screen.getByText('削除する'));

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('homebrew'));
  });

  it('ignores a stale getRuleset response when selection changes before it resolves', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([
      { id: 'ruleA', label: 'ルールA', desc: '説明A', hint: '' },
      { id: 'ruleB', label: 'ルールB', desc: '説明B', hint: '' },
    ]);

    let resolveA;
    const promiseA = new Promise((resolve) => {
      resolveA = resolve;
    });
    const getSpy = vi.spyOn(rulesetLibraryClient, 'getRuleset').mockImplementation((id) => {
      if (id === 'ruleA') return promiseA;
      if (id === 'ruleB') return Promise.resolve({ label: 'ルールB', desc: '説明B', hint: 'Bのヒント本文' });
      return Promise.reject(new Error('unexpected id: ' + id));
    });

    render(<RulesetTab />);
    await waitFor(() => expect(screen.getByText('ルールA')).toBeInTheDocument());

    fireEvent.click(screen.getByText('ルールA'));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('ruleA'));

    fireEvent.click(screen.getByText('ルールB'));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith('ruleB'));
    await waitFor(() => expect(screen.getByDisplayValue('Bのヒント本文')).toBeInTheDocument());

    await act(async () => {
      resolveA({ label: 'ルールA', desc: '説明A', hint: 'Aのヒント本文(stale)' });
      await promiseA;
    });

    expect(screen.getByDisplayValue('Bのヒント本文')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Aのヒント本文(stale)')).not.toBeInTheDocument();
  });
});
