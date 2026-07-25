# UI改善3件 + 小説化の非同期化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** セッション一覧カードの操作/状態を見分けられるようにし、プレイ中にホームへ常時戻れるようにし、エンディング到達を表示し、小説化をタイムアウトしない非同期ジョブにする。

**Architecture:** 小説化は「サーバー側に永続化したジョブレコード + クライアントのポーリング」に置き換える。生成ロジックは新モジュール `server/novelJobs.js` に切り出し、ルートは薄いHTTP層にする。UI側は新規 `Badge` コンポーネントで状態表示をボタンから分離し、Play画面のヘッダーを `position: sticky` にする。エンディングはGMの `state_update.ending_reached` 申告 → プレイヤーが確定 → `session.endedAt` の2段階。

**Tech Stack:** React 18(ビルドツールなしの inline style)、Express 4、vitest + @testing-library/react + supertest、fs ベースの `dataStore` / `textStore`。

**設計spec:** [docs/superpowers/specs/2026-07-25-ui-improvements-and-async-novelize-design.md](../specs/2026-07-25-ui-improvements-and-async-novelize-design.md)

## Global Constraints

- ブランチは `feat/ui-improvements-async-novelize`(作成済み)。main へ直接コミットしない。
- テスト: 単一ファイルは `npx vitest run <path>`、全体は `npm test`。既存の 965 テストを壊さない。
- `server/routes/characters.test.js` の「lists characters scoped to world and kind」は並列実行時にタイムアウトする既知のフレーク。落ちたら単体で再実行して確認する(本計画とは無関係)。
- **後方互換**: 既存セッションは `endedAt` も `state.ending_reached` も `novelJob` も持たない。新フィールドは全て「無ければ false / idle」として読むこと。旧セッションを壊す変更は不可。
- UI文言は日本語。コメントも既存に倣い日本語で、「なぜ」を書く(「何を」はコードが語る)。
- スタイルは既存どおり inline style + `src/theme.js` の `COLORS` / `F_DISPLAY` / `F_BODY` / `F_MONO` を使う。CSSファイルは追加しない。
- テストファイルは実装ファイルと同じディレクトリに `<name>.test.js(x)` として置く(リポジトリの既存方針)。
- サーバーのテストファイル冒頭には `// @vitest-environment node` が必要。

---

## File Structure

**新規作成**

| ファイル | 責務 |
|---|---|
| `src/components/ui/Badge.jsx` | 押せない状態ピル(完結 / 公開中 / 挿絵あり) |
| `src/components/ui/Badge.test.jsx` | 同テスト |
| `server/novelJobs.js` | 小説化ジョブの状態解決(純関数)とバックグラウンド実行ランナー |
| `server/novelJobs.test.js` | 同テスト |

**変更**

| ファイル | 変更内容 |
|---|---|
| `server/storage/paths.js` | `sessionNovelJobKey()` を追加 |
| `server/routes/sessions.js` | 生成ロジックを `novelJobs.js` へ移し、`POST /novelize` を 202 即応答に。`GET /novel-jobs` を追加 |
| `server/routes/sessions.test.js` | 非同期化に伴う既存テストの書き換え + 新規テスト |
| `server/index.js` | `createNovelJobRunner` を生成して sessions ルーターへ渡す |
| `src/api/sessionSyncClient.js` | `listNovelJobs()` を追加 |
| `src/api/sessionSyncClient.test.js` | 同テスト |
| `src/screens/Home.jsx` | カードを3層化、バッジ導入、ジョブ状態でボタンを切り替え、ポーリング、`次の章へ` で `endedAt` |
| `src/screens/Home.test.jsx` | 同テスト |
| `src/api/prompts.js` | `state_update.ending_reached` をスキーマとプロンプトに追加 |
| `src/api/prompts.test.js` | 同テスト |
| `src/api/turnResult.js` | `stateUpdate.endingReached` を正規化 |
| `src/api/turnResult.test.js` | 同テスト |
| `src/screens/Play.jsx` | 固定ヘッダー、完結バッジ、エンディング案内カード、`ending_reached` の反映 |
| `src/screens/Play.test.jsx` | 同テスト |
| `docs/*.md` | 実装に合わせて同期 |

---

## Task 1: Badge コンポーネント

状態表示をボタンと見分けられるようにする最小単位。他タスクが依存するので最初に作る。

**Files:**
- Create: `src/components/ui/Badge.jsx`
- Test: `src/components/ui/Badge.test.jsx`

**Interfaces:**
- Consumes: `src/theme.js` の `COLORS`, `F_MONO`
- Produces: `export default function Badge({ children, variant, style })`。`variant` は `'brass' | 'outline' | 'faint'`(既定 `'outline'`)。`<span>` を描画する。

- [ ] **Step 1: Write the failing test**

`src/components/ui/Badge.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Badge from './Badge.jsx';

describe('Badge', () => {
  it('renders its label as a non-interactive span', () => {
    render(<Badge>完結</Badge>);
    const el = screen.getByText('完結');
    expect(el.tagName).toBe('SPAN');
    expect(el.style.cursor).toBe('default');
  });

  it('fills the background for the brass variant', () => {
    render(<Badge variant="brass">完結</Badge>);
    expect(screen.getByText('完結').style.background).not.toBe('transparent');
  });

  it('keeps the background transparent for outline and faint variants', () => {
    render(
      <>
        <Badge variant="outline">公開中</Badge>
        <Badge variant="faint">挿絵あり</Badge>
      </>
    );
    expect(screen.getByText('公開中').style.background).toBe('transparent');
    expect(screen.getByText('挿絵あり').style.background).toBe('transparent');
  });

  it('falls back to the outline variant for an unknown variant', () => {
    render(<Badge variant="nope">未知</Badge>);
    expect(screen.getByText('未知').style.background).toBe('transparent');
  });

  it('merges a caller-supplied style', () => {
    render(<Badge style={{ marginLeft: 4 }}>完結</Badge>);
    expect(screen.getByText('完結').style.marginLeft).toBe('4px');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/Badge.test.jsx`
Expected: FAIL — `Failed to resolve import "./Badge.jsx"`

- [ ] **Step 3: Write the implementation**

`src/components/ui/Badge.jsx`:

```jsx
import { COLORS, F_MONO } from '../../theme.js';

// 状態を表す小さなピル。押せる要素(Button)と見分けがつくよう、spanで描画し
// カーソルもdefaultに固定する。セッション一覧で「公開中」がボタンと混同された問題への対処。
const VARIANTS = {
  brass: { background: COLORS.brass, color: COLORS.paper, borderColor: COLORS.brass },
  outline: { background: 'transparent', color: COLORS.brassDark, borderColor: COLORS.brassDark },
  faint: { background: 'transparent', color: COLORS.faint, borderColor: COLORS.line },
};

export default function Badge({ children, variant = 'outline', style }) {
  const v = VARIANTS[variant] || VARIANTS.outline;
  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: F_MONO,
        fontSize: 10,
        letterSpacing: 0.5,
        lineHeight: 1.6,
        padding: '2px 8px',
        borderRadius: 999,
        border: `1px solid ${v.borderColor}`,
        background: v.background,
        color: v.color,
        whiteSpace: 'nowrap',
        cursor: 'default',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/Badge.test.jsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Badge.jsx src/components/ui/Badge.test.jsx
git commit -m "feat(ui): 状態表示用のBadgeコンポーネントを追加"
```

---

## Task 2: 小説化ジョブモジュール(サーバー)

生成の実行と状態解決を、HTTPから切り離した純粋なモジュールにする。「running のまま固まらない」判定はここに置く。

