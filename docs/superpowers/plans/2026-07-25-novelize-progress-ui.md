# 小説化の進捗表示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小説化の実行中に経過時間・目安・案内文を表示し、完了をカード内ブロックとトーストで知らせることで、数分〜十数分の待ち時間を「壊れている」と誤解されない状態にする。

**Architecture:** サーバーは `GET /api/novel-jobs` で実行中ジョブの `elapsedMs`(サーバー時刻基準の経過ミリ秒)を返す。クライアントは5秒ポーリングのまま、受信時刻からの差分で1秒ごとに補間表示する。状態遷移(`running` → `done` / `error`)の検知は `Home.jsx` の `applyNovelJobs` 一箇所に集約し、完了ブロックとトーストを出す。

**Tech Stack:** React 18(hooks、CSS-in-JS のインラインスタイル)、Express、Vitest + @testing-library/react、jsdom

設計ドキュメント: `docs/superpowers/specs/2026-07-25-novelize-progress-ui-design.md`

## Global Constraints

- テストは `npx vitest run <path>` で個別実行、全体は `npm test`。
- スタイルは既存どおり `src/theme.js` の `COLORS` / `F_DISPLAY` / `F_BODY` / `F_MONO` を使う。CSSファイルは追加しない。
- アニメーションは `motionAllowed()` が `true` のときだけ動かす。`@keyframes` は `src/components/ui/Stamp.jsx` の `ensureKeyframes()` パターン(idつき `<style>` を `document.head` に一度だけ挿入)に倣う。
- コード中のコメントは日本語。「何をしているか」ではなく「なぜそうしたか」を書く(既存コードの方針)。
- コミットメッセージは Conventional Commits + 日本語の要約。本文末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付ける。
- 待機中の案内文(確定文言、変更しないこと):
  - 見出し(実行中): `小説を執筆しています`
  - 見出し(完了): `小説ができました`
  - 経過行(5分以下): `{m:ss} 経過 ・ 目安 2〜5分`
  - 経過行(5分超): `{m:ss} 経過`
  - 案内行(5分以下): `長い記録ほど時間がかかります。このまま他の画面に移っても生成は続きます。`
  - 案内行(5分超): `長い記録のため時間がかかっています。最大30分ほどかかることがあります。中断はされていません。`
  - 案内行(完了): `下の「小説をDL」から取り出せます`
  - トースト(成功): `「{セッション名}」の小説ができました`
  - トースト(失敗): `「{セッション名}」の小説化に失敗しました`
- 「最大30分」は `NOVEL_JOB_TIMEOUT_MS`(= `NOVELIZE_UPSTREAM_TIMEOUT_MS` 300000ms × (`NOVELIZE_MAX_CONTINUATIONS` 4 + 1) + 300000ms = 1800000ms = 30分)と整合させた数値。サーバー定数をクライアントから import はせず、リテラルで書いてコメントで対応を明記する。

## File Structure

| ファイル | 責務 |
|---|---|
| `server/novelJobs.js`(変更) | `resolveJobStatus` が running のとき `elapsedMs` を返す |
| `server/routes/sessions.js`(変更) | `GET /novel-jobs` のレスポンスに `elapsedMs` を載せる |
| `src/components/ui/NovelizeProgress.jsx`(新規) | 待機ブロック / 完了ブロックの表示のみ。状態もタイマーも持たない |
| `src/components/ui/Toast.jsx`(新規) | トーストスタックの表示と自動消滅タイマー。キュー管理は持たない |
| `src/screens/Home.jsx`(変更) | 受信時刻の記録、1秒タイマー、状態遷移の検知、上記2部品の描画 |

`NovelizeProgress` と `Toast` は props だけで決まる表示コンポーネントにする。判断(いつ出すか)は `Home.jsx` に集約し、表示部品は再利用可能かつ単体でテスト可能に保つ。

---

### Task 1: サーバーが経過時間を返す

**Files:**
- Modify: `server/novelJobs.js:19-29`
- Modify: `server/routes/sessions.js:33-52`
- Test: `server/novelJobs.test.js:47-81`
- Test: `server/routes/sessions.test.js`

**Interfaces:**
- Consumes: なし(このタスクが最初)
- Produces:
  - `resolveJobStatus(job, { bootId, now })` → `{ status: 'idle'|'running'|'done'|'error', error: string|null, elapsedMs: number|null }`。`elapsedMs` は `status === 'running'` のときだけ数値、それ以外は `null`。
  - `GET /api/novel-jobs` のレスポンス: `{ [sessionId]: { status, error, elapsedMs, hasNovel, stale, truncated } }`

- [x] **Step 1: 既存テストを新しい戻り値の形に更新する(失敗させる)**

