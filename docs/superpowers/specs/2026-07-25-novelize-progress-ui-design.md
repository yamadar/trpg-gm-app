# 小説化の進捗表示 設計ドキュメント

## 1. 背景・目的

小説化を開始すると、セッションカードのボタンが「小説化中…」の disabled 表示になり、完了までそれ以外の変化が一切ない(`src/screens/Home.jsx`)。

```jsx
{running ? (
  <Button variant="ghost" disabled style={ACTION_BTN}>
    小説化中…
  </Button>
) : ( ... )}
```

一方で、生成は打ち切り時に継続リクエストを最大4回重ねる設計になっており(`docs/superpowers/specs/2026-07-25-novelize-continuation-design.md`)、ジョブのタイムアウトは30分に設定されている。長いセッションでは実際に数分〜十数分かかる。

この「数分〜十数分、画面が一切変化しない」状態が、ユーザーに「本当に動いているのか」という不安を与えている。処理を速くすることはできない(上流の生成時間が支配的)ため、**待ち時間そのものを短縮するのではなく、待つに値すると納得できる状態にする**のが本ドキュメントの目的である。

達成したいこと:

- 処理が進行中であることが、静止画ではなく動く情報として分かる
- 「あとどれくらい待てばよいか」の見当がつく
- 想定より長引いても「壊れた」と誤解されない
- 画面を離れていても完了に気づける

## 2. スコープ

- `GET /api/novel-jobs` が実行中ジョブの経過時間を返す
- セッションカードに待機ブロック(経過時間・目安・案内文)を表示する
- 完了時にカード内の完了ブロックとトーストで通知する
- 上記に伴うコンポーネント追加とテスト

### 対象外

- **生成の実進捗(何パート目か)の表示**。継続リクエストの回数をサーバーから返せば実現できるが、`novelGeneration.js` の内部ループから `novelJobs.js` を経て永続化層へ進捗を書き戻す経路を新設する必要がある。経過時間だけでも「動いている」ことは伝わるため、まずは入れない
- **ブラウザ通知(Notification API)**。許可ダイアログをいつ出すかという別の設計判断を伴う。トーストとカード内表示で足りるかを見てから検討する
- **ポーリング間隔の変更**。5秒のまま。経過時間の秒表示はクライアント側の補間で行う(3.2参照)
- 挿絵生成・エンディング記録など、他の非同期処理の進捗表示。同じ部品を将来使い回せる形にはするが、今回は小説化のみに適用する

## 3. アーキテクチャ

### 3.1 サーバー: 経過時間の提供

`server/novelJobs.js` の `resolveJobStatus` は現在 `{ status, error }` を返す。running の場合に `elapsedMs` を追加する。

```js
export function resolveJobStatus(job, { bootId, now }) {
  if (!job) return { status: 'idle', error: null, elapsedMs: null };
  if (job.status !== 'running') return { status: job.status, error: job.error ?? null, elapsedMs: null };
  if (job.bootId !== bootId) { ... }           // 従来どおり error
  if (now - job.startedAt > NOVEL_JOB_TIMEOUT_MS) { ... }  // 従来どおり error
  return { status: 'running', error: null, elapsedMs: now - job.startedAt };
}
```

`server/routes/sessions.js` の `GET /novel-jobs` はこれをそのままレスポンスに載せる。

```js
const { status, error, elapsedMs } = await novelJobs.read(req.userId, id);
out[id] = { status, error, elapsedMs, hasNovel: ..., stale: ..., truncated: ... };
```

#### 絶対時刻ではなく経過時間を返す理由

`startedAt`(サーバーのエポックミリ秒)をそのまま返し、クライアントで `Date.now() - startedAt` を計算する方法もある。しかしクライアントの時計がサーバーとずれていると、経過時間が負になったり実際より大幅に大きく出たりする。ユーザーの端末の時計設定は制御できない。

サーバー側で差分まで計算して返せば、この問題は設計から消える。また `resolveJobStatus` は既にテストから `now` を注入されており、経過時間の算出を同じ関数に置くことで時刻に関する判断が一箇所にまとまる。

