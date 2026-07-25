# 小説化の出力打ち切り回避 設計ドキュメント

## 1. 背景・目的

小説化ジョブが `小説化に失敗した: novelization was truncated (max_tokens); not saved` で失敗するケースがある。

現状の実装(`server/novelJobs.js`)は、セッションログ全体を1リクエストで小説化し、上流レスポンスの `stop_reason` が `max_tokens` の場合は例外を投げて**生成結果を一切保存せずに破棄**する。

```js
// server/novelJobs.js
max_tokens: 12000,
...
if (data.stop_reason === 'max_tokens') {
  throw new Error('novelization was truncated (max_tokens); not saved');
}
```

セッションのターン数には上限がない(`src/screens/Play.jsx` は `turn_count` を無制限に加算する)ため、これは長いセッションで構造的に必ず発生する。しかも失敗時は生成済みの本文も破棄されるため、利用枠を消費して何も残らない。

本ドキュメントは、この打ち切りを継続リクエストで回避し、任意の長さのセッションで完結した小説を得られるようにする設計を定める。

## 2. スコープ

- `server/novelJobs.js` の生成ロジックを継続リクエスト対応に変更する
- 生成部分を `server/novelGeneration.js` として分離する
- 継続回数の上限に達した場合は、そこまでの本文を「未完」として保存し、UIに警告を出す
- 上記に伴うジョブタイムアウト・テストの更新

### 対象外

- **`server/endingNaming.js` の同種の打ち切りエラー**(`ending naming was truncated (max_tokens)`)。あちらは `max_tokens: 500` の構造化JSON出力であり、原因(JSONとして壊れる)も対処(スキーマ側の設計)も本文生成とは別物。今回は触らない
- ストリーミング(SSE)への移行。`max_tokens` を非ストリーミングで安全な 16000 に留めるため不要
- 小説化リクエストのUI上の進捗表示(現状のポーリングのまま)

## 3. アーキテクチャ

### 3.1 生成ロジックの分離

現在の `novelJobs.js` の `run()` は「ジョブ状態管理」と「上流呼び出し」を兼ねている。継続ループを入れると `run()` が肥大化し、ジョブのライフサイクル管理とプロンプト構築が同じ関数に同居することになる。

生成部分を新規モジュール `server/novelGeneration.js` に切り出す。

```js
// server/novelGeneration.js
export async function generateNovel({
  transcript,      // buildTranscriptWithMarkers の結果
  hasImages,       // 挿絵マーカー指示を付けるか
  pov,             // 'third' | 'first'
  apiKey,
  fetchImpl,
  maxContinuations, // 既定 NOVELIZE_MAX_CONTINUATIONS
  timeoutMs,        // 既定 NOVELIZE_UPSTREAM_TIMEOUT_MS
}) // → { text, truncated }
```

責務の分割:

| モジュール | 責務 |
|---|---|
| `novelGeneration.js` | プロンプト構築、上流呼び出し、継続ループ、本文の連結 |
| `novelJobs.js` | ジョブ状態の永続化、二重起動の抑止、タイムアウト判定、エラー記録、保存 |

`novelJobs.js` は `buildTranscriptWithMarkers` で `transcript`/`imageIds` を得たのち `generateNovel` を呼び、返った `{ text, truncated }` を保存する。上流呼び出しの詳細を知らなくなる。

### 3.2 継続ループ

```
messages = [ user(transcript) ]
parts = []

繰り返し(最大 maxContinuations + 1 回):
  data = 上流呼び出し(messages)
  text = data.content の text ブロック連結
  parts.push(text)
  if data.stop_reason !== 'max_tokens':
      return { text: parts.join(''), truncated: false }
  messages = [ user(transcript), assistant(parts.join('')), user(継続指示) ]

return { text: parts.join(''), truncated: true }
```

#### 末尾 assistant ターンを使わない理由

Claude Sonnet 5 は最終 assistant ターンのプレフィル(prefill)を受け付けず 400 を返す。したがって「これまでの出力を assistant ターンとして末尾に置き、続きを書かせる」形は使えない。

代わりに、これまでの出力を**中間の** assistant ターンとして置き、末尾を user ターンの継続指示にする。会話の途中に assistant メッセージを置くこと自体は制約されていない。

```js
messages = [
  { role: 'user', content: [{ type: 'text', text: transcript, cache_control: { type: 'ephemeral' } }] },
  { role: 'assistant', content: soFar },
  { role: 'user', content: CONTINUE_INSTRUCTION },
]
```

#### 継続指示

```
直前の出力は出力上限に達して途中で切れている。切れた箇所の直後から、自然につながるように本文を書き続けよ。
すでに書いた部分を繰り返したり要約したりしないこと。
「続き」などの前置きや説明文は一切付けず、小説本文のみを出力すること。
```

連結は区切り文字なしの単純結合(`parts.join('')`)とする。「切れた箇所の直後から再開する」という指示に対し、区切り文字や改行を挿入すると文の途中に不自然な断絶が入るため。

#### プロンプトキャッシュ

`transcript` は継続のたびに再送されるため、最初の user ブロックに `cache_control: { type: 'ephemeral' }` を付ける。継続が発生するのは `transcript` が大きいセッションであり、キャッシュが最も効く場面と一致する。

これに伴い、最初の user メッセージの `content` は文字列ではなくブロック配列になる(文字列には `cache_control` を付けられないため)。キャッシュ最小長(1024トークン)に満たない短い `transcript` ではキャッシュが効かないだけで、動作上の害はない。

### 3.3 未完時の扱い