`server/novelJobs.test.js` の `describe('resolveJobStatus', ...)` ブロック(47〜81行目)を丸ごと次で置き換える。既存の3つの `toEqual` は `elapsedMs` が増えることで必ず落ちるため、ここで一緒に直す。

```js
describe('resolveJobStatus', () => {
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
```

- [x] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run server/novelJobs.test.js`
Expected: FAIL。`resolveJobStatus` の戻り値に `elapsedMs` が無いため `toEqual` が
`- Expected + Received` の差分で `elapsedMs: null` の欠落を報告する。

- [x] **Step 3: `resolveJobStatus` に `elapsedMs` を足す**

`server/novelJobs.js` の `resolveJobStatus`(19〜29行目)を次で置き換える。

```js
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
```

- [x] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run server/novelJobs.test.js`
Expected: PASS(全テスト)

- [x] **Step 5: ルートのテストを書く(失敗させる)**

`server/routes/sessions.test.js` の import に `sessionNovelJobKey` を追加する。13行目の import 文を次で置き換える。

```js
import { sessionImagePath, sessionNovelJobKey } from '../storage/paths.js';
```

そのうえで、`describe('sessions routes', ...)` の中(既存の `reports truncated in /novel-jobs when the novelization hit the continuation limit` テストの直後)に次を追加する。

実際に走っているジョブを待つと生成が即座に終わってしまい running を観測できないため、
ジョブレコードを直接書き込んで running 状態を作る。

```js
  it('reports elapsedMs for a running job in /novel-jobs', async () => {
    // 実際の生成は一瞬で終わるためrunningを観測できない。ジョブレコードを直接置く。
    buildApp({ now: () => 5000 });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    await dataStore.set(sessionNovelJobKey('usr_test', 's1'), {
      status: 'running',
      startedAt: 1000,
      updatedAt: 1000,
      error: null,
      bootId: 'boot-test',
    });

    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.status).toBe('running');
    expect(jobs.body.s1.elapsedMs).toBe(4000);
  });

  it('reports a null elapsedMs for a finished job in /novel-jobs', async () => {
    buildApp();
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [{ role: 'gm', text: 'g' }] });
    await request(app).post('/api/sessions/s1/novelize');
    await waitForJob('s1');

    const jobs = await request(app).get('/api/novel-jobs');
    expect(jobs.body.s1.status).toBe('done');
    expect(jobs.body.s1.elapsedMs).toBeNull();
  });
```

- [x] **Step 6: テストを実行して失敗を確認する**

Run: `npx vitest run server/routes/sessions.test.js -t elapsedMs`
Expected: FAIL。`expected undefined to be 4000` — ルートがまだ `elapsedMs` を返していない。

- [x] **Step 7: ルートのレスポンスに `elapsedMs` を載せる**

`server/routes/sessions.js` の 38行目と 42〜49行目を次で置き換える。

```js
      const { status, error, elapsedMs } = await novelJobs.read(req.userId, id);
      const text = await textStore.read(sessionNovelDocPath(req.userId, id));
      const meta = await dataStore.get(sessionNovelMetaKey(req.userId, id));
      const session = await dataStore.get(key);
      out[id] = {
        status,
        error,
        // 実行中のみ数値。クライアントはこれを起点に秒を補間して表示する。
        elapsedMs,
        hasNovel: text !== null,
        stale: isStale(meta, session),
        // この変更以前に生成された小説のメタにはtruncatedが無い。完結扱いにする。
        truncated: meta?.truncated === true,
      };
```

- [x] **Step 8: テストを実行して通ることを確認する**

Run: `npx vitest run server/routes/sessions.test.js server/novelJobs.test.js`
Expected: PASS(全テスト)

- [x] **Step 9: コミット**

```bash
git add server/novelJobs.js server/routes/sessions.js server/novelJobs.test.js server/routes/sessions.test.js
git commit -m "$(cat <<'EOF'
feat(server): 小説化ジョブの経過時間をAPIで返す

クライアントが「何分待っているか」を表示できるようにする。時計ずれの
影響を受けないよう、絶対時刻ではなくサーバー基準の経過ミリ秒を返す。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 待機ブロック / 完了ブロックのコンポーネント

**Files:**
- Create: `src/components/ui/NovelizeProgress.jsx`
- Test: `src/components/ui/NovelizeProgress.test.jsx`

**Interfaces:**
- Consumes: `COLORS` / `F_DISPLAY` / `F_BODY` / `F_MONO` / `motionAllowed`(`src/theme.js`)
- Produces:
  - `export function formatElapsed(ms: number): string` — ミリ秒を `m:ss` にする。負値は `0:00`。
  - `export default function NovelizeProgress({ done?: boolean, elapsedMs?: number })` — `done` が真なら完了ブロック、偽なら待機ブロック。`elapsedMs` は待機時のみ使う。

- [x] **Step 1: 失敗するテストを書く**

Create `src/components/ui/NovelizeProgress.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NovelizeProgress, { formatElapsed } from './NovelizeProgress.jsx';

