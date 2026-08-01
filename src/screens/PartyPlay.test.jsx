import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PartyPlay from './PartyPlay.jsx';
import * as partyClient from '../api/partyClient.js';

const participants = [
  { userId: 'u1', displayName: 'ホスト', role: 'host', pcId: 'pc1', lobbyReady: false, activity: 'active', awayPolicy: 'follow', connection: 'online', typing: false },
  { userId: 'u2', displayName: '参加者', role: 'player', pcId: 'pc2', lobbyReady: true, activity: 'active', awayPolicy: 'follow', connection: 'online', typing: false },
];
const pcs = [{ id: 'pc1', characterName: 'カイ', raw: '自分のシート' }, { id: 'pc2', characterName: 'ミナ' }];

function snapshot(overrides = {}) {
  return {
    id: 'p1', title: '二人の遺跡', status: 'playing', settings: {},
    participants, pcs, me: { userId: 'u1', role: 'host', pcId: 'pc1' },
    round: { id: 'round_1', number: 1, phase: 'collecting', deadlineAt: Date.now() + 90000, lockAt: null, intents: [], readyUserIds: [], decision: null, error: null },
    snapshot: { narratives: [{ id: 'n1', text: '石の扉が開く。', audience: { kind: 'all', ids: [] } }], choicesByPc: { pc1: ['中へ進む'] } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(partyClient, 'getPartyChat').mockResolvedValue({ messages: [], nextSeq: 0 });
});

describe('PartyPlay', () => {
  it('shows a PC-view narrative, shares an action, typing heartbeat and ready state', async () => {
    let current = snapshot();
    vi.spyOn(partyClient, 'getPartySnapshot').mockImplementation(async () => current);
    const typing = vi.spyOn(partyClient, 'heartbeatPartyTyping').mockResolvedValue({});
    const submit = vi.spyOn(partyClient, 'submitPartyIntent').mockImplementation(async (_id, body) => {
      const intent = { id: 'intent_round_1_pc1', pcId: 'pc1', characterName: 'カイ', text: body.text, source: 'human' };
      current = { ...current, round: { ...current.round, intents: [intent] } };
      return intent;
    });
    const ready = vi.spyOn(partyClient, 'readyParty').mockResolvedValue({});
    render(<PartyPlay sessionId="p1" />);

    expect(await screen.findByText('石の扉が開く。')).toBeInTheDocument();
    expect(screen.getByText('カイ視点')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('自分の行動'), { target: { value: '罠を調べる' } });
    expect(typing).toHaveBeenCalledWith('p1');
    fireEvent.click(screen.getByText('行動を共有'));
    await waitFor(() => expect(submit).toHaveBeenCalledWith('p1', expect.objectContaining({ text: '罠を調べる' })));
    await waitFor(() => expect(
      screen.getAllByText(/罠を調べる/).some((element) => element.tagName === 'DIV'),
    ).toBe(true));
    fireEvent.click(await screen.findByText('この行動で確定'));
    await waitFor(() => expect(ready).toHaveBeenCalledWith('p1'));
  });

  it('renders lobby PC assignment and host invite controls', async () => {
    const lobby = snapshot({ status: 'lobby', round: null, snapshot: { narratives: [], choicesByPc: {} } });
    vi.spyOn(partyClient, 'getPartySnapshot').mockResolvedValue(lobby);
    const claim = vi.spyOn(partyClient, 'claimPartyPc').mockResolvedValue({});
    const invite = vi.spyOn(partyClient, 'createPartyInvite').mockResolvedValue({ inviteToken: 'token1' });
    render(<PartyPlay sessionId="p1" />);
    fireEvent.click(await screen.findByText(/カイ — ホスト/));
    await waitFor(() => expect(claim).toHaveBeenCalledWith('p1', 'pc1'));
    fireEvent.click(screen.getByText('招待URLを発行'));
    await waitFor(() => expect(invite).toHaveBeenCalledWith('p1'));
    expect((await screen.findByLabelText('招待URL')).value).toContain('#/party/p1/join/token1');
  });

  it('keeps Party chat on its own endpoint', async () => {
    vi.spyOn(partyClient, 'getPartySnapshot').mockResolvedValue(snapshot());
    const send = vi.spyOn(partyClient, 'sendPartyChat').mockResolvedValue({});
    render(<PartyPlay sessionId="p1" />);
    fireEvent.change(await screen.findByLabelText('Partyチャット'), { target: { value: '北へ行こう' } });
    fireEvent.click(screen.getByText('送信'));
    await waitFor(() => expect(send).toHaveBeenCalledWith('p1', '北へ行こう', expect.stringMatching(/^chat_/)));
    expect(screen.getByText('相談内容はAI GMへ送られない。')).toBeInTheDocument();
  });
});
