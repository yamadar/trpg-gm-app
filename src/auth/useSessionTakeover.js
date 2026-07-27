import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { listSessions } from '../storage/index.js';
import {
  getSessionSyncState,
  listServerSessions,
  putSessionToServer,
  rememberSessionSync,
} from '../api/sessionSyncClient.js';
import { reconcileServerSessions } from '../api/sessionReconcile.js';

export function useSessionTakeover() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState([]);
  const [ready, setReady] = useState(!user);
  const [syncVersion, setSyncVersion] = useState(0);
  const checkedForRef = useRef(null); // 同一ユーザーで1回だけ

  // user オブジェクトそのものではなく id にのみ依存する。refresh() は同じ id を
  // 持つ新しい user オブジェクトを返すことがあり(例: アカウントメニューからの
  // プロフィール保存後)、
  // [user] に依存しているとその再レンダーのたびにエフェクトが再実行されてしまう。
  // その結果、進行中のチェックが cleanup で cancelled 扱いになる一方、新しい実行は
  // checkedForRef.current === user.id の早期リターンで何もせず、
  // setCandidates が呼ばれずに引き継ぎ提案が消えてしまう。
  useEffect(() => {
    if (!user) {
      setReady(true);
      return;
    }
    if (checkedForRef.current === user.id) return;
    checkedForRef.current = user.id;
    setReady(false);
    let cancelled = false;
    (async () => {
      try {
        const [local, server] = await Promise.all([listSessions(), listServerSessions()]);
        if (cancelled) return;
        const serverById = new Map(server.map((s) => [s.id, s]));
        const { pulledIds } = await reconcileServerSessions(local, server);

        // revision導入前の同一データにも同期基点を記録する。
        for (const localSession of local) {
          const remote = serverById.get(localSession.id);
          if (
            remote &&
            !getSessionSyncState(localSession) &&
            (remote?._sync?.revision ?? 0) === 0 &&
            (localSession.updatedAt || 0) === (remote.updatedAt || 0)
          ) {
            rememberSessionSync(remote);
          }
        }

        setCandidates(
          local.filter((localSession) => {
            const remote = serverById.get(localSession.id);
            if (!remote) return true;
            const syncState = getSessionSyncState(localSession);
            const localRevision = syncState?.revision ?? localSession?._sync?.revision ?? 0;
            const remoteRevision = remote?._sync?.revision ?? 0;
            if (remoteRevision !== localRevision) return false;
            if (syncState?.lastSyncedUpdatedAt != null) {
              return (localSession.updatedAt ?? null) !== syncState.lastSyncedUpdatedAt;
            }
            return (localSession.updatedAt || 0) > (remote.updatedAt || 0);
          })
        );
        if (pulledIds.length > 0) setSyncVersion((v) => v + 1);
      } catch (e) {
        console.error('session takeover check failed', e);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const confirm = useCallback(async () => {
    for (const session of candidates) {
      try {
        await putSessionToServer(session);
      } catch (e) {
        console.error('session upload failed', e);
      }
    }
    setCandidates([]);
  }, [candidates]);

  const dismiss = useCallback(() => setCandidates([]), []);

  return { pendingCount: candidates.length, confirm, dismiss, ready, syncVersion };
}
