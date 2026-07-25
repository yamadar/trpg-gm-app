# 設計: 実績の拡張とSteam的な実績UI

作成 2026-07-25。[2026-07-25-ending-collection-design.md](2026-07-25-ending-collection-design.md) 5章・6章で作った実績の続き。本設計が入ったら、あちらの5章の表と6章の画面構成図は本書を参照する形へ更新する。

現状の課題は3つある。

1. 実績が8件しかない
2. 図鑑ページの上部に全件をベタ並べしているため、件数を増やすと本体(エンディング一覧)が押し下げられる
3. 1件の表示が「ラベル＋条件」の2行だけで、どこまでが1件なのか、取得済みか、あと何本で届くのかが読み取りにくい

方針は「実績を50件に増やし、図鑑上部は進捗のサマリーに縮め、実績の本体は専用画面へ出す」。実績をエンディング記録から導出する純関数という既存の性質は変えない(保存もマイグレーションも増えない)。

## 1. カタログを分離し、エントリにメタ情報を足す

`src/engine/achievements.js` からカタログを `src/engine/achievementCatalog.js` へ切り出す。50件の定義と評価ロジックが同じファイルに同居すると、どちらを読むときも他方が邪魔になるため。

エントリの形:

```js
{
  id: string,
  label: string,
  description: string,     // 条件を日本語1文で
  category: string,        // 'arrival' | 'world' | 'mood' | 'roll' | 'fate' | 'survival' | 'trace'
  tier: 1 | 2 | 3,         // 銅 / 銀 / 金
  icon: string,            // AchievementIcon が持つグリフのキー
  isEarnedBy: (list) => boolean,     // 既存と同じ。endedAt昇順の接頭辞を受け取る
  progress?: (endings) => number,    // 任意。全記録に対する現在値
  target?: number,                   // progress を持つときは必須
}
```

`progress` / `target` は「数えれば現在地が出る」実績にだけ付ける(記録10本、通算判定500回、雰囲気8種制覇など)。単発の記録で決まる実績(ファンブル0など)には付けない — 「0.5回ファンブルを出していない」に意味はないため。

`progress` は `isEarnedBy` と違い**全記録**を受け取る。取得済みかどうかの判定は接頭辞で行うが、進捗の表示は常に「いま何本持っているか」でよい。

`evaluateAchievements(endings)` の戻り値は既存フィールドを保ったまま拡張する:

```js
{ id, label, description, category, tier, icon, earned, earnedAt, sessionId,
  progress: { current, target } | null }
```

`current` は `target` で頭打ちにする(取得済みの実績で `12 / 10` と出さないため)。

## 2. 評価ループの向きを変える

現在の実装は実績ごとに記録を1件ずつ舐め、毎回 `ascending.slice(0, i + 1)` で接頭辞を作り直す。実績が8件なら誤差だが、50件になると記録数×50回の配列コピーが走る。

接頭辞を外側にする:

```
昇順に並べた記録を1件ずつ足しながら prefix を伸ばす
  その時点で未獲得の実績だけを isEarnedBy(prefix) にかける
  成立したものに earnedAt / sessionId を確定して未獲得集合から外す
全件走査後、残った実績を未獲得として返す
最後にカタログの定義順へ並べ直す
```

結果は現在と同一で、`earnedAt` は「条件を最初に満たした記録」のままになる。戻り値の順序もカタログ順で変わらない(既存テストがこれに依存している)。

## 3. カタログ: 50件

`stats` の形だけを見て判定する既存方針を守る。ハード成功・イクストリーム成功・正気度を使う実績は、その語彙を持たない記録(CoC7e風以外)では単に条件を満たさない。実績側に判定式の分岐は持ち込まない。

`resourceDefs` を持つのは CoC7e風の `san`(最大99)だけなので、生還カテゴリは実質 CoC7e風専用になる。

進捗欄の「—」は `progress` を持たないことを指す。

### 到達 (arrival) — 6件

| id | ラベル | 条件 | ティア | 進捗 |
|---|---|---|---|---|
| `first-ending` | 初めての結末 | 記録が1つ以上 | 銅 | 1 |
| `three-endings` | 三つの結末 | 記録が3つ以上 | 銅 | 3 |
| `five-endings` | 五つの結末 | 記録が5つ以上 | 銅 | 5 |
| `ten-endings` | 十の結末 | 記録が10以上 | 銀 | 10 |
| `endings-25` | 二十五の結末 | 記録が25以上 | 金 | 25 |
| `endings-50` | 五十の結末 | 記録が50以上 | 金 | 50 |

### 世界 (world) — 6件

`worldId` / `campaignId` が null の記録は数えない(単発セッションをまとめないための既存の扱い)。

