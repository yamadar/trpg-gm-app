export const CAMPAIGN_CHANGE_KINDS = [
  'canon_fact_add',
  'character_upsert',
  'faction_upsert',
  'timeline_upsert',
  'thread_open',
  'thread_resolve',
];

export function emptyCampaignState() {
  return {
    canonFacts: [],
    characters: [],
    factions: [],
    timeline: [],
    openThreads: [],
  };
}

function records(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

export function normalizeCampaignState(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    canonFacts: records(source.canonFacts),
    characters: records(source.characters),
    factions: records(source.factions),
    timeline: records(source.timeline),
    openThreads: records(source.openThreads),
  };
}

function upsert(items, value) {
  const index = items.findIndex((item) => item.id === value.id);
  if (index === -1) return [...items, value];
  const next = [...items];
  next[index] = { ...items[index], ...value };
  return next;
}

function targetId(change) {
  return change.targetId || change.id;
}

export function applyCampaignChanges(currentState, changes) {
  let state = normalizeCampaignState(currentState);
  for (const change of Array.isArray(changes) ? changes : []) {
    const common = {
      id: targetId(change),
      title: change.title || '',
      details: change.details || '',
      visibility: change.visibility === 'gm' ? 'gm' : 'all',
      updatedAt: Date.now(),
    };
    switch (change.kind) {
      case 'canon_fact_add':
        state = { ...state, canonFacts: upsert(state.canonFacts, common) };
        break;
      case 'character_upsert':
        state = {
          ...state,
          characters: upsert(state.characters, { ...common, status: change.status || 'active' }),
        };
        break;
      case 'faction_upsert':
        state = {
          ...state,
          factions: upsert(state.factions, { ...common, status: change.status || 'active' }),
        };
        break;
      case 'timeline_upsert':
        state = {
          ...state,
          timeline: upsert(state.timeline, {
            ...common,
            status: change.status || 'pending',
            progress: Number.isFinite(change.progress)
              ? Math.max(0, Math.min(100, Math.round(change.progress)))
              : 0,
          }),
        };
        break;
      case 'thread_open':
        state = { ...state, openThreads: upsert(state.openThreads, common) };
        break;
      case 'thread_resolve': {
        const resolvedId = change.targetId || change.id;
        state = {
          ...state,
          openThreads: state.openThreads.filter((thread) => thread.id !== resolvedId),
        };
        break;
      }
      default:
        break;
    }
  }
  return state;
}
