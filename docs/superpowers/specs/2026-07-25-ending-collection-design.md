# 設計: エンディングコレクション/実績

作成 2026-07-25。[08-feature-ideas.md](../08-feature-ideas.md) 2章の「エンディングコレクション/実績」の設計。引き継ぎ書は [handoff-2026-07-25-ending-collection.md](../handoff-2026-07-25-ending-collection.md)。

> **エンディングコレクション/実績**: セッション終了時にGMへ「エンディングタイトル」を命名させ図鑑化。分岐型なので再プレイ動機に直結。クリティカル/ファンブル回数などのダイス統計を添える。

## 前提: 終了状態はすでにある

引き継ぎ書が最重要論点として挙げていた「セッション終了という概念が存在しない」は、直前のブランチ(`feat/ui-improvements-async-novelize`、mainへマージ済み)で解消された。

- `session.state.ending_reached` — GMが毎ターン `state_update.ending_reached` で結末到達を申告する一時フラグ
- `session.endedAt` — プレイヤーが「この物語を終える」で確定した時刻(キャンペーンの「次の章へ」でも入る)
- Home一覧とPlayヘッダーの `完結` バッジ

本設計はその上に「名前を付けて集める」層を載せる。**確定アクションそのものは作り直さない。**

## 1. データモデル: エンディング記録はスナップショット

完結を確定した瞬間のセッションから記録を作り、サーバーに保存する。

**パス**: `users/{userId}/endings/{sessionId}`(`server/storage/paths.js` に `endingKey` / `endingListPrefix` を追加)

```js
{
  sessionId: string,
  sessionTitle: string,      // セッションのタイトル(記録時点)
  endingTitle: string,       // GMが命名したエンディングタイトル
  summary: string,           // GMによる2〜3文の総括
  endedAt: number,           // session.endedAt
  recordedAt: number,        // 記録を書いた時刻
  worldId: string | null,
  campaignId: string | null,
  rulesetId: string | null,
  formula: string | null,    // 統計の解釈に必要(simple/coc7e/dnd5e/gurps)
  moods: string[],
  stats: RollStats,          // 3章の形状。確定時に集計して固定する
}
```

**なぜスナップショットか**: 完結後もセッションは継続可能(入力欄を塞がない既存仕様)なので、都度ログから再計算すると図鑑の内容が後から変わる。「そのとき到達したエンディング」として固定する。

`sessionId` をキーにするため、1セッションにつきエンディングは1つ。記録し直すと上書きされる(命名の再試行に使う)。

## 2. ルールセット解決の共通化(小さな前準備)

`src/api/prompts.js` の `resolveRuleset(session)` / `resolveAdapter(session)` を `src/engine/resolveRuleset.js` へ移し、`prompts.js` はそこから import する。

統計モジュール(3章)も同じ解決規則を使う必要があるため。プロンプト生成モジュールから import させると層が逆転するので、判定エンジン側に置く。既存の振る舞いは変えない(`session.ruleset` → `RULESETS` から `rulesetId` 検索 → 先頭、の順で解決し、未知/未指定の `formula` は `simple` へフォールバック)。

## 3. ダイス統計: `src/engine/rollStats.js`(新規・純関数)

```js
summarizeRolls(session) -> {
  total: number,          // roll を持つGMログエントリの数
  successes: number,
  successRate: number,    // 0〜1。total===0 なら 0
  byDegree: { [degree]: number },  // adapter.degrees のキーのみ。出現0のdegreeも0で含む
  degrees: string[],      // 表示順(adapter.degrees をそのまま)
  resources: { [key]: { label, value, max } },  // セッションが実際に持つリソースのみ
}
```

アダプタは2章の `resolveAdapter(session)` で解決する(判定式の解決規則を1箇所に保つため)。

**ルールセット別の出し分けは `adapter.degrees` に無いキーを出さないことで実現する。** `simple` / `dnd5e` / `gurps` は `['fumble','fail','success','critical']`、`coc7e` だけが `['fumble','fail','success','hard','extreme','critical']` を持つので、ハード成功・イクストリーム成功はCoC7e風の記録にだけ現れる。

`resources` は `session.state.resources` に実在するキーだけを拾う(旧セッションは持たない)。CoC7e風なら `{ san: { label: '正気度', value: 12, max: 99 } }` となり、「正気度12で生還」という物語的に強い情報が出る。ラベルは `adapter.resourceDefs` から引く。

ログに `roll` を持たないエントリしかない場合も壊れず、`total: 0` / `byDegree` は全て0 を返す。

## 4. 命名フロー

**クライアント**(`src/screens/Play.jsx` の `finishStory`):

