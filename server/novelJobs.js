import crypto from 'node:crypto';
import {
  sessionKey,
  sessionNovelDocPath,
  sessionNovelMetaKey,
  sessionNovelJobKey,
  sessionNovelNoticeKey,
} from './storage/paths.js';
import { buildTranscriptWithMarkers } from './novelMarkers.js';
import { generateNovel, NOVELIZE_UPSTREAM_TIMEOUT_MS, NOVELIZE_MAX_CONTINUATIONS } from './novelGeneration.js';

// runningのまま放置されたジョブを失敗とみなすまでの時間。
// 生成は打ち切り時に継続リクエストを重ねるため、最悪ケース
// (初回+継続の全リクエストがそれぞれ上流タイムアウトぎりぎりまでかかり、
// さらにセッション更新による再生成が上限まで走る)を包含していないと、
// 正常に進行中のジョブを失敗扱いにしてしまう。
// 小説生成中に別端末からログが増えた場合、最新スナップショットで自動生成し直す上限。
// プレイ継続中に無制限で再生成されるのを防ぎつつ、端末切替直後の遅延同期を吸収する。
export const NOVELIZE_MAX_SESSION_REFRESHES = 2;
export const NOVEL_JOB_TIMEOUT_MS =
  NOVELIZE_UPSTREAM_TIMEOUT_MS *
    (NOVELIZE_MAX_CONTINUATIONS + 1) *
    (NOVELIZE_MAX_SESSION_REFRESHES + 1) +
  300000;

function novelSourceHash(session) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      pcName: session?.pc?.name || '',
      turnCount: session?.state?.turn_count ?? null,
      log: session?.log || [],
    }))
    .digest('hex');
}

export function makeBootId() {
  return `boot_${crypto.randomBytes(8).toString('hex')}`;
}

// 保存されたジョブレコードを、読み取り時点の見かけの状態へ解決する。
// runningのまま残ったジョブ(プロセス再起動で実行主体が消えた/異常に長い)を
// ここで失敗に倒すことで、UIが永久に「小説化中…」で固まるのを防ぐ。
//
// 経過時間は絶対時刻(startedAt)ではなく差分で返す。クライアントの時計がサーバーと
// ずれていても表示が狂わないようにするため。
export function resolveJobStatus(job, { bootId, now }) {
  if (!job) return { status: 'idle', error: null, elapsedMs: null };
  if (job.status !== 'running') return { status: job.status, error: job.error ?? null, elapsedMs: null };
  if (job.bootId !== bootId) {
    return {
      status: 'error',
      error: 'サーバーの再起動により中断されました。もう一度お試しください。',
      elapsedMs: null,
    };
  }
  if (now - job.startedAt > NOVEL_JOB_TIMEOUT_MS) {
    return { status: 'error', error: '時間内に完了しませんでした。もう一度お試しください。', elapsedMs: null };
  }
  return { status: 'running', error: null, elapsedMs: now - job.startedAt };
}

