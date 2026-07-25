# 設計: スターターコンテンツ(公式サンプル世界観・シナリオ・キャラクター)

作成 2026-07-25。初回アクセス時にライブラリが空で、かつアプリの概念モデルも掴めない問題への対処。

## 1. 問題

初回アクセス時のガイドが存在しない。

- `Home` に空状態の導線が無い。ログイン直後は「新しい物語」「素材ライブラリ」「公開ギャラリー」の3ボタンだけが並ぶ
- `Setup` の空状態は事実を告げるだけで次の行動を示さない(「素材ライブラリにWorldがまだ無い。」`src/screens/Setup.jsx`、Scenario/PCも同様)
- 公開ギャラリーは実装済みだが、**投稿がゼロなら空**。初回ユーザーが最初に触れる面として機能していない

ここには**別々の2つの問題**が混ざっている。

- **(a) 素材が空** — 遊び始めるのに World・Scenario・PC を自分で書く必要がある
- **(b) 概念モデルが不明** — World > Scenario、World > Character、Ruleset は独立、Session = それらの組み合わせ(02-data-model.md 3.5節)という階層が、画面から読み取れない

**(b) は素材を置くだけでは解決しない。** ライブラリに素材が並んでいても「どれをどう組み合わせると何が起きるのか」は分からない。そこで本設計は、素材の収録と**「1クリックで最後まで揃った状態にする」導線**をセットで作る。ユーザーは組み上がった結果を見てから逆算で構造を理解する。

## 2. 権利方針

**そのまま名前を出して収録できるのはパブリックドメイン作品だけ。**

| 検討対象 | 判断 |
|---|---|
| クトゥルフ神話(ラヴクラフト) | ✅ 収録する。作品はPD。ただし "Call of Cthulhu" は Chaosium の商標なのでゲーム名としては名乗らない |
| フェイルーン | ❌ Wizards of the Coast の著作物。SRD 5.1(CC BY 4.0)に世界設定は含まれない |
| 中つ国 | ❌ トールキン財団。保護期間内 |
| サイバーパンク(Cyberpunk RED / Shadowrun / ニューロマンサー) | ❌ すべて権利者あり。ジャンル自体が1980年代生まれのため、PDの有名世界観は存在しない |
| バローズ火星シリーズ | ✅ 小説本文はPD。ただし「バルスーム」「ジョン・カーター」は Edgar Rice Burroughs, Inc. の登録商標 → **パック名に使わず「死にゆく火星」とし、出典を明記する。登場人物も原作キャラを使わずオリジナルにする** |
| H.G.ウェルズ『宇宙戦争』 | ✅ PD |
| 北欧神話・日本の伝承 | ✅ PD |

フェイルーン枠・中つ国枠・サイバーパンク枠は、**同ジャンルのオリジナル世界観**で埋める。ジャンルの手触り(剣と魔法の辺境、神話叙事詩、ネオンと義体)の再現には権利上の制約は無い。

PD由来のパックは `pack.json` の `source` に出典を持ち、UI のパックカードに「H.G.ウェルズ『宇宙戦争』に基づく」のように表示する。オリジナルのパックは `source: null`。

## 3. 収録する7パック

各パックは **world.md ＋ scenario.md ＋ PC 2体 ＋ NPC 2体** で構成する。PCは必ず「戦う/動く役」と「調べる役」の対にして、初見でも役割分担が読み取れるようにする。

Ruleset は `coc7e`×2 / `dnd5e`×1 / `simple`×2 / `gurps`×2 に散らす。判定式アダプタの違い(CoC7e風だけが `hard` / `extreme` とSANを持つ。02-data-model.md 3.6節)を、パックを遊び比べるだけで体感できるようにするため。

| packId | タイトル | 出自 | ruleset | moods |
|---|---|---|---|---|
| `arkham-1920s` | アーカム 1920s | PD(ラヴクラフト) | `coc7e` | ホラー / ミステリー |
| `alden-frontier` | アルデン辺境領 | オリジナル | `dnd5e` | ファンタジー / 冒険 |
| `midgard-eve` | ミッドガルド 終焉前夜 | PD(北欧神話) | `simple` | ファンタジー / シリアス |
| `hyakki-yagyo` | 百鬼夜行 — 平安京 | PD(日本の伝承) | `coc7e` | ホラー / ファンタジー |
| `neo-yokohama` | 臨海特区ネオヨコハマ | オリジナル | `gurps` | SF / シリアス |
| `dying-mars` | 死にゆく火星 | PD(バローズ火星シリーズ) | `simple` | SF / 冒険 |
| `war-of-the-worlds` | 宇宙戦争 — 1898年ロンドン | PD(H.G.ウェルズ) | `gurps` | SF / ホラー |