describe('formatElapsed', () => {
  it('formats milliseconds as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(9000)).toBe('0:09');
    expect(formatElapsed(84000)).toBe('1:24');
    expect(formatElapsed(723000)).toBe('12:03');
  });

  it('clamps a negative elapsed time to zero', () => {
    // 受信時刻の補間で理論上わずかに負になりうる。マイナス表示は出さない。
    expect(formatElapsed(-500)).toBe('0:00');
  });
});

describe('NovelizeProgress', () => {
  it('shows the heading, the elapsed time and the estimate while running', () => {
    render(<NovelizeProgress elapsedMs={84000} />);
    expect(screen.getByRole('status')).toHaveTextContent('小説を執筆しています');
    expect(screen.getByText('1:24 経過 ・ 目安 2〜5分')).toBeInTheDocument();
    expect(
      screen.getByText('長い記録ほど時間がかかります。このまま他の画面に移っても生成は続きます。')
    ).toBeInTheDocument();
  });

  it('drops the estimate and explains the upper bound once it runs past five minutes', () => {
    render(<NovelizeProgress elapsedMs={432000} />); // 7:12
    expect(screen.getByText('7:12 経過')).toBeInTheDocument();
    expect(screen.queryByText(/目安/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        '長い記録のため時間がかかっています。最大30分ほどかかることがあります。中断はされていません。'
      )
    ).toBeInTheDocument();
  });

  it('keeps the estimate exactly at the five minute mark', () => {
    // 「5分を超えたら」であって「5分になったら」ではない(境界の回帰防止)。
    render(<NovelizeProgress elapsedMs={300000} />);
    expect(screen.getByText('5:00 経過 ・ 目安 2〜5分')).toBeInTheDocument();
  });

  it('hides the elapsed time from assistive technology', () => {
    // 毎秒更新される値を読み上げ対象にすると連続読み上げになるため。
    const { container } = render(<NovelizeProgress elapsedMs={84000} />);
    const hidden = [...container.querySelectorAll('[aria-hidden="true"]')];
    expect(hidden.some((el) => el.textContent === '1:24 経過 ・ 目安 2〜5分')).toBe(true);
  });

  it('shows the completion message and no elapsed time when done', () => {
    render(<NovelizeProgress done elapsedMs={84000} />);
    expect(screen.getByRole('status')).toHaveTextContent('小説ができました');
    expect(screen.getByText('下の「小説をDL」から取り出せます')).toBeInTheDocument();
    expect(screen.queryByText(/経過/)).not.toBeInTheDocument();
  });
});
```

- [x] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/ui/NovelizeProgress.test.jsx`
Expected: FAIL。`Failed to resolve import "./NovelizeProgress.jsx"` — ファイルがまだ無い。

- [x] **Step 3: コンポーネントを実装する**

Create `src/components/ui/NovelizeProgress.jsx`:

```jsx
import { useEffect } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, motionAllowed } from '../../theme.js';

// 目安を外れたとみなす閾値。これを超えたら見積もりの提示自体をやめる。
// 一度外した見積もりを出し続けても信頼を損なうだけなので、代わりに上限を伝える。
const ESTIMATE_LIMIT_MS = 5 * 60 * 1000;

// 「最大30分」はサーバーの NOVEL_JOB_TIMEOUT_MS(= 上流タイムアウト300秒 ×
// (継続上限4 + 1) + 余裕300秒 = 30分)と対応している。これより短い数字を提示すると
// タイムアウト前に約束を破ることになる。サーバー定数を跨いでimportはしないため、
// あちらを変えたときはこの文言も合わせること。
const OVER_ESTIMATE_NOTE =
  '長い記録のため時間がかかっています。最大30分ほどかかることがあります。中断はされていません。';
const RUNNING_NOTE = '長い記録ほど時間がかかります。このまま他の画面に移っても生成は続きます。';
const DONE_NOTE = '下の「小説をDL」から取り出せます';

const KEYFRAMES_ID = 'trpg-novelize-anim';
const KEYFRAMES = `
@keyframes trpg-novelize-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}`;

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const BOX = {
  border: `1px dashed ${COLORS.line}`,
  borderRadius: 4,
  background: COLORS.paper,
  padding: '10px 12px',
  marginTop: 8,
};

// 小説化の待機中/完了直後にセッションカード内へ出す面。状態は持たず、
// 「いつ出すか」の判断は呼び出し側(Home)に置く。
export default function NovelizeProgress({ done = false, elapsedMs = 0 }) {
  const animating = !done && motionAllowed();
  useEffect(() => {
    if (animating) ensureKeyframes();
  }, [animating]);

  const overEstimate = elapsedMs > ESTIMATE_LIMIT_MS;

  return (
    <div style={BOX}>
      {/* 状態遷移(執筆中 → できました)を伝えるのはこの行だけなので、role はここに置く。 */}
      <div role="status" style={{ fontFamily: F_DISPLAY, fontSize: 13, color: COLORS.brassDark }}>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            marginRight: 6,
            animation: animating ? 'trpg-novelize-pulse 1.6s ease-in-out infinite' : 'none',
          }}
        >
          {done ? '✓' : '●'}
        </span>
        {done ? '小説ができました' : '小説を執筆しています'}
      </div>

      {!done && (
        <div
          aria-hidden="true"
          style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.brass, marginTop: 4 }}
        >
          {formatElapsed(elapsedMs)} 経過{overEstimate ? '' : ' ・ 目安 2〜5分'}
        </div>
      )}

      <div
        style={{
          fontFamily: F_BODY,
          fontSize: 12,
          color: COLORS.inkSoft,
          opacity: 0.8,
          marginTop: 4,
          lineHeight: 1.6,
        }}
      >
        {done ? DONE_NOTE : overEstimate ? OVER_ESTIMATE_NOTE : RUNNING_NOTE}
      </div>
    </div>
  );
}
```