**Files:**
- Create: `server/novelJobs.js`
- Test: `server/novelJobs.test.js`
- Modify: `server/storage/paths.js`(末尾に1関数追加)

**Interfaces:**
- Consumes: `server/novelMarkers.js` の `buildTranscriptWithMarkers`、`server/storage/paths.js` の `sessionNovelDocPath` / `sessionNovelMetaKey`
- Produces:
  - `export const NOVEL_JOB_TIMEOUT_MS = 600000`
  - `export const NOVELIZE_UPSTREAM_TIMEOUT_MS = 300000`
  - `export function makeBootId(): string`
  - `export function resolveJobStatus(job, { bootId, now }): { status: 'idle'|'running'|'done'|'error', error: string|null }`
  - `export function createNovelJobRunner({ dataStore, textStore, apiKey, fetchImpl, bootId, now }): { read(userId, sessionId), start(userId, sessionId, session, pov), pending: Map }`
    - `read` は `Promise<{ status, error }>`
    - `start` は `Promise<void>`(ジョブレコードを running で書いた時点で解決。生成の完了は待たない)
    - `pending` は `` `${userId}/${sessionId}` `` → 実行中Promise の Map(テストの待ち合わせ用。完了時に削除される)
  - `export function sessionNovelJobKey(userId, sessionId)` は `server/storage/paths.js` 側に追加

- [ ] **Step 1: paths.js にジョブキーを追加**

`server/storage/paths.js` の `sessionNovelMetaKey` の直後に追加:

```js
export function sessionNovelJobKey(userId, sessionId) {
  return `users/${userId}/sessions/${sessionId}/novelJob`;
}
```

- [ ] **Step 2: Write the failing test**

`server/novelJobs.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createFsDataStore } from './storage/dataStore.js';
import { createFsTextStore } from './storage/textStore.js';
import { sessionNovelJobKey } from './storage/paths.js';
import {
  createNovelJobRunner,
  makeBootId,
  resolveJobStatus,
  NOVEL_JOB_TIMEOUT_MS,
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

function okFetch(text = '小説本文') {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
  });
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
  it('reports idle when there is no job', () => {
    expect(resolveJobStatus(null, { bootId: 'b1', now: 100 })).toEqual({ status: 'idle', error: null });
  });

  it('passes through done and error records', () => {
    expect(resolveJobStatus({ status: 'done', error: null }, { bootId: 'b1', now: 100 })).toEqual({
      status: 'done',
      error: null,
    });
    expect(resolveJobStatus({ status: 'error', error: 'boom' }, { bootId: 'b1', now: 100 })).toEqual({
      status: 'error',
      error: 'boom',
    });
  });

  it('keeps a fresh running job from the current process as running', () => {
    const job = { status: 'running', startedAt: 100, bootId: 'b1' };
    expect(resolveJobStatus(job, { bootId: 'b1', now: 200 })).toEqual({ status: 'running', error: null });
  });

  it('treats a running job from a previous process as interrupted', () => {
    const job = { status: 'running', startedAt: 100, bootId: 'b0' };
    const out = resolveJobStatus(job, { bootId: 'b1', now: 200 });
    expect(out.status).toBe('error');
    expect(out.error).toContain('再起動');
  });

  it('treats a running job past the timeout as failed', () => {
    const job = { status: 'running', startedAt: 0, bootId: 'b1' };
    const out = resolveJobStatus(job, { bootId: 'b1', now: NOVEL_JOB_TIMEOUT_MS + 1 });
    expect(out.status).toBe('error');
    expect(out.error).toContain('時間内');
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
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '本文' }], stop_reason: 'end_turn' }) };
    });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });

    await runner.start('u1', 's1', SESSION, 'third');
    expect(await runner.read('u1', 's1')).toEqual({ status: 'running', error: null });

    release();
    await runner.pending.get('u1/s1');
    expect(await runner.read('u1', 's1')).toEqual({ status: 'done', error: null });
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

  it('records an error when the upstream call fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    const out = await runner.read('u1', 's1');
    expect(out.status).toBe('error');
    expect(out.error).toContain('boom');
    expect(await textStore.read('users/u1/sessions/s1/novel.md')).toBeNull();
  });

  it('records an error when the upstream call throws', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('The operation was aborted due to timeout'));
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    const out = await runner.read('u1', 's1');
    expect(out.status).toBe('error');
    expect(out.error).toContain('aborted');
  });

  it('records an error for a truncated response without saving', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '途中' }], stop_reason: 'max_tokens' }),
    });
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect((await runner.read('u1', 's1')).status).toBe('error');
    expect(await textStore.read('users/u1/sessions/s1/novel.md')).toBeNull();
  });

  it('records an error for an empty response without saving', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [], stop_reason: 'end_turn' }),
    });
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
    expect(body.messages[0].content).toContain('〈挿絵1〉');
    expect(body.system).toContain('挿絵挿入位置');
    const meta = await dataStore.get('users/u1/sessions/s1/novel');
    expect(meta.imageIds).toEqual(['img_a']);
  });

  it('omits the marker instruction when the session has no images', async () => {
    const fetchImpl = okFetch();
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).system).not.toContain('挿絵挿入位置');
  });

  it('uses a first person prompt when pov is first', async () => {
    const fetchImpl = okFetch();
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'first');
    await runner.pending.get('u1/s1');

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).system).toContain('一人称');
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

  it('removes the pending entry once the job settles', async () => {
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl: okFetch(), bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');
    expect(runner.pending.has('u1/s1')).toBe(false);
  });
});

describe('makeBootId', () => {
  it('returns a different id on each call', () => {
    expect(makeBootId()).not.toBe(makeBootId());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run server/novelJobs.test.js`
Expected: FAIL — `Failed to resolve import "./novelJobs.js"`

- [ ] **Step 4: Write the implementation**

`server/novelJobs.js`:

```js
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
    const { transcript, imageIds } = buildTranscriptWithMarkers(session.log);
    try {
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
      await write(userId, sessionId, { status: 'error', startedAt, updatedAt: now(), error: e.message, bootId });
    }
  }

  // ジョブをrunningで記録してからバックグラウンド実行を始める。生成の完了は待たない。
  async function start(userId, sessionId, session, pov) {
    const startedAt = now();
    await write(userId, sessionId, { status: 'running', startedAt, updatedAt: startedAt, error: null, bootId });
    const key = `${userId}/${sessionId}`;
    const p = run(userId, sessionId, session, pov, startedAt).finally(() => pending.delete(key));
    pending.set(key, p);
  }

  return { read, start, pending, bootId };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run server/novelJobs.test.js`
Expected: PASS (17 tests)

- [ ] **Step 6: Commit**

```bash
git add server/novelJobs.js server/novelJobs.test.js server/storage/paths.js
git commit -m "feat(server): 小説化をバックグラウンド実行するジョブモジュールを追加"
```

---

## Task 3: sessions ルートの非同期化と `GET /novel-jobs`

**Files:**
- Modify: `server/routes/sessions.js`
- Modify: `server/routes/sessions.test.js`
- Modify: `server/index.js:98` 付近

**Interfaces:**
- Consumes: Task 2 の `createNovelJobRunner`(`read` / `start` / `pending`)、`sessionNovelJobKey`
- Produces:
  - `createSessionsRouter({ dataStore, textStore, imageStore, apiKey, novelJobs, usage })` — `fetchImpl` 引数は削除し、代わりに `novelJobs`(ランナー)を受け取る
  - `POST /api/sessions/:id/novelize` → `202 { status: 'running' }`
  - `GET /api/novel-jobs` → `200 { [sessionId]: { status, error, hasNovel, stale } }`

