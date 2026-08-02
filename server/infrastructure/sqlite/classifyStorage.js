function segments(value) {
  return String(value).split('/').filter(Boolean);
}

function publicOwner(db, parts, value) {
  if (typeof value?.ownerId === 'string' && value.ownerId) return value.ownerId;
  if (parts.length < 3) return null;
  const rootKey = `public/${parts[1]}/${parts[2]}`;
  const row = db.prepare('SELECT owner_id FROM domain_records WHERE key = ?').get(rootKey);
  return row?.owner_id || null;
}

function partyOwner(db, parts, value) {
  if (typeof value?.ownerId === 'string' && value.ownerId) return value.ownerId;
  if (parts.length < 2) return null;
  const row = db.prepare('SELECT owner_id FROM domain_records WHERE key = ?').get(`sharedSessions/${parts[1]}`);
  return row?.owner_id || null;
}

export function moduleForJsonKey(key) {
  const parts = segments(key);
  if (parts[0] === 'auth') return 'auth';
  if (parts[0] === 'global' && parts[1] === 'usage') return 'usage';
  if (parts[0] === 'sharedSessions') return 'party';
  if (parts[0] === 'public') return 'publishing';
  if (parts[0] !== 'users' || !parts[1]) return 'system';
  const area = parts[2];
  if (area === 'sharedSessions') return 'party';
  if (area === 'usage') return 'usage';
  if (area === 'publish') return 'publishing';
  if (area === 'sessions') return parts.at(-1) === 'novelJob' ? 'jobs' : 'sessions';
  if (area === 'sessionDeletions' || area === 'endings') return 'sessions';
  if (area === 'worlds' && parts.includes('campaigns')) return 'campaigns';
  if (area === 'worlds' || area === 'rulesets') return 'library';
  if (area === 'profile' || area === 'profile-image') return 'auth';
  return 'system';
}

export function moduleForDocumentPath(documentPath) {
  const parts = segments(documentPath);
  if (parts[0] === 'public') return 'publishing';
  if (parts[0] === 'users' && parts[1]) {
    if (parts[2] === 'sessions') return 'sessions';
    if (parts[2] === 'worlds' && parts.includes('campaigns')) return 'campaigns';
    if (parts[2] === 'worlds') return 'library';
  }
  return 'system';
}

export function classifyJsonRecord(db, key, value) {
  const parts = segments(key);
  if (parts[0] === 'auth') return { module: 'auth', resourceType: parts[1] || 'auth', ownerId: null };
  if (parts[0] === 'global' && parts[1] === 'usage') {
    return { module: 'usage', resourceType: 'global-usage', ownerId: null };
  }
  if (parts[0] === 'sharedSessions') {
    return {
      module: 'party',
      resourceType: parts[2] || 'party-session',
      ownerId: partyOwner(db, parts, value),
    };
  }
  if (parts[0] === 'public') {
    return {
      module: 'publishing',
      resourceType: parts[1] === 'starters' ? 'starter-manifest' : `public-${parts[1] || 'content'}`,
      ownerId: publicOwner(db, parts, value),
    };
  }
  if (parts[0] !== 'users' || !parts[1]) {
    return { module: 'system', resourceType: parts[0] || 'record', ownerId: null };
  }

  const ownerId = parts[1];
  const area = parts[2];
  if (area === 'sharedSessions') {
    return { module: 'party', resourceType: 'party-membership', ownerId: null };
  }
  if (area === 'usage') return { module: 'usage', resourceType: 'daily-usage', ownerId };
  if (area === 'publish') return { module: 'publishing', resourceType: 'publish-map', ownerId };
  if (area === 'sessions') {
    const leaf = parts.at(-1);
    return {
      module: leaf === 'novelJob' ? 'jobs' : 'sessions',
      resourceType: leaf === 'novelJob' ? 'novel-job' : leaf || 'session',
      ownerId,
    };
  }
  if (area === 'sessionDeletions' || area === 'endings') {
    return { module: 'sessions', resourceType: area, ownerId };
  }
  if (area === 'worlds' && parts.includes('campaigns')) {
    return { module: 'campaigns', resourceType: parts.at(-2) === 'drafts' ? 'campaign-draft' : 'campaign', ownerId };
  }
  if (area === 'worlds' || area === 'rulesets') {
    return { module: 'library', resourceType: area === 'rulesets' ? 'ruleset' : 'library-item', ownerId };
  }
  if (area === 'profile' || area === 'profile-image') {
    return { module: 'auth', resourceType: area, ownerId };
  }
  return { module: 'system', resourceType: area || 'user-record', ownerId };
}

export function classifyTextDocument(db, documentPath) {
  const parts = segments(documentPath);
  if (parts[0] === 'public') {
    return {
      module: 'publishing',
      resourceType: `public-${parts[1] || 'document'}`,
      ownerId: publicOwner(db, parts),
    };
  }
  if (parts[0] === 'users' && parts[1]) {
    if (parts[2] === 'sessions') {
      return { module: 'sessions', resourceType: 'session-document', ownerId: parts[1] };
    }
    if (parts[2] === 'worlds' && parts.includes('campaigns')) {
      return { module: 'campaigns', resourceType: 'campaign-document', ownerId: parts[1] };
    }
    if (parts[2] === 'worlds') {
      return { module: 'library', resourceType: 'library-document', ownerId: parts[1] };
    }
  }
  return { module: 'system', resourceType: 'document', ownerId: null };
}
