import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { listSessions } from '../storage/index.js';
import { listServerSessions, putSessionToServer } from '../api/sessionSyncClient.js';

export function useSessionTakeover() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState([]);
  const checkedForRef = useRef(null); // 同一ユーザーで1回だけ

  // user オブジェクトそのものではなく id にのみ依存する。refresh() は同じ id を
  // 持つ新しい user オブジェクトを返すことがあり(例: AuthBar からのプロフィール保存後)、
  // [user] に依存しているとその再レンダーのたびにエフェクトが再実行されてしまう。
  // その結果、進行中のチェックが cleanup で cancelled 扱いになる一方、新しい実行は
  // checkedForRef.current === user.id の早期リターンで何もせず、
  // setCandidates が呼ばれずに引き継ぎ提案が消えてしまう。
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

  return { pendingCount: candidates.length, confirm, dismiss };
}
