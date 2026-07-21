export function sessionKey(sessionId) {
  return `sessions/${sessionId}`;
}

export function worldMetaKey(worldId) {
  return `worlds/${worldId}`;
}

export function worldDocPath(worldId) {
  return `worlds/${worldId}/world.md`;
}

export function regionDocPath(worldId, region) {
  return `worlds/${worldId}/regions/${region}.md`;
}

export function categoryDocPath(worldId, category) {
  return `worlds/${worldId}/categories/${category}.md`;
}

export function characterDocPath(worldId, kind, name) {
  return `worlds/${worldId}/${kind}/${name}.md`;
}

export function characterMetaKey(worldId, kind, name) {
  return `worlds/${worldId}/${kind}/${name}.parsed`;
}

export function scenarioDocPath(worldId, scenarioId) {
  return `worlds/${worldId}/scenarios/${scenarioId}/scenario.md`;
}

export function scenarioMetaKey(worldId, scenarioId) {
  return `worlds/${worldId}/scenarios/${scenarioId}`;
}

export function campaignMetaKey(worldId, campaignId) {
  return `worlds/${worldId}/campaigns/${campaignId}/campaign`;
}

export function rulesetMetaKey(rulesetId) {
  return `rulesets/${rulesetId}`;
}
