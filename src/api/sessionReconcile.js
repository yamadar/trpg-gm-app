import { saveSession } from '../storage/index.js';
import {
  getServerSession,
  dispatchSessionConflict,
  getSessionSyncState,
  rememberSessionSync,
} from './sessionSyncClient.js';

export async function reconcileServerSessions(localSessions, serverSessions) {
  const localById = new Map(localSessions.map((session) => [session.id, session]));
  const pulledIds = [];
  const conflicts = [];

  for (let remote of serverSessions) {
    const local = localById.get(remote.id);
    if (!local) {
      if (remote._summary) remote = await getServerSession(remote.id);
      if (await saveSession(remote)) {
        rememberSessionSync(remote);
        pulledIds.push(remote.id);
      }
      continue;
    }

    const syncState = getSessionSyncState(local);
    const localRevision = syncState?.revision ?? local?._sync?.revision ?? 0;
    const remoteRevision = remote?._sync?.revision ?? 0;
    if (remoteRevision <= localRevision) continue;
    if (remote._summary) remote = await getServerSession(remote.id);

    const lastSyncedUpdatedAt = syncState?.lastSyncedUpdatedAt;
    const localDirty =
      lastSyncedUpdatedAt == null
        ? (local.updatedAt || 0) !== (remote.updatedAt || 0)
        : (local.updatedAt ?? null) !== lastSyncedUpdatedAt;
    if (localDirty) {
      conflicts.push({ local, remote });
      dispatchSessionConflict(local, remote, 'background-sync');
      continue;
    }

    if (await saveSession(remote)) {
      rememberSessionSync(remote);
      pulledIds.push(remote.id);
    }
  }

  return { pulledIds, conflicts };
}
