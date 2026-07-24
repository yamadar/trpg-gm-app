import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { listSessions } from '../storage/index.js';
import { listServerSessions, putSessionToServer } from '../api/sessionSyncClient.js';

export function useSessionTakeover() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState([]);
  const checkedForRef = useRef(null); // 同一ユーザーで1回だけ

  useEffect(() => {
    if (!user || checkedForRef.current === user.id) return;
    checkedForRef.current = user.id;
    let cancelled = false;
    (async () => {
      try {
        const [local, server] = await Promise.all([listSessions(), listServerSessions()]);
        if (cancelled) return;
        const serverById = new Map(server.map((s) => [s.id, s]));
        setCandidates(
          local.filter((s) => {
            const remote = serverById.get(s.id);
            return !remote || (s.updatedAt || 0) > (remote.updatedAt || 0);
          })
        );
      } catch (e) {
        console.error('session takeover check failed', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

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

  return { pendingCount: candidates.length, confirm, dismiss };
}