`moods` は `server/storage/moods.js` の8語彙(`ホラー`/`冒険`/`ミステリー`/`日常`/`SF`/`ファンタジー`/`コメディ`/`シリアス`)からのみ選ぶ。

### 3.1 各パックの中身

**`arkham-1920s` アーカム 1920s**
1920年代ニューイングランド。ミスカトニック大学を擁する古い港町。魔女裁判の記憶と禁書、外なるものの気配。
- シナリオ「丘の上の写真館」— 廃業した写真館の遺品整理で見つかった乾板に、写っているはずのないものが写り込んでいる
- PC: `howard-kane` ハワード・ケイン(民俗学講師 / 調べる役) / `mabel-thorne` メイベル・ソーン(私立探偵 / 動く役)
- NPC: `elias-witcham` エリアス・ウィッチャム(写真館の元主人、行方不明) / `agnes-reed` アグネス・リード(大学図書館司書)

**`alden-frontier` アルデン辺境領**
王国の最果て。街道が途切れた先に古代帝国の遺構が沈む。冒険者ギルドと多種族の交易町。
- シナリオ「涸れた井戸の底」— 村の井戸が一夜で涸れた。底に沈んでいるのは帝国期の封印石
- PC: `gareth-dowe` ガレス・ダウ(流れの傭兵剣士 / 戦う役) / `ilmina-vess` イルミナ・ヴェス(放浪の呪印術士 / 調べる役)
- NPC: `tobias` 村長トバイアス / `serika` 井戸守りセリカ(GM専用情報: 封印の番人)

**`midgard-eve` ミッドガルド 終焉前夜**
予言されたラグナロクの直前。神も人も終わりを知りながら日々を生きている。
- シナリオ「ヘイムダルの角笛」— 角笛が盗まれた。鳴らないラグナロクは、来ないのではなく遅れて来る
- PC: `skadi-hjalmsdottir` スカジ(誓いを破った戦士 / 戦う役) / `grima` グリーマ(予言を視るヴォルヴァ / 調べる役)
- NPC: `the-messenger` 名を告げぬ使者 / `one-eyed-traveler` 隻眼の旅人

**`hyakki-yagyo` 百鬼夜行 — 平安京**
平安京。夜になると大路を異形の行列が渡る。陰陽寮、検非違使、羅城門。
- シナリオ「朱雀大路の百鬼」— 百鬼夜行の列に、生きた人間が一人混ざって歩いている
- PC: `abe-shigure` 安倍時雨(陰陽寮の見習い / 調べる役) / `fujiwara-tsunechika` 藤原恒近(検非違使の下級官人 / 戦う役)
- NPC: `rajomon-no-rojin` 羅城門の老爺 / `kita-no-tai-no-hime` 北の対の姫

**`neo-yokohama` 臨海特区ネオヨコハマ**
202X年、自治権を持つ埋立特区。企業が行政を代行し、義体化が日常になった街。
- シナリオ「義体の記憶」— 闇市に流れた中古の義手が、持ち主でない誰かの記憶を再生する
- PC: `kuroda` クロダ(フリーの潜入屋 / 動く役) / `doc-shiba` ドク・シバ(元企業医のリップドク / 調べる役)
- NPC: `mimi` 情報屋ミミ / `hunt` 特区警備ハント

**`dying-mars` 死にゆく火星**
海が干上がり大気の薄れゆく火星。運河都市と飛空艇、複数の異種族。E.R.バローズの火星シリーズに基づくオリジナル記述。
- シナリオ「運河都市の囚われ人」— 墜ちた飛空艇の乗員が、司政官の館に「客人」として留め置かれている
- PC: `john-everett` ジョン・エヴァレット(地球から来た剣士 / 戦う役) / `tara-solan` タラ・ソラン(赤色火星人の航行士 / 調べる役)
- NPC: `orvak` オルヴァク(緑色火星人の族長) / `zedar` ゼダール(運河都市の司政官)

