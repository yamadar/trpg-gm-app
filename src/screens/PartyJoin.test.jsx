import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PartyJoin from './PartyJoin.jsx';
import * as partyClient from '../api/partyClient.js';

describe('PartyJoin', () => {
  it('sends the invite token only in the join body and replaces the tokenized URL', async () => {
    window.location.hash = '#/party/p1/join/secret';
    const join = vi.spyOn(partyClient, 'joinPartySession').mockResolvedValue({ id: 'p1' });
    render(<PartyJoin sessionId="p1" inviteToken="secret" />);
    fireEvent.click(screen.getByText('招待に参加'));
    await waitFor(() => expect(join).toHaveBeenCalledWith('p1', 'secret'));
    await waitFor(() => expect(window.location.hash).toBe('#/party/p1'));
  });
});