- [x] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run src/components/ui/NovelizeProgress.test.jsx`
Expected: PASS(7テスト)

- [x] **Step 5: コミット**

```bash
git add src/components/ui/NovelizeProgress.jsx src/components/ui/NovelizeProgress.test.jsx
git commit -m "$(cat <<'EOF'
feat(ui): 小説化の待機・完了ブロックのコンポーネントを追加

経過時間と目安、待ってよい旨の案内を出す面。目安(5分)を超えたら
見積もりを取り下げ、上限30分を伝える文言に切り替える。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: トーストスタックのコンポーネント

**Files:**
- Create: `src/components/ui/Toast.jsx`
- Test: `src/components/ui/Toast.test.jsx`

**Interfaces:**
- Consumes: `COLORS` / `F_BODY` / `motionAllowed`(`src/theme.js`)
- Produces:
  - `export const TOAST_TIMEOUT_MS = 6000`
  - `export default function ToastStack({ items, onDismiss })`。`items` は `{ id: string, text: string, tone?: 'success'|'error' }` の配列。`onDismiss(id)` は自動消滅時と `×` 押下時に呼ばれる。`items` が空なら何も描画しない。

- [x] **Step 1: 失敗するテストを書く**

Create `src/components/ui/Toast.test.jsx`:

```jsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ToastStack, { TOAST_TIMEOUT_MS } from './Toast.jsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('ToastStack', () => {
  it('renders nothing when there are no items', () => {
    const { container } = render(<ToastStack items={[]} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one entry per item inside a polite live region', () => {
    render(
      <ToastStack
        items={[
          { id: 't1', text: '「A」の小説ができました', tone: 'success' },
          { id: 't2', text: '「B」の小説化に失敗しました', tone: 'error' },
        ]}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText('「A」の小説ができました')).toBeInTheDocument();
    expect(screen.getByText('「B」の小説化に失敗しました')).toBeInTheDocument();
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('calls onDismiss with the item id when the close button is pressed', () => {
    const onDismiss = vi.fn();
    render(<ToastStack items={[{ id: 't1', text: 'A' }]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('閉じる'));
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('dismisses itself after the timeout', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ToastStack items={[{ id: 't1', text: 'A' }]} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS);
    });
    expect(onDismiss).toHaveBeenCalledWith('t1');
  });

  it('does not restart its timer when the parent re-renders with a new onDismiss identity', () => {
    // 親(Home)は1秒ごとに再描画されるため、onDismissの参照が毎回変わる。
    // これをeffectの依存に入れるとタイマーが毎秒張り直され、永久に消えない。
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const items = [{ id: 't1', text: 'A' }];
    const { rerender } = render(<ToastStack items={items} onDismiss={() => onDismiss('t1')} />);

    for (let i = 0; i < 5; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      rerender(<ToastStack items={items} onDismiss={() => onDismiss('t1')} />);
    }
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(onDismiss).toHaveBeenCalledWith('t1');
  });
});
```

- [x] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/components/ui/Toast.test.jsx`
Expected: FAIL。`Failed to resolve import "./Toast.jsx"` — ファイルがまだ無い。

- [x] **Step 3: コンポーネントを実装する**

Create `src/components/ui/Toast.jsx`:

```jsx
import { useEffect, useRef } from 'react';
import { COLORS, F_BODY, motionAllowed } from '../../theme.js';

export const TOAST_TIMEOUT_MS = 6000;

// AuthBar(zIndex 90)とモーダル(100/1000)より下に置く。上から降りてくる位置も
// AuthBarと重ならないよう下げる。
const STACK_Z_INDEX = 80;
const STACK_TOP = 64;