- [ ] **Step 1: `server/routes/sessions.js` を書き換える**

冒頭のimportとヘルパーを差し替え、`extractText` / `buildNovelizeSystemPrompt` / `MARKER_INSTRUCTION` / `NOVELIZE_TIMEOUT_MS` を削除する(Task 2 で `novelJobs.js` に移した)。ファイル全体は以下になる:

```js
import { Router } from 'express';
import {
  sessionKey,
  sessionNovelDocPath,
  sessionNovelMetaKey,
  sessionListPrefix,
  sessionImagePath,
} from '../storage/paths.js';
import { asyncHandler } from './asyncHandler.js';
import { idParamGuard } from './validateId.js';
import { stripImageMarkers } from '../novelMarkers.js';
import { buildIllustratedMarkdown } from '../illustratedNovel.js';

// 生成後にセッションが進んでいれば、保存済みの小説は古い。
function isStale(meta, session) {
  const currentTurn = session?.state?.turn_count ?? null;
  if (!meta || meta.turnCount == null || currentTurn == null) return false;
  return meta.turnCount !== currentTurn;
}

export function createSessionsRouter({ dataStore, textStore, imageStore, apiKey, novelJobs, usage }) {
  const router = Router();
  router.param('id', idParamGuard);

  router.get('/sessions', asyncHandler(async (req, res) => {
    const keys = await dataStore.list(sessionListPrefix(req.userId));
    const sessions = await Promise.all(keys.map((k) => dataStore.get(k)));
    res.json(sessions.filter(Boolean));
  }));

  // 一覧画面が全セッションのジョブ状態を1リクエストで取れるようにする
  // (セッションごとのポーリングだと件数分のリクエストが必要になるため)。
  router.get('/novel-jobs', asyncHandler(async (req, res) => {
    const keys = await dataStore.list(sessionListPrefix(req.userId));
    const out = {};
    for (const key of keys) {
      const id = key.slice(key.lastIndexOf('/') + 1);
      const { status, error } = await novelJobs.read(req.userId, id);
      const text = await textStore.read(sessionNovelDocPath(req.userId, id));
      const meta = await dataStore.get(sessionNovelMetaKey(req.userId, id));
      const session = await dataStore.get(key);
      out[id] = { status, error, hasNovel: text !== null, stale: isStale(meta, session) };
    }
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
    const session = { ...req.body, id: req.params.id };
    await dataStore.set(sessionKey(req.userId, req.params.id), session);
    res.json(session);
  }));

  // 生成は待たずに202を返す。進行状況は GET /novel-jobs で参照する。
  router.post('/sessions/:id/novelize', asyncHandler(async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
      return;
    }
    const session = await dataStore.get(sessionKey(req.userId, req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    // 生成中の再要求は利用枠を消費せず、そのまま現状を返す(二重起動の抑止)。
    const current = await novelJobs.read(req.userId, req.params.id);
    if (current.status === 'running') {
      res.status(202).json({ status: 'running' });
      return;
    }
    if (usage) {
      const check = await usage.consume(req.userId, 'novelize');
      if (!check.ok) {
        res.status(429).json({ error: 'daily limit reached', resetAt: check.resetAt });
        return;
      }
    }
    await novelJobs.start(req.userId, req.params.id, session, req.body?.pov === 'first' ? 'first' : 'third');
    res.status(202).json({ status: 'running' });
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
    const meta = await dataStore.get(sessionNovelMetaKey(req.userId, req.params.id));
    const imageIds = Array.isArray(meta?.imageIds) ? meta.imageIds : [];
    const images = new Map();
    for (const imageId of imageIds) {
      images.set(imageId, await imageStore.read(sessionImagePath(req.userId, req.params.id, imageId)));
    }
    res.json({ markdown: buildIllustratedMarkdown({ novelText: text, imageIds, images }) });
  }));

  return router;
}
```

- [ ] **Step 2: `server/index.js` を配線し直す**

`server/index.js` の import 群(`createSceneImagesRouter` の import の下あたり)に追加:

```js
import { createNovelJobRunner } from './novelJobs.js';
```

`const usage = createUsage({...})` の直後に追加:

```js
  const novelJobs = createNovelJobRunner({ dataStore, textStore, apiKey, fetchImpl });
```

`server/index.js:98` の sessions ルーターのマウントを差し替え:

```js
  app.use('/api', createSessionsRouter({ dataStore, textStore, imageStore, apiKey, novelJobs, usage }));
```

- [ ] **Step 3: 既存テストのハーネスを差し替える**

`server/routes/sessions.test.js` の import に追加:

```js
import { createNovelJobRunner } from '../novelJobs.js';
```

モジュールスコープの宣言に `runner` を足し(`let app;` の下)、`buildApp` を差し替える:

```js
let runner;

function buildApp(opts = {}) {
  // Use `'apiKey' in opts` rather than a destructured default so that an
  // explicit `{ apiKey: undefined }` (used to simulate "no API key
  // configured") is not silently overwritten by the default value.
  const apiKey = 'apiKey' in opts ? opts.apiKey : 'test-key';
  const { fetchImpl, usage, bootId = 'boot-test', now } = opts;
  runner = createNovelJobRunner({ dataStore, textStore, apiKey, fetchImpl, bootId, now });
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.userId = 'usr_test';
    next();
  });
  app.use('/api', createSessionsRouter({ dataStore, textStore, imageStore, apiKey, novelJobs: runner, usage }));
}

// 非同期ジョブの完了を待つ。完了済みならpendingから消えているのでそのまま抜ける。
async function waitForJob(sessionId) {
  await runner.pending.get(`usr_test/${sessionId}`);
}
```

- [ ] **Step 4: 非同期化で意味が変わる既存テストを書き換える**

`server/routes/sessions.test.js` の以下のテストを差し替える(それ以外のテストは変更しない)。

「小説化して保存する」テスト(`postRes.status` を 200 と比較している箇所、104行目付近):

```js
    const postRes = await request(app).post('/api/sessions/s1/novelize');
    expect(postRes.status).toBe(202);
    expect(postRes.body).toEqual({ status: 'running' });
    await waitForJob('s1');

    const getRes = await request(app).get('/api/sessions/s1/novel');
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({ text: '小説化された本文。', stale: false });
```

`挿絵付きセッションのnovelizeは…` の POST 行:

```js
    const res = await request(app).post('/api/sessions/s1/novelize').send({});
    expect(res.status).toBe(202);
    await waitForJob('s1');
```

`挿絵なしセッションのnovelizeは…` の POST 行:

```js
    await request(app).post('/api/sessions/s2/novelize').send({});
    await waitForJob('s2');
```

`marks the novel stale after…` の POST 行:

```js
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');
```

`rejects a truncated (max_tokens) novelization without saving`:

```js
  it('records an error for a truncated (max_tokens) novelization without saving', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '途中' }], stop_reason: 'max_tokens' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(202);
    await waitForJob('s1');
    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.status).toBe('error');
    const get = await request(app).get('/api/sessions/s1/novel');
    expect(get.status).toBe(404); // 保存されていない
  });
```

`rejects an empty novelization without saving`:

```js
  it('records an error for an empty novelization without saving', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [], stop_reason: 'end_turn' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(202);
    await waitForJob('s1');
    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.status).toBe('error');
  });
```

`returns 502 from novelize when the upstream call fails`:

```js
  it('records an error when the upstream call fails', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(202);
    await waitForJob('s1');
    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.status).toBe('error');
    expect(jobs.body.s1.error).toContain('boom');
  });
```

