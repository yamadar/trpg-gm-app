import { apiFetch } from './apiFetch.js';
import { getSession, saveSession } from '../storage/index.js';

const DEVICE_ID_KEY = 'trpg-gm-device-id';
const SYNC_STATE_KEY = 'trpg-gm-session-sync';
export const SESSION_CONFLICT_EVENT = 'trpg-session-conflict';
const putQueues = new Map();
const blockedSessions = new Set();
let memoryDeviceId = null;

function storage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readSyncStates() {
  try {
    return JSON.parse(storage()?.getItem(SYNC_STATE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function writeSyncStates(states) {
  try {
    storage()?.setItem(SYNC_STATE_KEY, JSON.stringify(states));
  } catch {
    // localStorageが使えなくても条件更新自体はsession._syncを使って継続する。
  }
}

export function getDeviceId() {
  if (memoryDeviceId) return memoryDeviceId;
  const existing = storage()?.getItem(DEVICE_ID_KEY);
  if (existing) {
    memoryDeviceId = existing;
    return existing;
  }
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const id = `device_${random}`;
  memoryDeviceId = id;
  try {
    storage()?.setItem(DEVICE_ID_KEY, id);
  } catch {
    // 保存不可なら、このページ内で生成値を使う。競合検知はrevision側で維持される。
  }
  return id;
}

export function getSessionSyncState(sessionOrId) {
  const id = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId?.id;
  if (!id) return null;
  const stored = readSyncStates()[id];
  if (stored && Number.isSafeInteger(stored.revision)) return stored;
  const embedded = typeof sessionOrId === 'object' ? sessionOrId?._sync : null;
  if (!Number.isSafeInteger(embedded?.revision)) return null;
  return {
    revision: embedded.revision,
    lastSyncedUpdatedAt: embedded.clientUpdatedAt ?? sessionOrId.updatedAt ?? null,
    serverUpdatedAt: embedded.updatedAt ?? null,
    updatedByDeviceId: embedded.updatedByDeviceId ?? null,
  };
}

export function rememberSessionSync(session) {
  if (!session?.id || !Number.isSafeInteger(session?._sync?.revision)) return;
  const states = readSyncStates();
  states[session.id] = {
    revision: session._sync.revision,
    lastSyncedUpdatedAt: session._sync.clientUpdatedAt ?? session.updatedAt ?? null,
    serverUpdatedAt: session._sync.updatedAt ?? null,
    updatedByDeviceId: session._sync.updatedByDeviceId ?? null,
  };
  writeSyncStates(states);
  // サーバー進捗を採用した、または明示上書きが成功したため、新しいrevisionを
  // 基点に以後の送信を再開できる。
  blockedSessions.delete(session.id);
}

export function forgetSessionSync(id) {
  if (!id) return;
  const states = readSyncStates();
  delete states[id];
  writeSyncStates(states);
  blockedSessions.delete(id);
}

export function dispatchSessionConflict(local, remote, reason = 'write-conflict') {
  const sessionId = local?.id || remote?.id;
  if (sessionId) blockedSessions.add(sessionId);
  if (
    typeof window === 'undefined' ||
    typeof window.dispatchEvent !== 'function' ||
    typeof CustomEvent === 'undefined'
  ) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(SESSION_CONFLICT_EVENT, {
      detail: { sessionId, local, remote, reason },
    })
  );
}

async function recordSuccessfulSync(submitted, saved) {
  rememberSessionSync(saved);
  if (!saved?._sync || !submitted?.id) return;
  // PUT待ち中に次ターンがローカル保存されていた場合、古い応答本体でIndexedDBを
  // 巻き戻さない。同じupdatedAtの内容がまだ残る場合だけ同期メタを差し込む。
  const current = await getSession(submitted.id);
  if (current && current.updatedAt === submitted.updatedAt) {
    await saveSession({ ...current, _sync: saved._sync });
  }
}

async function performPut(session, { force = false } = {}) {
  if (!force && blockedSessions.has(session.id)) {
    const blocked = new Error('別端末の進捗との競合を解決するまで同期を停止中');
    blocked.status = 409;
    blocked.code = 'SESSION_SYNC_BLOCKED';
    throw blocked;
  }
  const syncState = getSessionSyncState(session);
  const expectedRevision = syncState?.revision ?? 0;
  try {
    const saved = await apiFetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': getDeviceId(),
        'If-Match': `"${expectedRevision}"`,
        ...(force ? { 'X-Force-Overwrite': 'true' } : {}),
      },
      body: JSON.stringify(session),
    });
    await recordSuccessfulSync(session, saved);
    return saved;
  } catch (error) {
    if (error.status === 409 && error.body?.code === 'SESSION_CONFLICT') {
      dispatchSessionConflict(session, error.body.current, 'write-conflict');
    }
    throw error;
  }
}

export function putSessionToServer(session, options) {
  const previous = putQueues.get(session.id) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => performPut(session, options));
  putQueues.set(session.id, current);
  current.finally(() => {
    if (putQueues.get(session.id) === current) putQueues.delete(session.id);
  }).catch(() => {});
  return current;
}

export async function getServerSession(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function deleteServerSession(id) {
  await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  forgetSessionSync(id);
}

export async function heartbeatSession(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/presence`, {
    method: 'POST',
    headers: { 'X-Device-Id': getDeviceId() },
  });
}

export async function releaseSessionPresence(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/presence`, {
    method: 'DELETE',
    headers: { 'X-Device-Id': getDeviceId() },
  });
}

export async function novelizeSession(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/novelize`, { method: 'POST' });
}

export async function getNovel(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/novel`, { method: 'GET' });
}

export async function getIllustratedNovel(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/novel/illustrated`, { method: 'GET' });
}

// 完了通知を受け取ったことをサーバーに記録する。以降その小説は未読でなくなる。
export async function markNovelSeen(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/novel/seen`, { method: 'POST' });
}

export async function listServerSessions() {
  return apiFetch('/api/sessions');
}

// 一覧画面が全セッションの小説化ジョブ状態を1リクエストで取得する。
export async function listNovelJobs() {
  return apiFetch('/api/novel-jobs');
}
