# 設計: UI改善3件 + 小説化の非同期化

作成 2026-07-25。ユーザーから提示された4件の要望に対する設計。

1. セッション一覧の「小説化」ボタンが「挿絵付き」タグと並んでいて、ボタンなのかタグなのか分からない
2. セッションプレイ中、ホームに戻るのに一番上までスクロールする必要があり面倒
3. エンディングまで到達したセッションを一覧・セッション画面で分かりやすく表示したい
4. 小説化がタイムアウトで失敗する。同期生成をやめ、非同期化してリロード・画面遷移を跨いでも「小説化中…」を維持し再押下できないようにしたい

4件は独立しているが、(1) と (3) と (4) はいずれもセッション一覧カードの表示を変更するため、1つの spec / 1つの実装計画で扱う。

## 1. セッション一覧カードの整理

### 現状の問題

[`src/screens/Home.jsx`](../../../src/screens/Home.jsx) の `renderSessionCard` は、カード右カラムに `小説化` / `挿絵付き` / `次の章へ` / `小説を公開`(または `公開中` + `公開解除`)を1行で並べる。全て `variant="ghost"` の同一スタイルで、幅の狭い環境では窮屈に折り返す。

- `挿絵付き` だけが体言止めのラベルで、押せる要素に見えない(要望1の直接原因)
- `公開中` は `<span>` の素のテキストで、隣の同サイズのボタンと見分けがつかない(逆方向の混同)
- 状態(公開中)と操作(公開する)が同じ行に混在している

### 設計

カードを **情報 / 状態バッジ / 操作** の3層に分ける。

```
┌──────────────────────────────────────────────────┐
│ 星降りの夜に        シーン: 廃坑 / 12手     続ける → │  ← 情報層
│ 灯りが消えた瞬間、足音だけが…                        │
│ 〔完結〕〔公開中〕〔挿絵あり〕                          │  ← 状態バッジ層
├──────────────────────────────────────────────────┤  ← 区切り線
│ [小説化する] [次の章へ] [小説を公開]                  │  ← 操作層
└──────────────────────────────────────────────────┘
```

**状態バッジ**: 新規コンポーネント `src/components/ui/Badge.jsx`。小さい角丸ピル(`F_MONO` / 10px / `padding: '2px 8px'` / `borderRadius: 999px` / `cursor: 'default'`)。`<span>` として描画し、ボタンとの見た目の差を明確にする。

| バッジ | 表示条件 | 色 |
|---|---|---|
| 完結 | `session.endedAt` がある | `brass` 系(塗り) |
| 公開中 | `publishedNovelIds[id]` がある | `brassDark`(枠線) |
| 挿絵あり | ログに `image.imageId` を持つGMエントリがある | `faint`(枠線) |

**操作ボタン**: カード下部に区切り線(`borderTop: 1px solid COLORS.line`)を挟んだ専用行へ移す。`flexWrap: 'wrap'` で狭幅に対応。ラベルは全て動詞で統一する。

| 旧ラベル | 新ラベル |
|---|---|
| 小説化 | 小説化する |
| 挿絵付き | 挿絵付きでDL |
| (なし) | 小説をDL / 小説を再生成 |
| 次の章へ | 次の章へ(変更なし) |
| 小説を公開 / 公開解除 | 変更なし |

`挿絵付きでDL` は、**セッションに挿絵があり、かつ小説が生成済みのときだけ**表示する(現状は挿絵さえあれば表示され、小説未生成だと押した後に生成が走っていた。非同期化後は生成済みが前提になる)。

`続ける →` はカード全体のクリックに対応する主要導線なので、情報層の右端に残す。

### 非対象

カードのクリックでセッションを開く挙動、キャンペーングルーピング、並び順は変更しない。

## 2. Play画面の固定ヘッダー

### 現状の問題

[`src/screens/Play.jsx`](../../../src/screens/Play.jsx) のヘッダー(タイトル / シーン / 経験値 / PC / 挿絵自動生成 / ホームへ)はページ先頭にあり、ログと一緒にスクロールアウトする。ログは進行に応じて下へ伸び続けるため、ホームに戻るには先頭まで戻る必要がある。

