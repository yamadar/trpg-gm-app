# 小説化の完了通知の永続化 設計ドキュメント

## 1. 背景・目的

`docs/superpowers/specs/2026-07-25-novelize-progress-ui-design.md` で、小説化の完了をカード内の完了ブロックとトーストで知らせるようにした。しかしどちらも、マウント中の `Home` が `running → done` の遷移を観測したときにしか出ない。

```jsx
// src/screens/Home.jsx
const [finishedIds, setFinishedIds] = useState(() => new Set()); // 完了ブロックを出すセッション
```

`finishedIds` も `toasts` もただのローカルstateであり、`Home` は `src/App.jsx` で `{view === 'home' && <Home .../>}` と条件レンダリングされている。つまり以下のいずれでも通知は失われる。

- 別の画面(プレイ・ライブラリ・ギャラリー)に移動している間に生成が終わった
- リロードした
- タブを閉じていた

いずれの場合も、戻ってきたユーザーが見るのは「小説をDL」に変わったボタンだけで、完了した旨はどこにも出ない。

これは機能自身の主張と矛盾している。待機ブロックは離脱を積極的に勧めている。

> 長い記録ほど時間がかかります。**このまま他の画面に移っても生成は続きます。**

離脱を勧めておきながら、離脱すると完了を知らせない。前設計はリロードのケースだけを検討し「リロードは画面を見ている証拠」として許容したが、画面遷移とタブを閉じるケースを見落としていた。

本ドキュメントは、完了通知をリロード・画面遷移・タブを閉じるのすべてを跨いで保持する設計を定める。

### 維持されているもの(変更不要)

誤解を避けるために記す。**ジョブの進行状況そのものは既に永続化されている。** 状態はサーバーが真実源であり、`Home` のマウント時に `listNovelJobs()` を取得し直すため、リロードしても「小説化中…」と待機ブロックは復元され、経過時間もサーバー計算値なので正しい値のまま戻る。ポーリングも応答に running が含まれれば自動的に再開する。

失われているのは**完了したという通知**だけである。

## 2. スコープ

- 生成成功時にサーバーが「未読」フラグを立てる
- `GET /api/novel-jobs` が `unread` を返す
- 既読化のエンドポイントを新設する
- クライアントの完了通知を、遷移検知から `unread` 駆動へ一本化する

### 対象外

- **失敗(`error`)の永続通知**。ジョブの `status: 'error'` とエラー文言はサーバーに残り、カードのエラー行として戻れば見える。トーストを永続化する必要はない
- **ブラウザ通知(Notification API)**。タブを閉じていても届く唯一の手段だが、許可ダイアログの設計を伴う。本設計で「戻れば必ず気づく」状態にしてから改めて検討する
- **プレイ画面等でのリアルタイム通知**。ポーリングと通知の状態を `App` へ持ち上げれば可能だが、本設計の目的(通知を失わない)は Home 再訪時の表示で達成できる
- ポーリング間隔の変更

## 3. アーキテクチャ

### 3.1 未読は「立てて降ろす」フラグにする

「既読時刻を記録し、小説の生成時刻と比較して未読を判定する」方式も考えられるが、採らない。

その方式では「既読の記録が無い」＝「未読」となるため、**この変更を投入した瞬間に既存の小説がすべて未読になる。** ユーザーが Home を開くと、過去に生成した全セッション分のトーストが一斉に出る。

代わりに、生成が成功した瞬間にジョブランナーがフラグを立て、ユーザーが受け取ったら降ろす。既存の小説にはフラグのレコード自体が無いので `unread: false` となり、静かなままである。後方互換が設計上自動的に成立し、時刻の比較もクロックの考慮も不要になる。

### 3.2 保存先

新しいキー `sessionNovelNoticeKey(userId, sessionId)` を `server/storage/paths.js` に追加し、`{ unread: boolean }` を保存する。

小説のメタ(`sessionNovelMetaKey`)に相乗りさせない。メタはジョブランナーが毎回オブジェクトごと上書きするため、そこにユーザー側の既読状態を混ぜると、既読化の書き込みと生成完了の書き込みが読み書きで競合する。責務も異なる(メタは生成物の属性、noticeはユーザーへの提示状態)。

### 3.3 サーバー

| 変更 | 内容 |
|---|---|
| `server/storage/paths.js` | `sessionNovelNoticeKey` を追加 |
| `server/novelJobs.js` | 生成成功時に `{ unread: true }` を書く |
| `server/routes/sessions.js` | `/novel-jobs` に `unread` を追加。`POST /sessions/:id/novel/seen` を新設 |

`novelJobs.js` は、本文とメタを保存してジョブを `done` にする箇所で notice も書く。**失敗時は書かない**(エラーは別経路で伝わるため)。

`truncated: true`(継続上限に達して末尾が欠けている場合)でも本文は保存され `status` は `done` になる。この場合も `unread: true` を立てる。ユーザーにとっては「小説ができた」という事実に変わりはなく、欠落は既存の警告行が伝える。

`GET /novel-jobs` は notice を読んで返す。

```js
const notice = await dataStore.get(sessionNovelNoticeKey(req.userId, id));
out[id] = {
  status, error, elapsedMs,
  hasNovel: text !== null,
  stale: isStale(meta, session),
  truncated: meta?.truncated === true,
  // レコードが無い(この変更以前に生成された小説)は既読扱いにする。
  unread: notice?.unread === true,
};
```

