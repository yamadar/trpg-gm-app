export const PARTY_PHASES = [
  'lobby',
  'presenting',
  'collecting',
  'lock_grace',
  'locked',
  'resolving',
  'deciding',
  'paused',
  'ended',
];

export const PARTY_AWAY_POLICIES = ['follow', 'wait', 'delegate'];

export function normalizePartySettings(value = {}) {
  const maxPlayers = Number.isSafeInteger(value.maxPlayers)
    ? Math.max(2, Math.min(6, value.maxPlayers))
    : 4;
  const actionTimeoutSeconds = Number.isFinite(value.actionTimeoutSeconds)
    ? Math.max(15, Math.min(600, Math.round(value.actionTimeoutSeconds)))
    : 90;
  const voteTimeoutSeconds = Number.isFinite(value.voteTimeoutSeconds)
    ? Math.max(10, Math.min(120, Math.round(value.voteTimeoutSeconds)))
    : 30;
  return {
    maxPlayers,
    actionTimeoutSeconds,
    voteTimeoutSeconds,
    viewPolicy: value.viewPolicy === 'character' ? 'character' : 'open',
    defaultAwayPolicy: PARTY_AWAY_POLICIES.includes(value.defaultAwayPolicy)
      ? value.defaultAwayPolicy
      : 'follow',
  };
}

export function createPartySnapshot(pcs, ruleset, now = Date.now()) {
  const resources = Object.fromEntries(
    (ruleset?.resourceDefs || []).map((resource) => [
      resource.key,
      { value: resource.initial, max: resource.max },
    ]),
  );
  return {
    lastEventSeq: 0,
    stateRevision: 0,
    global: {
      time: '冒頭',
      flags: {},
      historySummary: '',
      tensionLevel: 0,
      endingReached: false,
    },
    scenes: {
      main: {
        id: 'main',
        title: '冒頭',
        location: '',
        participantPcIds: pcs.map((pc) => pc.id),
        summary: '',
      },
    },
    pcs: Object.fromEntries(
      pcs.map((pc) => [
        pc.id,
        {
          sceneId: 'main',
          resources: structuredClone(resources),
          conditions: [],
          knownFactIds: [],
          xp: 0,
        },
      ]),
    ),
    facts: {},
    narratives: [],
    choicesByPc: {},
    autoActions: [],
    updatedAt: now,
  };
}

export function canReadAudience(audience, participant, session) {
  if (!audience || audience.kind === 'all') return true;
  if (!participant?.pcId) return false;
  if (audience.kind === 'pcs') return (audience.ids || []).includes(participant.pcId);
  if (audience.kind === 'scene') {
    const sceneId = audience.ids?.[0];
    return session?.snapshot?.pcs?.[participant.pcId]?.sceneId === sceneId;
  }
  return false;
}

export function activePartyParticipants(session, connectionOf = () => 'online') {
  return (session.participants || []).filter((participant) => {
    if (!participant.pcId) return false;
    if (participant.activity === 'away_manual' || participant.activity === 'away_auto') return false;
    return connectionOf(participant.userId) !== 'offline';
  });
}

function publicPc(pc, isOwn) {
  return {
    id: pc.id,
    characterName: pc.characterName,
    ...(isOwn ? { raw: pc.raw, goal: pc.goal || '', bonds: pc.bonds || '' } : {}),
  };
}

function publicScene(scene) {
  return {
    id: scene.id,
    title: scene.title,
    location: scene.location,
    participantPcIds: scene.participantPcIds || [],
    summary: scene.summary,
  };
}

function publicPcState(pc, visibleFactIds, includeKnownFacts) {
  return {
    sceneId: pc.sceneId,
    resources: pc.resources || {},
    conditions: pc.conditions || [],
    knownFactIds: includeKnownFacts
      ? (pc.knownFactIds || []).filter((id) => visibleFactIds.has(id))
      : [],
    xp: pc.xp || 0,
  };
}

