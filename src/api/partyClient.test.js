import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPartySession,
  getPartySnapshot,
  joinPartySession,
  submitPartyIntent,
  readyParty,
  setPartyAway,
  sendPartyChat,
  voteParty,
} from './partyClient.js';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) }));
});

describe('partyClient', () => {
  it('creates and reads Party sessions', async () => {
    await createPartySession({ title: '卓' });
    expect(fetch).toHaveBeenLastCalledWith('/api/party-sessions', expect.objectContaining({ method: 'POST', body: '{"title":"卓"}' }));
    await getPartySnapshot('party a');
    expect(fetch).toHaveBeenLastCalledWith('/api/party-sessions/party%20a/snapshot', undefined);
  });

  it('sends join, intent, ready, away, vote and chat as separate commands', async () => {
    await joinPartySession('p1', 'secret');
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({ inviteToken: 'secret' });
    await submitPartyIntent('p1', { text: '進む', commandId: 'c1' });
    expect(fetch.mock.calls.at(-1)[0]).toBe('/api/party-sessions/p1/intents');
    await readyParty('p1');
    expect(fetch.mock.calls.at(-1)[1].method).toBe('POST');
    await setPartyAway('p1', { policy: 'follow' });
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({ policy: 'follow' });
    await voteParty('p1', 'option_1');
    expect(JSON.parse(fetch.mock.calls.at(-1)[1].body)).toEqual({ optionId: 'option_1' });
    await sendPartyChat('p1', '相談', 'chat1');
    expect(fetch.mock.calls.at(-1)[0]).toBe('/api/party-sessions/p1/chat');
  });
});