**`war-of-the-worlds` 宇宙戦争 — 1898年ロンドン**
火星の円筒が落ち、三脚機と黒煙が南イングランドを覆う。ウェルズ『宇宙戦争』の世界。
- シナリオ「ウォーキングからの脱出」— 三脚機に包囲された町から、生きて川まで辿り着く
- PC: `hargreaves` E.M.ハーグリーヴズ(科学ジャーナリスト / 調べる役) / `samuel-bly` 伍長サミュエル・ブライ(王立砲兵 / 戦う役)
- NPC: `nathan` 牧師ネイサン / `the-artilleryman` 工兵の男

### 3.2 文書の書式

`world.md` と `scenario.md` は 02-data-model.md 3.2節の書式に従う。特にシナリオは `## シナリオ概要` と `## GM専用情報` を必ず分ける。**サンプルは初回ユーザーが読む「お手本」でもある**ため、この分割を全パックで徹底する。

キャラクターシートは 02-data-model.md 3.1節に従い、`goal` と `bonds` を必ず書く(パース対象であり、推奨記法の実例にもなる)。NPCシートの `goal` は GM専用情報として書く。

## 4. 既存実装から来る制約(重要)

設計にあたり、既存コードの2つの制約を確認した。**どちらも本設計では回避し、既存の検証ロジックには手を入れない。**

### 4.1 キャラクター名はASCIIに限られる

`server/routes/characters.js` は `router.param('name', idParamGuard)` を持ち、`isValidId` が `^[A-Za-z0-9._-]+$` を要求する(`server/routes/validateId.js`)。`name` はそのままファイルパスになる(`characterDocPath`)ため、この制限はパストラバーサル対策として妥当であり、緩めない。

日本語名をそのまま `name` にすると、インポートは `saveCharacter` を直接呼ぶため保存自体は通るが、その後の `GET /worlds/:worldId/characters/:kind/:name` が 400 を返す**壊れた状態**になる。

**対応**: 保存上の `name` はローマ字スラッグ(`abe-shigure`)にし、日本語表記はシート本文の1行目(`PC名: 安倍時雨`)に持つ。3.1節の識別子はこの規約に従っている。素材ライブラリのPC一覧にはローマ字が表示されるが、シートを開けば日本語名が読める。

### 4.2 日本語タイトルの World は `slugify` で `untitled` に潰れる

`importWorld` は `findAvailable(slugify(pub.title), …)` で新しい worldId を決める(`server/storage/importLibrary.js`)。`slugify` は `[^a-z0-9-]` を全除去するため(`server/storage/slugify.js`)、`slugify('百鬼夜行 — 平安京')` は `'untitled'`、`slugify('アーカム 1920s')` は `'1920s'` になる。7パックを順に取り込むと worldId が `untitled` / `untitled-2` / `untitled-3` … と並ぶ。

World の表示は `title` メタを使うので画面上の実害は小さいが、スターターパックは**必ず7つとも取り込まれうる**ので、ここは潰さない。

**対応**: `importWorld` に任意の第5引数 `{ preferredId }` を追加する。指定があればそれを `findAvailable` の基底に使い、無ければ従来どおり `slugify(pub.title)` を使う(後方互換)。スターター一括インポートは `preferredId` に `packId` を渡す。結果として worldId は `arkham-1920s` / `hyakki-yagyo` のようになる。

## 5. コンテンツの正本と配布

`server/data/` は `.gitignore` 済み。よって素材の正本はリポジトリ管理のディレクトリに置き、シードでストアへ流し込む。

### 5.1 ディレクトリ構造

```
content/starters/
  index.json                 パックIDの表示順(配列)
  arkham-1920s/
    pack.json
    world.md
    scenario.md
    pc/howard-kane.md
    pc/mabel-thorne.md
    npc/elias-witcham.md
    npc/agnes-reed.md
  alden-frontier/
    …
```

`pack.json`:
```json
{
  "id": "arkham-1920s",
  "title": "アーカム 1920s",
  "tagline": "禁書と魔女裁判の記憶が残る港町。写り込んではならないものが、乾板に写る。",
  "source": "H.P.ラヴクラフトのクトゥルフ神話作品に基づく(パブリックドメイン)",
  "moods": ["ホラー", "ミステリー"],
  "recommendedRuleset": "coc7e",
  "scenario": { "id": "photo-studio-on-the-hill", "title": "丘の上の写真館" },
  "pc": ["howard-kane", "mabel-thorne"],
  "npc": ["elias-witcham", "agnes-reed"]
}
```