export function createNovelJobRunner({
  dataStore,
  textStore,
  apiKey,
  model,
  fetchImpl = fetch,
  bootId = makeBootId(),
  now = Date.now,
}) {
  // 実行中Promiseの控え。テストの待ち合わせに使う(二重起動の抑止は永続レコード側で行う)。
  const pending = new Map();

  async function write(userId, sessionId, record) {
    await dataStore.set(sessionNovelJobKey(userId, sessionId), record);
  }

  async function read(userId, sessionId) {
    const job = await dataStore.get(sessionNovelJobKey(userId, sessionId));
    return resolveJobStatus(job, { bootId, now: now() });
  }

  async function run(userId, sessionId, session, pov, startedAt) {
    try {
      // ログの破損などによる同期的な例外もここでcatchし、error記録に倒す。
      // tryの外に置くとrun()のPromiseがrejectし、start()側で誰も待たないため
      // プロセス全体を落とす未処理rejectionになってしまう。
      let sourceSession = session;
      let generated = false;
      for (let refresh = 0; refresh <= NOVELIZE_MAX_SESSION_REFRESHES; refresh += 1) {
        const sourceHash = novelSourceHash(sourceSession);
        const { transcript, imageIds } = buildTranscriptWithMarkers(sourceSession.log);
        const { text, truncated } = await generateNovel({
          transcript,
          hasImages: imageIds.length > 0,
          // 旧セッションは pc.name を持たない。空文字で渡し、呼称の決定はモデルに委ねる。
          pcName: sourceSession.pc?.name || '',
          pov,
          apiKey,
          model,
          fetchImpl,
        });

        // 生成中にスマホ等からログが増えていたら、旧本文を完成扱いで保存せず、
        // 最新セッションを入力に自動生成し直す。
        const latest = await dataStore.get(sessionKey(userId, sessionId));
        if (latest && novelSourceHash(latest) !== sourceHash) {
          if (refresh === NOVELIZE_MAX_SESSION_REFRESHES) {
            throw new Error('小説化中もセッションが更新され続けたため完了できませんでした。プレイ終了後に再試行してください。');
          }
          sourceSession = latest;
          continue;
        }
        // truncatedでも保存する。継続の上限に達しただけで本文自体は使えるので、
        // 複数リクエスト分のコストを払った生成を捨てない(欠落はUIで警告する)。
        await textStore.write(sessionNovelDocPath(userId, sessionId), text);
        await dataStore.set(sessionNovelMetaKey(userId, sessionId), {
          turnCount: sourceSession.state?.turn_count ?? null,
          updatedAt: now(),
          imageIds,
          truncated,
        });

        // 本文・メタ保存中にも更新が届き得る。完了通知を出す直前に再確認し、
        // 更新済みなら保存した旧本文を成功扱いにせず、最新ログで再生成する。
        const afterSave = await dataStore.get(sessionKey(userId, sessionId));
        if (afterSave && novelSourceHash(afterSave) !== sourceHash) {
          if (refresh === NOVELIZE_MAX_SESSION_REFRESHES) {
            throw new Error('小説化中もセッションが更新され続けたため完了できませんでした。プレイ終了後に再試行してください。');
          }
          sourceSession = afterSave;
          continue;
        }
        generated = true;
        break;
      }

      if (!generated) throw new Error('小説化する最新ログを確定できませんでした。');
      // 生成できたことをユーザーがまだ受け取っていない、という印。
      // 「既読の記録が無い=未読」と定義すると、この機能の投入時に過去の小説が
      // 一斉に未読になってしまう。成功時に立てて受け取り時に降ろす形にする。
      await dataStore.set(sessionNovelNoticeKey(userId, sessionId), { unread: true });
      await write(userId, sessionId, { status: 'done', startedAt, updatedAt: now(), error: null, bootId });
    } catch {
      try {
        await write(userId, sessionId, {
          status: 'error',
          startedAt,
          updatedAt: now(),
          error: '小説化に失敗した。時間をおいて再試行してください。',
          bootId,
        });
      } catch (writeErr) {
        // ここでの書き込み失敗(ディスクI/Oエラー等)を握りつぶすとrun()のPromiseが
        // rejectしてしまい、start()側で誰も待っていないため未処理rejectionでプロセスが
        // 落ちる。記録は諦めるが、ログには残す。
        console.error('novelJobs error persistence failed', {
          name: writeErr?.name || 'Error',
          code: writeErr?.code || null,
        });
      }
    }
  }

  // ジョブをrunningで記録してからバックグラウンド実行を始める。生成の完了は待たない。
  async function start(userId, sessionId, session, pov) {
    const key = `${userId}/${sessionId}`;
    // 同じセッションに対する二重startで生成が2回走らないようにする
    // (利用枠の二重消費を防ぐのはルート側の責務であり、ここでは扱わない)。
    if (pending.has(key)) return;
    const startedAt = now();
    // 新しい生成は前回の小説を置き換える。前回分の未読フラグが残ったままだと
    // running中にunread:trueが観測され、既読化(古いnotice宛のPOST)が今回の
    // 成功時のunread:trueを上書き消去しうる。開始時点で必ず降ろしておく。
    await dataStore.set(sessionNovelNoticeKey(userId, sessionId), { unread: false });
    await write(userId, sessionId, { status: 'running', startedAt, updatedAt: startedAt, error: null, bootId });
    const p = run(userId, sessionId, session, pov, startedAt).finally(() => pending.delete(key));
    pending.set(key, p);
  }

  return { read, start, pending, bootId };
}
