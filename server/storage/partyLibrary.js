import crypto from 'node:crypto';
import {
  partySessionKey,
  partySnapshotKey,
  partyRoundKey,
  partyEventKey,
  partyEventListPrefix,
  partyChatKey,
  partyChatListPrefix,
  partyInviteKey,
  partyInviteListPrefix,
  partyMembershipKey,
  partyMembershipListPrefix,
} from './paths.js';

export function hashInviteToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export async function savePartySession(dataStore, session) {
  await dataStore.set(partySessionKey(session.id), session);
  return session;
}

export async function getPartySession(dataStore, sessionId) {
  return dataStore.get(partySessionKey(sessionId));
}

export async function savePartySnapshot(dataStore, sessionId, snapshot) {
  await dataStore.set(partySnapshotKey(sessionId), snapshot);
  return snapshot;
}

export async function getPartySnapshot(dataStore, sessionId) {
  return dataStore.get(partySnapshotKey(sessionId));
}

export async function savePartyRound(dataStore, sessionId, round) {
  await dataStore.set(partyRoundKey(sessionId, round.id), round);
  return round;
}

export async function getPartyRound(dataStore, sessionId, roundId) {
  if (!roundId) return null;
  return dataStore.get(partyRoundKey(sessionId, roundId));
}

export async function savePartyMembership(dataStore, userId, session) {
  const membership = {
    sessionId: session.id,
    title: session.title,
    ownerId: session.ownerId,
    status: session.status,
    worldId: session.worldId || null,
    campaignId: session.campaignId || null,
    updatedAt: session.updatedAt,
  };
  await dataStore.set(partyMembershipKey(userId, session.id), membership);
  return membership;
}

export async function listPartyMemberships(dataStore, userId) {
  const keys = await dataStore.list(partyMembershipListPrefix(userId));
  const values = await Promise.all(keys.map((key) => dataStore.get(key)));
  return values.filter(Boolean).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function deletePartyMembership(dataStore, userId, sessionId) {
  await dataStore.delete(partyMembershipKey(userId, sessionId));
}

export async function appendPartyEvent(dataStore, session, event, snapshot = null) {
  const seq = (session.eventSeq || 0) + 1;
  const saved = {
    seq,
    id: event.id || `event_${session.id}_${seq}`,
    sessionId: session.id,
    audience: event.audience || { kind: 'all', ids: [] },
    createdAt: event.createdAt || Date.now(),
    ...event,
  };
  // eventが真実源。snapshot/sessionより先に保存する。
  await dataStore.set(partyEventKey(session.id, seq), saved);
  if (snapshot) {
    snapshot.lastEventSeq = seq;
    await savePartySnapshot(dataStore, session.id, snapshot);
  }
  session.eventSeq = seq;
  session.updatedAt = saved.createdAt;
  await savePartySession(dataStore, session);
  return saved;
}

export async function listPartyEvents(dataStore, sessionId, after = 0) {
  const keys = await dataStore.list(partyEventListPrefix(sessionId));
  const values = await Promise.all(keys.map((key) => dataStore.get(key)));
  return values
    .filter((event) => event && event.seq > after)
    .sort((a, b) => a.seq - b.seq);
}

export async function appendPartyChat(dataStore, session, message) {
  const seq = (session.chatSeq || 0) + 1;
  const saved = { ...message, id: `chat_${session.id}_${seq}`, seq };
  await dataStore.set(partyChatKey(session.id, seq), saved);
  session.chatSeq = seq;
  session.updatedAt = message.createdAt;
  await savePartySession(dataStore, session);
  return saved;
}

export async function listPartyChat(dataStore, sessionId, after = 0) {
  const keys = await dataStore.list(partyChatListPrefix(sessionId));
  const values = await Promise.all(keys.map((key) => dataStore.get(key)));
  return values
    .filter((message) => message && message.seq > after)
    .sort((a, b) => a.seq - b.seq);
}

export async function savePartyInvite(dataStore, sessionId, invite) {
  await dataStore.set(partyInviteKey(sessionId, invite.id), invite);
  return invite;
}

export async function listPartyInvites(dataStore, sessionId) {
  const keys = await dataStore.list(partyInviteListPrefix(sessionId));
  const values = await Promise.all(keys.map((key) => dataStore.get(key)));
  return values.filter(Boolean);
}

export async function findPartyInvite(dataStore, sessionId, token) {
  const hash = hashInviteToken(token);
  const invites = await listPartyInvites(dataStore, sessionId);
  return invites.find((invite) => invite.tokenHash === hash) || null;
}

export async function deletePartyInvite(dataStore, sessionId, inviteId) {
  await dataStore.delete(partyInviteKey(sessionId, inviteId));
}
