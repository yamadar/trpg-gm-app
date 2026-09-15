import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderWithAuth } from '../test/renderWithAuth.jsx';
import PartyJoin from './PartyJoin.jsx';
import * as partyClient from '../api/partyClient.js';

describe('PartyJoin', () => {
  it('sends the invite token only in the join body and replaces the tokenized URL', async () => {
    window.location.hash = '#/party/p1/join/secret';
    const join = vi.spyOn(partyClient, 'joinPartySession').mockResolvedValue({ id: 'p1' });
    renderWithAuth(<PartyJoin sessionId="p1" inviteToken="secret" />);
    fireEvent.click(screen.getByText('招待に参加'));
    await waitFor(() => expect(join).toHaveBeenCalledWith('p1', 'secret'));
    await waitFor(() => expect(window.location.hash).toBe('#/party/p1'));
  });
});

it('offers login in the invitation screen before making a join request', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ providers: ['google'] }) }));
  const join = vi.spyOn(partyClient, 'joinPartySession').mockResolvedValue({});
  join.mockClear();
  renderWithAuth(<PartyJoin sessionId="p1" inviteToken="secret" />, { user: null });
  fireEvent.click(screen.getByRole('button', { name: 'ログインして参加' }));
  expect(await screen.findByText('Google でログイン')).toBeInTheDocument();
  expect(join).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
