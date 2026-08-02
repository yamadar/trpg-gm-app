import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PartySetup from './PartySetup.jsx';
import * as worldClient from '../api/worldLibraryClient.js';
import * as scenarioClient from '../api/scenarioLibraryClient.js';
import * as characterClient from '../api/characterLibraryClient.js';
import * as rulesetClient from '../api/rulesetLibraryClient.js';
import * as partyClient from '../api/partyClient.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(worldClient, 'listWorlds').mockResolvedValue([{ id: 'w1', title: '遺跡世界' }]);
  vi.spyOn(worldClient, 'getWorld').mockResolvedValue({ id: 'w1', title: '遺跡世界', raw: 'World原文', moods: [] });
  vi.spyOn(scenarioClient, 'listScenarios').mockResolvedValue([{ id: 's1', title: '石の扉' }]);
  vi.spyOn(scenarioClient, 'getScenario').mockResolvedValue({ id: 's1', title: '石の扉', raw: 'Scenario原文', directorGuide: { secrets: ['扉'] } });
  vi.spyOn(characterClient, 'listCharacters').mockResolvedValue([
    { name: 'pc1', characterName: 'カイ' },
    { name: 'pc2', characterName: 'ミナ' },
  ]);
  vi.spyOn(characterClient, 'getCharacter').mockImplementation(async (_world, _kind, name) => ({
    name, characterName: name === 'pc1' ? 'カイ' : 'ミナ', raw: `${name}シート`, parsed: {},
  }));
  vi.spyOn(rulesetClient, 'listRulesets').mockResolvedValue([]);
});

describe('PartySetup', () => {
  it('snapshots selected world, scenario, ruleset and two PCs into a Party room', async () => {
    const createSpy = vi.spyOn(partyClient, 'createPartySession').mockResolvedValue({ id: 'party1' });
    const onCreated = vi.fn();
    render(<PartySetup onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('セッション名'), { target: { value: '二人の遺跡' } });
    fireEvent.change(await screen.findByLabelText('World'), { target: { value: 'w1' } });
    fireEvent.change(await screen.findByLabelText('Scenario'), { target: { value: 's1' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'カイ' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'ミナ' }));
    fireEvent.click(screen.getByText('ロビーを作成'));

    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    expect(createSpy.mock.calls[0][0]).toMatchObject({
      title: '二人の遺跡', worldId: 'w1',
      pcs: [{ id: 'pc1', characterName: 'カイ', raw: 'pc1シート' }, { id: 'pc2', characterName: 'ミナ', raw: 'pc2シート' }],
      gmSnapshot: {
        world: { raw: 'World原文' },
        scenario: { raw: 'Scenario原文' },
        ruleset: { id: 'simple', formula: 'simple', resourceDefs: [] },
      },
    });
    expect(onCreated).toHaveBeenCalledWith('party1');
  });

  it('requires two PCs before creating', async () => {
    const createSpy = vi.spyOn(partyClient, 'createPartySession').mockResolvedValue({ id: 'party1' });
    render(<PartySetup />);
    fireEvent.change(screen.getByLabelText('セッション名'), { target: { value: '卓' } });
    fireEvent.click(screen.getByText('ロビーを作成'));
    expect(await screen.findByText(/2人以上のPC/)).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('uses Campaign world, generated scenario and carried PCs as initial context', async () => {
    const createSpy = vi.spyOn(partyClient, 'createPartySession').mockResolvedValue({ id: 'party-campaign' });
    const initialContext = {
      worldId: 'w1',
      campaignId: 'cp1',
      title: '灰の密使',
      rulesetId: 'simple',
      world: { id: 'w1', title: '遺跡世界', raw: '正史反映済みWorld', moods: ['シリアス'] },
      scenario: { id: 'gray-envoy', title: '灰の密使', raw: '生成Scenario' },
      pcs: [
        { id: 'carry1', characterName: 'カイ', raw: '剣士\nXP: 4', xp: 4 },
        { id: 'carry2', characterName: 'ミナ', raw: '学者\nXP: 7', xp: 7 },
      ],
    };
    render(<PartySetup initialContext={initialContext} />);

    expect(screen.getByLabelText('セッション名')).toHaveValue('灰の密使');
    expect(await screen.findByRole('checkbox', { name: 'カイ' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'ミナ' })).toBeChecked();
    fireEvent.click(screen.getByText('ロビーを作成'));

    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    expect(createSpy.mock.calls[0][0]).toMatchObject({
      title: '灰の密使',
      worldId: 'w1',
      campaignId: 'cp1',
      pcs: [
        { id: 'carry1', characterName: 'カイ', raw: '剣士\nXP: 4' },
        { id: 'carry2', characterName: 'ミナ', raw: '学者\nXP: 7' },
      ],
      gmSnapshot: {
        world: { raw: '正史反映済みWorld' },
        scenario: { id: 'gray-envoy', raw: '生成Scenario' },
      },
    });
  });
});