| id | ラベル | 条件 | ティア | 進捗 |
|---|---|---|---|---|
| `world-trilogy` | 一つの世界の三つの結末 | 同一 `worldId` の記録が3以上 | 銅 | 3(最大の世界の本数) |
| `world-five` | 一つの世界の五つの結末 | 同一 `worldId` の記録が5以上 | 銀 | 5(同上) |
| `worlds-three` | 三つの世界 | 異なる `worldId` が3以上 | 銅 | 3 |
| `worlds-five` | 五つの世界 | 異なる `worldId` が5以上 | 銀 | 5 |
| `campaign-two` | 章を重ねて | 同一 `campaignId` の記録が2以上 | 銅 | 2(最大のキャンペーンの本数) |
| `campaign-four` | 長い年代記 | 同一 `campaignId` の記録が4以上 | 金 | 4(同上) |

### 雰囲気 (mood) — 10件

雰囲気タグは `src/constants/moods.js` の8種。

| id | ラベル | 条件 | ティア | 進捗 |
|---|---|---|---|---|
| `mood-horror` | ホラーの結末 | `moods` にホラーを含む記録がある | 銅 | — |
| `mood-adventure` | 冒険の結末 | 同上(冒険) | 銅 | — |
| `mood-mystery` | ミステリーの結末 | 同上(ミステリー) | 銅 | — |
| `mood-daily` | 日常の結末 | 同上(日常) | 銅 | — |
| `mood-sf` | SFの結末 | 同上(SF) | 銅 | — |
| `mood-fantasy` | ファンタジーの結末 | 同上(ファンタジー) | 銅 | — |
| `mood-comedy` | コメディの結末 | 同上(コメディ) | 銅 | — |
| `mood-serious` | シリアスの結末 | 同上(シリアス) | 銅 | — |
| `mood-all` | 八色の物語 | 8種すべてで1本以上 | 金 | 8(達成済みの種類数) |
| `mood-blend` | 混ざりあう色 | 1つの記録が雰囲気を3つ以上持つ | 銅 | — |

### 判定 (roll) — 7件

| id | ラベル | 条件 | ティア | 進捗 |
|---|---|---|---|---|
| `short-story` | 短編 | 1記録で `1 <= total <= 10` | 銅 | — |
| `long-story` | 長編 | 1記録で `total >= 50` | 銀 | — |
| `epic` | 大長編 | 1記録で `total >= 100` | 金 | — |
| `rolls-100` | 百の判定 | 全記録の `total` 合計が100以上 | 銅 | 100 |
| `rolls-500` | 五百の判定 | 同上が500以上 | 銀 | 500 |
| `adept` | 手練れ | 1記録で `total >= 10` かつ `successRate >= 0.8` | 銀 | — |
| `ordeal` | 苦難の道 | 1記録で `total >= 10` かつ `successRate <= 0.3` | 銀 | — |

### 運命 (fate) — 10件

| id | ラベル | 条件 | ティア | 進捗 |
|---|---|---|---|---|
| `flawless` | 無傷の旅路 | 1記録で `total >= 1` かつ `fumble === 0` | 銅 | — |
| `flawless-long` | 完全なる旅路 | 1記録で `total >= 30` かつ `fumble === 0` | 金 | — |
| `lucky` | 豪運 | 1記録で `critical >= 3` | 銅 | — |
| `lucky-five` | 天佑 | 1記録で `critical >= 5` | 銀 | — |
| `cursed` | 厄日 | 1記録で `fumble >= 3` | 銅 | — |
| `cursed-five` | 呪われた日 | 1記録で `fumble >= 5` | 銀 | — |
| `tempest` | 明暗 | 1記録で `critical >= 3` かつ `fumble >= 3` | 銀 | — |
| `hard-three` | 際どい成功 | 1記録で `hard >= 3` | 銅 | — |
| `extreme-one` | 会心 | 1記録で `extreme >= 1` | 銅 | — |
| `criticals-25` | 積み重なる幸運 | 全記録の `critical` 合計が25以上 | 銀 | 25 |

`hard` / `extreme` は `byDegree` に存在しないルールセットでは 0 として扱う(`byDegree[d] ?? 0`)。

### 生還 (survival) — 4件

正気度は `stats.resources.san`(`value` / `max`)。`max` は記録ごとに読み、定数で持たない。

| id | ラベル | 条件 | ティア | 進捗 |
|---|---|---|---|---|
| `brink` | 瀬戸際の生還 | `san.value <= 10` | 銅 | — |
| `shaken` | 削られた精神 | `total >= 10` かつ `san.value <= max * 0.3` | 銅 | — |
| `steady` | 揺るがぬ精神 | `total >= 10` かつ `san.value >= max * 0.6` | 銀 | — |
| `sanity-zero` | 正気の底 | `san.value === 0` | 金 | — |

### 軌跡 (trace) — 7件

