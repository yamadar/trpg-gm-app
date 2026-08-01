// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './storage/dataStore.js';
import { createFsTextStore } from './storage/textStore.js';
import { sessionNovelJobKey, sessionNovelNoticeKey } from './storage/paths.js';
import {
  createNovelJobRunner,
  makeBootId,
  resolveJobStatus,
  NOVEL_JOB_TIMEOUT_MS,
  NOVELIZE_MAX_SESSION_REFRESHES,
} from './novelJobs.js';

let dir;
let dataStore;
let textStore;

const SESSION = {
  id: 's1',
  title: 'A',
  state: { turn_count: 3 },
  log: [
    { role: 'player', text: '波止場を調べる' },
    { role: 'gm', text: '誰もいなかった。' },
  ],
};

function geminiResponse(text, stopReason = 'end_turn') {
  return {
    ok: true,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text }] },
        finishReason: stopReason === 'max_tokens' ? 'MAX_TOKENS' : 'STOP',
      }],
    }),
  };
}

function okFetch(text = '小説本文') {
  return vi.fn().mockResolvedValue(geminiResponse(text));
}

function systemOf(fetchImpl) {
  return JSON.parse(fetchImpl.mock.calls[0][1].body).systemInstruction.parts[0].text;
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'novel-jobs-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('resolveJobStatus', () => {
  it('allows the worst-case continuation and session-refresh attempts to finish', () => {
    expect(NOVEL_JOB_TIMEOUT_MS).toBe(80 * 60 * 1000);
  });

  it('reports idle when there is no job', () => {
    expect(resolveJobStatus(null, { bootId: 'b1', now: 100 })).toEqual({
      status: 'idle',
      error: null,
      elapsedMs: null,
    });
  });

  it('passes through done and error records without an elapsed time', () => {
    expect(resolveJobStatus({ status: 'done', error: null }, { bootId: 'b1', now: 100 })).toEqual({
      status: 'done',
      error: null,
      elapsedMs: null,
    });
    expect(resolveJobStatus({ status: 'error', error: 'boom' }, { bootId: 'b1', now: 100 })).toEqual({
      status: 'error',
      error: 'boom',
      elapsedMs: null,
    });
  });

  it('keeps a fresh running job from the current process as running and reports its elapsed time', () => {
    const job = { status: 'running', startedAt: 100, bootId: 'b1' };
    expect(resolveJobStatus(job, { bootId: 'b1', now: 200 })).toEqual({
      status: 'running',
      error: null,
      elapsedMs: 100,
    });
  });

  it('treats a running job from a previous process as interrupted', () => {
    const job = { status: 'running', startedAt: 100, bootId: 'b0' };
    const out = resolveJobStatus(job, { bootId: 'b1', now: 200 });
    expect(out.status).toBe('error');
    expect(out.error).toContain('再起動');
    expect(out.elapsedMs).toBeNull();
  });

  it('treats a running job past the timeout as failed', () => {
    const job = { status: 'running', startedAt: 0, bootId: 'b1' };
    const out = resolveJobStatus(job, { bootId: 'b1', now: NOVEL_JOB_TIMEOUT_MS + 1 });
    expect(out.status).toBe('error');
    expect(out.error).toContain('時間内');
    expect(out.elapsedMs).toBeNull();
  });
});