継続回数の上限に達しても `stop_reason` が `max_tokens` のままだった場合、`truncated: true` を返す。

`novelJobs.js` はこの場合も:

- 本文を `sessionNovelDocPath` に保存する
- ジョブの `status` は `done` にする
- メタ(`sessionNovelMetaKey`)に `truncated: true` を記録する

長時間・複数リクエスト分のコストを払った生成を全て捨てないことを優先する。ユーザーには「末尾が欠けている可能性がある」ことをUIで伝える。

継続の途中で上流がエラーを返した場合や本文が空になった場合は、従来どおり例外として扱いジョブを `error` に倒す(部分保存はしない)。継続途中の失敗はネットワーク・上流障害であり、再実行で解決しうるため。

## 4. パラメータ変更

| 定数 | 現在 | 変更後 | 理由 |
|---|---|---|---|
| `max_tokens` | 12000 | 16000 | 非ストリーミングで安全な実用上限。1リクエストあたりの出力を増やし継続回数を減らす |
| `NOVELIZE_MAX_CONTINUATIONS` | — | 4 (新規) | 最大5リクエスト = 約80000トークン相当。日本語の小説として十分な長さ |
| `NOVELIZE_UPSTREAM_TIMEOUT_MS` | 300000 | 据え置き | 1リクエストあたりの上限として妥当 |
| `NOVEL_JOB_TIMEOUT_MS` | 600000 | 1800000 | 最悪ケース(5リクエスト × 300秒 = 1500秒)を包含する必要がある |

`NOVEL_JOB_TIMEOUT_MS` の引き上げは必須である。現在の600秒のままだと、継続ループが正常に走っている最中に `resolveJobStatus` が「時間内に完了しませんでした」として実行中ジョブを失敗扱いにし、UIが誤ったエラーを表示する。

## 5. 未完フラグの伝播

### 5.1 サーバー

`novelJobs.js` がメタに `truncated` を記録する。

```js
await dataStore.set(sessionNovelMetaKey(userId, sessionId), {
  turnCount: session.state?.turn_count ?? null,
  updatedAt: now(),
  imageIds,
  truncated,
});
```

`GET /novel-jobs`(`server/routes/sessions.js`)のレスポンスに `truncated` を追加する。既にメタを読んで `stale` を算出しているため、同じ経路に乗せる。

```js
out[id] = {
  status, error,
  hasNovel: text !== null,
  stale: isStale(meta, session),
  truncated: meta?.truncated === true,
};
```

`truncated` が未定義の既存メタ(この変更以前に生成された小説)は `false` として扱われる。マイグレーションは不要。

### 5.2 クライアント

`src/screens/Home.jsx` のセッションカードに、既存の `stale` 警告と同じ形式で表示を追加する。

```jsx
{hasNovel && job.truncated && (
  <div style={{ ... }}>
    小説が出力上限に達したため、末尾が欠けている可能性があります。
  </div>
)}
```

`stale` 警告と同時に出ることはありうる。どちらも独立した事実であり、両方表示してよい。

## 6. テスト

### 6.1 新規: `server/novelGeneration.test.js`

- 1回で完結した場合、その本文をそのまま返し `truncated: false` になる
- `stop_reason: 'max_tokens'` の後に継続し、2回分の本文を区切りなしで連結する
- 継続リクエストの `messages` の末尾が `user` ロールである(プレフィル禁止の回帰防止)
- 継続リクエストの `messages` に、それまでの出力が assistant ターンとして含まれる
- 継続回数の上限に達したら `truncated: true` を返す(上限回数ぶんだけ呼ばれることも確認)
- 最初の user ブロックに `cache_control` が付いている
- 挿絵ありのセッションで system に挿絵マーカー指示が入る / なしのセッションでは入らない
- `pov: 'first'` で一人称のシステムプロンプトになる
- 上流が ok でない場合に例外を投げる
- 本文が空の場合に例外を投げる

### 6.2 更新: `server/novelJobs.test.js`

- **書き換え**: `records an error for a truncated response without saving` → 継続して保存する挙動、および上限到達時に `truncated: true` で保存する挙動のテストに置き換える
- **修正**: `sends image markers and the marker instruction for an illustrated session` は `body.messages[0].content` が文字列からブロック配列に変わるため、アサーションを更新する
- 既存のジョブ管理系テスト(二重起動抑止・boot跨ぎ・非Error値のthrow等)は挙動が変わらないため維持する

### 6.3 更新: `server/routes/sessions.test.js`

- **書き換え**: `records an error for a truncated (max_tokens) novelization without saving` を新挙動に合わせる
- **追加**: `GET /novel-jobs` が `truncated` を返すこと

## 7. リスク

| リスク | 対応 |
|---|---|
| 継続の境目で文体・文脈が途切れる | 継続指示で「切れた箇所の直後から」「繰り返さない」を明示。区切り文字なしで連結 |
| モデルが継続時に前置き(「続きです:」等)を書く | 継続指示で前置き禁止を明示。既存のシステムプロンプトにも同趣旨の指示がある |
| 挿絵マーカーが継続部分で重複・欠落する | `buildIllustratedMarkdown` が既に重複番号を除去し、本文に現れなかった番号を末尾に救済する。連結後の本文に対して従来どおり動作する |
| 継続ループのコスト増 | 上限4回で頭打ち。`transcript` はプロンプトキャッシュで再送コストを抑える |
| 最悪ケースで最大25分ジョブが走る | `NOVEL_JOB_TIMEOUT_MS` を30分に設定。UIは `running` 表示を維持する |