`consumes usage with the novelize kind and proceeds when allowed` の末尾3行:

```js
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(consume).toHaveBeenCalledWith('usr_test', 'novelize');
    expect(res.status).toBe(202);
    await waitForJob('s1');
    expect(fetchImpl).toHaveBeenCalled();
```

- [ ] **Step 5: 新規テストを追加する**

`server/routes/sessions.test.js` の `describe('sessions routes', ...)` の末尾に追加:

```js
  it('returns an empty map from /novel-jobs when there are no sessions', async () => {
    const res = await request(app).get('/api/novel-jobs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
  });

  it('reports idle for a session that has never been novelized', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [], state: {} });
    const res = await request(app).get('/api/novel-jobs');
    expect(res.body.s1).toEqual({ status: 'idle', error: null, hasNovel: false, stale: false });
  });

  it('reports running while the job is in flight and done afterwards', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn().mockImplementation(async () => {
      await gate;
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '本文' }], stop_reason: 'end_turn' }) };
    });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 1 } });

    await request(app).post('/api/sessions/s1/novelize');
    const during = await request(app).get('/api/novel-jobs');
    expect(during.body.s1.status).toBe('running');

    release();
    await waitForJob('s1');
    const after = await request(app).get('/api/novel-jobs');
    expect(after.body.s1).toMatchObject({ status: 'done', hasNovel: true, stale: false });
  });

  it('reports stale in /novel-jobs after the session advances', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '小説' }], stop_reason: 'end_turn' }) });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 3 } });
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: { turn_count: 5 } });

    const res = await request(app).get('/api/novel-jobs');
    expect(res.body.s1.stale).toBe(true);
  });

  it('reports a job left running by a previous process as an error', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [], state: {} });
    await dataStore.set('users/usr_test/sessions/s1/novelJob', {
      status: 'running',
      startedAt: 1,
      updatedAt: 1,
      error: null,
      bootId: 'other-boot',
    });
    const res = await request(app).get('/api/novel-jobs');
    expect(res.body.s1.status).toBe('error');
    expect(res.body.s1.error).toContain('再起動');
  });

  it('does not consume usage or start a second run while a job is already running', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn().mockImplementation(async () => {
      await gate;
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '本文' }], stop_reason: 'end_turn' }) };
    });
    const consume = vi.fn().mockResolvedValue({ ok: true });
    buildApp({ fetchImpl, usage: { consume } });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: {} });

    await request(app).post('/api/sessions/s1/novelize');
    const second = await request(app).post('/api/sessions/s1/novelize');
    expect(second.status).toBe(202);
    expect(consume).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    release();
    await waitForJob('s1');
  });

  it('starts a new run after a previous job finished', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '本文' }], stop_reason: 'end_turn' }),
    });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }], state: {} });

    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run server/routes/sessions.test.js server/index.test.js`
Expected: PASS(全件)

- [ ] **Step 7: Commit**

```bash
git add server/routes/sessions.js server/routes/sessions.test.js server/index.js
git commit -m "feat(server): 小説化を202即応答の非同期ジョブにし GET /novel-jobs を追加"
```

---

## Task 4: クライアントAPI `listNovelJobs`

**Files:**
- Modify: `src/api/sessionSyncClient.js`
- Modify: `src/api/sessionSyncClient.test.js`

**Interfaces:**
- Consumes: `src/api/apiFetch.js` の `apiFetch`
- Produces: `export async function listNovelJobs(): Promise<Record<string, { status, error, hasNovel, stale }>>` — `GET /api/novel-jobs`

- [ ] **Step 1: Write the failing test**

`src/api/sessionSyncClient.test.js` の1行目の import を差し替える:

```js
import { putSessionToServer, novelizeSession, getNovel, getIllustratedNovel, listNovelJobs } from './sessionSyncClient.js';
```

ファイル末尾に新しい `describe` を追加する:

```js
describe('listNovelJobs', () => {
  it('GETs the novel job map', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ s1: { status: 'running', error: null, hasNovel: false, stale: false } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const jobs = await listNovelJobs();

    expect(fetchMock).toHaveBeenCalledWith('/api/novel-jobs', undefined);
    expect(jobs.s1.status).toBe('running');
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(listNovelJobs()).rejects.toThrow('API error 500: boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/sessionSyncClient.test.js`
Expected: FAIL — `listNovelJobs is not a function`(または import エラー)

- [ ] **Step 3: Write the implementation**

`src/api/sessionSyncClient.js` の末尾に追加:

```js
// 一覧画面が全セッションの小説化ジョブ状態を1リクエストで取得する。
export async function listNovelJobs() {
  return apiFetch('/api/novel-jobs');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/sessionSyncClient.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/sessionSyncClient.js src/api/sessionSyncClient.test.js
git commit -m "feat(api): listNovelJobs クライアントを追加"
```

---

## Task 5: セッション一覧カードの3層化

操作はボタン行、状態はバッジ行に分ける。この時点ではまだ同期の `novelizing` state を使う(Task 6 で置き換える)。

**Files:**
- Modify: `src/screens/Home.jsx`(`renderSessionCard`)
- Modify: `src/screens/Home.test.jsx`

**Interfaces:**
- Consumes: Task 1 の `Badge`
- Produces: `renderSessionCard` の描画構造(Task 6 が同じ操作行を書き換える)。ヘルパー `hasIllustrations(session)` を Home.jsx 内に定義

- [ ] **Step 1: Write the failing test**

`src/screens/Home.test.jsx` の `describe('Home', ...)` 末尾に追加:

```js
  it('shows a 完結 badge for a session that has ended', () => {
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, endedAt: 123, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText('完結')).toBeInTheDocument();
  });

  it('does not show a 完結 badge for a session still in progress', () => {
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.queryByText('完結')).not.toBeInTheDocument();
  });

  it('shows an 挿絵あり badge when the session log carries images', () => {
    const sessions = [
      { id: 's1', title: 'A', updatedAt: 1, state: {}, log: [{ role: 'gm', text: 'g', image: { imageId: 'img_a' } }] },
    ];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    expect(screen.getByText('挿絵あり')).toBeInTheDocument();
  });

  it('renders 公開中 as a badge rather than a button', async () => {
    vi.spyOn(shareClient, 'publishedNovels').mockResolvedValue({ s1: 'pub_1' });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);
    const badge = await screen.findByText('公開中');
    expect(badge.tagName).toBe('SPAN');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: FAIL — `Unable to find an element with the text: 完結`

- [ ] **Step 3: Implement — import と helper を追加**

`src/screens/Home.jsx` の import に追加:

```js
import Badge from '../components/ui/Badge.jsx';
```

`lastLineOf` の下に追加:

```js
function hasIllustrations(session) {
  return !!session.log?.some((e) => e.role === 'gm' && e.image?.imageId);
}