`POST /sessions/:id/novel/seen` は `{ unread: false }` を書き、`204` を返す。セッションが存在しない場合は `404`。冪等であり、既に false でも成功する。

再生成すると成功時に再び `unread: true` が立つため、「新しい小説ができた」も同じ経路で通知される。

### 3.4 クライアント: 遷移検知から unread への一本化

現在、完了通知は `collectJobEvents` が `running → done` の遷移を見て発火している。ここに `unread` を足すと、同じ完了に対して遷移と `unread` の両方が反応し、通知が二重に出る。

**完了の通知は `unread` に一本化する。** `collectJobEvents` は `running → error` のトーストだけを担当する。

遅延は悪化しない。完了を知る手段はどのみちポーリングであり、`status: 'done'` を返すポーリングと `unread: true` を返すポーリングは同一のレスポンスだからである。

```
[ポーリング応答] { status:'done', unread:true, ... }
        ↓
announcedRef に無いIDだけを拾う
        ↓
  ├→ finishedIds に追加(完了ブロック)
  ├→ toasts に追加
  ├→ announcedRef に追加
  └→ markNovelSeen(id) をPOST(結果は待たない)
```

#### 二重通知の抑止

`markNovelSeen` の往復中に次のポーリングが返ると、サーバーはまだ `unread: true` を返す。そこで**マウント中に通知済みのIDをメモリ上の `Set`(ref)** で押さえ、同じセッションを二度通知しない。

- ref(state ではない): 通知の判定は描画ではなく副作用の中で行うため、再描画を誘発する必要がない
- サーバーのフラグはマウントを跨いだ抑止、`announcedRef` はマウント内の抑止。二段で担保する

#### POSTが失敗したとき

握りつぶし、UIはそのまま進める。サーバーのフラグが残るので、次に Home を開いたときにもう一度通知される。

通知を失うより出し直すほうが害が小さいため、これは意図した挙動とする。ユーザーに見えるエラーは出さない(既読化の失敗はユーザーが対処できることではない)。

#### 完了ブロックの消え方

変更しない。DL・挿絵付きDL・再生成のいずれかで消える(`clearFinished`)。既読化はサーバーへの記録であって、画面上の表示を消す操作ではない。

したがって「Home を開く → 完了ブロックとトーストが出る → 既読化される → その画面にいる間は完了ブロックは残る → DLすると消える → 次に Home を開いてももう出ない」となる。

### 3.5 ログアウト

既存の `!user` 分岐で `finishedIds` と `toasts` をクリアしている。`announcedRef` もここでクリアする。別のユーザーでログインし直したときに、前のユーザーの通知済み記録が残っていると新しいユーザーの未読を握りつぶしてしまうため。

## 4. 変更ファイル

| ファイル | 変更 |
|---|---|
| `server/storage/paths.js` | `sessionNovelNoticeKey` を追加 |
| `server/novelJobs.js` | 生成成功時に notice を書く |
| `server/routes/sessions.js` | `/novel-jobs` が `unread` を返す。`POST /sessions/:id/novel/seen` を追加 |
| `src/api/sessionSyncClient.js` | `markNovelSeen(sessionId)` を追加 |
| `src/screens/Home.jsx` | `unread` 駆動の通知、`announcedRef`、`collectJobEvents` から done 分岐を削除 |

## 5. テスト

### 5.1 `server/novelJobs.test.js`

- 生成成功時に notice に `{ unread: true }` が書かれる
- 生成失敗時に notice が書かれない
- `truncated` で完了した場合も `unread: true` が書かれる

### 5.2 `server/routes/sessions.test.js`

- `GET /novel-jobs` が生成直後のセッションに `unread: true` を返す
- **notice レコードが無い小説は `unread: false` になる**(後方互換の回帰防止)
- `POST /sessions/:id/novel/seen` が 204 を返し、以降 `/novel-jobs` の `unread` が false になる
- 存在しないセッションへの `POST .../seen` が 404 を返す
- 既に既読のセッションへの `POST .../seen` が成功する(冪等)

### 5.3 `src/screens/Home.test.jsx`

- マウント時に `unread: true` のセッションがあると、完了ブロックとトーストが出て `markNovelSeen` が呼ばれる
- **`unread: true` が2回続けて返っても通知は1回だけ**(二重通知の回帰防止)
- `markNovelSeen` が失敗しても通知は出たままで、エラー表示は出ない
- `unread: false` の done セッションでは完了ブロックもトーストも出ない
- `running → error` のトーストは従来どおり出る
- 完了ブロックは DL で消える(既存テストの維持)
- `collectJobEvents` が `running → done` でイベントを返さなくなる(error のみを返す)

## 6. リスク

| リスク | 対応 |
|---|---|
| 既存の小説が一斉に未読になる | フラグを生成時に立てる方式にすることで構造的に回避。回帰テストで固定する |
| 既読化POSTの失敗で通知が出続ける | 次回 Home を開いたときに再通知される。通知を失うより安全と判断し受け入れる |
| 通知が二重に出る | `announcedRef`(マウント内)とサーバーのフラグ(マウント跨ぎ)の二段で抑止 |
| ユーザー切替で通知済み記録が残る | ログアウト時に `announcedRef` をクリアする |
| 完了通知の経路が二重化して片方だけ直す事故 | `collectJobEvents` から done 分岐を削除し、完了は `unread` の一経路に統一する |
