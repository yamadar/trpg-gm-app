import crypto from 'node:crypto';
import { sessionNovelDocPath, sessionNovelMetaKey, sessionNovelJobKey } from './storage/paths.js';
import { buildTranscriptWithMarkers } from './novelMarkers.js';

// HTTPリクエストが応答を待たなくなったので、上流の打ち切りは同期時代の120秒から延ばす。
export const NOVELIZE_UPSTREAM_TIMEOUT_MS = 300000;
// runningのまま放置されたジョブを失敗とみなすまでの時間。上流タイムアウトより十分長く取る。
export const NOVEL_JOB_TIMEOUT_MS = 600000;

const MARKER_INSTRUCTION =
  '\nトランスクリプト中の〈挿絵N〉は対応する場面の挿絵挿入位置である。小説本文の対応する場面の切れ目に、各マーカーを一度だけ行独立でそのまま残すこと。';

export function makeBootId() {
  return `boot_${crypto.randomBytes(8).toString('hex')}`;
}

function extractText(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// pov: 'third'(既定)または 'first'。
function buildNovelizeSystemPrompt(pov) {
  const voice = pov === 'first' ? 'PC視点の一人称' : '三人称';
  return `以下はTRPGセッションの進行ログである。プレイヤー発言とGMの地の文が交互に並んでいる。これを${voice}の小説として、場面転換や心理描写を補いながら自然な文章に書き直せ。ゲーム的な表現(選択肢・判定結果の数値等)はそのまま出力せず、物語として自然に溶け込ませること。説明文やコードブロック記号は付けず、小説本文のみを出力すること。`;
}

// 保存されたジョブレコードを、読み取り時点の見かけの状態へ解決する。
// runningのまま残ったジョブ(プロセス再起動で実行主体が消えた/異常に長い)を
// ここで失敗に倒すことで、UIが永久に「小説化中…」で固まるのを防ぐ。
export function resolveJobStatus(job, { bootId, now }) {
  if (!job) return { status: 'idle', error: null };
  if (job.status !== 'running') return { status: job.status, error: job.error ?? null };
  if (job.bootId !== bootId) {
    return { status: 'error', error: 'サーバーの再起動により中断されました。もう一度お試しください。' };
  }
  if (now - job.startedAt > NOVEL_JOB_TIMEOUT_MS) {
    return { status: 'error', error: '時間内に完了しませんでした。もう一度お試しください。' };
  }
  return { status: 'running', error: null };
}

export function createNovelJobRunner({
  dataStore,
  textStore,
  apiKey,
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
      const { transcript, imageIds } = buildTranscriptWithMarkers(session.log);
      const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 12000,
          thinking: { type: 'disabled' },
          system: buildNovelizeSystemPrompt(pov) + (imageIds.length > 0 ? MARKER_INSTRUCTION : ''),
          messages: [{ role: 'user', content: transcript }],
        }),
        signal: AbortSignal.timeout(NOVELIZE_UPSTREAM_TIMEOUT_MS),
      });
      if (!upstream.ok) {
        const t = await upstream.text().catch(() => '');
        throw new Error(`upstream request failed: ${t.slice(0, 200)}`);
      }
      const data = await upstream.json();
      if (data.stop_reason === 'max_tokens') {
        throw new Error('novelization was truncated (max_tokens); not saved');
      }
      const text = extractText(data.content);
      if (!text) throw new Error('novelization produced empty output; not saved');

      await textStore.write(sessionNovelDocPath(userId, sessionId), text);
      await dataStore.set(sessionNovelMetaKey(userId, sessionId), {
        turnCount: session.state?.turn_count ?? null,
        updatedAt: now(),
        imageIds,
      });
      await write(userId, sessionId, { status: 'done', startedAt, updatedAt: now(), error: null, bootId });
    } catch (e) {
      try {
        // Error以外の値がthrowされてもe.messageがundefinedにならないようにする
        // (カードにエラー理由が出ない状態を避けるため)。
        await write(userId, sessionId, {
          status: 'error',
          startedAt,
          updatedAt: now(),
          error: String(e?.message || e),
          bootId,
        });
      } catch (writeErr) {
        // ここでの書き込み失敗(ディスクI/Oエラー等)を握りつぶすとrun()のPromiseが
        // rejectしてしまい、start()側で誰も待っていないため未処理rejectionでプロセスが
        // 落ちる。記録は諦めるが、ログには残す。
        console.error('novelJobs: failed to persist error record', writeErr);
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
    await write(userId, sessionId, { status: 'running', startedAt, updatedAt: startedAt, error: null, bootId });
    const p = run(userId, sessionId, session, pov, startedAt).finally(() => pending.delete(key));
    pending.set(key, p);
  }

  return { read, start, pending, bootId };
}
