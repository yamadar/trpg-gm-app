export function sessionListPrefix(userId) {
  return `users/${userId}/sessions`;
}

export function sessionKey(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}`;
}

export function sessionNovelDocPath(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}/novel.md`;
}

export function sessionNovelMetaKey(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}/novel`;
}

export function worldListPrefix(userId) {
  return `users/${userId}/worlds`;
}

export function worldMetaKey(userId, worldId) {
  return `users/${userId}/worlds/${worldId}`;
}

export function worldDocPath(userId, worldId) {
  return `users/${userId}/worlds/${worldId}/world.md`;
}

export function worldSourceDocPath(userId, worldId) {
  return `users/${userId}/worlds/${worldId}/source.md`;
}

export function regionDocPath(userId, worldId, region) {
  return `users/${userId}/worlds/${worldId}/regions/${region}.md`;
}

export function categoryDocPath(userId, worldId, category) {
  return `users/${userId}/worlds/${worldId}/categories/${category}.md`;
}

export function characterDocPath(userId, worldId, kind, name) {
  return `users/${userId}/worlds/${worldId}/${kind}/${name}.md`;
}

export function characterMetaKey(userId, worldId, kind, name) {
  return `users/${userId}/worlds/${worldId}/${kind}/${name}.parsed`;
}

export function scenarioDocPath(userId, worldId, scenarioId) {
  return `users/${userId}/worlds/${worldId}/scenarios/${scenarioId}/scenario.md`;
}

export function scenarioMetaKey(userId, worldId, scenarioId) {
  return `users/${userId}/worlds/${worldId}/scenarios/${scenarioId}`;
}

export function campaignMetaKey(userId, worldId, campaignId) {
  return `users/${userId}/worlds/${worldId}/campaigns/${campaignId}/campaign`;
}

export function rulesetListPrefix(userId) {
  return `users/${userId}/rulesets`;
}

export function rulesetMetaKey(userId, rulesetId) {
  return `users/${userId}/rulesets/${rulesetId}`;
}