`source` はPD作品に基づくパックのみ文字列、オリジナルは `null`。

### 5.2 シード: `scripts/seedStarters.js`

公式ユーザー名義でライブラリに保存し、既存の公開機構でギャラリーへ出す。

1. 公式ユーザーのプロフィール `users/usr_official/profile` を用意する(表示名「公式サンプル」)。**`auth/identities/*` は作らない** — 誰もこのアカウントにログインできないシステムアカウントとして扱う
2. 各パックについて `saveWorld` / `saveScenario` / `saveCharacter`(`server/storage/*Library.js`)で `usr_official` のライブラリへ保存する。worldId は `packId` をそのまま使う
3. `publishWorld` / `publishScenario` / `publishCharacter`(`server/storage/shareLibrary.js`)で公開する
4. 得られた `publicId` を集めてマニフェストを `public/starters` キーへ書く

**冪等性**: `resolvePublicId` が `publishWorldMapKey` 等のマッピングを見て既存 `publicId` を再利用するため(`shareLibrary.js`)、再実行しても `publicId` は変わらない。素材の文面を直して再シードすれば、公開済みの内容だけが更新される。既にインポート済みのユーザーの手元は変わらない(コピーであるため。これは既存インポート機構の意図した挙動)。

**実行タイミング**: `server/index.js` 末尾の `NODE_ENV !== 'test'` ブロックで、`listen` の前に await する。`server/data/` が消える環境でも起動時に復元されるようにするため。`npm run seed` でも単体実行できるようにする。`createApp` 自体はシードしない(テストへの副作用を避け、シードを明示的に呼べるようにする)。

### 5.3 マニフェスト(`public/starters`)

```json
{
  "packs": [
    {
      "packId": "arkham-1920s",
      "title": "アーカム 1920s",
      "tagline": "…",
      "source": "…",
      "moods": ["ホラー", "ミステリー"],
      "recommendedRuleset": "coc7e",
      "scenarioTitle": "丘の上の写真館",
      "worldPublicId": "pub_…",
      "scenarioPublicId": "pub_…",
      "pcPublicIds": ["pub_…", "pub_…"],
      "npcPublicIds": ["pub_…", "pub_…"]
    }
  ],
  "seededAt": 1721900000000
}
```

`publicId` は `pub_${randomBytes(6)}` で採番される(`shareLibrary.js`)ため、クライアント側の静的定数表では持てない。シードの出力として持つ必要がある。

## 6. API

追加は2本。専用ルーターは作らず、既存ルーターに置く。

### 6.1 `GET /api/starters` — 認証不要

`createPublicContentRouter`(`server/routes/publicContent.js`)に追加する。公開ギャラリーと同じく `requireAuth` の手前にマウントされているため、未ログインでも一覧を見られる。

`public/starters` をそのまま返す。未シードなら `{ packs: [], seededAt: null }` を返す(404 にしない — 「まだ無い」は UI にとって正常系)。

### 6.2 `POST /api/starters/:packId/import` — 認証必須

`createImportsRouter`(`server/routes/imports.js`)に追加する。`requireAuth` の後段にあるので `req.userId` が使える。

処理は既存の `importWorld` / `importScenario` / `importCharacter` を順に呼ぶだけの薄い層:

1. マニフェストから `packId` を引く。無ければ 404
2. `importWorld(…, worldPublicId, { preferredId: packId })` → `worldId`
3. `importScenario(…, scenarioPublicId, worldId)`
4. `importCharacter` を `pcPublicIds` / `npcPublicIds` の全件について実行
5. `201` で `{ world, scenario, pcs: [meta…], npcs: [meta…] }` を返す

**1エンドポイントにまとめる理由**: クライアントから既存 `/api/import/*` を7回叩くと、途中で失敗したとき「Worldだけできて中身が無い」半端な状態が残り、リトライすると `findAvailable` により `arkham-1920s-2` が生える。サーバー側の1呼び出しにすれば、失敗時にエラーを1つ返すだけで済む。

