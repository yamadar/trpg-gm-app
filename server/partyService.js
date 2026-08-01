import crypto from 'node:crypto';
import {
  appendPartyChat,
  appendPartyEvent,
  deletePartyInvite,
  deletePartyMembership,
  findPartyInvite,
  getPartyRound,
  getPartySession,
  getPartySnapshot,
  hashInviteToken,
  listPartyChat,
  listPartyEvents,
  listPartyInvites,
  listPartyMemberships,
  savePartyInvite,
  savePartyMembership,
  savePartyRound,
  savePartySession,
  savePartySnapshot,
} from './storage/partyLibrary.js';
import { sessionKey } from './storage/paths.js';
import { getCampaign, saveCampaign } from './storage/campaignLibrary.js';
import {
  activePartyParticipants,
  applyPartyResolution,
  canReadAudience,
  createPartySnapshot,
  normalizePartySettings,
  PARTY_AWAY_POLICIES,
  projectPartySession,
  validatePartyResolution,
} from './partyState.js';

const SAFE_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const ONLINE_MS = 15_000;
const OFFLINE_MS = 45_000;
const TYPING_MS = 6_000;
const LOCK_GRACE_MS = 5_000;
const TYPING_EXTENSION_MS = 15_000;
const MAX_TYPING_EXTENSION_MS = 90_000;

function partyError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function safeId(value, fallback) {
  const text = String(value || '');
  return text !== '.' && text !== '..' && SAFE_ID_RE.test(text) ? text : fallback;
}

function randomId(prefix, size = 8) {
  return `${prefix}_${crypto.randomBytes(size).toString('hex')}`;
}

function exportedPartyLog(events, narratives) {
  const narrativesByRound = new Map();
  for (const narrative of narratives || []) {
    const items = narrativesByRound.get(narrative.roundId) || [];
    items.push(narrative);
    narrativesByRound.set(narrative.roundId, items);
  }
  const log = [];
  for (const event of events) {
    if (event.type === 'decision_resolved' && event.payload?.option) {
      log.push({
        role: 'gm',
        text: `Party投票結果: ${event.payload.option.label || event.payload.option.id}`,
        roundId: event.roundId,
      });
    }
    if (event.type !== 'round_resolved') continue;
    const checksByPc = new Map((event.payload?.checks || []).map((check) => [check.pcId, check]));
    for (const intent of event.payload?.intents || []) {
      log.push({
        role: 'player',
        source: intent.source || 'human',
        pcId: intent.pcId,
        characterName: intent.characterName,
        text: intent.text,
        reason: intent.reason || '',
        roundId: event.roundId,
        ...(checksByPc.has(intent.pcId) ? { roll: checksByPc.get(intent.pcId) } : {}),
      });
    }
    for (const narrative of narrativesByRound.get(event.roundId) || []) {
      log.push({
        role: 'gm',
        text: narrative.text,
        audience: narrative.audience,
        roundId: event.roundId,
      });
    }
  }
  return log;
}

function participantOf(session, userId) {
  return session.participants.find((item) => item.userId === userId) || null;
}

function ensureMember(session, userId) {
  const participant = participantOf(session, userId);
  if (!participant) throw partyError(403, 'party membership required', 'NOT_MEMBER');
  return participant;
}

function ensureHost(session, userId) {
  const participant = ensureMember(session, userId);
  if (participant.role !== 'host') throw partyError(403, 'host permission required', 'HOST_REQUIRED');
  return participant;
}

function pcName(session, pcId) {
  return session.pcs.find((pc) => pc.id === pcId)?.characterName || pcId;
}