describe('createNovelJobRunner', () => {
  it('writes the running record before the upstream call resolves', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn().mockImplementation(async () => {
      await gate;
      return geminiResponse('本文');
    });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });

    await runner.start('u1', 's1', SESSION, 'third');
    const running = await runner.read('u1', 's1');
    expect(running.status).toBe('running');
    expect(running.error).toBeNull();
    expect(typeof running.elapsedMs).toBe('number');

    release();
    await runner.pending.get('u1/s1');
    const done = await runner.read('u1', 's1');
    expect(done.status).toBe('done');
    expect(done.error).toBeNull();
    expect(done.elapsedMs).toBeNull();
  });

  it('saves the novel text and meta on success', async () => {
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl: okFetch(), bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect(await textStore.read('users/u1/sessions/s1/novel.md')).toBe('小説本文');
    const meta = await dataStore.get('users/u1/sessions/s1/novel');
    expect(meta.turnCount).toBe(3);
    expect(meta.imageIds).toEqual([]);
  });

  it('regenerates from latest logs when another device updates the session during generation', async () => {
    const first = {
      ...SESSION,
      _sync: { revision: 1 },
      state: { turn_count: 3 },
    };
    const latest = {
      ...first,
      _sync: { revision: 2 },
      state: { turn_count: 4 },
      log: [
        ...first.log,
        { role: 'player', text: 'スマホで最後の扉を開く' },
        { role: 'gm', text: '物語は結末へ到達した。' },
      ],
    };
    await dataStore.set('users/u1/sessions/s1', first);
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) await dataStore.set('users/u1/sessions/s1', latest);
      return geminiResponse(call === 1 ? '途中までの小説' : '最後までの小説');
    });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });

    await runner.start('u1', 's1', first, 'third');
    await runner.pending.get('u1/s1');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retriedTranscript = JSON.parse(fetchImpl.mock.calls[1][1].body).contents[0].parts[0].text;
    expect(retriedTranscript).toContain('スマホで最後の扉を開く');
    expect(retriedTranscript).toContain('物語は結末へ到達した。');
    expect(await textStore.read('users/u1/sessions/s1/novel.md')).toBe('最後までの小説');
    expect((await dataStore.get('users/u1/sessions/s1/novel')).turnCount).toBe(4);
    expect((await runner.read('u1', 's1')).status).toBe('done');
  });

  it('fails instead of saving stale text when logs keep changing beyond refresh limit', async () => {
    const initial = { ...SESSION, state: { turn_count: 0 }, log: [] };
    await dataStore.set('users/u1/sessions/s1', initial);
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      call += 1;
      await dataStore.set('users/u1/sessions/s1', {
        ...initial,
        state: { turn_count: call },
        log: [{ role: 'gm', text: `更新${call}` }],
      });
      return geminiResponse(`旧本文${call}`);
    });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });

    await runner.start('u1', 's1', initial, 'third');
    await runner.pending.get('u1/s1');

    expect(fetchImpl).toHaveBeenCalledTimes(NOVELIZE_MAX_SESSION_REFRESHES + 1);
    expect((await runner.read('u1', 's1')).status).toBe('error');
    expect(await textStore.read('users/u1/sessions/s1/novel.md')).toBeNull();
  });

  it('passes the session PC name into the generated system prompt', async () => {
    const fetchImpl = okFetch();
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', { ...SESSION, pc: { name: 'カイ', raw: 'PC名: カイ' } }, 'third');
    await runner.pending.get('u1/s1');

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.systemInstruction.parts[0].text).toContain('主人公の名前は「カイ」である');
  });

  // pc.name を持たない既存セッションでも落ちず、呼称をモデルに決めさせる側へ倒れる。
  it('falls back to the nameless prompt for sessions that predate pc.name', async () => {
    const fetchImpl = okFetch();
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.systemInstruction.parts[0].text).toContain('一つだけ定め');
    expect(await runner.read('u1', 's1')).toMatchObject({ status: 'done' });
  });

  it('records an error when the upstream call fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    const out = await runner.read('u1', 's1');
    expect(out.status).toBe('error');
    expect(out.error).toBe('小説化に失敗した。時間をおいて再試行してください。');
    expect(out.error).not.toContain('boom');
    expect(await textStore.read('users/u1/sessions/s1/novel.md')).toBeNull();
  });

  it('records an error when the upstream call throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('The operation was aborted due to timeout'));
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    const out = await runner.read('u1', 's1');
    expect(out.status).toBe('error');
    expect(out.error).toBe('小説化に失敗した。時間をおいて再試行してください。');
  });

  it('continues a truncated response and saves the joined text as complete', async () => {
    let call = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      call += 1;
      return geminiResponse(call === 1 ? '前半' : '後半', call === 1 ? 'max_tokens' : 'end_turn');
    });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect((await runner.read('u1', 's1')).status).toBe('done');
    expect(await textStore.read('users/u1/sessions/s1/novel.md')).toBe('前半後半');
    expect((await dataStore.get('users/u1/sessions/s1/novel')).truncated).toBe(false);
  });

  it('saves what it has and marks it truncated when the continuation limit is reached', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(geminiResponse('途中', 'max_tokens'));
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    // 打ち切られても本文は捨てない。欠落はtruncatedフラグで伝える。
    expect((await runner.read('u1', 's1')).status).toBe('done');
    expect(await textStore.read('users/u1/sessions/s1/novel.md')).toBe('途中'.repeat(fetchImpl.mock.calls.length));
    expect((await dataStore.get('users/u1/sessions/s1/novel')).truncated).toBe(true);
  });

  it('records an error for an empty response without saving', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(geminiResponse(''));
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect((await runner.read('u1', 's1')).status).toBe('error');
  });

  it('sends image markers and the marker instruction for an illustrated session', async () => {
    const fetchImpl = okFetch('本文\n〈挿絵1〉\n続き');
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    const illustrated = { ...SESSION, log: [{ role: 'gm', text: '森', image: { imageId: 'img_a' } }] };
    await runner.start('u1', 's1', illustrated, 'third');
    await runner.pending.get('u1/s1');

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.contents[0].parts[0].text).toContain('〈挿絵1〉');
    expect(body.systemInstruction.parts[0].text).toContain('挿絵挿入位置');
    const meta = await dataStore.get('users/u1/sessions/s1/novel');
    expect(meta.imageIds).toEqual(['img_a']);
  });

  it('omits the marker instruction when the session has no images', async () => {
    const fetchImpl = okFetch();
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect(systemOf(fetchImpl)).not.toContain('挿絵挿入位置');
  });

  it('uses a first person prompt when pov is first', async () => {
    const fetchImpl = okFetch();
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'first');
    await runner.pending.get('u1/s1');

    expect(systemOf(fetchImpl)).toContain('一人称');
  });

  it('reports a running job left behind by a previous process as an error', async () => {
    await dataStore.set(sessionNovelJobKey('u1', 's1'), {
      status: 'running',
      startedAt: 1,
      updatedAt: 1,
      error: null,
      bootId: 'old-boot',
    });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl: okFetch(), bootId: 'b1' });
    expect((await runner.read('u1', 's1')).status).toBe('error');
  });

  it('ignores a concurrent start() for the same user/session while one is already pending', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn().mockImplementation(async () => {
      await gate;
      return geminiResponse('本文');
    });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });

    await runner.start('u1', 's1', SESSION, 'third');
    await runner.start('u1', 's1', SESSION, 'third'); // 実行中に同じキーへ二重start

    release();
    await runner.pending.get('u1/s1');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // 生成が2回走っていない
  });

  it('records a usable error message even when a non-Error value is thrown', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => {
      throw 'boom-string'; // Errorではない値を投げるケース
    });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    const out = await runner.read('u1', 's1');
    expect(out.status).toBe('error');
    expect(out.error).toBe('小説化に失敗した。時間をおいて再試行してください。');
  });

  it('removes the pending entry once the job settles', async () => {
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl: okFetch(), bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');
    expect(runner.pending.has('u1/s1')).toBe(false);
  });

  it('never rejects the pending promise even when a malformed log entry throws synchronously', async () => {
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl: okFetch(), bootId: 'b1' });
    const brokenSession = { ...SESSION, log: [null] };

    await runner.start('u1', 's1', brokenSession, 'third');
    // run()が返すPromiseがrejectしないことがこのテストの本旨。rejectすればawaitでテスト自体が失敗する。
    await expect(runner.pending.get('u1/s1')).resolves.toBeUndefined();

    const out = await runner.read('u1', 's1');
    expect(out.status).toBe('error');
  });

  it('marks the novel as unread when generation succeeds', async () => {
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl: okFetch(), bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect(await dataStore.get(sessionNovelNoticeKey('u1', 's1'))).toEqual({ unread: true });
  });

  it('does not mark anything unread when generation fails', async () => {
    // 失敗は status:'error' とエラー行がサーバー状態として残るため、
    // 永続通知は要らない。noticeを書くと消せない通知になってしまう。
    // start()が開始時にnoticeをunread:falseへ倒すため、失敗後もnullには戻らない
    // (それ自体は「未読ではない」という意味を保っており、このテストの主旨に反しない)。
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect(await dataStore.get(sessionNovelNoticeKey('u1', 's1'))).toEqual({ unread: false });
  });

  it('clears a pre-existing unread notice when a new job starts', async () => {
    // 既読化POSTが遅延している間に再生成が始まった場合を想定。開始時点で
    // 古いunreadを降ろしておかないと、running中にunread:trueが観測されたり、
    // 遅れて届いた既読化POSTが今回の成功時のunread:trueを消してしまう。
    await dataStore.set(sessionNovelNoticeKey('u1', 's1'), { unread: true });
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn().mockImplementation(async () => {
      await gate;
      return geminiResponse('本文');
    });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });

    await runner.start('u1', 's1', SESSION, 'third');
    expect(await dataStore.get(sessionNovelNoticeKey('u1', 's1'))).toEqual({ unread: false });

    release();
    await runner.pending.get('u1/s1');
  });

  it('marks the novel as unread even when it was truncated', async () => {
    // 末尾が欠けていても「小説ができた」ことに変わりはない。欠落は別途警告される。
    const fetchImpl = vi.fn().mockResolvedValue(geminiResponse('途中', 'max_tokens'));
    const runner = createNovelJobRunner({
      dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1',
    });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect(await dataStore.get(sessionNovelNoticeKey('u1', 's1'))).toEqual({ unread: true });
  });
});

describe('makeBootId', () => {
  it('returns a different id on each call', () => {
    expect(makeBootId()).not.toBe(makeBootId());
  });
});
