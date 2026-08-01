// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  appendPartyChat,
  appendPartyEvent,
  MAX_STORED_PARTY_CHAT_MESSAGES,
  MAX_STORED_PARTY_EVENTS,
  MAX_STORED_PARTY_ROUNDS,
  listPartyChat,
  savePartyRound,
} from './partyLibrary.js';
import { partyChatKey, partyEventKey, partyRoundKey } from './paths.js';

function store() {
  return { set: vi.fn().mockResolvedValue(), delete: vi.fn().mockResolvedValue() };
}

describe('party storage retention', () => {
  it('removes the oldest event after the event retention window', async () => {
    const dataStore = store();
    const session = { id: 'party_1', eventSeq: MAX_STORED_PARTY_EVENTS };
    await appendPartyEvent(dataStore, session, { type: 'test', createdAt: 1 });
    expect(dataStore.delete).toHaveBeenCalledWith(partyEventKey('party_1', 1));
  });

  it('removes the oldest chat message after the chat retention window', async () => {
    const dataStore = store();
    const session = { id: 'party_1', chatSeq: MAX_STORED_PARTY_CHAT_MESSAGES };
    await appendPartyChat(dataStore, session, { text: 'x', createdAt: 1 });
    expect(dataStore.delete).toHaveBeenCalledWith(partyChatKey('party_1', 1));
  });

  it('removes the oldest completed round after the round retention window', async () => {
    const dataStore = store();
    await savePartyRound(dataStore, 'party_1', {
      id: `round_${MAX_STORED_PARTY_ROUNDS}`,
      number: MAX_STORED_PARTY_ROUNDS,
    });
    expect(dataStore.delete).toHaveBeenCalledWith(partyRoundKey('party_1', 'round_0'));
  });

  it('reads only chat files newer than the requested sequence', async () => {
    const keys = [1, 2, 3].map((seq) => partyChatKey('party_1', seq));
    const dataStore = {
      list: vi.fn().mockResolvedValue(keys),
      get: vi.fn().mockImplementation(async (key) => {
        const seq = Number(key.slice(key.lastIndexOf('/') + 1));
        return { id: `chat_${seq}`, seq };
      }),
    };

    await expect(listPartyChat(dataStore, 'party_1', 1)).resolves.toEqual([
      { id: 'chat_2', seq: 2 },
      { id: 'chat_3', seq: 3 },
    ]);
    expect(dataStore.get).not.toHaveBeenCalledWith(keys[0]);
    expect(dataStore.get).toHaveBeenCalledTimes(2);
  });
});