function newRound(session, number, now) {
  const timeout = session.settings.actionTimeoutSeconds * 1000;
  return {
    id: `round_${number}`,
    number,
    phase: 'collecting',
    basedOnStateRevision: session.stateRevision || 0,
    deadlineAt: now + timeout,
    baseDeadlineAt: now + timeout,
    maxDeadlineAt: now + timeout + MAX_TYPING_EXTENSION_MS,
    lockAt: null,
    intents: [],
    readyUserIds: [],
    decision: null,
    resolutionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function autoIntent(session, participant, round, reason, timestamp) {
  const policy = participant.awayPolicy || session.settings.defaultAwayPolicy;
  const text = policy === 'wait'
    ? '安全な場所で待機し、状況が変わるまで危険な決断を避ける'
    : '自分の安全を確保しながら仲間へ防御・警戒・援護を行う';
  return {
    id: `intent_${round.id}_${participant.pcId}`,
    userId: participant.userId,
    pcId: participant.pcId,
    characterName: pcName(session, participant.pcId),
    text,
    source: 'auto',
    reason,
    submittedAt: timestamp,
  };
}

async function consumeUsage(usage, userId) {
  if (!usage) return;
  const result = await usage.consume(userId, 'messages');
  if (!result.ok) {
    const error = partyError(429, 'daily limit reached', 'DAILY_LIMIT');
    error.resetAt = result.resetAt;
    throw error;
  }
}

export function createPartyService({
  dataStore,
  generator = null,
  usage = null,
  now = Date.now,
  randomToken = () => crypto.randomBytes(24).toString('base64url'),
}) {
  const locks = new Map();
  const presence = new Map();
  const typing = new Map();
  const chatRate = new Map();

  async function withLock(sessionId, operation) {
    const previous = locks.get(sessionId) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    locks.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (locks.get(sessionId) === current) locks.delete(sessionId);
    }
  }

  function touchPresence(sessionId, userId) {
    presence.set(`${sessionId}/${userId}`, now());
  }

  function connectionOf(sessionId, participant) {
    const seen = presence.get(`${sessionId}/${participant.userId}`) ?? participant.lastSeenAt ?? 0;
    const age = now() - seen;
    if (age <= ONLINE_MS) return 'online';
    if (age <= OFFLINE_MS) return 'reconnecting';
    return 'offline';
  }

  function typingOf(sessionId, userId) {
    return now() - (typing.get(`${sessionId}/${userId}`) || 0) <= TYPING_MS;
  }

  async function load(sessionId) {
    const session = await getPartySession(dataStore, sessionId);
    if (!session) throw partyError(404, 'party session not found', 'PARTY_NOT_FOUND');
    const [snapshot, round] = await Promise.all([
      getPartySnapshot(dataStore, sessionId),
      getPartyRound(dataStore, sessionId, session.currentRoundId),
    ]);
    return { session, snapshot, round };
  }

  function projection(data, userId) {
    return projectPartySession({
      ...data,
      userId,
      connectionOf: (id) => {
        const participant = participantOf(data.session, id);
        return participant ? connectionOf(data.session.id, participant) : 'offline';
      },
      typingOf: (id) => typingOf(data.session.id, id),
      serverNow: now(),
    });
  }

  async function syncMemberships(session) {
    await Promise.all(session.participants.map((item) => savePartyMembership(dataStore, item.userId, session)));
  }

  async function record(data, event) {
    await appendPartyEvent(dataStore, data.session, { ...event, createdAt: now() }, data.snapshot);
    if (data.round) await savePartyRound(dataStore, data.session.id, data.round);
    await syncMemberships(data.session);
  }

  function active(data) {
    return activePartyParticipants(data.session, (userId) => {
      const participant = participantOf(data.session, userId);
      return connectionOf(data.session.id, participant);
    });
  }

  function lockRound(data, reason) {
    const human = data.round.intents.filter((intent) => intent.source !== 'auto');
    if (human.length === 0) {
      data.round.phase = 'paused';
      data.round.error = '全員無反応のため進行を停止した';
      data.session.status = 'paused';
      return { paused: true };
    }
    const intents = [...data.round.intents];
    for (const participant of data.session.participants) {
      if (!participant.pcId || intents.some((intent) => intent.pcId === participant.pcId)) continue;
      intents.push(autoIntent(data.session, participant, data.round, reason, now()));
      if (participant.activity !== 'away_manual' && participant.activity !== 'away_auto') {
        participant.consecutiveMisses = (participant.consecutiveMisses || 0) + 1;
        if (participant.consecutiveMisses >= 2) participant.activity = 'away_auto';
      }
    }
    data.round.phase = 'resolving';
    data.round.resolutionId ||= randomId('resolution');
    data.round.resolutionIntents = intents;
    data.round.lockAt = now();
    data.round.updatedAt = now();
    return {
      job: {
        sessionId: data.session.id,
        roundId: data.round.id,
        resolutionId: data.round.resolutionId,
      },
    };
  }

  function winningDecision(data) {
    const decision = data.round.decision;
    const voters = active(data);
    const counts = Object.fromEntries(decision.options.map((option) => [option.id, 0]));
    for (const userId of voters.map((item) => item.userId)) {
      const optionId = decision.votes?.[userId];
      if (optionId in counts) counts[optionId] += 1;
    }
    const max = Math.max(...Object.values(counts));
    const tied = decision.options.filter((option) => counts[option.id] === max);
    if (tied.length === 1) return tied[0];
    const leader = voters[data.session.leaderIndex % Math.max(1, voters.length)];
    const leaderVote = leader ? decision.votes?.[leader.userId] : null;
    return tied.find((option) => option.id === leaderVote) || tied[0];
  }

  async function advanceClock(sessionId, { force = false } = {}) {
    let event = null;
    const result = await withLock(sessionId, async () => {
      const data = await load(sessionId);
      if (!data.round || ['lobby', 'ended', 'resolving', 'locked'].includes(data.round.phase)) return { data };
      const timestamp = now();

      // 45秒を超えた切断は自動離席。復帰APIまで待機対象へ戻さない。
      for (const participant of data.session.participants) {
        if (
          participant.pcId &&
          participant.activity !== 'away_manual' &&
          participant.activity !== 'away_auto' &&
          connectionOf(sessionId, participant) === 'offline'
        ) {
          participant.activity = 'away_auto';
        }
      }

      if (data.round.phase === 'collecting') {
        const waiting = active(data);
        const allReady = waiting.length > 0 && waiting.every((item) => data.round.readyUserIds.includes(item.userId));
        if (allReady && !force) {
          data.round.phase = 'lock_grace';
          data.round.lockAt = timestamp + LOCK_GRACE_MS;
          event = { type: 'round_lock_grace', roundId: data.round.id, payload: { lockAt: data.round.lockAt } };
        } else if (force || (data.round.deadlineAt && timestamp >= data.round.deadlineAt)) {
          const missingTyping = waiting.some(
            (item) => !data.round.intents.some((intent) => intent.pcId === item.pcId) && typingOf(sessionId, item.userId),
          );
          if (!force && missingTyping && timestamp < data.round.maxDeadlineAt) {
            data.round.deadlineAt = Math.min(timestamp + TYPING_EXTENSION_MS, data.round.maxDeadlineAt);
            event = { type: 'round_extended_for_typing', roundId: data.round.id, payload: { deadlineAt: data.round.deadlineAt } };
          } else if (!force && missingTyping) {
            data.round.deadlineAt = null;
            data.round.awaitingHostAdvance = true;
            event = { type: 'round_waiting_for_host', roundId: data.round.id, payload: {} };
          } else {
            const locked = lockRound(data, force ? 'ホストが先へ進めた' : '締切まで入力がなかった');
            event = {
              type: locked.paused ? 'party_paused_no_actions' : 'round_locked',
              roundId: data.round.id,
              payload: { resolutionId: data.round.resolutionId || null },
            };
            await record(data, event);
            return { data, job: locked.job };
          }
        }
      } else if (data.round.phase === 'lock_grace') {
        const waiting = active(data);
        const allReady = waiting.length > 0 && waiting.every((item) => data.round.readyUserIds.includes(item.userId));
        if (!allReady && !force) {
          data.round.phase = 'collecting';
          data.round.lockAt = null;
          event = { type: 'round_lock_cancelled', roundId: data.round.id, payload: {} };
        } else if (force || timestamp >= data.round.lockAt) {
          const locked = lockRound(data, force ? 'ホストが先へ進めた' : '全員の準備が確定した');
          event = { type: 'round_locked', roundId: data.round.id, payload: { resolutionId: data.round.resolutionId } };
          await record(data, event);
          return { data, job: locked.job };
        }
      } else if (data.round.phase === 'deciding') {
        const voters = active(data);
        const allVoted = voters.length > 0 && voters.every((item) => data.round.decision.votes?.[item.userId]);
        if (force || allVoted || timestamp >= data.round.decision.deadlineAt) {
          const winner = winningDecision(data);
          data.round.decision.result = winner;
          data.round.phase = 'resolving';
          data.round.resolutionId = randomId('resolution');
          data.session.leaderIndex = ((data.session.leaderIndex || 0) + 1) % Math.max(1, voters.length);
          event = { type: 'decision_resolved', roundId: data.round.id, payload: { option: winner } };
          await record(data, event);
          return {
            data,
            job: { sessionId, roundId: data.round.id, resolutionId: data.round.resolutionId },
          };
        }
      }
      if (event) await record(data, event);
      return { data };
    });
    if (result.job) await runResolution(result.job);
    return result;
  }

  async function runResolution(job) {
    const prepared = await withLock(job.sessionId, async () => {
      const data = await load(job.sessionId);
      if (data.round?.resolutionId !== job.resolutionId || data.round.phase !== 'resolving') return null;
      return {
        session: structuredClone(data.session),
        snapshot: structuredClone(data.snapshot),
        round: structuredClone(data.round),
      };
    });
    if (!prepared) return;
    try {
      if (!generator) throw partyError(503, 'party generation is not configured', 'GENERATOR_UNAVAILABLE');
      await consumeUsage(usage, prepared.session.ownerId);
      const generated = await generator({
        ...prepared,
        decisionResult: prepared.round.decision?.result || null,
      });
      validatePartyResolution(prepared.session, prepared.snapshot, prepared.round, generated);
      await withLock(job.sessionId, async () => {
        const data = await load(job.sessionId);
        if (data.round?.resolutionId !== job.resolutionId || data.round.phase !== 'resolving') return;
        if (generated.resolution === 'decision_required') {
          data.round.phase = 'deciding';
          data.round.decision = {
            question: cleanText(generated.decision?.question, 1000) || 'Partyの方針を選ぶ',
            options: generated.decision?.options || [],
            votes: {},
            deadlineAt: now() + data.session.settings.voteTimeoutSeconds * 1000,
          };
          data.round.updatedAt = now();
          await record(data, {
            type: 'decision_required',
            roundId: data.round.id,
            payload: { question: data.round.decision.question, options: data.round.decision.options },
          });
          return;
        }
        data.snapshot = applyPartyResolution(data.snapshot, generated, { roundId: data.round.id, now: now() });
        data.session.stateRevision = data.snapshot.stateRevision;
        const resolvedRoundId = data.round.id;
        const resolvedIntents = data.round.resolutionIntents || data.round.intents;
        const checks = generated.checkResults || [];
        const resolvedRound = {
          ...data.round,
          phase: 'presenting',
          resolvedAt: now(),
          updatedAt: now(),
        };
        const next = newRound(data.session, data.round.number + 1, now());
        data.round = next;
        data.session.currentRoundId = next.id;
        data.session.status = 'playing';
        for (const participant of data.session.participants) {
          if (participant.activity === 'ready') participant.activity = 'active';
        }
        await record(data, {
          type: 'round_resolved',
          roundId: resolvedRoundId,
          payload: {
            intents: resolvedIntents,
            checks,
            narrativeIds: (generated.narratives || []).map((item) => item.id).filter(Boolean),
            autoActions: generated.autoActions || [],
            stateRevision: data.snapshot.stateRevision,
          },
        });
        await savePartyRound(dataStore, data.session.id, resolvedRound);
      });
    } catch (error) {
      await withLock(job.sessionId, async () => {
        const data = await load(job.sessionId);
        if (data.round?.resolutionId !== job.resolutionId || data.round.phase !== 'resolving') return;
        data.round.phase = 'paused';
        data.round.error = `AI GM処理に失敗した: ${error.message}`;
        data.session.status = 'paused';
        await record(data, {
          type: 'resolution_failed',
          roundId: data.round.id,
          payload: { error: error.message, code: error.code || null, resetAt: error.resetAt || null },
        });
      });
    }
  }

  async function create(userId, body) {
    const timestamp = now();
    const title = cleanText(body?.title, 200);
    if (!title) throw partyError(400, 'title is required');
    if (!body?.gmSnapshot || typeof body.gmSnapshot !== 'object') throw partyError(400, 'gmSnapshot is required');
    const rawPcs = Array.isArray(body.pcs) ? body.pcs.slice(0, 6) : [];
    if (rawPcs.length < 2) throw partyError(400, 'at least two PCs are required');
    const usedIds = new Set();
    const pcs = rawPcs.map((pc, index) => {
      let id = safeId(pc.id, `pc_${index + 1}`);
      while (usedIds.has(id)) id = `${id}_${index + 1}`;
      usedIds.add(id);
      return {
        id,
        characterName: cleanText(pc.characterName || pc.name, 200) || `PC ${index + 1}`,
        raw: cleanText(pc.raw, 30000),
        goal: cleanText(pc.goal, 1000),
        bonds: cleanText(pc.bonds, 2000),
      };
    });
    const profile = await dataStore.get(`users/${userId}/profile`);
    const id = randomId('party');
    const settings = normalizePartySettings(body.settings);
    const session = {
      id,
      mode: 'party',
      ownerId: userId,
      campaignId: safeId(body.campaignId, null),
      worldId: safeId(body.worldId, null),
      title,
      status: 'lobby',
      settings,
      participants: [{
        userId,
        displayName: profile?.displayName || 'ホスト',
        role: 'host',
        pcId: null,
        joinedAt: timestamp,
        lastSeenAt: timestamp,
        lobbyReady: false,
        activity: 'active',
        awayPolicy: settings.defaultAwayPolicy,
        delegatedToUserId: null,
        consecutiveMisses: 0,
        lastActionRound: 0,
      }],
      pcs,
      gmSnapshot: {
        world: body.gmSnapshot.world || {},
        scenario: body.gmSnapshot.scenario || {},
        ruleset: body.gmSnapshot.ruleset || { id: 'simple', formula: 'simple', resourceDefs: [] },
        directorGuide: body.gmSnapshot.directorGuide || body.gmSnapshot.scenario?.directorGuide || null,
      },
      eventSeq: 0,
      chatSeq: 0,
      stateRevision: 0,
      currentRoundId: null,
      leaderIndex: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const snapshot = createPartySnapshot(pcs, session.gmSnapshot.ruleset, timestamp);
    await savePartySession(dataStore, session);
    await savePartySnapshot(dataStore, id, snapshot);
    await savePartyMembership(dataStore, userId, session);
    await appendPartyEvent(dataStore, session, {
      type: 'party_created',
      actorUserId: userId,
      payload: { title, settings },
      createdAt: timestamp,
    }, snapshot);
    touchPresence(id, userId);
    return projection({ session, snapshot, round: null }, userId);
  }

  async function list(userId) {
    const memberships = await listPartyMemberships(dataStore, userId);
    const sessions = await Promise.all(memberships.map((membership) => getPartySession(dataStore, membership.sessionId)));
    return sessions.filter(Boolean).map((session) => ({
      id: session.id,
      title: session.title,
      status: session.status,
      role: participantOf(session, userId)?.role || 'player',
      playerCount: session.participants.length,
      maxPlayers: session.settings.maxPlayers,
      updatedAt: session.updatedAt,
      endedAt: session.endedAt || null,
    })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function getSnapshot(userId, sessionId) {
    const initial = await load(sessionId);
    ensureMember(initial.session, userId);
    touchPresence(sessionId, userId);
    await advanceClock(sessionId);
    const data = await load(sessionId);
    return projection(data, userId);
  }

  async function createInvite(userId, sessionId, options = {}) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      ensureHost(data.session, userId);
      const token = randomToken();
      const timestamp = now();
      const invite = {
        id: randomId('invite', 6),
        tokenHash: hashInviteToken(token),
        createdByUserId: userId,
        createdAt: timestamp,
        expiresAt: timestamp + Math.max(60_000, Math.min(30 * 86400000, Number(options.expiresInMs) || 7 * 86400000)),
        maxUses: Math.max(1, Math.min(20, Number(options.maxUses) || data.session.settings.maxPlayers)),
        uses: 0,
        revokedAt: null,
      };
      await savePartyInvite(dataStore, sessionId, invite);
      return { inviteId: invite.id, inviteToken: token, expiresAt: invite.expiresAt, maxUses: invite.maxUses };
    });
  }

  async function invites(userId, sessionId) {
    const data = await load(sessionId);
    ensureHost(data.session, userId);
    return (await listPartyInvites(dataStore, sessionId)).map(({ tokenHash: _tokenHash, ...invite }) => invite);
  }

  async function revokeInvite(userId, sessionId, inviteId) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      ensureHost(data.session, userId);
      await deletePartyInvite(dataStore, sessionId, inviteId);
    });
  }

  async function join(userId, sessionId, token) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      const existing = participantOf(data.session, userId);
      if (existing) {
        touchPresence(sessionId, userId);
        return projection(data, userId);
      }
      if (data.session.status !== 'lobby') throw partyError(409, 'party already started', 'PARTY_STARTED');
      if (data.session.participants.length >= data.session.settings.maxPlayers) throw partyError(409, 'party is full', 'PARTY_FULL');
      const invite = await findPartyInvite(dataStore, sessionId, token);
      if (!invite || invite.revokedAt || invite.expiresAt <= now() || invite.uses >= invite.maxUses) {
        throw partyError(403, 'invite is invalid or expired', 'INVALID_INVITE');
      }
      const profile = await dataStore.get(`users/${userId}/profile`);
      data.session.participants.push({
        userId,
        displayName: profile?.displayName || 'プレイヤー',
        role: 'player',
        pcId: null,
        joinedAt: now(),
        lastSeenAt: now(),
        lobbyReady: false,
        activity: 'active',
        awayPolicy: data.session.settings.defaultAwayPolicy,
        delegatedToUserId: null,
        consecutiveMisses: 0,
        lastActionRound: 0,
      });
      invite.uses += 1;
      await savePartyInvite(dataStore, sessionId, invite);
      await savePartyMembership(dataStore, userId, data.session);
      await record(data, { type: 'participant_joined', actorUserId: userId, payload: {} });
      touchPresence(sessionId, userId);
      return projection(data, userId);
    });
  }

  async function leave(userId, sessionId) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      const participant = ensureMember(data.session, userId);
      if (participant.role === 'host') throw partyError(409, 'host cannot leave the party', 'HOST_CANNOT_LEAVE');
      data.session.participants = data.session.participants.filter((item) => item.userId !== userId);
      await deletePartyMembership(dataStore, userId, sessionId);
      await record(data, { type: 'participant_left', actorUserId: userId, payload: {} });
    });
  }

  async function claimPc(userId, sessionId, pcId) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      if (data.session.status !== 'lobby') throw partyError(409, 'PC assignment is locked');
      const participant = ensureMember(data.session, userId);
      if (!data.session.pcs.some((pc) => pc.id === pcId)) throw partyError(400, 'known pcId is required');
      if (data.session.participants.some((item) => item.userId !== userId && item.pcId === pcId)) {
        throw partyError(409, 'PC is already assigned', 'PC_ASSIGNED');
      }
      participant.pcId = pcId;
      participant.lobbyReady = false;
      await record(data, { type: 'pc_claimed', actorUserId: userId, actorPcId: pcId, payload: {} });
      return projection(data, userId);
    });
  }

  async function setReady(userId, sessionId, ready) {
    let shouldTick = false;
    const value = await withLock(sessionId, async () => {
      const data = await load(sessionId);
      const participant = ensureMember(data.session, userId);
      if (data.session.status === 'lobby') {
        if (!participant.pcId && ready) throw partyError(400, 'choose a PC before ready');
        participant.lobbyReady = ready;
        await record(data, { type: ready ? 'lobby_ready' : 'lobby_unready', actorUserId: userId, payload: {} });
      } else if (data.round && ['collecting', 'lock_grace'].includes(data.round.phase)) {
        if (ready && !data.round.intents.some((intent) => intent.pcId === participant.pcId)) {
          throw partyError(400, 'submit an action before ready');
        }
        const set = new Set(data.round.readyUserIds);
        if (ready) set.add(userId);
        else set.delete(userId);
        data.round.readyUserIds = [...set];
        participant.activity = ready ? 'ready' : 'active';
        if (!ready && data.round.phase === 'lock_grace') {
          data.round.phase = 'collecting';
          data.round.lockAt = null;
        }
        await record(data, { type: ready ? 'round_ready' : 'round_unready', actorUserId: userId, roundId: data.round.id, payload: {} });
        shouldTick = ready;
      } else {
        throw partyError(409, 'ready cannot be changed in this phase');
      }
      return projection(data, userId);
    });
    if (shouldTick) await advanceClock(sessionId);
    return value;
  }

  async function start(userId, sessionId) {
    if (!generator) throw partyError(503, 'party generation is not configured', 'GENERATOR_UNAVAILABLE');
    const job = await withLock(sessionId, async () => {
      const data = await load(sessionId);
      ensureHost(data.session, userId);
      if (data.session.status !== 'lobby') throw partyError(409, 'party already started');
      if (data.session.participants.length < 2) throw partyError(409, 'at least two players are required');
      if (data.session.participants.some((item) => !item.pcId || !item.lobbyReady)) {
        throw partyError(409, 'all players must choose a PC and become ready');
      }
      const round = {
        ...newRound(data.session, 0, now()),
        id: 'round_0',
        phase: 'resolving',
        deadlineAt: null,
        baseDeadlineAt: null,
        maxDeadlineAt: null,
        resolutionId: randomId('resolution'),
        resolutionIntents: [],
      };
      data.round = round;
      data.session.currentRoundId = round.id;
      data.session.status = 'playing';
      await record(data, { type: 'party_started', actorUserId: userId, roundId: round.id, payload: {} });
      return { sessionId, roundId: round.id, resolutionId: round.resolutionId };
    });
    await runResolution(job);
    return getSnapshot(userId, sessionId);
  }

  function canControlPc(session, participant, pcId) {
    if (participant.pcId === pcId) return true;
    const owner = session.participants.find((item) => item.pcId === pcId);
    return owner?.awayPolicy === 'delegate' && owner.delegatedToUserId === participant.userId;
  }

  async function submitIntent(userId, sessionId, body, expectedIntentId = null) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      const participant = ensureMember(data.session, userId);
      if (!data.round || !['collecting', 'lock_grace'].includes(data.round.phase)) throw partyError(409, 'round is not collecting');
      const pcId = body.pcId || participant.pcId;
      if (!pcId || !canControlPc(data.session, participant, pcId)) throw partyError(403, 'cannot control this PC');
      const text = cleanText(body.text, 4000);
      if (!text) throw partyError(400, 'action text is required');
      const id = `intent_${data.round.id}_${pcId}`;
      if (expectedIntentId && expectedIntentId !== id) throw partyError(404, 'intent not found');
      const commandId = safeId(body.commandId, null);
      if (commandId && (data.session.recentCommandIds || []).includes(commandId)) {
        return data.round.intents.find((item) => item.id === id) || null;
      }
      const intent = {
        id,
        userId,
        pcId,
        characterName: pcName(data.session, pcId),
        text,
        source: 'human',
        commandId,
        submittedAt: now(),
      };
      const index = data.round.intents.findIndex((item) => item.id === id);
      if (index === -1) data.round.intents.push(intent);
      else data.round.intents[index] = { ...data.round.intents[index], ...intent };
      participant.activity = 'active';
      participant.consecutiveMisses = 0;
      participant.lastActionRound = data.round.number;
      const ready = new Set(data.round.readyUserIds);
      ready.delete(userId);
      data.round.readyUserIds = [...ready];
      if (data.round.phase === 'lock_grace') {
        data.round.phase = 'collecting';
        data.round.lockAt = null;
      }
      if (commandId) data.session.recentCommandIds = [...(data.session.recentCommandIds || []), commandId].slice(-100);
      await record(data, {
        type: index === -1 ? 'intent_submitted' : 'intent_updated',
        actorUserId: userId,
        actorPcId: pcId,
        roundId: data.round.id,
        commandId: intent.commandId,
        payload: { intent },
      });
      return intent;
    });
  }

  async function deleteIntent(userId, sessionId, intentId) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      const participant = ensureMember(data.session, userId);
      if (!data.round || !['collecting', 'lock_grace'].includes(data.round.phase)) throw partyError(409, 'round is not collecting');
      const intent = data.round.intents.find((item) => item.id === intentId);
      if (!intent || !canControlPc(data.session, participant, intent.pcId)) throw partyError(404, 'intent not found');
      data.round.intents = data.round.intents.filter((item) => item.id !== intentId);
      data.round.readyUserIds = data.round.readyUserIds.filter((id) => id !== userId);
      data.round.phase = 'collecting';
      data.round.lockAt = null;
      await record(data, { type: 'intent_deleted', actorUserId: userId, actorPcId: intent.pcId, roundId: data.round.id, payload: { intentId } });
    });
  }

  async function heartbeatTyping(userId, sessionId) {
    const data = await load(sessionId);
    ensureMember(data.session, userId);
    typing.set(`${sessionId}/${userId}`, now());
    touchPresence(sessionId, userId);
    return { typingUntil: now() + TYPING_MS };
  }

  async function heartbeatPresence(userId, sessionId) {
    const data = await load(sessionId);
    ensureMember(data.session, userId);
    touchPresence(sessionId, userId);
    return { ok: true, serverNow: now() };
  }

  async function setAway(userId, sessionId, body) {
    const result = await withLock(sessionId, async () => {
      const data = await load(sessionId);
      const participant = ensureMember(data.session, userId);
      const policy = PARTY_AWAY_POLICIES.includes(body?.policy) ? body.policy : participant.awayPolicy;
      participant.activity = 'away_manual';
      participant.awayPolicy = policy;
      participant.delegatedToUserId = policy === 'delegate' && participantOf(data.session, body?.delegatedToUserId)
        ? body.delegatedToUserId
        : null;
      if (data.round) data.round.readyUserIds = data.round.readyUserIds.filter((id) => id !== userId);
      await record(data, { type: 'participant_away', actorUserId: userId, payload: { policy, delegatedToUserId: participant.delegatedToUserId } });
      return projection(data, userId);
    });
    await advanceClock(sessionId);
    return result;
  }

  async function returnToParty(userId, sessionId) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      const participant = ensureMember(data.session, userId);
      participant.activity = 'active';
      participant.consecutiveMisses = 0;
      participant.lastSeenAt = now();
      touchPresence(sessionId, userId);
      if (data.round?.phase === 'paused' && data.session.status !== 'ended') {
        data.session.status = 'playing';
        data.round.phase = 'collecting';
        data.round.error = null;
        data.round.deadlineAt = now() + data.session.settings.actionTimeoutSeconds * 1000;
      }
      await record(data, { type: 'participant_returned', actorUserId: userId, payload: {} });
      return projection(data, userId);
    });
  }

  async function vote(userId, sessionId, optionId) {
    const value = await withLock(sessionId, async () => {
      const data = await load(sessionId);
      const participant = ensureMember(data.session, userId);
      if (participant.activity === 'away_manual' || participant.activity === 'away_auto') throw partyError(409, 'away participant cannot vote');
      if (data.round?.phase !== 'deciding') throw partyError(409, 'no decision is active');
      if (!data.round.decision.options.some((option) => option.id === optionId)) throw partyError(400, 'known optionId is required');
      data.round.decision.votes[userId] = optionId;
      await record(data, { type: 'vote_cast', actorUserId: userId, roundId: data.round.id, payload: { optionId } });
      return projection(data, userId);
    });
    await advanceClock(sessionId);
    return value;
  }

  async function hostAdvance(userId, sessionId) {
    const data = await load(sessionId);
    ensureHost(data.session, userId);
    await advanceClock(sessionId, { force: true });
    return getSnapshot(userId, sessionId);
  }

  async function hostPause(userId, sessionId) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      ensureHost(data.session, userId);
      if (!data.round || data.session.status === 'ended') throw partyError(409, 'party cannot be paused');
      data.session.status = 'paused';
      data.round.phase = 'paused';
      data.round.error = 'ホストが進行を停止した';
      await record(data, { type: 'party_paused_by_host', actorUserId: userId, payload: {} });
      return projection(data, userId);
    });
  }

  async function hostResume(userId, sessionId) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      ensureHost(data.session, userId);
      if (!data.round || data.session.status === 'ended') throw partyError(409, 'party cannot be resumed');
      data.session.status = 'playing';
      data.round.phase = 'collecting';
      data.round.error = null;
      data.round.resolutionId = null;
      data.round.deadlineAt = now() + data.session.settings.actionTimeoutSeconds * 1000;
      data.round.maxDeadlineAt = data.round.deadlineAt + MAX_TYPING_EXTENSION_MS;
      await record(data, { type: 'party_resumed_by_host', actorUserId: userId, payload: {} });
      return projection(data, userId);
    });
  }

  async function hostUpdateParticipant(userId, sessionId, targetUserId, body) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      ensureHost(data.session, userId);
      const target = participantOf(data.session, targetUserId);
      if (!target) throw partyError(404, 'participant not found');
      if (body?.remove === true) {
        if (target.role === 'host') throw partyError(409, 'host cannot be removed');
        data.session.participants = data.session.participants.filter((item) => item.userId !== targetUserId);
        await deletePartyMembership(dataStore, targetUserId, sessionId);
        await record(data, { type: 'participant_removed', actorUserId: userId, payload: { targetUserId } });
        return projection(data, userId);
      }
      if (body?.pcId != null) {
        if (data.session.status !== 'lobby') throw partyError(409, 'PC assignment is locked');
        if (!data.session.pcs.some((pc) => pc.id === body.pcId)) throw partyError(400, 'known pcId is required');
        if (data.session.participants.some((item) => item.userId !== targetUserId && item.pcId === body.pcId)) {
          throw partyError(409, 'PC is already assigned', 'PC_ASSIGNED');
        }
        target.pcId = body.pcId;
        target.lobbyReady = false;
      }
      if (['active', 'away_manual', 'away_auto'].includes(body?.activity)) {
        target.activity = body.activity;
        if (body.activity === 'active') target.consecutiveMisses = 0;
      }
      if (PARTY_AWAY_POLICIES.includes(body?.awayPolicy)) target.awayPolicy = body.awayPolicy;
      if (body?.delegatedToUserId == null || participantOf(data.session, body.delegatedToUserId)) {
        target.delegatedToUserId = body?.delegatedToUserId || null;
      }
      await record(data, {
        type: 'participant_updated_by_host',
        actorUserId: userId,
        payload: { targetUserId, pcId: target.pcId, activity: target.activity, awayPolicy: target.awayPolicy },
      });
      return projection(data, userId);
    });
  }

  async function end(userId, sessionId) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      ensureHost(data.session, userId);
      if (data.session.status === 'ended') return projection(data, userId);
      const timestamp = now();
      data.session.status = 'ended';
      data.session.endedAt = timestamp;
      if (data.round) data.round.phase = 'ended';
      data.snapshot.global.endingReached = true;
      await record(data, { type: 'party_ended', actorUserId: userId, payload: {} });
      const partyEvents = await listPartyEvents(dataStore, data.session.id, 0);
      const exported = {
        id: data.session.id,
        mode: 'party',
        title: data.session.title,
        worldId: data.session.worldId || undefined,
        campaignId: data.session.campaignId || undefined,
        world: data.session.gmSnapshot.world,
        scenario: data.session.gmSnapshot.scenario,
        rulesetId: data.session.gmSnapshot.ruleset?.id || 'simple',
        ruleset: data.session.gmSnapshot.ruleset,
        pcs: data.session.pcs,
        pc: data.session.pcs[0] || { raw: '' },
        state: {
          ...data.snapshot.global,
          party: { scenes: data.snapshot.scenes, pcs: data.snapshot.pcs, autoActions: data.snapshot.autoActions },
          turn_count: data.round?.number || 0,
          xp: Math.max(0, ...Object.values(data.snapshot.pcs || {}).map((pc) => pc.xp || 0)),
        },
        log: exportedPartyLog(partyEvents, data.snapshot.narratives),
        endedAt: timestamp,
        updatedAt: timestamp,
      };
      await dataStore.set(sessionKey(data.session.ownerId, data.session.id), exported);

      if (data.session.campaignId && data.session.worldId) {
        const campaign = await getCampaign(dataStore, data.session.ownerId, data.session.worldId, data.session.campaignId);
        if (campaign) {
          const chapter = {
            chapterId: `chapter_${data.session.id}`,
            sessionId: data.session.id,
            scenarioId: data.session.gmSnapshot.scenario?.id,
            title: data.session.title,
            status: 'ended',
            endedAt: timestamp,
          };
          const chapters = [...campaign.chapters];
          const index = chapters.findIndex((item) => item.sessionId === data.session.id);
          if (index === -1) chapters.push(chapter);
          else chapters[index] = { ...chapters[index], ...chapter };
          await saveCampaign(dataStore, data.session.ownerId, { ...campaign, chapters });
        }
      }
      return projection(data, userId);
    });
  }

  async function events(userId, sessionId, after = 0) {
    const data = await load(sessionId);
    const participant = ensureMember(data.session, userId);
    const values = await listPartyEvents(dataStore, sessionId, after);
    return {
      events: values.filter((event) => canReadAudience(event.audience, participant, { ...data.session, snapshot: data.snapshot })),
      nextSeq: data.session.eventSeq || 0,
    };
  }

  async function chat(userId, sessionId, after = 0) {
    const data = await load(sessionId);
    ensureMember(data.session, userId);
    return { messages: await listPartyChat(dataStore, sessionId, after), nextSeq: data.session.chatSeq || 0 };
  }

  async function sendChat(userId, sessionId, text, commandId = null) {
    return withLock(sessionId, async () => {
      const data = await load(sessionId);
      const participant = ensureMember(data.session, userId);
      const body = cleanText(text, 2000);
      if (!body) throw partyError(400, 'chat text is required');
      const normalizedCommandId = safeId(commandId, null);
      if (normalizedCommandId && (data.session.recentCommandIds || []).includes(normalizedCommandId)) {
        const recent = await listPartyChat(dataStore, sessionId, Math.max(0, (data.session.chatSeq || 0) - 20));
        return recent.find((item) => item.commandId === normalizedCommandId) || recent.at(-1) || null;
      }
      const rateKey = `${sessionId}/${userId}`;
      if (now() - (chatRate.get(rateKey) || 0) < 750) throw partyError(429, 'chat rate limit exceeded');
      chatRate.set(rateKey, now());
      if (normalizedCommandId) {
        data.session.recentCommandIds = [...(data.session.recentCommandIds || []), normalizedCommandId].slice(-100);
      }
      return appendPartyChat(dataStore, data.session, {
        userId,
        displayName: participant.displayName,
        text: body,
        commandId: normalizedCommandId,
        createdAt: now(),
      });
    });
  }

  return {
    create,
    list,
    getSnapshot,
    createInvite,
    invites,
    revokeInvite,
    join,
    leave,
    claimPc,
    setReady,
    start,
    submitIntent,
    deleteIntent,
    heartbeatTyping,
    heartbeatPresence,
    setAway,
    returnToParty,
    vote,
    hostAdvance,
    hostPause,
    hostResume,
    hostUpdateParticipant,
    end,
    events,
    chat,
    sendChat,
    touchPresence,
    advanceClock,
  };
}