固定表示されているのは下部の入力バーだけ。

### 設計

ヘッダーを `position: sticky; top: 0` のバーにする。

- **左**: `← ホーム`。戻る導線は左が定石であり、右上に `position: fixed` で置かれている `AuthBar`(`top: 12 / right: 16 / zIndex: 90`)との衝突も避けられる
- **中央**: セッションタイトル、その下に `シーン: X ・ 経験値: N` を1行に圧縮(現行は3行。固定バーは低くする)。`endedAt` があれば `完結` バッジをタイトル脇に置く
- **右**: `PC`(非ドック時のみ) / `挿絵を自動生成` チェックボックス
- 背景 `mood.paper`、下端に `1px solid COLORS.line`、`zIndex: 20`(AuthBar の 90 より下に潜らせる)
- コンテナの左右パディング(20px)を打ち消す負マージンでバーを横いっぱいに広げ、内側で同じパディングを取る

**併せて直す既存の不具合**: 現行でも狭幅時にヘッダー右端の `ホームへ` と `AuthBar` のアバターが重なっている。固定化すると常時見えるため、非ドック時はバー右端に `AuthBar` の幅ぶんの余白(`paddingRight: 56`)を確保する。

### 非対象

下部入力バー、キャラクターパネル、ログ本体のレイアウトは変更しない。

## 3. エンディング到達の表示

### 前提: 「セッション終了」という概念が存在しない

現状セッションは明示的に終わらない。完了フラグも終了時刻もなく、それらしいのはキャンペーンの「次の章へ」が作る `chapter = { sessionId, title, endedAt }` だけ。したがって表示の前に**終了という状態そのものを新設する**必要がある。

これは [`docs/superpowers/handoff-2026-07-25-ending-collection.md`](../handoff-2026-07-25-ending-collection.md) が次期機能「エンディングコレクション/実績」の最重要論点として挙げているものと同じ土台である。本 spec ではその土台(終了状態 + 表示)だけを作り、**エンディングタイトルのGM命名・図鑑化・ダイス統計・実績は非対象**とする(次期機能のスコープを侵さない)。

### 設計

**AIの申告 → プレイヤーの確定** の2段階にする。AIの誤検知だけで完結扱いにしない。

**(a) 申告**

[`src/api/prompts.js`](../../../src/api/prompts.js) の `TURN_OUTPUT_FORMAT` の `state_update` に `ending_reached: { type: 'boolean' }` を追加し、`required` にも加える(既存フィールドは全て required で揃っている)。システムプロンプトの「出力フィールドの書き方」に追記:

> `state_update.ending_reached`: 物語が結末(エンディング)に到達し、これ以上続ける必要がない場合のみ true。通常は false。

[`src/api/turnResult.js`](../../../src/api/turnResult.js) の `normalizeTurnResult` は `stateUpdate.endingReached`(boolean、既定 `false`)を返す。`Play.jsx` の `runTurn` はこれを `session.state.ending_reached` に反映する。

**(b) 確定**

`ending_reached` が true かつ `endedAt` が未設定のとき、Play画面のログ末尾に案内カードを出す。

```
┌──────────────────────────────────┐
│ 物語は結末に辿り着いたようだ。       │
│ [この物語を終える] [まだ続ける]      │
└──────────────────────────────────┘
```

- `この物語を終える` → `session.endedAt = Date.now()` を保存(IndexedDB + サーバー)
- `まだ続ける` → `session.state.ending_reached = false` に戻す(次のターンでAIが再度 true を返せばまた出る)

キャンペーンの `次の章へ` が成功したセッションも、その章は終わったとみなして `endedAt` を設定する(`chapters[].endedAt` を記録している現行の扱いと整合する)。

**(c) 表示**

- セッション一覧カード: `完結` バッジ(第1章の設計に含む)
- Play画面の固定ヘッダー: タイトル脇に `完結` バッジ