**中途失敗の扱い**: ロールバックはしない。ストアはトランザクションを持たず、既存のインポート系も同様に部分適用を許容している。失敗時は 500 を返し、UI は「素材ライブラリを確認してください」と案内する。再実行すると `-2` 付きの重複が生えるが、ユーザーがライブラリから削除できる。**トランザクションの導入は本設計のスコープ外。**

**再インポートは重複を許す**: 同じパックを2回取り込むと `arkham-1920s` と `arkham-1920s-2` ができる。既存インポート機構の一貫した挙動なので変えない。ただし UI 側で「取り込み済み」を示す(7.1節)。

## 7. UI

### 7.1 共通コンポーネント `StarterPackList`(`src/components/share/StarterPackList.jsx`)

Home と Gallery の両方が同じカードを出すので、取得・描画・インポート実行を1つのコンポーネントに閉じる。

- props: `onImported(starterContext)` のみ
- 内部で `GET /api/starters` を取得し、カード(タイトル / `tagline` / mood バッジ / 推奨Ruleset名 / `source` があれば小さく)を並べる
- 「この冒険を始める」で `POST /api/starters/:packId/import` を呼び、返ってきた `world` / `scenario` から `starterContext` を組み立てて `onImported` に渡す
- インポート中はそのカードのボタンだけ `disabled` にし「取り込み中…」を表示する。失敗時はそのカードの下にエラーを出す(他のカードは操作可能なまま)
- 取得に失敗した場合・`packs` が空の場合は**何も描画しない**(`null` を返す)

「取得できなければ何も出さない」を親ではなくこのコンポーネントの責務にすることで、Home も Gallery も「置くだけ」で済み、スターター未シードの環境でも両画面が壊れない。

### 7.2 Home の空状態(`src/screens/Home.jsx`)

`sessions.length === 0` かつログイン済みのとき、既存のボタン列の上に「はじめての冒険を選ぶ」見出しと `StarterPackList` を置く。`onImported` は Setup への遷移コールバックを呼ぶ。

セッションを1つでも持つユーザーには出さない。2周目以降は Gallery から取りに行く(7.4節)。

### 7.3 Setup の事前入力(`src/screens/Setup.jsx`)

既存の `campaignContext` prop と同じ前例に倣い、`starterContext` prop を追加する。

```js
starterContext = {
  world,        // 一括インポートAPIが返した World メタ { id, title, moods, updatedAt, raw }
  scenario,     // 同 Scenario メタ { id, worldId, title, recommendedRuleset, moods, updatedAt, raw }
  rulesetId,    // パックの recommendedRuleset
}
```

`world` / `scenario` はAPIの戻り値をそのまま渡す。個別のフィールドに分解しないのは、`selectedWorld.moods`(Play画面の配色に使われる)のように Setup が既に読んでいる項目を落とさないため。

初期状態を World=選択済み / Scenario=選択済み / Ruleset=推奨値 にし、**`step` を 3(PC選択)から開始する**。

**PCまで自動選択しない理由**: 2体のうちどちらを演じるかは、初回ユーザーが最初に下すべき楽しい選択であり、同時に「PCは選ぶものだ」「PCはWorldに属している」という構造を最短で伝える。ここを飛ばすと(b)の学習効果が落ちる。「戻る」でWorld/Scenario/Rulesetの各ステップを遡れるので、何が組み合わさっているかも確認できる。

`campaignContext` と `starterContext` は同時に渡らない(前者はホームの「次の章へ」、後者は空状態からのみ)。`App.jsx` では両方を state に持ち、Setup を離れるときに両方 `null` に戻す。

### 7.4 Gallery に「おすすめ」タブ(`src/screens/Gallery.jsx`)

`PUBLIC_TABS`(`src/constants/publicContent.js`)の先頭に `starters` タブを足す。セッションを持つユーザーが2つ目以降の世界観を取りに来る場所。

このタブだけは `PublicItemList` / `PublicItemDetail` を使わず `StarterPackList` を描画する。公開アイテムの一覧・詳細ではなく「まとめて取り込む単位」であり、`/api/public/:type` の `TYPES`(`worlds`/`characters`/`scenarios`/`novels`)にも属さないため。Gallery 側は `tab === 'starters'` のときだけ分岐し、既存の一覧/詳細の状態機械には触れない。