### 3.2 クライアント: 秒の補間

ポーリングは5秒間隔のまま(`NOVEL_POLL_MS`)。5秒ごとにしか数字が動かないと「止まっている」印象が残るため、クライアント側で1秒ごとに補間する。

レスポンス受信時に受信時刻を控え、表示値を次で求める:

```
表示経過ms = job.elapsedMs + (Date.now() - 受信時刻)
```

ここで使う `Date.now()` は差分の計算のみに使われるため、クライアントの時計がサーバーとずれていても影響しない。

再描画のためのタイマーは、running のジョブが1件以上あるときだけ動かす。

```js
// running が無くなったら止める。常時1秒タイマーを回さない。
useEffect(() => {
  if (!hasRunning) return;
  const id = setInterval(() => setTick((t) => t + 1), 1000);
  return () => clearInterval(id);
}, [hasRunning]);
```

受信時刻は state ではなく ref に持つ(受信のたびに再描画を誘発する必要がないため)。

表示書式は `m:ss`(例 `1:24`、`12:03`)。

### 3.3 待機ブロック: `src/components/ui/NovelizeProgress.jsx`

セッションカードのバッジ行とボタン行の間に置く。既存の `stale` / `truncated` 警告と同じ領域である。

```
┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐
┆ ● 小説を執筆しています              ┆
┆   1:24 経過 ・ 目安 2〜5分          ┆
┆   長い記録ほど時間がかかります。      ┆
┆   このまま他の画面に移っても         ┆
┆   生成は続きます。                  ┆
└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘
```

| 要素 | スタイル |
|---|---|
| 枠 | `1px dashed COLORS.line` / `borderRadius: 4` / `padding: 10px 12px` / `marginTop: 8` |
| 地色 | `COLORS.paper` (カード地 `COLORS.card` より一段沈む) |
| 見出し行 | `F_DISPLAY` 13px / `COLORS.brassDark` |
| 経過行 | `F_MONO` 11px / `COLORS.brass` |
| 案内行 | `F_BODY` 12px / `COLORS.inkSoft` / `opacity: 0.8` |

先頭の `●` は 1.6秒周期で `opacity` を 0.35 ↔ 1 に脈動させる。`motionAllowed()`(`src/theme.js`)が false のときは静止した `●` にする。

ボタン行は現状どおり「小説化中…」の disabled ボタンを出す。待機ブロックが状態を語るので、ボタンは「押せない」ことだけを示せばよい。

#### 目安の超過

経過が5分を超えたら案内行を差し替える。

| 経過 | 経過行 | 案内行 |
|---|---|---|
| 5分以下 | `1:24 経過 ・ 目安 2〜5分` | 長い記録ほど時間がかかります。このまま他の画面に移っても生成は続きます。 |
| 5分超 | `7:12 経過` | 長い記録のため時間がかかっています。最大30分ほどかかることがあります。中断はされていません。 |

超過後は「目安」を出さない。一度外した見積もりを出し続けても信頼を損なうだけであり、代わりに上限(30分)を伝えて待てる範囲を示す。

「30分」は `NOVEL_JOB_TIMEOUT_MS`(= `NOVELIZE_UPSTREAM_TIMEOUT_MS` × (`NOVELIZE_MAX_CONTINUATIONS` + 1) + 300000 = 30分)と整合させた数値である。これより短い数字を提示すると、タイムアウト前に「約束を破った」状態になる。定数から算出せずリテラルで書くが、両者がずれないよう `NovelizeProgress.jsx` にその旨のコメントを置く。

#### アクセシビリティ

- ブロック全体ではなく**見出し行のみ**を `role="status"` にする。ここが状態遷移(執筆中 → できました)を伝える
- 経過時間の行は `aria-hidden="true"`。毎秒更新される値を読み上げ対象にすると支援技術の利用者に連続読み上げを強いる
- 脈動する `●` は装飾であり `aria-hidden="true"`

