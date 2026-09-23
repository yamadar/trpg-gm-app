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
  vi.unstubAllGlobals();
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
    await waitFor(() => expect(submit).toHaveBeenLastCalledWith('p1', expect.objectContaining({ text: '罠を調べる', roundId: 'round_1', ready: true })));
    expect(ready).not.toHaveBeenCalled();
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

  it('polls Party chat after the last sequence and appends only new messages', async () => {
    vi.spyOn(partyClient, 'getPartySnapshot').mockResolvedValue(snapshot());
    const chatFetch = vi.mocked(partyClient.getPartyChat);
    chatFetch
      .mockResolvedValueOnce({
        messages: [{ id: 'chat_1', seq: 1, displayName: 'ホスト', text: '最初の相談' }],
        nextSeq: 1,
      })
      .mockResolvedValueOnce({
        messages: [{ id: 'chat_2', seq: 2, displayName: '参加者', text: '次の相談' }],
        nextSeq: 2,
      });
    vi.spyOn(partyClient, 'sendPartyChat').mockResolvedValue({});

    render(<PartyPlay sessionId="p1" />);
    expect(await screen.findByText(/最初の相談/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Partyチャット'), { target: { value: '送信して更新' } });
    fireEvent.click(screen.getByText('送信'));

    expect(await screen.findByText(/次の相談/)).toBeInTheDocument();
    expect(screen.getByText(/最初の相談/)).toBeInTheDocument();
    expect(chatFetch).toHaveBeenNthCalledWith(1, 'p1', 0);
    expect(chatFetch).toHaveBeenNthCalledWith(2, 'p1', 1);
  });

  it('keeps only the latest 500 chat messages in the DOM', async () => {
    vi.spyOn(partyClient, 'getPartySnapshot').mockResolvedValue(snapshot());
    const messages = Array.from({ length: 501 }, (_, index) => ({
      id: `chat_${index + 1}`,
      seq: index + 1,
      displayName: 'ホスト',
      text: index === 0 ? 'OLDEST_CHAT_SENTINEL' : index === 500 ? 'LATEST_CHAT_SENTINEL' : `相談${index + 1}`,
    }));
    vi.mocked(partyClient.getPartyChat).mockResolvedValue({ messages, nextSeq: 501 });

    render(<PartyPlay sessionId="p1" />);
    expect(await screen.findByText(/LATEST_CHAT_SENTINEL/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('OLDEST_CHAT_SENTINEL');
  });
});

it('renders GM progress below the story with goals and an own character sheet, without a zero countdown', async () => {
  const current = snapshot();
  vi.spyOn(partyClient, 'getPartySnapshot').mockResolvedValue({ ...current,
    sharedGoal: '皆で帰路を探す', pcs: [{ ...pcs[0], goal: '失われた剣を探す' }, pcs[1]],
    round: { ...current.round, phase: 'resolving', lockAt: Date.now() - 1000, deadlineAt: Date.now() - 1000, resolutionStartedAt: Date.now() - 5000, progress: 'narrating' },
  });
  render(<PartyPlay sessionId="p1" />);
  const progress = await screen.findByText('判定完了・あなたの場面を描写中…');
  const story = screen.getByText('石の扉が開く。');
  expect(story.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText('0秒')).toBeNull();
  expect(screen.getByText('皆で帰路を探す')).toBeInTheDocument();
  expect(screen.getByText('失われた剣を探す')).toBeInTheDocument();
  fireEvent.click(screen.getByText('キャラクターシート：カイ'));
  expect(screen.getByText('自分のシート')).toBeVisible();
});

it('updates the GM state even while chat is stuck, and retains a failed draft within the round and clears it in the next round', async () => {
  let current = snapshot();
  vi.mocked(partyClient.getPartyChat).mockReturnValue(new Promise(() => {}));
  vi.spyOn(partyClient, 'getPartySnapshot').mockImplementation(async () => current);
  vi.spyOn(partyClient, 'submitPartyIntent').mockImplementation(async () => {
    current = { ...current, eventSeq: 2, round: { ...current.round, phase: 'resolving' } };
    throw Object.assign(new Error('行動受付は終了した'), { status: 409 });
  });
  render(<PartyPlay sessionId="p1" />);
  fireEvent.change(await screen.findByLabelText('自分の行動'), { target: { value: '失いたくない下書き' } });
  fireEvent.click(screen.getByText('この行動で確定'));
  expect(await screen.findByText('全員の行動を一度に解決中…')).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('行動受付は終了した');
  current = { ...current, eventSeq: 3, round: { ...current.round, id: 'round_2', phase: 'collecting' } };
  expect(await screen.findByLabelText('自分の行動', {}, { timeout: 2000 })).toHaveValue('');
});

it('reduces polling while hidden and preserves the screen on unchanged responses', async () => {
  const { act } = await import('@testing-library/react');
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const fetch = vi.spyOn(partyClient, 'getPartySnapshot').mockResolvedValueOnce(snapshot({ version: 'v1' })).mockResolvedValue({ unchanged: true, version: 'v1', serverNow: Date.now() });
  const view = render(<PartyPlay sessionId="p1" />);
  try {
    await act(async () => {});
    expect(screen.getByText('石の扉が開く。')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetch).toHaveBeenLastCalledWith('p1', 'v1');
    expect(screen.getByText('石の扉が開く。')).toBeInTheDocument();
    visibility.mockReturnValue('hidden');
    const count = fetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(14000); });
    expect(fetch).toHaveBeenCalledTimes(count);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetch).toHaveBeenCalledTimes(count + 1);
    visibility.mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(fetch).toHaveBeenCalledTimes(count + 2);
  } finally { view.unmount(); vi.useRealTimers(); visibility.mockRestore(); }
});