// 操作行のボタンは数が多いので、共通の小さめサイズに揃える。
const ACTION_BTN = { fontSize: 12, padding: '6px 10px' };
```

- [ ] **Step 4: Implement — `renderSessionCard` を差し替える**

`src/screens/Home.jsx` の `renderSessionCard` 全体を以下で置き換える:

```jsx
  function renderSessionCard(s) {
    const badges = [];
    if (s.endedAt) badges.push(<Badge key="ended" variant="brass">完結</Badge>);
    if (publishedNovelIds[s.id]) badges.push(<Badge key="published" variant="outline">公開中</Badge>);
    if (hasIllustrations(s)) badges.push(<Badge key="illustrated" variant="faint">挿絵あり</Badge>);

    return (
      <Card key={s.id} style={{ cursor: 'pointer' }} onClick={() => onContinue(s.id)}>
        {/* 情報層 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>{s.title}</div>
              {s.state?.current_scene && (
                <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brassDark, whiteSpace: 'nowrap' }}>
                  シーン: {s.state.current_scene}
                  {typeof s.state.turn_count === 'number' ? ` / ${s.state.turn_count}手` : ''}
                </div>
              )}
            </div>
            <div
              style={{
                fontFamily: F_BODY,
                fontSize: 13,
                color: COLORS.inkSoft,
                opacity: 0.8,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {lastLineOf(s)}
            </div>
          </div>
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.brass, whiteSpace: 'nowrap' }}>続ける →</div>
        </div>

        {/* 状態バッジ層。押せる要素と混同されないようボタン行とは分ける。 */}
        {badges.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>{badges}</div>
        )}

        {novelizeError[s.id] && (
          <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.stamp, marginTop: 8 }}>
            {novelizeError[s.id]}
          </div>
        )}

        {/* 操作層 */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px solid ${COLORS.line}`,
          }}
        >
          <Button
            variant="ghost"
            onClick={(e) => handleNovelize(e, s)}
            disabled={!!novelizing[s.id] || !user}
            style={ACTION_BTN}
          >
            {novelizing[s.id] ? '小説化中…' : '小説化する'}
          </Button>
          {hasIllustrations(s) && (
            <Button
              variant="ghost"
              onClick={(e) => handleNovelizeIllustrated(e, s)}
              disabled={!!novelizing[s.id] || !user}
              style={ACTION_BTN}
            >
              挿絵付きでDL
            </Button>
          )}
          {s.worldId && (
            <Button
              variant="ghost"
              onClick={(e) => handleNextChapter(e, s)}
              disabled={!!advancing[s.id] || !user}
              style={ACTION_BTN}
            >
              {advancing[s.id] ? '準備中…' : '次の章へ'}
            </Button>
          )}
          {user &&
            (publishedNovelIds[s.id] ? (
              <Button
                variant="ghost"
                onClick={(e) => handleUnpublish(e, s)}
                disabled={!!publishBusy[s.id]}
                style={ACTION_BTN}
              >
                公開解除
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={(e) => handlePublish(e, s)}
                disabled={!!publishBusy[s.id]}
                style={ACTION_BTN}
              >
                小説を公開
              </Button>
            ))}
        </div>
      </Card>
    );
  }
```

- [ ] **Step 5: 既存テストのラベル参照を更新**

`src/screens/Home.test.jsx` 内で `getByText('小説化')` を使っている箇所を `getByText('小説化する')` に、`getByText('挿絵付き')` を `getByText('挿絵付きでDL')` に置き換える。

Run: `grep -n "小説化'\|挿絵付き'" src/screens/Home.test.jsx` で該当箇所を洗い出してから直す。

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: PASS(全件)

- [ ] **Step 7: Commit**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "feat(ui): セッション一覧カードを情報/状態バッジ/操作の3層に整理"
```

---

## Task 6: 一覧を小説化ジョブに接続する

**Files:**
- Modify: `src/screens/Home.jsx`
- Modify: `src/screens/Home.test.jsx`

**Interfaces:**
- Consumes: Task 4 の `listNovelJobs()`、既存の `novelizeSession` / `getNovel` / `getIllustratedNovel`
- Produces: なし(画面内で完結)

- [ ] **Step 1: Write the failing test**

`src/screens/Home.test.jsx` の `describe('Home', ...)` 末尾に追加:

```js
  it('shows 小説化中… and disables the button while the server reports a running job', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'running', error: null, hasNovel: false, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    const button = await screen.findByText('小説化中…');
    expect(button).toBeDisabled();
    expect(screen.queryByText('小説化する')).not.toBeInTheDocument();
  });

  it('offers download buttons when the server reports a finished novel', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, hasNovel: true, stale: false },
    });
    const sessions = [
      { id: 's1', title: 'A', updatedAt: 1, state: {}, log: [{ role: 'gm', text: 'g', image: { imageId: 'img_a' } }] },
    ];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説をDL')).toBeInTheDocument();
    expect(screen.getByText('挿絵付きでDL')).toBeInTheDocument();
    expect(screen.getByText('小説を再生成')).toBeInTheDocument();
  });

  it('hides the illustrated download until a novel exists', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'idle', error: null, hasNovel: false, stale: false },
    });
    const sessions = [
      { id: 's1', title: 'A', updatedAt: 1, state: {}, log: [{ role: 'gm', text: 'g', image: { imageId: 'img_a' } }] },
    ];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説化する')).toBeInTheDocument();
    expect(screen.queryByText('挿絵付きでDL')).not.toBeInTheDocument();
  });

  it('shows the failure message and a retry button when the job errored', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'error', error: 'サーバーの再起動により中断されました。', hasNovel: false, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText(/サーバーの再起動により中断されました。/)).toBeInTheDocument();
    expect(screen.getByText('小説化を再試行')).toBeInTheDocument();
  });

  it('warns that a finished novel may be out of date when the job reports stale', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, hasNovel: true, stale: true },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText(/最新のログを反映していない可能性があります/)).toBeInTheDocument();
  });

  it('marks the session as running immediately after 小説化する is pressed, without downloading', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({});
    const novelizeSpy = vi.spyOn(sessionSyncClient, 'novelizeSession').mockResolvedValue({ status: 'running' });
    const getNovelSpy = vi.spyOn(sessionSyncClient, 'getNovel');
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    const onContinue = vi.fn();
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={onContinue} onOpenLibrary={vi.fn()} />);

    fireEvent.click(await screen.findByText('小説化する'));

    await waitFor(() => expect(novelizeSpy).toHaveBeenCalledWith('s1'));
    expect(await screen.findByText('小説化中…')).toBeInTheDocument();
    expect(getNovelSpy).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled(); // カードへ潜り込まない
  });

  it('downloads the novel when 小説をDL is pressed', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, hasNovel: true, stale: false },
    });
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({ text: '小説本文', stale: false });
    const createObjectURLSpy = vi.fn().mockReturnValue('blob:mock-url');
    vi.stubGlobal('URL', { ...URL, createObjectURL: createObjectURLSpy, revokeObjectURL: vi.fn() });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    fireEvent.click(await screen.findByText('小説をDL'));

    await waitFor(() => expect(sessionSyncClient.getNovel).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(createObjectURLSpy).toHaveBeenCalled());
  });
```

既存の「novelizes a session and triggers a file download when "小説化" is clicked…」テストは**削除する**(同期DLの挙動は仕様変更で無くなり、上の2テストが後継)。同様に、既存テストで `novelizeSession` の後に `getNovel` / `getIllustratedNovel` が呼ばれることを期待しているものがあれば削除する。`grep -n "getIllustratedNovel\|novelizeSession" src/screens/Home.test.jsx` で洗い出す。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: FAIL — `listNovelJobs` が spy されていても呼ばれず、`小説化中…` が見つからない

- [ ] **Step 3: Implement — state とポーリング**

`src/screens/Home.jsx` の import 行を差し替え:

```js
import {
  novelizeSession,
  getNovel,
  getIllustratedNovel,
  putSessionToServer,
  listNovelJobs,
} from '../api/sessionSyncClient.js';
```

`const [novelizing, setNovelizing] = useState({});` を削除し、代わりに追加:

```js
  const [novelJobs, setNovelJobs] = useState({}); // sessionId -> { status, error, hasNovel, stale }
  const [pollNonce, setPollNonce] = useState(0);