export function projectPartySession({ session, snapshot, round, userId, connectionOf, typingOf, serverNow = Date.now() }) {
  const participant = session.participants.find((item) => item.userId === userId);
  if (!participant) return null;
  const readable = (item) => canReadAudience(item?.audience, participant, { ...session, snapshot });
  const visibleFacts = Object.fromEntries(
    Object.entries(snapshot.facts || {})
      .filter(([, fact]) => readable(fact))
      .map(([id, fact]) => [id, {
        id: fact.id || id,
        text: fact.text,
        audience: fact.audience || { kind: 'all', ids: [] },
      }]),
  );
  const visibleFactIds = new Set(Object.keys(visibleFacts));
  const ownSceneId = snapshot.pcs?.[participant.pcId]?.sceneId;
  const visibleScenes = Object.fromEntries(
    Object.entries(snapshot.scenes || {})
      .filter(([id]) => session.settings?.viewPolicy !== 'character' || id === ownSceneId)
      .map(([id, scene]) => [id, publicScene(scene)]),
  );
  const projectedSnapshot = {
    lastEventSeq: snapshot.lastEventSeq || 0,
    stateRevision: snapshot.stateRevision || 0,
    global: {
      time: snapshot.global?.time || '',
      tensionLevel: snapshot.global?.tensionLevel || 0,
      endingReached: snapshot.global?.endingReached === true,
    },
    scenes: visibleScenes,
    pcs: Object.fromEntries(
      Object.entries(snapshot.pcs || {}).map(([id, pc]) => [
        id,
        publicPcState(pc, visibleFactIds, id === participant.pcId),
      ]),
    ),
    facts: visibleFacts,
    narratives: (snapshot.narratives || []).filter(readable).map((item) => ({
      id: item.id,
      roundId: item.roundId,
      audience: item.audience,
      text: item.text,
      createdAt: item.createdAt,
    })),
    choicesByPc: participant.pcId && snapshot.choicesByPc?.[participant.pcId]
      ? { [participant.pcId]: snapshot.choicesByPc[participant.pcId] }
      : {},
    autoActions: (snapshot.autoActions || []).map((item) => ({
      pcId: item.pcId,
      text: item.text,
      reason: item.reason,
      roundId: item.roundId,
    })),
    updatedAt: snapshot.updatedAt,
  };
  return {
    id: session.id,
    mode: 'party',
    ownerId: session.ownerId,
    campaignId: session.campaignId || null,
    worldId: session.worldId || null,
    title: session.title,
    status: session.status,
    settings: session.settings,
    participants: session.participants.map((item) => ({
      userId: item.userId,
      displayName: item.displayName,
      role: item.role,
      pcId: item.pcId || null,
      lobbyReady: item.lobbyReady === true,
      activity: item.activity || 'active',
      awayPolicy: item.awayPolicy,
      delegatedToUserId: item.delegatedToUserId || null,
      consecutiveMisses: item.consecutiveMisses || 0,
      lastActionRound: item.lastActionRound || 0,
      connection: connectionOf(item.userId),
      typing: typingOf(item.userId),
    })),
    pcs: session.pcs.map((pc) => publicPc(pc, pc.id === participant.pcId)),
    me: {
      userId,
      role: participant.role,
      pcId: participant.pcId || null,
    },
    round: round
      ? {
          id: round.id,
          number: round.number,
          phase: round.phase,
          deadlineAt: round.deadlineAt || null,
          lockAt: round.lockAt || null,
          intents: (round.intents || []).map((intent) => ({
            id: intent.id,
            userId: intent.userId,
            pcId: intent.pcId,
            characterName: intent.characterName,
            text: intent.text,
            source: intent.source,
            reason: intent.reason,
            submittedAt: intent.submittedAt,
          })),
          readyUserIds: round.readyUserIds || [],
          decision: round.decision
            ? {
                question: round.decision.question,
                options: round.decision.options,
                votes: round.decision.votes || {},
                deadlineAt: round.decision.deadlineAt,
              }
            : null,
          error: round.error || null,
        }
      : null,
    snapshot: projectedSnapshot,
    eventSeq: session.eventSeq || 0,
    stateRevision: session.stateRevision || 0,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    endedAt: session.endedAt || null,
    serverNow,
  };
}

function cleanAudience(value, pcIds, sceneIds) {
  if (value?.kind === 'pcs') {
    const ids = (value.ids || []).filter((id) => pcIds.has(id));
    return ids.length ? { kind: 'pcs', ids } : { kind: 'all', ids: [] };
  }
  if (value?.kind === 'scene') {
    const ids = (value.ids || []).filter((id) => sceneIds.has(id)).slice(0, 1);
    return ids.length ? { kind: 'scene', ids } : { kind: 'all', ids: [] };
  }
  return { kind: 'all', ids: [] };
}

