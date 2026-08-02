import { Router } from 'express';
import {
  sessionKey,
  sessionDir,
  sessionDeletionKey,
  sessionNovelDocPath,
  sessionNovelMetaKey,
  sessionNovelNoticeKey,
  sessionListPrefix,
  sessionImagePath,
  sessionImageDir,
  novelAttachmentDir,
} from '../storage/paths.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { stripImageMarkers } from '../novelMarkers.js';
import { buildIllustratedHtml } from '../illustratedNovel.js';
import { getAttachmentCollection, topAttachmentOf } from '../storage/attachmentLibrary.js';
import { unpublishNovel } from '../storage/shareLibrary.js';
import { createKeyedLock } from '../keyedLock.js';

// 生成後にセッションが進んでいれば、保存済みの小説は古い。
function isStale(meta, session) {
  const currentTurn = session?.state?.turn_count ?? null;
  if (!meta || meta.turnCount == null || currentTurn == null) return false;
  return meta.turnCount !== currentTurn;
}

const PRESENCE_TTL_MS = 45_000;
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_SESSIONS_PER_USER = 100;
const MAX_SESSION_BYTES = 1024 * 1024;

function revisionOf(session) {
  const revision = session?._sync?.revision;
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function parseExpectedRevision(value) {
  if (value == null) return null;
  const match = String(value).trim().match(/^(?:W\/)?"?(\d+)"?$/);
  if (!match) return NaN;
  const revision = Number(match[1]);
  return Number.isSafeInteger(revision) ? revision : NaN;
}

function deviceIdOf(req, fallback = 'legacy-client') {
  const value = String(req.get('X-Device-Id') || '').trim();
  return DEVICE_ID_RE.test(value) ? value : fallback;
}

export function createSessionsRouter({
  dataStore,
  textStore,
  imageStore,
  apiKey,
  novelJobs,
  usage,
  sessionRepository = null,
  now = Date.now,
  withSessionLock = createKeyedLock(),
}) {
  const router = Router();
  router.param('id', idParamGuard);
  const activePlayers = new Map();

  router.get('/sessions', asyncHandler(async (req, res) => {
    const keys = await dataStore.list(sessionListPrefix(req.userId));
    const sessions = await Promise.all(keys.map((k) => dataStore.get(k)));
    // Party終了時のCampaign章精算用exportはowner名前空間にも置くが、Solo一覧へ
    // 二重表示しない。Party一覧は /party-sessions が担う。
    res.json(sessions.filter((session) => session && session.mode !== 'party'));
  }));

  // 一覧画面が全セッションのジョブ状態を1リクエストで取れるようにする
  // (セッションごとのポーリングだと件数分のリクエストが必要になるため)。
  router.get('/novel-jobs', asyncHandler(async (req, res) => {
    const keys = await dataStore.list(sessionListPrefix(req.userId));
    const out = {};
    // このエンドポイントはジョブ実行中5秒おきにポーリングされる。セッションごとの
    // 5回の読み取りは互いに独立しているため、直列awaitだとセッション数に比例して
    // レイテンシが伸びる(GET /sessionsと同様にPromise.allでまとめる)。
    await Promise.all(
      keys.map(async (key) => {
        const id = key.slice(key.lastIndexOf('/') + 1);
        const [{ status, error, elapsedMs }, text, meta, notice, session] = await Promise.all([
          novelJobs.read(req.userId, id),
          textStore.read(sessionNovelDocPath(req.userId, id)),
          dataStore.get(sessionNovelMetaKey(req.userId, id)),
          dataStore.get(sessionNovelNoticeKey(req.userId, id)),
          dataStore.get(key),
        ]);
        const topImage = topAttachmentOf(
          await getAttachmentCollection(dataStore, novelAttachmentDir(req.userId, id)),
        );
        out[id] = {
          status,
          error,
          // 実行中のみ数値。クライアントはこれを起点に秒を補間して表示する。
          elapsedMs,
          hasNovel: text !== null,
          stale: isStale(meta, session),
          // この変更以前に生成された小説のメタにはtruncatedが無い。完結扱いにする。
          truncated: meta?.truncated === true,
          // レコードが無い(この機能の投入以前に生成された小説)は既読扱いにする。
          // ここを未読に倒すと、投入直後に過去の全小説が一斉に通知される。
          unread: notice?.unread === true,
          ...(topImage ? { topImage } : {}),
        };
      })
    );
    res.json(out);
  }));

  router.get('/sessions/:id', asyncHandler(async (req, res) => {
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json(session);
  }));

  router.put('/sessions/:id', asyncHandler(async (req, res) => {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      res.status(400).json({ error: 'session body must be an object' });
      return;
    }
    const expectedRevision = parseExpectedRevision(req.get('If-Match'));
    if (Number.isNaN(expectedRevision)) {
      res.status(400).json({ error: 'If-Match must contain a non-negative revision' });
      return;
    }
    const force = req.get('X-Force-Overwrite') === 'true';
    const key = sessionKey(req.userId, req.params.id);
    const result = await withSessionLock(`user-sessions/${req.userId}`, () => withSessionLock(key, async () => {
      const deletionKey = sessionDeletionKey(req.userId, req.params.id);
      const [current, tombstone] = await Promise.all([
        dataStore.get(key),
        dataStore.get(deletionKey),
      ]);
      const currentRevision = revisionOf(current);
      // 削除途中で後続ストアの削除に失敗した場合、Session本体とtombstoneが一時的に
      // 共存する。通常PUTを許すと削除処理と競合して復活するため、forceだけを復旧経路にする。
      if (tombstone && !force) {
        return { deleted: tombstone };
      }
      if (!force && current && expectedRevision !== null && expectedRevision !== currentRevision) {
        return { conflict: current };
      }
      const savedAt = now();
      const session = {
        ...req.body,
        id: req.params.id,
        _sync: {
          revision: currentRevision + 1,
          updatedAt: savedAt,
          updatedByDeviceId: deviceIdOf(req),
          clientUpdatedAt: Number.isFinite(req.body.updatedAt) ? req.body.updatedAt : null,
        },
      };
      if (Buffer.byteLength(JSON.stringify(session), 'utf8') > MAX_SESSION_BYTES) {
        return { tooLarge: true };
      }
      if (!current) {
        const keys = await dataStore.list(sessionListPrefix(req.userId));
        if (keys.length >= MAX_SESSIONS_PER_USER) return { tooMany: true };
      }
      if (current && !force && sessionRepository?.compareAndSet) {
        const saved = await sessionRepository.compareAndSet(key, currentRevision, session);
        if (!saved.ok) return { conflict: saved.current };
      } else {
        await dataStore.set(key, session);
      }
      if (tombstone) await dataStore.delete(deletionKey);
      return { session };
    }));
    if (result.tooLarge) {
      res.status(413).json({ error: 'session is too large', code: 'SESSION_TOO_LARGE' });
      return;
    }
    if (result.tooMany) {
      res.status(409).json({ error: 'session limit reached', code: 'SESSION_LIMIT_REACHED' });
      return;
    }
    if (result.deleted) {
      res.status(409).json({
        error: 'session was deleted on another device',
        code: 'SESSION_DELETED',
        deletedAt: result.deleted.deletedAt,
      });
      return;
    }
    if (result.conflict) {
      res.status(409).json({
        error: 'session was updated by another device',
        code: 'SESSION_CONFLICT',
        current: result.conflict,
      });
      return;
    }
    res.json(result.session);
  }));

  router.delete('/sessions/:id', asyncHandler(async (req, res) => {
    const key = sessionKey(req.userId, req.params.id);
    const result = await withSessionLock(`user-sessions/${req.userId}`, () => withSessionLock(key, async () => {
      const session = await dataStore.get(key);
      const deletionKey = sessionDeletionKey(req.userId, req.params.id);
      if (!session) {
        return await dataStore.get(deletionKey) ? { alreadyDeleted: true } : { missing: true };
      }
      const job = await novelJobs.read(req.userId, req.params.id);
      if (job.status === 'running') return { running: true };

      // tombstoneを破壊的処理より先に確定する。後続処理が途中で失敗しても通常PUTを
      // 拒否し、同じDELETEで安全に再試行できる。
      await dataStore.set(deletionKey, {
        sessionId: req.params.id,
        deletedAt: now(),
        revision: revisionOf(session),
      });
      // 公開小説は独立スナップショットだが、元セッション削除後はHomeから公開解除できない。
      // 孤立公開物と課金不能データを残さないため、セッションと同時に解除する。
      await unpublishNovel(dataStore, textStore, req.userId, req.params.id, imageStore);
      await imageStore.deleteDir(sessionImageDir(req.userId, req.params.id));
      await imageStore.deleteDir(novelAttachmentDir(req.userId, req.params.id));
      // 現行FS adapterではこのディレクトリ配下にMarkdown、ジョブJSON、画像manifestが
      // 同居する。ルートmetaはディレクトリ外の{id}.jsonなので別途削除する。
      await textStore.deleteDir(sessionDir(req.userId, req.params.id));
      await dataStore.delete(key);
      activePlayers.delete(`${req.userId}/${req.params.id}`);
      return { deleted: true };
    }));

    if (result.missing) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    if (result.running) {
      res.status(409).json({
        error: 'novel generation is running',
        code: 'SESSION_JOB_RUNNING',
      });
      return;
    }
    res.status(204).end();
  }));

  router.post('/sessions/:id/presence', asyncHandler(async (req, res) => {
    const key = sessionKey(req.userId, req.params.id);
    const session = await dataStore.get(key);
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    const deviceId = deviceIdOf(req, '');
    if (!deviceId) {
      res.status(400).json({ error: 'X-Device-Id is required' });
      return;
    }
    const timestamp = now();
    const presenceKey = `${req.userId}/${req.params.id}`;
    const devices = activePlayers.get(presenceKey) || new Map();
    for (const [id, lastSeenAt] of devices) {
      if (timestamp - lastSeenAt > PRESENCE_TTL_MS) devices.delete(id);
    }
    const otherDeviceActive = [...devices.keys()].some((id) => id !== deviceId);
    devices.set(deviceId, timestamp);
    activePlayers.set(presenceKey, devices);
    res.json({ otherDeviceActive, sync: session._sync || null });
  }));

  router.delete('/sessions/:id/presence', asyncHandler(async (req, res) => {
    const deviceId = deviceIdOf(req, '');
    const presenceKey = `${req.userId}/${req.params.id}`;
    const devices = activePlayers.get(presenceKey);
    if (devices && deviceId) {
      devices.delete(deviceId);
      if (devices.size === 0) activePlayers.delete(presenceKey);
    }
    res.json({ ok: true });
  }));

  // 生成は待たずに202を返す。進行状況は GET /novel-jobs で参照する。
  router.post('/sessions/:id/novelize', asyncHandler(async (req, res) => {
    if (!apiKey) {
      res.status(503).json({ error: 'novel generation is unavailable', code: 'NOVEL_GENERATION_UNAVAILABLE' });
      return;
    }
    const key = sessionKey(req.userId, req.params.id);
    // 別端末の最終ターンPUTと小説化POSTがほぼ同時に届いた場合、PUTの永続化中に
    // セッションを読むと一つ前のログを生成ジョブへ固定してしまう。PUTと同じロックへ
    // 読み取りとジョブ登録を並べ、削除がその間へ割り込む競合窓も閉じる。
    const result = await withSessionLock(key, async () => {
      const session = await dataStore.get(key);
      if (!session) return { missing: true };
      // 生成中の再要求は利用枠を消費せず、そのまま現状を返す(二重起動の抑止)。
      const current = await novelJobs.read(req.userId, req.params.id);
      if (current.status === 'running') return { running: true };
      if (usage) {
        const check = await usage.consume(req.userId, 'novelize');
        if (!check.ok) return { rateLimited: true, resetAt: check.resetAt };
      }
      // HTTP応答後も小説本文・メタを書き込むため、容量予約をジョブ完了まで保持する。
      // storageGuardを使わない単体テストではundefinedとなり、従来どおり動作する。
      const releaseStorageReservation = req.storageReservation?.retain?.();
      try {
        await novelJobs.start(
          req.userId,
          req.params.id,
          session,
          req.body?.pov === 'first' ? 'first' : 'third',
          { onSettled: releaseStorageReservation },
        );
      } catch (error) {
        releaseStorageReservation?.();
        throw error;
      }
      return { started: true };
    });
    if (result.missing) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    if (result.running) {
      res.status(202).json({ status: 'running' });
      return;
    }
    if (result.rateLimited) {
      res.status(429).json({ error: 'daily limit reached', resetAt: result.resetAt });
      return;
    }
    res.status(202).json({ status: 'running' });
  }));

  // 完了通知を受け取ったことを記録する。冪等であり、既に既読でも成功する。
  // 204ではなくJSONを返すのは、クライアントのapiFetchが成功時に必ず
  // res.json()を呼ぶため(空ボディだとパースに失敗する)。
  router.post('/sessions/:id/novel/seen', asyncHandler(async (req, res) => {
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    await dataStore.set(sessionNovelNoticeKey(req.userId, req.params.id), { unread: false });
    res.json({ ok: true });
  }));

  router.get('/sessions/:id/novel', asyncHandler(async (req, res) => {
    const text = await textStore.read(sessionNovelDocPath(req.userId, req.params.id));
    if (text === null) {
      res.status(404).json({ error: 'novel not found' });
      return;
    }
    const meta = await dataStore.get(sessionNovelMetaKey(req.userId, req.params.id));
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    res.json({ text: stripImageMarkers(text), stale: isStale(meta, session) });
  }));

  router.get('/sessions/:id/novel/illustrated', asyncHandler(async (req, res) => {
    const text = await textStore.read(sessionNovelDocPath(req.userId, req.params.id));
    if (text === null) {
      res.status(404).json({ error: 'novel not found' });
      return;
    }
    const [meta, session] = await Promise.all([
      dataStore.get(sessionNovelMetaKey(req.userId, req.params.id)),
      dataStore.get(sessionKey(req.userId, req.params.id)),
    ]);
    const imageIds = Array.isArray(meta?.imageIds) ? meta.imageIds : [];
    const images = new Map();
    for (const imageId of imageIds) {
      images.set(imageId, await imageStore.read(sessionImagePath(req.userId, req.params.id, imageId)));
    }
    res.json({
      html: buildIllustratedHtml({
        title: session?.title || '小説',
        novelText: text,
        imageIds,
        images,
      }),
    });
  }));

  return router;
}