1. これまでどおり `session.endedAt` を確定してローカル保存・サーバー同期する(**先に完了させる** — サーバーが記録を作る際に最新のセッションを読むため)
2. `summarizeRolls(session)` を計算し、`recordEnding(sessionId, stats)` を呼ぶ
3. 成功したらログ末尾のカードをエンディング結果(タイトル・総括・統計)の表示に差し替える
4. **失敗しても `endedAt` の確定は取り消さない。** カードに「エンディングを記録する」の再試行ボタンを出す

**サーバー**(`POST /api/sessions/:id/ending`、ボディ `{ stats }`):

1. セッションを読む。無ければ404
2. `session.endedAt` が無ければ400(完結していないセッションには記録を作らない)
3. AI利用枠を消費(既存の `messages` 種別に相乗り。AI呼び出し1回のため新種別は作らない)
4. Anthropicを1回呼び、structured outputs で `{ ending_title, summary }` を得る
5. セッション由来のフィールド(タイトル・worldId・campaignId・rulesetId・`ruleset.formula`・moods・endedAt)と受け取った `stats` を合成して記録を保存し、`201 { ending }` を返す

**統計をクライアントで集計してサーバーへ送る理由**: サーバーは `src/` を import できない(`server/routes/rulesets.js:7` が判定式リストを意図的に複製しているのと同じ制約)。統計ロジックをサーバー側に複製すると、判定式を追加したときに2箇所を直す必要が生まれる。セッション本体もすでに `PUT /api/sessions/:id` でクライアントから丸ごと受け取っている流儀に沿う。

**命名プロンプトの入力**: `state.history_summary`、直近のGM地の文数件、PCの `raw` / `goal` / `bonds`、シナリオの「シナリオ概要」相当。GM専用情報は既存の方針どおり渡さない。出力は日本語で、`ending_title` は20字程度、`summary` は2〜3文。

**その他のルート**:

| ルート | 役割 |
|---|---|
| `GET /api/endings` | 記録の一覧。`endedAt` の降順 |
| `PATCH /api/endings/:id` | `{ endingTitle }` で改名 |
| `DELETE /api/endings/:id` | 記録の削除 |

`:id` はいずれも `sessionId`(1セッションにつき記録は1つなので、記録専用のIDは作らない)。

クライアントは `src/api/endingClient.js` に `recordEnding` / `listEndings` / `renameEnding` / `deleteEnding` を置く。

## 5. 実績: `src/engine/achievements.js`(新規・純関数)

```js
evaluateAchievements(endings) -> [{ id, label, description, earned, earnedAt, sessionId }]
```

**エンディング記録のコレクションだけから導出する。実績の保存を持たない。** これにより (a) マイグレーションが要らない、(b) 実績定義を後から足すと過去の記録に遡って付く、(c) 判定が純粋で試験しやすい。

カタログはコード内の固定リスト(ユーザー定義は非対象)。全件を返し、未獲得は `earned: false` で返す — 図鑑側でグレー表示して集める動機にするため。

| id | ラベル | 条件 | 種別 |
|---|---|---|---|
| `first-ending` | 初めての結末 | 記録が1つ以上 | コレクション |
| `three-endings` | 三つの結末 | 記録が3つ以上 | コレクション |
| `world-trilogy` | 一つの世界の三つの結末 | 同一 `worldId` の記録が3つ以上 | コレクション |
| `flawless` | 無傷の旅路 | 1つの記録で `total >= 1` かつ `byDegree.fumble === 0` | 単体 |
| `lucky` | 豪運 | 1つの記録で `byDegree.critical >= 3` | 単体 |
| `cursed` | 厄日 | 1つの記録で `byDegree.fumble >= 3` | 単体 |
| `brink` | 瀬戸際の生還 | 1つの記録で `stats.resources.san.value <= 10`(CoC7e風のみ) | 単体 |
| `short-story` | 短編 | 1つの記録で `1 <= total <= 10` | 単体 |

`earnedAt` / `sessionId` は**条件を最初に満たした記録**のもの(記録を `endedAt` の昇順に並べて判定するので決定的)。コレクション種別は条件を成立させた記録のものになる。

ルールセット依存の実績(`brink`)は、その語彙・リソースを持たない記録では単に条件を満たさない。判定は `stats` の形だけを見るので、`formula` の分岐を実績側に持ち込まない。

## 6. 図鑑画面: `src/screens/EndingGallery.jsx`(新規)

**ルーティング**: `src/router/useHashRoute.js` に `#/endings` を追加する。現在 `parseHash` は `{ userId }` だけを返すので `{ userId, endings }` に拡張し、`navigateToEndings()` を追加する(既存の `navigateToUser` / `clearHash` と同じ流儀)。`src/App.jsx` は `#/u/:userId` と同様に、このルートで `EndingGallery` を描画する。