const KEYFRAMES_ID = 'trpg-toast-anim';
const KEYFRAMES = `
@keyframes trpg-toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}`;

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

function ToastItem({ item, onDismiss }) {
  // onDismissは親の再描画ごとに新しい関数になる。これをeffectの依存に入れると
  // 経過時間の1秒更新のたびにタイマーが張り直され、自動消滅が永久に来なくなる。
  // 依存はidのみにし、最新のコールバックはrefから読む。
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const animating = motionAllowed();
    if (animating) ensureKeyframes();
    const timer = setTimeout(() => dismissRef.current(item.id), TOAST_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [item.id]);

  const borderColor = item.tone === 'error' ? COLORS.stamp : COLORS.brass;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: COLORS.card,
        border: `1px solid ${borderColor}`,
        borderRadius: 4,
        boxShadow: '0 2px 6px rgba(31,42,56,0.12)',
        padding: '8px 12px',
        fontFamily: F_BODY,
        fontSize: 13,
        color: COLORS.ink,
        animation: motionAllowed() ? 'trpg-toast-in 200ms ease-out' : 'none',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.text}</span>
      <button
        type="button"
        aria-label="閉じる"
        onClick={() => onDismiss(item.id)}
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          color: COLORS.brassDark,
          fontSize: 14,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}