export function applyPartyResolution(snapshot, result, { roundId, now = Date.now() }) {
  const next = structuredClone(snapshot);
  const pcIds = new Set(Object.keys(next.pcs || {}));
  const existingSceneIds = new Set(Object.keys(next.scenes || {}));

  for (const update of result.sceneUpdates || []) {
    if (!update?.sceneId) continue;
    const participantPcIds = (update.participantPcIds || []).filter((id) => pcIds.has(id));
    next.scenes[update.sceneId] = {
      id: update.sceneId,
      title: String(update.title || update.sceneId).slice(0, 200),
      location: String(update.location || '').slice(0, 500),
      participantPcIds,
      summary: String(update.summary || '').slice(0, 3000),
    };
    existingSceneIds.add(update.sceneId);
    for (const pcId of participantPcIds) next.pcs[pcId].sceneId = update.sceneId;
  }

  for (const update of result.pcUpdates || []) {
    if (!pcIds.has(update?.pcId)) continue;
    const pc = next.pcs[update.pcId];
    if (existingSceneIds.has(update.sceneId)) pc.sceneId = update.sceneId;
    if (Array.isArray(update.conditionChanges)) {
      pc.conditions = update.conditionChanges.map(String).map((v) => v.slice(0, 300)).slice(0, 20);
    }
    if (Array.isArray(update.newlyKnownFactIds)) {
      pc.knownFactIds = [...new Set([...pc.knownFactIds, ...update.newlyKnownFactIds.map(String)])].slice(0, 200);
    }
  }

  for (const check of result.checkResults || []) {
    const effect = check.resourceEffect;
    if (!pcIds.has(check.pcId) || !effect?.key) continue;
    const resource = next.pcs[check.pcId].resources?.[effect.key];
    if (resource) resource.value = effect.value;
  }

  if (result.globalUpdate) {
    next.global = {
      ...next.global,
      time: String(result.globalUpdate.time || next.global.time).slice(0, 300),
      historySummary: String(result.globalUpdate.historySummary || next.global.historySummary).slice(0, 12000),
      tensionLevel: Number.isFinite(result.globalUpdate.tensionLevel)
        ? Math.max(0, Math.min(10, Math.round(result.globalUpdate.tensionLevel)))
        : next.global.tensionLevel,
      endingReached: result.globalUpdate.endingReached === true,
      flags: {
        ...next.global.flags,
        ...(result.globalUpdate.flags && typeof result.globalUpdate.flags === 'object'
          ? result.globalUpdate.flags
          : {}),
      },
    };
  }

  const created = (result.narratives || [])
    .filter((item) => typeof item?.text === 'string' && item.text.trim())
    .map((item, index) => ({
      id: item.id || `narrative_${roundId}_${index}`,
      roundId,
      audience: cleanAudience(item.audience, pcIds, existingSceneIds),
      text: item.text.trim().slice(0, 12000),
      createdAt: now,
    }));
  next.narratives = [...(next.narratives || []), ...created];
  next.choicesByPc = Object.fromEntries(
    (result.choicesByPc || [])
      .filter((item) => pcIds.has(item.pcId))
      .map((item) => [item.pcId, (item.choices || []).map(String).map((v) => v.slice(0, 500)).slice(0, 6)]),
  );
  next.autoActions = [
    ...(next.autoActions || []),
    ...(result.autoActions || [])
      .filter((item) => pcIds.has(item.pcId))
      .map((item) => ({
        roundId,
        pcId: item.pcId,
        text: String(item.text || '').slice(0, 1000),
        reason: String(item.reason || '').slice(0, 500),
      })),
  ];
  next.stateRevision = (next.stateRevision || 0) + 1;
  next.updatedAt = now;
  return next;
}

export function validatePartyResolution(session, snapshot, round, result) {
  if (result?.resolution === 'decision_required') {
    if (!Array.isArray(result.decision?.options) || result.decision.options.length < 2 || result.decision.options.length > 4) {
      throw new Error('party decision must have 2-4 options');
    }
    return result;
  }
  if (result?.resolution !== 'advance') throw new Error('unknown party resolution');
  const pcIds = new Set(session.pcs.map((pc) => pc.id));
  const sceneIds = new Set([
    ...Object.keys(snapshot.scenes || {}),
    ...(result.sceneUpdates || []).map((item) => item.sceneId),
  ]);
  for (const scene of result.sceneUpdates || []) {
    if (!scene?.sceneId || (scene.participantPcIds || []).some((id) => !pcIds.has(id))) {
      throw new Error('party resolution contains an unknown scene PC');
    }
  }
  for (const update of result.pcUpdates || []) {
    if (!pcIds.has(update?.pcId) || !sceneIds.has(update.sceneId)) {
      throw new Error('party resolution contains an unknown PC or scene');
    }
  }
  const checkPcs = new Set();
  for (const check of result.checkResults || []) {
    if (!pcIds.has(check?.pcId) || checkPcs.has(check.pcId)) throw new Error('party resolution contains invalid checks');
    checkPcs.add(check.pcId);
  }
  if (checkPcs.size > pcIds.size) throw new Error('party resolution contains too many checks');
  for (const narrative of result.narratives || []) {
    const audience = narrative?.audience;
    if (audience?.kind === 'pcs' && (audience.ids || []).some((id) => !pcIds.has(id))) {
      throw new Error('party narrative contains an unknown audience PC');
    }
    if (audience?.kind === 'scene' && (audience.ids || []).some((id) => !sceneIds.has(id))) {
      throw new Error('party narrative contains an unknown audience scene');
    }
  }
  const automaticPcIds = new Set(
    (round.resolutionIntents || []).filter((intent) => intent.source === 'auto').map((intent) => intent.pcId),
  );
  for (const action of result.autoActions || []) {
    if (!automaticPcIds.has(action?.pcId)) throw new Error('auto action was emitted for a human-controlled PC');
  }
  return result;
}