**導線**: ホームのボタン行(`+ 新規プレイ` / `素材ライブラリ` / `公開ギャラリー`)に `エンディング図鑑` を追加。

**画面構成**:

```
エンディング図鑑

〔実績〕
[初めての結末] [三つの結末] [無傷の旅路] [豪運] [厄日] [瀬戸際の生還] [一つの世界の三つの結末] [短編]
 ↑獲得済みは brass、未獲得はグレー。ホバー等ではなく説明文を常時添える

〔到達したエンディング〕(endedAt 降順)
┌────────────────────────────────────────┐
│ 灰は星を数えない            2026-07-25   │
│ (セッション: 星降りの夜に)                │
│ 〔ホラー〕〔ミステリー〕                    │
│ 総括の2〜3文…                             │
│ 判定 24回 / 成功率 58% ・ クリティカル 2 ・ │
│ ファンブル 1 ・ ハード成功 5 ・ 正気度 12/99 │
│ [改名] [削除]                             │
└────────────────────────────────────────┘
```

統計の表示は `stats.degrees` の順に、そのdegreeのラベルを添えて並べる(degree→日本語ラベルの対応表は図鑑側に持つ)。

**Homeへの反映**: Home は `listEndings()` をマウント時に1回取得し、記録があるセッションカードにはエンディングタイトルを1行表示する。`endedAt` があるのに記録が無いセッション(命名に失敗した、または旧データ)には `エンディングを記録する` ボタンを出し、そこからも記録できるようにする。

## 7. 非対象(明示的にスコープ外)

- **エンディングの公開/ギャラリー連携** — 既存の公開基盤(`server/storage/shareLibrary.js`)に乗せられるが、08-feature-ideas の別項目「公開シナリオの遊ばれた数とリアクション」とスコープを混ぜない
- ユーザー定義の実績、実績の通知/トースト演出
- エンディング分岐ツリーの可視化
- 完結後にセッションを続けた場合の記録の自動更新(記録し直しは手動)

## テスト

モジュールごとに `.test.js(x)` を置く既存方針に従う。

**純関数(最も厚く)**
- `src/engine/rollStats.test.js`: ログが空 / `roll` なし / simple と coc7e で `degrees` と `byDegree` のキーが変わる / `resources` はセッションが持つものだけ / 成功率の計算
- `src/engine/achievements.test.js`: 各実績の境界値(2つ目と3つ目、ファンブル2回と3回、正気度10と11、判定10回と11回) / 未獲得も返る / `earnedAt` が最初に満たした記録のもの / 空配列で全件未獲得
- `src/engine/resolveRuleset.test.js`: 既存の `prompts.test.js` から移設・拡充(`session.ruleset` あり / `rulesetId` のみ / どちらも無い / 未知の `formula`)

**サーバー**
- `server/routes/endings.test.js`: 完結していないセッションは400 / 404 / AI失敗時に記録を作らない / 保存内容がセッション由来フィールドと `stats` を含む / 一覧の降順 / 改名 / 削除 / 別ユーザーの記録が見えないこと

**クライアント**
- `src/api/endingClient.test.js`: 各関数のURL・メソッド・ボディ
- `src/screens/EndingGallery.test.jsx`: 実績の獲得/未獲得表示 / 記録の一覧 / 統計の出し分け(coc7e の記録にだけハード成功が出る) / 改名 / 削除 / 空状態
- `src/screens/Play.test.jsx`: 確定時に記録が作られること / 記録に失敗しても `endedAt` は確定したままで再試行ボタンが出ること
- `src/screens/Home.test.jsx`: 記録済みセッションにエンディングタイトルが出ること / 未記録の完結セッションに記録ボタンが出ること
- `src/router/useHashRoute.test.jsx`: `#/endings` の解析と遷移

既存の 1029 テストは全て通す。`server/routes/characters.test.js` の「lists characters scoped to world and kind」は並列実行時にタイムアウトする既知のフレーク。

## ドキュメント更新

- `docs/02-data-model.md`: エンディング記録の形状と保存先
- `docs/04-persistence.md`: 新ルート4本をAPI一覧へ
- `docs/05-ui-ux.md`: 図鑑画面、Homeの導線とエンディングタイトル表示、Playの確定後カード
- `docs/06-content-generation.md`: エンディング命名のAI呼び出し
- `docs/08-feature-ideas.md`: 2章の該当項目を実装済みに(実績を含む/公開連携は非対象、と明記)
- `docs/superpowers/handoff-2026-07-25-ending-collection.md`: 本機能の完了を追記