```

ファイル上部(`lastLineOf` の上)に定数を追加:

```js
const NOVEL_POLL_MS = 5000;
```

`publishedNovels` の useEffect の下に、ジョブのポーリング effect を追加:

```jsx
  // 小説化の進行状況はサーバーが真実源。リロードや画面遷移を跨いでも「小説化中…」が
  // 維持されるよう、マウント時に取得し、実行中のジョブがある間だけ定期的に追う。
  useEffect(() => {
    if (!user) {
      setNovelJobs({});
      return;
    }
    let cancelled = false;
    let timer = null;
    (async function tick() {
      try {
        const jobs = await listNovelJobs();
        if (cancelled) return;
        setNovelJobs(jobs);
        if (Object.values(jobs).some((j) => j.status === 'running')) {
          timer = setTimeout(tick, NOVEL_POLL_MS);
        }
      } catch {
        // 取得に失敗してもホーム自体は使えるようにする(次の操作で再試行される)
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [user, pollNonce]);
```

- [ ] **Step 4: Implement — ハンドラを置き換える**

`handleNovelize` と `handleNovelizeIllustrated` を以下で置き換える:

```jsx
  async function handleNovelize(e, session) {
    e.stopPropagation();
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    // 押した直後から「小説化中…」にする。以降はポーリング結果で上書きされる。
    setNovelJobs((prev) => ({
      ...prev,
      [session.id]: { ...(prev[session.id] || {}), status: 'running', error: null },
    }));
    try {
      await novelizeSession(session.id);
    } catch (err) {
      setNovelJobs((prev) => ({
        ...prev,
        [session.id]: { ...(prev[session.id] || {}), status: 'error', error: err.message },
      }));
      return;
    }
    setPollNonce((n) => n + 1); // ポーリングを再始動する
  }

  async function handleDownloadNovel(e, session) {
    e.stopPropagation();
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      const { text } = await getNovel(session.id);
      downloadMarkdown(`${sanitizeFilename(session.title)}.md`, text);
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: '小説の取得に失敗した: ' + err.message }));
    }
  }

  async function handleDownloadIllustrated(e, session) {
    e.stopPropagation();
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      const { markdown } = await getIllustratedNovel(session.id);
      downloadMarkdown(`${sanitizeFilename(session.title)}-挿絵付き.md`, markdown);
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: '挿絵付き小説の取得に失敗した: ' + err.message }));
    }
  }
```

- [ ] **Step 5: Implement — 操作層のボタンをジョブ状態で切り替える**

`renderSessionCard` の冒頭(`const badges = [];` の上)に追加:

```jsx
    const job = novelJobs[s.id] || {};
    const running = job.status === 'running';
    const hasNovel = job.status === 'done' || !!job.hasNovel;
```

エラー表示ブロックを差し替え(`{novelizeError[s.id] && ...}` の部分):

```jsx
        {(novelizeError[s.id] || (job.status === 'error' && job.error)) && (
          <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.stamp, marginTop: 8 }}>
            {novelizeError[s.id] || `小説化に失敗した: ${job.error}`}
          </div>
        )}
        {hasNovel && job.stale && (
          <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.brassDark, marginTop: 8 }}>
            生成済みの小説は最新のログを反映していない可能性があります。
          </div>
        )}
```

操作層の小説化まわり(`<Button ... 小説化する>` と `挿絵付きでDL` のブロック)を差し替える:

```jsx
          {running ? (
            <Button variant="ghost" disabled style={ACTION_BTN}>
              小説化中…
            </Button>
          ) : (
            <>
              {hasNovel && (
                <Button variant="ghost" onClick={(e) => handleDownloadNovel(e, s)} style={ACTION_BTN}>
                  小説をDL
                </Button>
              )}
              {hasNovel && hasIllustrations(s) && (
                <Button variant="ghost" onClick={(e) => handleDownloadIllustrated(e, s)} style={ACTION_BTN}>
                  挿絵付きでDL
                </Button>
              )}
              <Button variant="ghost" onClick={(e) => handleNovelize(e, s)} disabled={!user} style={ACTION_BTN}>
                {job.status === 'error' ? '小説化を再試行' : hasNovel ? '小説を再生成' : '小説化する'}
              </Button>
            </>
          )}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: PASS(全件)

- [ ] **Step 7: Commit**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "feat(ui): 小説化の状態をサーバージョブから取得しボタンを切り替える"
```

---

## Task 7: `ending_reached` をGM応答に追加する

**Files:**
- Modify: `src/api/prompts.js:49-97`(`TURN_OUTPUT_FORMAT`)と `buildSystemBlocks` の「出力フィールドの書き方」
- Modify: `src/api/prompts.test.js`
- Modify: `src/api/turnResult.js`
- Modify: `src/api/turnResult.test.js`

**Interfaces:**
- Produces: `normalizeTurnResult(result).stateUpdate.endingReached: boolean`(既定 `false`)。Task 9 の Play.jsx が消費する

- [ ] **Step 1: Write the failing tests**

`src/api/turnResult.test.js` の末尾に追加:

```js
describe('normalizeTurnResult ending_reached', () => {
  it('reports endingReached true when the model says the story ended', () => {
    const out = normalizeTurnResult({ narrative: 'n', state_update: { ending_reached: true }, choices: [] });
    expect(out.stateUpdate.endingReached).toBe(true);
  });

  it('defaults endingReached to false when absent', () => {
    const out = normalizeTurnResult({ narrative: 'n', state_update: {}, choices: [] });
    expect(out.stateUpdate.endingReached).toBe(false);
  });

  it('treats non-boolean ending_reached as false', () => {
    const out = normalizeTurnResult({ narrative: 'n', state_update: { ending_reached: 'yes' }, choices: [] });
    expect(out.stateUpdate.endingReached).toBe(false);
  });
});
```

`src/api/prompts.test.js` の末尾に追加:

```js
describe('ending_reached', () => {
  it('declares ending_reached as a required boolean in the turn schema', () => {
    const su = TURN_OUTPUT_FORMAT.schema.properties.state_update;
    expect(su.properties.ending_reached.type).toBe('boolean');
    expect(su.required).toContain('ending_reached');
  });

  it('tells the GM when to set ending_reached', () => {
    const session = {
      world: { summary: 'w' },
      scenario: { raw: 's' },
      pc: { raw: 'p' },
      rulesetId: 'simple',
      state: { current_scene: 'c' },
    };
    expect(buildSystemBlocks(session)[0].text).toContain('ending_reached');
  });
});
```

`src/api/prompts.test.js` の import に `TURN_OUTPUT_FORMAT` と `buildSystemBlocks` が無ければ追加する。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/api/turnResult.test.js src/api/prompts.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'type')` / `endingReached` が undefined

- [ ] **Step 3: Implement — スキーマ**

`src/api/prompts.js` の `state_update` の `required` 配列を差し替え:

```js
          required: ['current_scene', 'flags', 'history_summary', 'xp_gained', 'tension_level', 'ending_reached'],
```

`tension_level` プロパティ定義の直後に追加:

```js
          ending_reached: {
            type: 'boolean',
            description: '物語が結末(エンディング)に到達したならtrue。通常はfalse',
          },
```

- [ ] **Step 4: Implement — プロンプト**

`buildSystemBlocks` の「出力フィールドの書き方」の `- choices:` の直前に1行追加:

```
- state_update.ending_reached: 物語が結末(エンディング)に到達し、これ以上続ける必要がない場合のみtrue。それ以外は必ずfalse。
```

- [ ] **Step 5: Implement — 正規化**