日付の判定はローカルタイムゾーンで行う(`new Date(endedAt)` の `getHours` / `getFullYear` 系)。プレイヤーの体感時刻と一致させるため。

| id | ラベル | 条件 | ティア | 進捗 |
|---|---|---|---|---|
| `formula-two` | 二つの流儀 | 異なる `formula` の記録が2種以上 | 銅 | 2 |
| `formula-all` | 四つの流儀 | `simple` / `coc7e` / `dnd5e` / `gurps` すべて | 金 | 4 |
| `night-owl` | 夜更かしの語り部 | `endedAt` の時刻が0〜4時台 | 銅 | — |
| `dawn` | 夜明けの結末 | `endedAt` の時刻が5〜7時台 | 銅 | — |
| `same-day-two` | 一日二作 | 同じ日付の記録が2つ以上 | 銀 | — |
| `streak-three` | 三日連続 | 3日連続で記録がある | 銀 | — |
| `month-five` | 実り月 | 同一年月の記録が5つ以上 | 銀 | — |

### カテゴリのラベル

| キー | 表示名 |
|---|---|
| `arrival` | 到達 |
| `world` | 世界 |
| `mood` | 雰囲気 |
| `roll` | 判定 |
| `fate` | 運命 |
| `survival` | 生還 |
| `trace` | 軌跡 |

カタログの定義順もこの順に並べる(一覧画面のセクション順と一致させ、並べ替えのコードを持たないため)。

## 4. 表示コンポーネント

`src/components/achievements/` に置く。図鑑と実績一覧の両方から使う。

**`AchievementIcon.jsx`** — 24×24・`currentColor` のインラインSVGグリフ集(20個ほど)を `id -> path` のマップで持ち、`icon` キーで引く。1つのグリフを複数の実績で使い回してよい(「三つの結末」と「五つの結末」は同じ書物のグリフでよい)。未知のキーはカテゴリごとの既定グリフへ落とす — カタログ側はテストで実在するキーだけに縛るので、これは実行時に穴を開けないための保険。絵文字は使わない — 紙とタイプライターの意匠に合わないため。

ティアと取得状態は円枠で表す。既存パレットの値だけを使う。

| 状態 | 枠 | 枠の色 | グリフの色 |
|---|---|---|---|
| 銅・取得済み | 実線1.5px | `COLORS.line` | `COLORS.brassDark` |
| 銀・取得済み | 実線2px | `COLORS.brass` | `COLORS.brassDark` |
| 金・取得済み | 二重線 | `COLORS.stamp`(紙に押した朱印の見立て) | `COLORS.stamp` |
| 未取得 | 破線2px | `COLORS.faint` | `COLORS.faint` |

銅と未取得はどちらも淡いが、実線と破線で区別する。ティアの差が色だけに乗らないよう、枠の太さと本数も併せて変える。

**`AchievementRow.jsx`** — 一覧画面の行。`[アイコン] [ラベル(F_DISPLAY 15px) / 条件(F_BODY 12px)] [右端]`。右端は取得済みなら獲得日、`progress` があれば `3 / 10` と進捗バー、どちらでもなければ「未取得」。ラベルと条件を書体で分けることで、1件の切れ目が読み取れるようにする。

**`AchievementTile.jsx`** — 図鑑上部の「直近の獲得」用タイル。アイコンを中央に置き、下にラベル・条件・獲得日。

**`AchievementProgressBar.jsx`** — `12 / 50` の帯。`role="progressbar"` と `aria-valuenow` / `aria-valuemin` / `aria-valuemax` / `aria-label` を持たせる。

色だけに情報を載せない。取得済み・未取得は必ずテキスト(獲得日か「未取得」)でも示し、アイコンは `aria-hidden`、行全体の読み上げはラベル→条件→状態の順にする。

## 5. 画面

### エンディング図鑑(既存 `src/screens/EndingGallery.jsx`)

上部の実績ベタ並べを次に置き換える。

```
実績  12 / 50                              すべて見る →
▓▓▓▓▓▓░░░░░░░░░░░░░░░░  24%

〔直近の獲得〕
[タイル] [タイル] [タイル]      ← earnedAt 降順の先頭3件
```

取得済みが0件のときはタイル行を出さず、「まだ実績がありません」の1行に落とす。未ログイン時は実績ブロックごと出さない(記録を取得できないため)。

### 実績一覧(新規 `src/screens/AchievementList.jsx`、`#/achievements`)

```
実績                                    〔図鑑へ〕〔ホームへ〕
12 / 50 (24%)  ▓▓▓▓▓▓░░░░░░░░░░

〔取得済み 12〕〔未取得 38〕〔すべて 50〕        ← セグメント(単一選択)
〔すべて〕〔到達〕〔世界〕〔雰囲気〕〔判定〕〔運命〕〔生還〕〔軌跡〕  ← カテゴリ(単一選択)

到達 ────────────────────────────
[◎] 初めての結末                     2026-07-12
    初めてエンディングに到達した
[◎] 三つの結末                       2026-07-21
    3つのエンディングに到達した
[◌] 十の結末                            3 / 10
    10のエンディングに到達した     ▓▓▓░░░░░░░
...
```