### 3.4 完了ブロック

同じ枠を使い、内容を差し替える。

```
┌┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┐
┆ ✓ 小説ができました                  ┆
┆   下の「小説をDL」から取り出せます    ┆
└┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┘
```

見出しの `✓` は `COLORS.brassDark`。脈動はしない。

#### 表示条件

**この画面を開いている間に `running` → `done` の遷移を観測したセッションにのみ表示する。**

`hasNovel` を条件にすると、過去に生成済みの全セッションに「小説ができました」が永久に並ぶ。完了ブロックは「たった今できた」という出来事を伝える部品であり、状態ではなく遷移に紐づける。

遷移を観測したセッションIDを `Set` として持ち、以下で消す:

- そのカードの「小説をDL」または「挿絵付きでDL」を押したとき(目的を果たした)
- そのカードの「小説を再生成」を押したとき(新しいジョブが始まる)

時間経過では消さない。ユーザーが席を外している間に自動で消えると、通知の意味がなくなる。

リロードすると消えるが、これは許容する。リロードは「ユーザーが画面を見ている」ことの証左であり、そのときにはボタンが「小説をDL」に変わっていることで完了が分かる。

#### 失敗の扱い

`running` → `error` の遷移では完了ブロックを出さない。既存のエラー行(`src/screens/Home.jsx`)がそのまま担う。

```jsx
{(novelizeError[s.id] || (job.status === 'error' && job.error)) && ( ... )}
```

### 3.5 トースト: `src/components/ui/Toast.jsx`

一覧が長いとき、下方のカードで完了しても画面外で気づけない。画面上部にトーストを出す。

現状トーストの仕組みは存在しないため新規に作る。汎用の通知基盤(Context + reducer + キュー管理)は今回必要としないため作らない。`Home.jsx` がメッセージの配列を state で持ち、`<Toast>` はその配列を受け取って描画するだけの表示コンポーネントとする。

```jsx
<ToastStack
  items={toasts}                          // [{ id, text, tone }]
  onDismiss={(id) => ...}
/>
```

| 項目 | 仕様 |
|---|---|
| 位置 | `position: fixed` / 上部中央 / `zIndex` はモーダルより下 |
| 見た目 | `COLORS.card` 地 / `1px solid COLORS.brass` / `borderRadius: 4` / `F_BODY` 13px |
| 文言(成功) | 「『{セッション名}』の小説ができました」 |
| 文言(失敗) | 「『{セッション名}』の小説化に失敗しました」(`tone: 'error'`、枠を `COLORS.stamp`) |
| 自動消滅 | 6秒 |
| 手動消滅 | `×` ボタン(`aria-label="閉じる"`) |
| 複数 | 縦に積む。同時完了しうるため配列で保持する |
| a11y | スタックのコンテナを `role="status"` / `aria-live="polite"` |
| reduced motion | `motionAllowed()` が false ならフェードなしで即時表示・即時消去 |

セッション名が長い場合は `textOverflow: ellipsis` で1行に収める。

#### 発火点

状態遷移の検知は `applyNovelJobs`(`src/screens/Home.jsx`)**一箇所に集約する**。

```js
// novelJobsの更新経路(マウント時取得・ポーリング・楽観的更新)をすべてここに通し、
function applyNovelJobs(updater) { ... }
```

このコメントのとおり、すべての更新経路が既にこの関数を通る。前状態と次状態を突き合わせて `running` → `done` / `running` → `error` を検出し、トースト追加と完了ブロック用 Set の更新を行う。

マウント時の初回取得では前状態が空であり `running` が存在しないため、既に完了済みのセッションで誤発火しない。

楽観的更新(`handleNovelize` が押下直後に `running` を書き込む経路)も同じ関数を通るが、`running` → `running` は遷移として扱わないため影響しない。

## 4. データフロー