`src/api/turnResult.js` の `const tension_level = ...` の下に追加:

```js
  // 誤検知を避けるため、真偽値のtrue以外は全てfalseとして扱う。
  const endingReached = su.ending_reached === true;
```

戻り値の `stateUpdate` を差し替え:

```js
    stateUpdate: { current_scene, flags, history_summary, xpGain, tension_level, endingReached },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/api/turnResult.test.js src/api/prompts.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/api/prompts.js src/api/prompts.test.js src/api/turnResult.js src/api/turnResult.test.js
git commit -m "feat(gm): GM応答にending_reachedを追加しstateUpdateへ正規化する"
```

---

## Task 8: Play画面の固定ヘッダー

**Files:**
- Modify: `src/screens/Play.jsx:200-254`(ヘッダーブロック)
- Modify: `src/screens/Play.test.jsx`

**Interfaces:**
- Consumes: Task 1 の `Badge`
- Produces: なし

- [ ] **Step 1: Write the failing test**

`src/screens/Play.test.jsx` の末尾の `describe` 内に追加:

```js
  it('keeps the header pinned to the top of the viewport', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    const home = await screen.findByText('← ホーム');
    const header = home.closest('div[style*="sticky"]');
    expect(header).not.toBeNull();
    expect(header.style.top).toBe('0px');
  });

  it('returns home from the pinned header', async () => {
    const onExit = vi.fn();
    renderWithAuth(<Harness initialSession={makeSession()} onExit={onExit} />);
    fireEvent.click(await screen.findByText('← ホーム'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('shows a 完結 badge in the header for a finished session', async () => {
    renderWithAuth(<Harness initialSession={makeSession({ endedAt: 123 })} onExit={vi.fn()} />);
    expect(await screen.findByText('完結')).toBeInTheDocument();
  });

  it('does not show a 完結 badge for a session still in progress', async () => {
    renderWithAuth(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await screen.findByText('← ホーム');
    expect(screen.queryByText('完結')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: FAIL — `Unable to find an element with the text: ← ホーム`

- [ ] **Step 3: Implement**

`src/screens/Play.jsx` の import に追加:

```js
import Badge from '../components/ui/Badge.jsx';
```

ヘッダーブロック(`<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>` から対応する `</div>` まで、200行目付近〜254行目付近)を以下で置き換える:

```jsx
      {/* ログは下へ伸び続けるので、ホームへの導線をスクロール位置に依らず出す。
          「← ホーム」を左に置くのは、右上に固定されているAuthBarとの重なりを避けるため。 */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: mood.paper,
          borderBottom: `1px solid ${COLORS.line}`,
          margin: '-24px -20px 16px',
          // 非ドック時は右上のAuthBar(アバター)と重ならないよう右に余白を空ける。
          padding: docked ? '10px 20px' : '10px 56px 10px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <Button variant="ghost" onClick={onExit} style={{ fontSize: 12, padding: '6px 10px', whiteSpace: 'nowrap' }}>
          ← ホーム
        </Button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div
              style={{
                fontFamily: F_DISPLAY,
                fontSize: 16,
                color: COLORS.ink,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {session.title}
            </div>
            {session.endedAt && <Badge variant="brass">完結</Badge>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>
            <span>シーン: {session.state.current_scene}</span>
            <span>
              {session.ruleset?.growthUnit || '経験値'}: {session.state.xp || 0}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!docked && (
            <Button variant="ghost" onClick={() => setPanelOpen((v) => !v)} style={{ fontSize: 12, padding: '6px 10px' }}>
              PC
            </Button>
          )}
          {imageGen && (
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontFamily: F_MONO,
                fontSize: 11,
                color: COLORS.faint,
              }}
            >
              <input
                type="checkbox"
                checked={!!session.autoIllustrate}
                onChange={(e) => {
                  const updated = { ...session, autoIllustrate: e.target.checked, updatedAt: Date.now() };
                  setSession(updated);
                  saveSession(updated);
                  putSessionToServer(updated).catch((err) => console.error('session server sync failed', err));
                }}
              />
              挿絵を自動生成
            </label>
          )}
        </div>
      </div>
```

- [ ] **Step 4: 既存テストのラベル参照を更新**

`grep -n "ホームへ" src/screens/Play.test.jsx` で該当箇所があれば `← ホーム` に置き換える。

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS(全件)

- [ ] **Step 6: Commit**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "feat(ui): Play画面のヘッダーを固定しホーム導線を常時表示する"
```

---

## Task 9: エンディング到達の案内と確定

**Files:**
- Modify: `src/screens/Play.jsx`(`runTurn` の state 合成、ログ末尾の案内カード、ヘルパー追加)
- Modify: `src/screens/Play.test.jsx`
- Modify: `src/screens/Home.jsx`(`handleNextChapter` で `endedAt` を付ける)
- Modify: `src/screens/Home.test.jsx`

**Interfaces:**
- Consumes: Task 7 の `normalizeTurnResult(...).stateUpdate.endingReached`、Task 1 の `Badge`
- Produces: `session.endedAt: number | undefined`、`session.state.ending_reached: boolean`

- [ ] **Step 1: Write the failing test**

`src/screens/Play.test.jsx` の末尾の `describe` 内に追加:

```js
  it('offers to finish the story when the GM reports the ending was reached', async () => {
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。' }],
    });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);

    expect(await screen.findByText(/結末に辿り着いた/)).toBeInTheDocument();
    expect(screen.getByText('この物語を終える')).toBeInTheDocument();
    expect(screen.getByText('まだ続ける')).toBeInTheDocument();
  });

  it('does not offer to finish when the GM has not reported an ending', async () => {
    const session = makeSession({ log: [{ role: 'gm', text: '道は続く。' }] });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);
    await screen.findByText('道は続く。');
    expect(screen.queryByText('この物語を終える')).not.toBeInTheDocument();
  });

  it('stamps endedAt and shows the 完結 badge when the player finishes the story', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。' }],
    });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);

    fireEvent.click(await screen.findByText('この物語を終える'));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const saved = saveSpy.mock.calls.at(-1)[0];
    expect(typeof saved.endedAt).toBe('number');
    expect(await screen.findByText('完結')).toBeInTheDocument();
    expect(screen.queryByText('この物語を終える')).not.toBeInTheDocument();
  });

  it('clears the ending flag when the player chooses to keep playing', async () => {
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    const session = makeSession({
      state: { current_scene: '結末', flags: {}, history_summary: '', recent_log: [], turn_count: 5, ending_reached: true },
      log: [{ role: 'gm', text: '物語は終わった。' }],
    });
    renderWithAuth(<Harness initialSession={session} onExit={vi.fn()} />);

    fireEvent.click(await screen.findByText('まだ続ける'));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const saved = saveSpy.mock.calls.at(-1)[0];
    expect(saved.state.ending_reached).toBe(false);
    expect(saved.endedAt).toBeUndefined();
    expect(screen.queryByText('この物語を終える')).not.toBeInTheDocument();
  });
```

`src/screens/Home.test.jsx` の末尾に追加:

```js
  it('marks the session as ended when the campaign advances to the next chapter', async () => {
    vi.spyOn(sessionApi, 'advanceCampaignPc').mockResolvedValue({ pcRaw: '更新シート', xp: 7 });
    vi.spyOn(campaignClient, 'getCampaign').mockResolvedValue(null);
    vi.spyOn(campaignClient, 'putCampaign').mockResolvedValue({});
    vi.spyOn(campaignClient, 'listCampaigns').mockResolvedValue([]);
    vi.spyOn(sessionSyncClient, 'putSessionToServer').mockResolvedValue({});
    const saveSpy = vi.spyOn(storage, 'saveSession').mockResolvedValue(true);
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, worldId: 'w1', state: {}, log: [] }];
    renderWithAuth(
      <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} onNextChapter={vi.fn()} />
    );

    fireEvent.click(await screen.findByText('次の章へ'));

    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    expect(typeof saveSpy.mock.calls.at(-1)[0].endedAt).toBe('number');
  });
```

`src/screens/Home.test.jsx` の import に `import * as storage from '../storage/index.js';` が無ければ追加する。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/screens/Play.test.jsx src/screens/Home.test.jsx`
Expected: FAIL — `Unable to find an element with the text: /結末に辿り着いた/`

- [ ] **Step 3: Implement — `runTurn` に `ending_reached` を反映**

`src/screens/Play.jsx` の `runTurn` 内、`updated` を組み立てる `state` オブジェクトの `tension_level` 行の直後に追加:

```js
            ending_reached: norm.stateUpdate.endingReached,
```

- [ ] **Step 4: Implement — 確定/継続のハンドラ**

`src/screens/Play.jsx` の `submitChoice` 関数の直後に追加:

```jsx
  // エンディングの確定・取り消しはターン進行を伴わないので、最新セッションへ直接書く。
  async function persistSession(updated) {
    setSession(updated);
    await saveSession(updated);
    putSessionToServer(updated).catch((e) => console.error('session server sync failed', e));
  }

  function finishStory() {
    const current = sessionRef.current;
    persistSession({ ...current, endedAt: Date.now(), updatedAt: Date.now() });
  }

  // AIの誤検知で完結扱いにしないための逃げ道。次のターンで再度trueが返れば案内は戻る。
  function keepPlaying() {
    const current = sessionRef.current;
    persistSession({
      ...current,
      state: { ...current.state, ending_reached: false },
      updatedAt: Date.now(),
    });
  }
```

- [ ] **Step 5: Implement — 案内カード**

`src/screens/Play.jsx` のログ一覧の `)}` の直後、`{busy && (` の直前に追加:

```jsx
        {session.state?.ending_reached && !session.endedAt && (
          <Card style={{ borderColor: COLORS.brass }}>
            <div style={{ fontFamily: F_BODY, fontSize: 14, color: COLORS.ink, marginBottom: 10 }}>
              物語は結末に辿り着いたようだ。
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Button variant="brass" onClick={finishStory}>
                この物語を終える
              </Button>
              <Button variant="ghost" onClick={keepPlaying}>
                まだ続ける
              </Button>
            </div>
          </Card>
        )}
```

- [ ] **Step 6: Implement — `次の章へ` で `endedAt` を立てる**

`src/screens/Home.jsx` の `handleNextChapter` 内、`if (!session.campaignId) { ... }` のブロック全体を以下で置き換える:

```jsx
      // 次章へ進む＝この章は終わり。キャンペーン側のchapters[].endedAtと足並みを揃える。
      const ended = {
        ...session,
        campaignId,
        endedAt: session.endedAt || Date.now(),
        updatedAt: Date.now(),
      };
      await saveSession(ended);
      putSessionToServer(ended).catch((err) => console.error('session server sync failed', err));
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/screens/Play.test.jsx src/screens/Home.test.jsx`
Expected: PASS(全件)

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS(既知フレーク `server/routes/characters.test.js` の1件を除く。落ちたら `npx vitest run server/routes/characters.test.js` で単体確認)

- [ ] **Step 9: Commit**

```bash
git add src/screens/Play.jsx src/screens/Play.test.jsx src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "feat: エンディング到達の申告と完結の確定・表示を追加"
```

---

## Task 10: ドキュメント同期

**Files:**
- Modify: `docs/01-architecture.md`
- Modify: `docs/02-data-model.md`
- Modify: `docs/03-gm-logic.md`
- Modify: `docs/05-ui-ux.md`
- Modify: `docs/06-content-generation.md`
- Modify: `docs/superpowers/handoff-2026-07-25-ending-collection.md`

- [ ] **Step 1: 各ドキュメントの該当箇所を読む**

Run: `grep -rn "小説化\|novelize" docs/*.md`
Run: `grep -rn "state_update\|セッション終了" docs/*.md`

- [ ] **Step 2: `docs/01-architecture.md` を更新**

プロキシサーバーの箇条書きにある「小説化(novelize)は独自プロンプトを組んでAnthropicを直接呼び出し、結果を保存するビジネスロジックを持つ」を、非同期ジョブになったことを反映した記述に差し替える。要点: `POST /novelize` は 202 を即返し、生成は `server/novelJobs.js` がバックグラウンドで実行、状態は `novelJob` レコードに永続化、`GET /api/novel-jobs` で参照、プロセス再起動や10分超過は読み取り時に失敗へ倒す。

- [ ] **Step 3: `docs/02-data-model.md` を更新**

セッションのフィールドに追記する:

- `endedAt?: number` — 物語を終えた時刻。プレイヤーが「この物語を終える」を押したとき、またはキャンペーンで次章へ進んだときに入る。無い場合は未完結
- `state.ending_reached?: boolean` — 直近のターンでGMが結末到達を申告したか。確定前の一時的な状態で、「まだ続ける」でfalseに戻る

小説化ジョブのレコード(`users/{userId}/sessions/{sessionId}/novelJob`)の形状 `{ status, startedAt, updatedAt, error, bootId }` も追記する。

- [ ] **Step 4: `docs/03-gm-logic.md` を更新**

`state_update` のフィールド一覧に `ending_reached`(boolean、結末到達時のみtrue)を追加する。

- [ ] **Step 5: `docs/05-ui-ux.md` を更新**

- セッション一覧カードが「情報 / 状態バッジ(完結・公開中・挿絵あり) / 操作」の3層になったこと
- Play画面のヘッダーが `position: sticky` で、左端に `← ホーム` を置くこと
- エンディング案内カード(「この物語を終える」/「まだ続ける」)
- 小説化ボタンの状態遷移(小説化する → 小説化中… → 小説をDL / 挿絵付きでDL / 小説を再生成、失敗時は小説化を再試行)

- [ ] **Step 6: `docs/06-content-generation.md` を更新**

小説化のフローを非同期ジョブに合わせて書き換える(押下→202→ポーリング→DLボタン)。完了時の自動ダウンロードは行わないことを明記。

- [ ] **Step 7: `docs/superpowers/handoff-2026-07-25-ending-collection.md` を更新**

「1. 「セッション終了」という概念が存在しない ← 最重要」の節に、本実装で `session.endedAt` と `state.ending_reached` が導入され、終了アクション(Play画面の「この物語を終える」)が既に存在することを追記する。エンディングタイトルの命名・図鑑化・ダイス統計は未実装のまま残っていることも明記する。

- [ ] **Step 8: Verify**

Run: `npm test`
Expected: PASS(既知フレークを除く)

- [ ] **Step 9: Commit**

```bash
git add docs
git commit -m "docs: UI改善と小説化非同期化をドキュメントへ反映"
```

---

## 完了条件

- `npm test` が通る(既知フレーク `server/routes/characters.test.js` の1件を除く)
- 手動確認: `npm run dev` で
  1. セッション一覧でボタンとバッジが見分けられる
  2. プレイ中に下までスクロールしてもヘッダーの `← ホーム` が見える
  3. `小説化する` を押すと即座に `小説化中…` になり、**リロードしても** `小説化中…` のままで押せない。完了後は `小説をDL` に変わる
  4. サーバーを再起動すると、生成中だったジョブが失敗として表示され再試行できる