// 画面上部に積む通知。キューの管理(いつ足すか)は呼び出し側の責務。
export default function ToastStack({ items, onDismiss }) {
  if (!items.length) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: STACK_TOP,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: STACK_Z_INDEX,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        width: 'max-content',
        maxWidth: 'min(92vw, 420px)',
      }}
    >
      {items.map((item) => (
        <ToastItem key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
```

- [x] **Step 4: テストを実行して通ることを確認する**

Run: `npx vitest run src/components/ui/Toast.test.jsx`
Expected: PASS(5テスト)

- [x] **Step 5: コミット**

```bash
git add src/components/ui/Toast.jsx src/components/ui/Toast.test.jsx
git commit -m "$(cat <<'EOF'
feat(ui): 画面上部のトーストスタックを追加

一覧の下方にあるカードの完了に気づけるようにする。自動消滅のタイマーは
親の再描画で張り直されないよう、依存をidのみにしてコールバックはrefで読む。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 経過時間の補間と待機ブロックの表示

**Files:**
- Modify: `src/screens/Home.jsx`(import 追加、ポーリング内の受信時刻記録、1秒タイマー、`renderSessionCard` 内の描画)
- Test: `src/screens/Home.test.jsx`

**Interfaces:**
- Consumes: `NovelizeProgress`(Task 2)、`GET /api/novel-jobs` の `elapsedMs`(Task 1)
- Produces: `running` のセッションカードに待機ブロックが出る状態。Task 5 はここに完了ブロックとトーストを足す。

- [x] **Step 1: 失敗するテストを書く**

`src/screens/Home.test.jsx` の `describe('Home', ...)` の中、既存の
`shows 小説化中… and disables the button while the server reports a running job` テストの直後に追加する。

```jsx
  it('shows the waiting block with the elapsed time while a job is running', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'running', error: null, elapsedMs: 84000, hasNovel: false, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('1:24 経過 ・ 目安 2〜5分')).toBeInTheDocument();
    expect(
      screen.getByText('長い記録ほど時間がかかります。このまま他の画面に移っても生成は続きます。')
    ).toBeInTheDocument();
  });

  it('advances the elapsed time every second between polls', async () => {
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'running', error: null, elapsedMs: 84000, hasNovel: false, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByText('1:24 経過 ・ 目安 2〜5分')).toBeInTheDocument();

      // ポーリング(5秒)を待たずに数字が進むこと。止まって見えないための肝。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.getByText('1:26 経過 ・ 目安 2〜5分')).toBeInTheDocument();
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('stops the one-second interval once no job is running', async () => {
    const listSpy = vi.spyOn(sessionSyncClient, 'listNovelJobs');
    listSpy.mockResolvedValueOnce({
      s1: { status: 'running', error: null, elapsedMs: 1000, hasNovel: false, stale: false },
    });
    listSpy.mockResolvedValueOnce({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.queryByText(/経過/)).not.toBeInTheDocument();
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });
```

- [x] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/screens/Home.test.jsx -t 経過`
Expected: FAIL。`Unable to find an element with the text: 1:24 経過 ・ 目安 2〜5分`

- [x] **Step 3: `Home.jsx` に import を足す**

`src/screens/Home.jsx` の 5行目(`import Badge ...`)の直後に追加する。

```jsx
import NovelizeProgress from '../components/ui/NovelizeProgress.jsx';
```

- [x] **Step 4: 受信時刻の ref と1秒タイマーを足す**

`src/screens/Home.jsx` の 49〜50行目、`hasRunningRef` の宣言の直後に次を挿入する。

```jsx
  // 経過時間の補間の起点。ポーリング応答を受け取った時刻(クライアント時計)を控える。
  // 差分にしか使わないため、サーバーとの時計ずれの影響を受けない。
  const jobsReceivedAtRef = useRef(0);
```

続いて、`applyNovelJobs` の定義(62〜68行目)の直後に次を挿入する。

```jsx
  const anyRunning = Object.values(novelJobs).some((j) => j.status === 'running');

  // 実行中のジョブがある間だけ1秒ごとに再描画し、経過時間の表示を進める。
  // ポーリング(5秒)の更新だけに任せると数字が5秒刻みで飛び、止まって見える。
  // 値そのものは使わないため、setterだけを受け取る。
  const [, setElapsedTick] = useState(0);
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setElapsedTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);
```

- [x] **Step 5: ポーリング成功時に受信時刻を記録する**

`src/screens/Home.jsx` のポーリング内、155〜156行目を次で置き換える。

```jsx
        const jobs = await listNovelJobs();
        if (cancelled) return;
        jobsReceivedAtRef.current = Date.now();
```

- [x] **Step 6: カードに待機ブロックを描画する**

`renderSessionCard` 内、`const running = job.status === 'running';` の行の直後に次を挿入する。

```jsx
    // サーバーが返した経過時間に、受信からの実時間を足して補間する。
    // 楽観的更新の直後(elapsedMs未取得)は0から始める。
    const elapsedMs =
      running && typeof job.elapsedMs === 'number' ? job.elapsedMs + (Date.now() - jobsReceivedAtRef.current) : 0;
```

続いて、`truncated` 警告の JSX ブロック(409〜413行目)の直後、`{/* 操作層 */}` コメントの直前に次を挿入する。

```jsx
        {running && <NovelizeProgress elapsedMs={elapsedMs} />}
```

- [x] **Step 7: テストを実行して通ることを確認する**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: PASS(既存テストを含む全テスト)

- [x] **Step 8: コミット**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "$(cat <<'EOF'
feat(home): 小説化中に経過時間と待機の案内を表示する

ボタンが「小説化中…」のまま数分変化せず、動いているか分からなかった。
5秒ポーリングの間をクライアント側で1秒ごとに補間し、数字が進むようにする。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 完了の検知・完了ブロック・トースト

**Files:**
- Modify: `src/screens/Home.jsx`(`applyNovelJobs` の書き換え、`collectJobEvents` の追加、完了ブロックとトーストの描画、DL/再生成時のクリア)
- Test: `src/screens/Home.test.jsx`

**Interfaces:**
- Consumes: `NovelizeProgress`(Task 2)、`ToastStack` / `TOAST_TIMEOUT_MS`(Task 3)、Task 4 で入れた `anyRunning` / `jobsReceivedAtRef`
- Produces:
  - `export function collectJobEvents(prev, next, titleOf)` → `{ id: string, kind: 'done'|'error', title: string }[]`。`prev[id].status === 'running'` だったものだけを対象にする。

- [x] **Step 1: 失敗するテストを書く**

`src/screens/Home.test.jsx` の import 行(3行目)を次で置き換える。

```jsx
import Home, { sanitizeFilename, collectJobEvents } from './Home.jsx';
```

`describe('Home', ...)` ブロックの外(ファイル末尾)に、純粋関数のテストを追加する。

```jsx
describe('collectJobEvents', () => {
  const titleOf = (id) => ({ s1: 'A', s2: 'B' })[id] ?? '';

  it('reports a done transition only when the previous state was running', () => {
    const prev = { s1: { status: 'running' } };
    const next = { s1: { status: 'done' } };
    expect(collectJobEvents(prev, next, titleOf)).toEqual([{ id: 's1', kind: 'done', title: 'A' }]);
  });

  it('ignores sessions that were already done before (regression: no notification on first load)', () => {
    // マウント時の初回取得では前状態が空。ここで発火すると過去の全セッションが
    // 「できました」になる。
    expect(collectJobEvents({}, { s1: { status: 'done' } }, titleOf)).toEqual([]);
    expect(collectJobEvents({ s1: { status: 'done' } }, { s1: { status: 'done' } }, titleOf)).toEqual([]);
  });

  it('reports an error transition', () => {
    const prev = { s1: { status: 'running' } };
    const next = { s1: { status: 'error', error: 'boom' } };
    expect(collectJobEvents(prev, next, titleOf)).toEqual([{ id: 's1', kind: 'error', title: 'A' }]);
  });

  it('ignores a job that is still running', () => {
    expect(collectJobEvents({ s1: { status: 'running' } }, { s1: { status: 'running' } }, titleOf)).toEqual([]);
  });

  it('reports every session that finished in the same poll', () => {
    const prev = { s1: { status: 'running' }, s2: { status: 'running' } };
    const next = { s1: { status: 'done' }, s2: { status: 'error' } };
    expect(collectJobEvents(prev, next, titleOf)).toEqual([
      { id: 's1', kind: 'done', title: 'A' },
      { id: 's2', kind: 'error', title: 'B' },
    ]);
  });
});
```

さらに `describe('Home', ...)` の中、Task 4 で足したテストの直後に統合テストを追加する。

```jsx
  it('does not show the completion block for novels that were already done on first load', async () => {
    // 過去に生成済みの全セッションに「できました」が並ばないこと。
    vi.spyOn(sessionSyncClient, 'listNovelJobs').mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];
    renderWithAuth(<Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    expect(await screen.findByText('小説をDL')).toBeInTheDocument();
    expect(screen.queryByText('小説ができました')).not.toBeInTheDocument();
  });

  it('shows the completion block and a toast on a running → done transition', async () => {
    const listSpy = vi.spyOn(sessionSyncClient, 'listNovelJobs');
    listSpy.mockResolvedValueOnce({
      s1: { status: 'running', error: null, elapsedMs: 1000, hasNovel: false, stale: false },
    });
    listSpy.mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false },
    });
    const sessions = [{ id: 's1', title: '黄昏の塔の契約', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.getByText('小説ができました')).toBeInTheDocument();
      expect(screen.getByText('「黄昏の塔の契約」の小説ができました')).toBeInTheDocument();
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('shows a toast but no completion block on a running → error transition', async () => {
    const listSpy = vi.spyOn(sessionSyncClient, 'listNovelJobs');
    listSpy.mockResolvedValueOnce({
      s1: { status: 'running', error: null, elapsedMs: 1000, hasNovel: false, stale: false },
    });
    listSpy.mockResolvedValue({
      s1: { status: 'error', error: '時間内に完了しませんでした。', elapsedMs: null, hasNovel: false, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(screen.getByText('「A」の小説化に失敗しました')).toBeInTheDocument();
      expect(screen.queryByText('小説ができました')).not.toBeInTheDocument();
      // 正規表現で引くと祖先要素にも一致して「複数見つかった」で落ちるため、完全一致で引く。
      expect(screen.getByText('小説化に失敗した: 時間内に完了しませんでした。')).toBeInTheDocument();
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it('clears the completion block once the novel is downloaded', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn().mockReturnValue('blob:x'), revokeObjectURL: vi.fn() });
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({ text: '本文' });
    const listSpy = vi.spyOn(sessionSyncClient, 'listNovelJobs');
    listSpy.mockResolvedValueOnce({
      s1: { status: 'running', error: null, elapsedMs: 1000, hasNovel: false, stale: false },
    });
    listSpy.mockResolvedValue({
      s1: { status: 'done', error: null, elapsedMs: null, hasNovel: true, stale: false },
    });
    const sessions = [{ id: 's1', title: 'A', updatedAt: 1, state: {}, log: [] }];

    vi.useFakeTimers();
    let view;
    try {
      view = renderWithAuth(
        <Home sessions={sessions} storageOk onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />
      );
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.getByText('小説ができました')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByText('小説をDL'));
        await Promise.resolve();
      });

      expect(screen.queryByText('小説ができました')).not.toBeInTheDocument();
    } finally {
      view?.unmount();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
```

- [x] **Step 2: テストを実行して失敗を確認する**

Run: `npx vitest run src/screens/Home.test.jsx -t collectJobEvents`
Expected: FAIL。`collectJobEvents is not a function` — まだ export されていない。

- [x] **Step 3: `collectJobEvents` を追加する**

`src/screens/Home.jsx` の `sanitizeFilename` の定義(38〜42行目)の直後に追加する。

```jsx
// 小説化ジョブの状態遷移から通知イベントを取り出す。
// 直前がrunningだったものだけを対象にすることで、マウント時の初回取得(前状態が空)で
// 既に完了済みのセッションを一斉に「できました」と通知してしまうのを防ぐ。
export function collectJobEvents(prev, next, titleOf) {
  const events = [];
  for (const [id, job] of Object.entries(next)) {
    if (prev[id]?.status !== 'running') continue;
    if (job.status === 'done') events.push({ id, kind: 'done', title: titleOf(id) });
    else if (job.status === 'error') events.push({ id, kind: 'error', title: titleOf(id) });
  }
  return events;
}
```

- [x] **Step 4: テストを実行して純粋関数のテストが通ることを確認する**

Run: `npx vitest run src/screens/Home.test.jsx -t collectJobEvents`
Expected: PASS(5テスト)

- [x] **Step 5: `Home.jsx` に import と state を足す**

Task 4 で足した `import NovelizeProgress ...` の直後に追加する。

```jsx
import ToastStack from '../components/ui/Toast.jsx';
```

`jobsReceivedAtRef` の宣言の直後に追加する。

```jsx
  // novelJobsの直前の値。applyNovelJobs内で遷移を判定するために持つ。
  // setNovelJobsのupdater引数の中で通知を積むと、Reactがupdaterを複数回実行した際に
  // トーストが重複する。副作用はupdaterの外で行い、比較元はこのrefから読む。
  const novelJobsRef = useRef({});
  const [toasts, setToasts] = useState([]); // [{ id, text, tone }]
  const [finishedIds, setFinishedIds] = useState(() => new Set()); // 完了ブロックを出すセッション
```

- [x] **Step 6: `applyNovelJobs` を遷移検知つきに書き換える**

`src/screens/Home.jsx` の `applyNovelJobs` 関数の定義を丸ごと次で置き換える(Task 4 で
その直後に `anyRunning` と1秒タイマーを足しているので、行番号ではなく関数の範囲で見ること。
`anyRunning` 以降は残す)。

```jsx
  // novelJobsの更新経路(マウント時取得・ポーリング・楽観的更新)をすべてここに通し、
  // hasRunningRefを常に最新の状態と一致させる。状態遷移(running→done/error)の
  // 検知もここに集約する。
  function applyNovelJobs(updater) {
    const prev = novelJobsRef.current;
    const next = typeof updater === 'function' ? updater(prev) : updater;
    const events = collectJobEvents(prev, next, (id) => sessions.find((s) => s.id === id)?.title ?? '');

    novelJobsRef.current = next;
    hasRunningRef.current = Object.values(next).some((j) => j.status === 'running');
    setNovelJobs(next);

    if (events.length === 0) return;
    setFinishedIds((prevSet) => {
      const nextSet = new Set(prevSet);
      for (const ev of events) {
        if (ev.kind === 'done') nextSet.add(ev.id);
      }
      return nextSet;
    });
    setToasts((prevToasts) => [
      ...prevToasts,
      ...events.map((ev) => ({
        id: makeId(),
        text: ev.kind === 'done' ? `「${ev.title}」の小説ができました` : `「${ev.title}」の小説化に失敗しました`,
        tone: ev.kind === 'done' ? 'success' : 'error',
      })),
    ]);
  }

  // 完了ブロックを消す。目的を果たした(DL)か、やり直す(再生成)ときに呼ぶ。
  function clearFinished(sessionId) {
    setFinishedIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
  }
```

- [x] **Step 7: DL と再生成で完了ブロックを消す**

`handleNovelize` / `handleDownloadNovel` / `handleDownloadIllustrated` の先頭、
`setNovelizeError(...)` の行の直後にそれぞれ次の1行を挿入する。

```jsx
    clearFinished(session.id);
```

- [x] **Step 8: 完了ブロックとトーストを描画する**

Task 4 で挿入した `{running && <NovelizeProgress elapsedMs={elapsedMs} />}` の行を次で置き換える。

```jsx
        {running && <NovelizeProgress elapsedMs={elapsedMs} />}
        {!running && finishedIds.has(s.id) && <NovelizeProgress done />}
```

`Home` の return の直下、`<div style={{ maxWidth: 640, ... }}>` を開いた直後の行に次を挿入する。

```jsx
      <ToastStack items={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
```

- [x] **Step 9: テストを実行して通ることを確認する**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: PASS(既存テストを含む全テスト)

- [x] **Step 10: 全テストを実行して回帰がないことを確認する**

Run: `npm test`
Expected: PASS(全ファイル)

- [x] **Step 11: コミット**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "$(cat <<'EOF'
feat(home): 小説化の完了をカードとトーストで知らせる

待つよう促す以上、完了に気づけないと待ち損になる。running→done/errorの
遷移をapplyNovelJobsで検知し、完了ブロックとトーストを出す。表示条件を
状態(hasNovel)ではなく遷移にすることで、生成済みの全セッションに
「できました」が並ぶのを防ぐ。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Notes for the implementer

- **`jobsReceivedAtRef` の初期値は 0** だが、`elapsedMs` の計算は `typeof job.elapsedMs === 'number'` で守られている。サーバー応答を一度も受け取っていない状態(押下直後の楽観的更新)では `elapsedMs` が `undefined` なので `0:00 経過` から始まる。これは意図した挙動。
- **`applyNovelJobs` が `sessions` を参照する件**: ポーリングの `useEffect` は `[user, pollNonce]` を依存に持つため、`tick` はその時点の `sessions` を捕捉したままになる。トーストに出るセッション名が、ポーリング開始後に改名された場合に古い名前になりうる。実害が小さいため今回は許容する。
- **`vi.useFakeTimers()` は `Date.now()` も差し替える**(vitest の既定)。そのため Task 4 の「1秒ごとに進む」テストで補間値が正しく動く。実タイマーのテストに `Date` の進行を期待しないこと。
