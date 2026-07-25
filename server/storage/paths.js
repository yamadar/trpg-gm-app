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

export function sessionNovelJobKey(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}/novelJob`;
}

export function sessionNovelNoticeKey(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}/novelNotice`;
}

export function endingKey(userId, sessionId) {
  return `users/${userId}/endings/${sessionId}`;
}

export function endingListPrefix(userId) {
  return `users/${userId}/endings`;
}

export function sessionImageDir(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}/images`;
}

export function sessionImagePath(userId, sessionId, imageId) {
  return `users/${userId}/sessions/${sessionId}/images/${imageId}.png`;
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
  return `users/${userId}/worlds/${worldId}/campaigns/${campaignId}`;
}

export function campaignListPrefix(userId, worldId) {
  return `users/${userId}/worlds/${worldId}/campaigns`;
}

export function rulesetListPrefix(userId) {
  return `users/${userId}/rulesets`;
}

export function rulesetMetaKey(userId, rulesetId) {
  return `users/${userId}/rulesets/${rulesetId}`;
}

export function publicListPrefix(type) {
  return `public/${type}`;
}

export function publicMetaKey(type, publicId) {
  return `public/${type}/${publicId}`;
}

export function publicWorldDocsPrefix(publicId) {
  return `public/worlds/${publicId}`;
}

export function publicWorldDocPath(publicId) {
  return `public/worlds/${publicId}/world.md`;
}

export function publicRegionDocPath(publicId, region) {
  return `public/worlds/${publicId}/regions/${region}.md`;
}

export function publicCategoryDocPath(publicId, category) {
  return `public/worlds/${publicId}/categories/${category}.md`;
}

export function publicCharacterDocsPrefix(publicId) {
  return `public/characters/${publicId}`;
}

export function publicCharacterDocPath(publicId) {
  return `public/characters/${publicId}/sheet.md`;
}

export function publicScenarioDocsPrefix(publicId) {
  return `public/scenarios/${publicId}`;
}

export function publicScenarioDocPath(publicId) {
  return `public/scenarios/${publicId}/scenario.md`;
}

export function publicNovelDocsPrefix(publicId) {
  return `public/novels/${publicId}`;
}

export function publicNovelDocPath(publicId) {
  return `public/novels/${publicId}/novel.md`;
}

export function publishWorldMapKey(userId, worldId) {
  return `users/${userId}/publish/worlds/${worldId}`;
}

export function publishWorldListPrefix(userId) {
  return `users/${userId}/publish/worlds`;
}

export function publishCharacterMapKey(userId, worldId, kind, name) {
  return `users/${userId}/publish/worlds/${worldId}/characters/${kind}/${name}`;
}

export function publishCharacterListPrefix(userId, worldId, kind) {
  return `users/${userId}/publish/worlds/${worldId}/characters/${kind}`;
}

export function publishScenarioMapKey(userId, worldId, scenarioId) {
  return `users/${userId}/publish/worlds/${worldId}/scenarios/${scenarioId}`;
}

export function publishScenarioListPrefix(userId, worldId) {
  return `users/${userId}/publish/worlds/${worldId}/scenarios`;
}

export function publishNovelMapKey(userId, sessionId) {
  return `users/${userId}/publish/sessions/${sessionId}`;
}

export function publishNovelListPrefix(userId) {
  return `users/${userId}/publish/sessions`;
}