- セグメントとカテゴリはローカルstate。URLには持たせない(戻る操作で実績一覧そのものを離れる方が自然なため)
- 絞り込みの結果が0件のカテゴリは、セクションごと出さない
- セクション内の並びはティア昇順 → カタログ定義順。銅から順に埋まっていくのが見えるようにする
- 件数バッジ(取得済み12 / 未取得38)はカテゴリ絞り込みの影響を受けない全体の数にする。絞り込むたびに数字が動くと「全体でいくつか」が読めなくなるため

`listEndings()` は図鑑と同じくマウント時に1回呼ぶ。取得の重複は許容する(実績は記録から導出するだけで、共有できる状態を作ると両画面の再取得タイミングを揃える必要が出る)。

### ルーティング

`src/router/useHashRoute.js` に `#/achievements` を追加する。`parseHash` の戻り値へ `achievements: boolean` を足し、`navigateToAchievements()` を既存の `navigateToEndings` と同じ流儀で置く。`src/App.jsx` はこのルートで `AchievementList` を描画する。

ホームからの直接の導線は作らない。実績は図鑑の中身であって並列の機能ではないため、入口は図鑑の「すべて見る →」に一本化する。実績一覧には「図鑑へ」を置いて往復できるようにする。

## 6. 非対象

- 実績取得時の通知・トースト・演出(既存設計の非対象を引き継ぐ)
- ユーザー定義の実績
- 全ユーザーの取得率にもとづくレア度表示(集計バッチと保存先が要る。ティアはカタログの静的な値で代用する)
- 実績の共有・公開ページへの掲載

## テスト

**`src/engine/achievementCatalog.test.js`(新規)**
- `id` の重複がないこと
- すべてのエントリが正当な `category` と `tier`(1〜3)を持つこと
- `AchievementIcon` が知らない `icon` キーを参照していないこと
- `progress` を持つエントリは `target` も持ち、逆も成り立つこと

カタログが50件に増えると1件ずつの目視が効かなくなるため、形の検査を機械に任せる。

**`src/engine/achievements.test.js`(拡充)**
- 既存の境界値テストは残す
- 各カテゴリの代表的な境界値: 記録9本と10本 / 同一世界2本と3本 / 雰囲気7種と8種 / 通算判定99回と100回 / 成功率0.79と0.8 / 正気度が `max*0.3` の前後 / 連続2日と3日 / 同日1本と2本
- `progress.current` が `target` を超えないこと
- `progress` を持たない実績は `progress: null` を返すこと
- `earnedAt` が条件を最初に満たした記録のものであること(既存)
- 空配列で50件すべてが未獲得で返ること
- 日付系はタイムゾーンを固定して書く(`TZ=Asia/Tokyo` 前提の固定ミリ秒か、テスト内でローカル時刻から `Date` を組む)

**コンポーネント**
- `AchievementRow.test.jsx`: 取得済みは獲得日、進捗ありは `3 / 10`、それ以外は「未取得」/ ティアごとの枠の出し分け
- `AchievementProgressBar.test.jsx`: `aria-valuenow` と割合

**画面**
- `src/screens/AchievementList.test.jsx`: 全50件が出ること / セグメントで取得済み・未取得が切り替わること / カテゴリ絞り込みで他のセクションが消えること / 0件のセクションが出ないこと / 件数バッジがカテゴリ絞り込みで変わらないこと / 図鑑へ戻れること
- `src/screens/EndingGallery.test.jsx`(改修): 上部が `12 / 50` のサマリーになり全件のベタ並べが無いこと / 直近の獲得が3件までで `earnedAt` 降順であること / 取得済み0件の文言 / 「すべて見る」で遷移すること
- `src/router/useHashRoute.test.jsx`: `#/achievements` の解析と `navigateToAchievements`

既存のテストは全て通す。`server/routes/characters.test.js` の「lists characters scoped to world and kind」は並列実行時にタイムアウトする既知のフレーク。

## ドキュメント更新

- `docs/05-ui-ux.md`: 実績一覧画面、図鑑上部のサマリー、`#/achievements` の導線
- `docs/02-data-model.md`: カタログエントリと `evaluateAchievements` の戻り値の形
- `docs/superpowers/specs/2026-07-25-ending-collection-design.md`: 5章の実績表と6章の画面構成図から本書へ参照を張り、8件時代の記述を差し替える
- `docs/08-feature-ideas.md`: 実績の項に規模と一覧画面の存在を反映