完結後もセッションは継続可能なままにする(入力欄を塞がない)。エピローグを書き足したい場合があり、また誤って確定した場合の救済にもなる(次のターンを進めれば実質的に継続できる)。`endedAt` の明示的な取り消しUIは設けない。

### 後方互換

既存セッションは `endedAt` も `state.ending_reached` も持たない。いずれも「無ければ false / 未完結」として読むため、旧セッションはバッジも案内カードも出ずに従来どおり動く。

## 4. 小説化の非同期化

### 現状の問題

[`server/routes/sessions.js`](../../../server/routes/sessions.js) の `POST /sessions/:id/novelize` は Anthropic API の応答を `await` してからレスポンスを返す同期処理で、`AbortSignal.timeout(120000)` を張っている。長いセッションでは120秒を超え、報告されたエラー `upstream request failed: The operation was aborted due to timeout` はこの中断メッセージそのものである。

さらにクライアント([`src/screens/Home.jsx`](../../../src/screens/Home.jsx))は `novelizing` を React の state だけで持つため、リロードや画面遷移で「小説化中」の表示が失われ、生成中でも再押下できてしまう。

### 設計

生成中の状態をサーバー側に永続化し、クライアントはそれを見る。サーバーが真実源になるので、リロード・画面遷移・別タブを跨いでも表示が保たれる。

**ジョブレコード**

`server/storage/paths.js` に `sessionNovelJobKey(userId, sessionId)` = `users/{userId}/sessions/{sessionId}/novelJob` を追加。`dataStore` に以下を保存する。

```js
{
  status: 'running' | 'done' | 'error',
  startedAt: number,
  updatedAt: number,
  error: string | null,   // status==='error' のときのみ
  bootId: string,         // このジョブを開始したサーバープロセスの識別子
}
```

`bootId` は `createApp` ごとに生成するプロセス識別子(`makeBootId()`)。

**`POST /sessions/:id/novelize`(変更)**

1. セッションの存在確認、APIキー確認(現行どおり)
2. 既存ジョブが `running` かつ**生存している**なら、利用枠を消費せず `202 { status: 'running' }` を返す(二重起動の防止をサーバー側で行う)
3. 利用枠を消費(`usage.consume(userId, 'novelize')`、超過時 429 は現行どおり)
4. ジョブを `running` で書き込み、**生成を待たずに** `202 { status: 'running' }` を返す
5. バックグラウンドで Anthropic を呼び、成功なら `novel.md` + メタを書いてジョブを `done`、失敗なら `error`(メッセージ付き)にする

HTTPリクエストが応答を待たなくなるため、上流の `AbortSignal.timeout` は 120秒 → **300秒**に延長する。

**`GET /api/novel-jobs`(新規)**

一覧画面は全セッションのジョブ状態を必要とするため、セッションごとにポーリングせず1リクエストで取れるエンドポイントを設ける。`/api/sessions/:id` とのルート衝突を避けるためパスを分けた。

```js
// レスポンス: { [sessionId]: { status, error, hasNovel, stale } }
```

- `status`: `'idle' | 'running' | 'done' | 'error'`(ジョブが無ければ `idle`)
- `hasNovel`: `novel.md` が存在するか(過去に生成済みならジョブが無くても true)
- `stale`: 生成後にセッションが進んだか(現行 `GET /sessions/:id/novel` の `stale` と同じ判定)

**固まらないための異常系処理**

`running` のまま永久に残ることを防ぐ。読み取り時に以下を `error` として扱う(遅延評価。バックグラウンドの見張りプロセスは持たない)。

| 状況 | 判定 | 返すエラー |
|---|---|---|
| サーバー再起動でジョブが失われた | `status==='running'` かつ `bootId !== 現在のbootId` | `サーバーの再起動により中断されました。もう一度お試しください。` |
| 何らかの理由で完了記録が書かれなかった | `status==='running'` かつ `now - startedAt > 10分` | `時間内に完了しませんでした。もう一度お試しください。` |

この判定は `GET /api/novel-jobs` と `POST /novelize` の生存確認で共有する(同じ純粋関数)。