it('restores the current submitted action but clears edits when the round changes', async () => {
  let current = snapshot();
  current.round.intents = [{ id: 'i1', pcId: 'pc1', source: 'human', text: '共有済み' }];
  vi.spyOn(partyClient, 'getPartySnapshot').mockImplementation(async () => current);
  vi.spyOn(partyClient, 'heartbeatPartyTyping').mockResolvedValue({});
  render(<PartyPlay sessionId="p1" />);
  expect(await screen.findByLabelText('自分の行動')).toHaveValue('共有済み');
  fireEvent.change(screen.getByLabelText('自分の行動'), { target: { value: '前ラウンドの編集' } });
  current = { ...current, eventSeq: 2, round: { ...current.round, id: 'round_2', intents: [] } };
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(screen.getByLabelText('自分の行動')).toHaveValue(''));
});

it('shows historical PC actions before the matching GM response', async () => {
  const current = snapshot();
  current.snapshot.narratives.push({ id: 'n2', roundId: 'round_1', text: '扉の先へ進んだ。' });
  current.snapshot.actionHistory = [{ roundId: 'round_1', number: 1, intents: [
    { id: 'i1', characterName: 'カイ', text: '扉を押す', source: 'human' },
    { id: 'i2', characterName: 'ミナ', text: '周囲を見張る', source: 'auto' },
  ] }];
  vi.spyOn(partyClient, 'getPartySnapshot').mockResolvedValue(current);
  render(<PartyPlay sessionId="p1" />);
  const actions = await screen.findByRole('region', { name: 'ラウンド1の行動' });
  expect(actions).toHaveTextContent('扉を押す');
  expect(actions).toHaveTextContent('ミナ（自動行動）');
  expect(actions.compareDocumentPosition(screen.getByText('扉の先へ進んだ。')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('restores mobile tab positions and opens a new GM scene only on new narration', async () => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const sceneScroll = vi.spyOn(Element.prototype, 'scrollIntoView');
  const position = vi.spyOn(window, 'scrollY', 'get').mockReturnValue(420);
  let current = snapshot();
  vi.spyOn(partyClient, 'getPartySnapshot').mockImplementation(async () => current);
  render(<PartyPlay sessionId="p1" />);
  await screen.findByText('石の扉が開く。');
  const actionTab = screen.getByRole('button', { name: '行動', exact: true });
  const storyTab = screen.getByRole('button', { name: '物語', exact: true });
  fireEvent.click(actionTab);
  expect(scroll).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
  position.mockReturnValue(80);
  fireEvent.click(storyTab);
  expect(scroll).toHaveBeenLastCalledWith({ top: 420, behavior: 'instant' });
  fireEvent.click(actionTab);
  current = { ...current, eventSeq: 2 };
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(actionTab).toHaveAttribute('aria-pressed', 'true'));
  current = { ...current, eventSeq: 3, snapshot: { ...current.snapshot, narratives: [...current.snapshot.narratives, { id: 'n2', text: '新しい場面' }] } };
  fireEvent(document, new Event('visibilitychange'));
  expect(await screen.findByText('新しい場面')).toBeVisible();
  expect(storyTab).toHaveAttribute('aria-pressed', 'true');
  expect(sceneScroll).toHaveBeenCalledWith({ block: 'start' });
});
