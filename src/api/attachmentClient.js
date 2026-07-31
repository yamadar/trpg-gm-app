import { apiFetch } from './apiFetch.js';

export function attachmentBase(owner) {
  if (owner.type === 'world') {
    return `/api/worlds/${encodeURIComponent(owner.worldId)}`;
  }
  if (owner.type === 'scenario') {
    return `/api/worlds/${encodeURIComponent(owner.worldId)}/scenarios/${encodeURIComponent(owner.scenarioId)}`;
  }
  if (owner.type === 'character') {
    return `/api/worlds/${encodeURIComponent(owner.worldId)}/characters/${encodeURIComponent(owner.kind)}/${encodeURIComponent(owner.name)}`;
  }
  if (owner.type === 'novel') {
    return `/api/sessions/${encodeURIComponent(owner.sessionId)}/novel`;
  }
  throw new Error('unknown attachment owner');
}

export function attachmentUrl(owner, attachmentId, variant = 'display') {
  return `${attachmentBase(owner)}/attachments/${encodeURIComponent(attachmentId)}/${encodeURIComponent(variant)}`;
}

export function publicAttachmentUrl(type, publicId, attachmentId, variant = 'display') {
  return `/api/public/${encodeURIComponent(type)}/${encodeURIComponent(publicId)}/attachments/${encodeURIComponent(attachmentId)}/${encodeURIComponent(variant)}`;
}

export async function getAttachments(owner) {
  return apiFetch(`${attachmentBase(owner)}/attachments`);
}

export async function uploadAttachment(owner, file, description = '') {
  const body = new FormData();
  body.append('file', file);
  body.append('description', description);
  return apiFetch(`${attachmentBase(owner)}/attachments`, { method: 'POST', body });
}

export async function updateAttachment(owner, attachmentId, description) {
  return apiFetch(`${attachmentBase(owner)}/attachments/${encodeURIComponent(attachmentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
}

export async function deleteAttachment(owner, attachmentId) {
  return apiFetch(`${attachmentBase(owner)}/attachments/${encodeURIComponent(attachmentId)}`, {
    method: 'DELETE',
  });
}

export async function setTopAttachment(owner, imageId) {
  return apiFetch(`${attachmentBase(owner)}/attachments/top`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageId }),
  });
}

export async function uploadProfileImage(file) {
  const body = new FormData();
  body.append('file', file);
  return apiFetch('/api/me/profile-image', { method: 'POST', body });
}

export async function deleteProfileImage() {
  return apiFetch('/api/me/profile-image', { method: 'DELETE' });
}