**利用枠について**: 生成が失敗しても消費した1回は戻らない。日次上限(既定10回)に対して失敗が枠を食う挙動は現行と同じであり、本 spec では変更しない。

**クライアント**

`src/api/sessionSyncClient.js` に `listNovelJobs()` を追加。`novelizeSession(id)` は 202 を返すだけになる(戻り値の意味が変わる)。

`Home.jsx`:

- マウント時に `listNovelJobs()` を1回取得(リロード直後でも「小説化中…」が出る)
- `running` のジョブが1件でもある間だけ5秒間隔でポーリングし、全て終わったら止める。アンマウントで必ず解除する
- `小説化する` を押したら POST 後すぐローカルのジョブ状態を `running` にし、以降はポーリング結果で上書きする

**ボタンの状態遷移**(第1章の操作行の中で):

| ジョブ状態 | 表示 |
|---|---|
| `idle` かつ小説なし | `[小説化する]` |
| `running` | `[小説化中…]`(disabled) |
| `done` / `idle` かつ小説あり | `[小説をDL]` `[挿絵付きでDL]`(挿絵がある場合) `[小説を再生成]` |
| `error` | `[小説化を再試行]` + エラーメッセージ |

ダウンロード自体は既存の `GET /sessions/:id/novel` と `GET /sessions/:id/novel/illustrated` をそのまま使う(これらは変更しない)。完了時に自動ダウンロードはしない(タブを閉じていた場合に取り逃すため、また意図しないタイミングでのファイル降下を避けるため)。`stale` が true のときは `小説をDL` の脇に「最新のログを反映していない可能性があります」を出す(現行のDL後メッセージを事前提示に変える)。

### 非対象

- 挿絵生成(`sceneImages`)、`messages` など他のAI呼び出しの非同期化
- 生成の進捗率表示、キャンセル操作
- 複数プロセス構成でのジョブ排他(現行の `usage` と同じく単一プロセス前提)

## テスト

このリポジトリはモジュールごとに `.test.js(x)` を持つ方針なので、それに従う。

**サーバー**

- `server/routes/sessions.test.js`: `POST /novelize` が 202 を即返すこと / バックグラウンド完了で `novel.md` とジョブが `done` になること / 上流エラーでジョブが `error` になること / `running` 中の再POSTが利用枠を消費せず 202 を返すこと
- `GET /api/novel-jobs`: 空マップ / `running` / `done` + `stale` 判定 / `bootId` 不一致で `error` / 10分超過で `error`
- 非同期完了をテストから待てるよう、進行中のジョブの Promise を `app.locals` のレジストリに登録する(テスト専用の待ち合わせ口)

**クライアント**

- `src/components/ui/Badge.jsx`: 描画とバリアント
- `src/screens/Home.test.jsx`: ジョブ状態ごとのボタン表示 / `running` で押せないこと / マウント時にジョブを取得すること / `完結` `公開中` `挿絵あり` バッジ
- `src/screens/Play.test.jsx`: 固定ヘッダーに `← ホーム` があること / `ending_reached` で案内カードが出ること / `この物語を終える` で `endedAt` が保存されること / `まだ続ける` でカードが消えること / `完結` バッジ
- `src/api/turnResult.test.js`: `endingReached` の正規化(true / false / 欠落 / 非boolean)

既存の 965 テストは全て通す。`server/routes/characters.test.js` の「lists characters scoped to world and kind」は並列実行時にタイムアウトするフレークとして既知(引き継ぎ書に記載)。

## ドキュメント更新

- `docs/01-architecture.md`: 小説化が非同期ジョブになったこと
- `docs/02-data-model.md`: `session.endedAt`、`state.ending_reached`、novelJob レコード
- `docs/03-gm-logic.md`: `state_update.ending_reached`
- `docs/05-ui-ux.md`: 一覧カードの3層構造、Play固定ヘッダー、エンディング案内カード
- `docs/06-content-generation.md`: 小説化フローの変更
- `docs/superpowers/handoff-2026-07-25-ending-collection.md`: 「セッション終了の概念が無い」という前提が本 spec で解消されることを追記
