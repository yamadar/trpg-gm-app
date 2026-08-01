import { apiFetch } from './apiFetch.js';

function path(id, suffix = '') {
  return `/api/party-sessions/${encodeURIComponent(id)}${suffix}`;
}

function json(method, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export const createPartySession = (body) => apiFetch('/api/party-sessions', json('POST', body));
export const listPartySessions = () => apiFetch('/api/party-sessions');
export const getPartySnapshot = (id) => apiFetch(path(id, '/snapshot'));
export const joinPartySession = (id, inviteToken) => apiFetch(path(id, '/join'), json('POST', { inviteToken }));
export const leavePartySession = (id) => apiFetch(path(id, '/leave'), { method: 'POST' });
export const createPartyInvite = (id, options = {}) => apiFetch(path(id, '/invites'), json('POST', options));
export const listPartyInvites = (id) => apiFetch(path(id, '/invites'));
export const revokePartyInvite = (id, inviteId) => apiFetch(path(id, `/invites/${encodeURIComponent(inviteId)}`), { method: 'DELETE' });
export const claimPartyPc = (id, pcId) => apiFetch(path(id, '/claim'), json('POST', { pcId }));
export const startPartySession = (id) => apiFetch(path(id, '/start'), { method: 'POST' });
export const submitPartyIntent = (id, body) => apiFetch(path(id, '/intents'), json('POST', body));
export const updatePartyIntent = (id, intentId, body) => apiFetch(path(id, `/intents/${encodeURIComponent(intentId)}`), json('PATCH', body));
export const deletePartyIntent = (id, intentId) => apiFetch(path(id, `/intents/${encodeURIComponent(intentId)}`), { method: 'DELETE' });
export const readyParty = (id) => apiFetch(path(id, '/ready'), { method: 'POST' });
export const unreadyParty = (id) => apiFetch(path(id, '/ready'), { method: 'DELETE' });
export const heartbeatPartyTyping = (id) => apiFetch(path(id, '/typing'), { method: 'POST' });
export const heartbeatPartyPresence = (id) => apiFetch(path(id, '/presence'), { method: 'POST' });
export const setPartyAway = (id, body) => apiFetch(path(id, '/away'), json('POST', body));
export const returnToParty = (id) => apiFetch(path(id, '/return'), { method: 'POST' });
export const voteParty = (id, optionId) => apiFetch(path(id, '/votes'), json('POST', { optionId }));
export const hostAdvanceParty = (id) => apiFetch(path(id, '/host/advance'), { method: 'POST' });
export const hostPauseParty = (id) => apiFetch(path(id, '/host/pause'), { method: 'POST' });
export const hostResumeParty = (id) => apiFetch(path(id, '/host/resume'), { method: 'POST' });
export const hostEndParty = (id) => apiFetch(path(id, '/host/end'), { method: 'POST' });
export const updatePartyParticipant = (id, userId, body) => apiFetch(path(id, `/host/participants/${encodeURIComponent(userId)}`), json('PATCH', body));
export const getPartyEvents = (id, after = 0) => apiFetch(path(id, `/events?after=${encodeURIComponent(after)}`));
export const getPartyChat = (id, after = 0) => apiFetch(path(id, `/chat?after=${encodeURIComponent(after)}`));
export const sendPartyChat = (id, text, commandId) => apiFetch(path(id, '/chat'), json('POST', { text, commandId }));