```
[サーバー] novelJobs.read()
    → { status: 'running', elapsedMs: 84000 }
        ↓ GET /api/novel-jobs (5秒ごと)
[Home.jsx] applyNovelJobs()
    ├→ 受信時刻を ref に控える
    ├→ 前状態と比較 → running→done なら トースト追加 + 完了Setに追加
    └→ novelJobs state 更新
        ↓
[1秒タイマー] setTick()          ← running が1件以上あるときだけ動く
        ↓
[renderSessionCard]
    ├→ running        → <NovelizeProgress elapsedMs={補間値} />
    ├→ 完了Setに含む  → <NovelizeProgress done />
    └→ それ以外       → 従来どおり
```

## 5. 変更ファイル

| ファイル | 変更 |
|---|---|
| `server/novelJobs.js` | `resolveJobStatus` が `elapsedMs` を返す |
| `server/routes/sessions.js` | `GET /novel-jobs` のレスポンスに `elapsedMs` を追加 |
| `src/components/ui/NovelizeProgress.jsx` | 新規。待機ブロック / 完了ブロック |
| `src/components/ui/Toast.jsx` | 新規。トーストスタック(表示のみ) |
| `src/screens/Home.jsx` | 受信時刻の記録、1秒タイマー、遷移検知、上記2部品の描画 |

`Home.jsx` は既に大きいファイルだが、今回追加するのは「タイマーと遷移検知」というカード描画に閉じない関心である。表示部分を2つのコンポーネントに切り出すことで `Home.jsx` 側の増分をロジックのみに留める。`Home.jsx` 全体の分割は本作業の範囲外とする。

## 6. テスト

### 6.1 更新: `server/novelJobs.test.js`

- running のジョブで `elapsedMs` が `now - startedAt` になる
- running 以外(done / error / idle)では `elapsedMs` が `null` になる

### 6.2 更新: `server/routes/sessions.test.js`

- `GET /novel-jobs` が running のエントリに `elapsedMs` を返す

### 6.3 新規: `src/components/ui/NovelizeProgress.test.jsx`

- 経過時間が `m:ss` で表示される(84000ms → `1:24`)
- 5分以下では「目安 2〜5分」が出る
- 5分超では目安が消え、超過時の案内文に切り替わる
- `done` では「小説ができました」が出て、経過時間は出ない
- 経過時間の要素が `aria-hidden` である

### 6.4 新規: `src/components/ui/Toast.test.jsx`

- 渡した件数ぶん描画される
- `×` で `onDismiss` が該当IDで呼ばれる
- コンテナが `role="status"` を持つ

### 6.5 更新: `src/screens/Home.test.jsx`

- running のセッションカードに待機ブロックが出る
- **初回ロード時点で `done`(かつ `hasNovel`)のカードには完了ブロックが出ない**(誤発火の回帰防止)
- ポーリングで `running` → `done` に変わると、完了ブロックとトーストが出る
- ポーリングで `running` → `error` に変わると、エラー行とトーストが出る(完了ブロックは出ない)
- 「小説をDL」を押すと完了ブロックが消える
- running が無くなったら1秒タイマーが停止する(`vi.useFakeTimers` で再描画が止まることを確認)

## 7. リスク

| リスク | 対応 |
|---|---|
| 「目安 2〜5分」が実態と合わない | 実測データを持たないため初期値は推定。5分超で目安表示を取り下げる設計により、外れても破綻しない。運用後に実測が得られたら定数を見直す |
| 1秒タイマーが running 終了後も回り続ける | `hasRunning` を依存配列に持つ `useEffect` でクリーンアップする。テストで停止を確認する |
| トーストが他のモーダル(`ConfirmModal` / `LoginModal`)に被る | `zIndex` をモーダルより低く設定する |
| 完了ブロックが期待どおり消えず残り続ける | 消える契機を DL 押下と再生成押下の2つに限定し、テストで確認する |
| `NOVEL_JOB_TIMEOUT_MS` を将来変更したとき文言の「30分」がずれる | `NovelizeProgress.jsx` に定数との対応をコメントで明記する。定数を跨いだ import はサーバー・クライアント境界を越えるため行わない |