`onImported` は Gallery を閉じて Setup へ遷移させる。

### 7.5 Setup 空状態の文言

`src/screens/Setup.jsx` の3箇所(「素材ライブラリにWorldがまだ無い。」「このWorldにはScenarioがまだ無い。」「このWorldにはPCがまだ無い。」)に、次の行動を書き足す。World の空状態には「公開ギャラリーのおすすめから取り込めます」と添える。

## 8. テスト

隣接ファイル規約(`foo.js` ↔ `foo.test.js`)に従う。

**コンテンツの検証**(`scripts/seedStarters.test.js`) — 素材は手書きなので、機械で守れる不変条件を全パックに対して確認する:
- `content/starters/index.json` の全 `packId` にディレクトリと `pack.json` が存在する
- `pack.json` の `recommendedRuleset` が `simple`/`coc7e`/`dnd5e`/`gurps` のいずれか
- `moods` が `MOODS` の語彙のみ
- `pc` / `npc` の識別子が `isValidId` を通る(4.1節の制約)
- `pc` は2件、`npc` は2件、参照する `.md` が全て存在し空でない
- `scenario.md` が `## シナリオ概要` と `## GM専用情報` の両方を含む(3.2節)
- `pc/*.md` が `goal:` と `bonds:` を含む

**シード**(`scripts/seedStarters.test.js`) — インメモリストアに対して:
- 1回実行するとマニフェストが書かれ、全パックの `publicId` が埋まる
- 2回実行しても `publicId` が変わらない(冪等)
- 素材の文面を変えて再実行すると公開ドキュメントの内容だけが更新される

**API**(`server/routes/publicContent.test.js` / `server/routes/imports.test.js`) — supertest で:
- 未シードで `GET /api/starters` が `{ packs: [], seededAt: null }` を返す
- 未ログインでも `GET /api/starters` が 200
- `POST /api/starters/:packId/import` が World/Scenario/PC2/NPC2 を作り 201 を返す
- 未知の `packId` で 404
- 未ログインで 401
- 取り込まれた worldId が `packId` に一致する(4.2節)
- 2回実行すると `packId-2` ができる

**importWorld の preferredId**(`server/storage/importLibrary.test.js`):
- `preferredId` 指定時はそれが基底になる
- 未指定時は従来どおり `slugify(title)` が基底になる(後方互換)

**UI**(`src/components/share/StarterPackList.test.jsx` / `src/screens/Home.test.jsx` / `Setup.test.jsx` / `Gallery.test.jsx`):
- `StarterPackList` が `packs` を取得してカードを描画する
- `GET /api/starters` が失敗したとき、および `packs` が空のとき、`StarterPackList` が何も描画しない
- 「この冒険を始める」がインポートを呼び、成功時に `onImported` を `starterContext` 付きで呼ぶ
- インポート失敗時にそのカードにエラーが出て、他のカードのボタンは押せるままである
- Home は `sessions` が空のときだけスターターセクションを出し、1件でもあれば出さない
- `GET /api/starters` が失敗しても Home が既存ボタンを描画し続ける
- Gallery の `starters` タブが `StarterPackList` を描画し、他タブの一覧/詳細の挙動が変わらない
- `starterContext` を渡した Setup が step 3(PC選択)から始まり、World/Scenario/Ruleset が選択済みである

## 9. ドキュメント更新

- `docs/05-ui-ux.md` — 起動直後のUIにスターターセクションを追記
- `docs/06-content-generation.md` — スターターコンテンツの正本と配布(5章)を追記
- `docs/02-data-model.md` — `content/starters/` と `public/starters` をストレージ構造に追記。4.1節・4.2節の制約も記録する

## 10. スコープ外

- **キャンペーン用の連作サンプル** — 各パックはシナリオ1本のみ。「次の章へ」は既存機構でユーザー自身が続ける
- **カスタムRulesetのサンプル** — ビルトイン4種で足りる
- **サンプル小説(novels)の公開** — ギャラリーの `novels` タブは実プレイの産物で埋まるべきで、作り物を混ぜない
- **インポートのトランザクション化** — 6.2節の通り部分適用を許容する
- **既存の `slugify` / `isValidId` の変更** — 4章の通り回避する
- **多言語対応** — 素材は日本語のみ
