# UI/UX方針

## 7. UI/UX方針

- ログ表示: プレイヤー発言とGMの地の文を視覚的に区別(吹き出し位置・フォント・色)
- 入力: 自由記述欄 + AI提示の選択肢ボタン併用(自由記述の判定トリガー誤検出リスクを選択肢で補完)
- キャラシートパネル: **未実装**。`Play.jsx`はタイトル・現在シーン・成長ポイント(`{growthUnit}: {xp}`)・ログ・入力欄のみで、PCシートを常時表示するサイドパネルは無い。キャラシートを見るには素材ライブラリのCharacterタブに移動する必要がある。HPはデータモデルにも無く、追跡対象ではない。
- ローディング: API応答待ち中はGMが「考えている」ような待機表現(`Play.jsx`の「GMが考えている…」表示)
- ダイスロール演出(実装済み 2026-07-24): 新着ターンの判定スタンプ(`src/components/ui/Stamp.jsx`)は「d100の数字回転(約0.8秒)→出目停止→押印」の3段階アニメーションで表示される。degree別に配色が変わる(会心=真鍮、成功=朱、失敗=薄い朱、大失敗=暗い赤+揺れ)。セッション再開時の過去ログは即時表示。`prefers-reduced-motion`環境や`matchMedia`非対応環境ではアニメーションせず即時表示(`theme.js`の`motionAllowed()`)。
- タイプライター表示(実装済み 2026-07-24): 新着GMターンの地の文は一文字ずつ表示され(`src/hooks/useTypewriter.js`)、表示中に本文クリックで全文スキップできる。速度は`state.tension_level`連動(high=15ms/字、medium=25、low=35)。タイプ完了まで選択肢ボタン・入力欄は無効化される。reduced-motion時は即時表示。
- 雰囲気連動配色(実装済み 2026-07-24): セッション作成時にWorld(優先)/Scenarioの`moods`が`session.moods`へ継承され、Play画面の背景色が雰囲気に応じて変わる(`theme.js`の`moodTheme()`、8種+既定)。文字色は可読性のため変更しない。moodsの無いセッションは従来配色。
- シーン挿絵(実装済み 2026-07-24): GMログエントリ毎に、地の文の上に生成挿絵を表示する(`src/screens/Play.jsx` + `src/api/sceneImageClient.js`)。未生成エントリの「この場面を描く」ボタンで手動生成、ヘッダの「挿絵を自動生成」トグルでシーン変化時に自動生成する。Geminiキー未設定(`GET /api/config` の `imageGen:false`)時は挿絵UIを一切出さない。生成失敗・日次上限は当該エントリにインラインエラー表示。登場人物の見た目はセッション専用レジストリ(`session.appearances`)で横断的に一貫させる(06-content-generation.md参照)。


## 13. 演出方針(テンション制御)

「楽しさ」はGMの演出品質に直結するため、プロンプトで明文化する。

### 13.1 GMペルソナ指示(system prompt例)
- 緊迫場面: 短文を畳み掛ける、五感情報を絞り緊張感のみ描写
- 平穏場面: ゆったりした文体、五感描写を増やし世界観を掘る
- 選択の重み: プレイヤーが重大な選択をする場面は、選択前に一拍置く描写を入れる

### 13.2 クライマックス制御
`tension_level`(low/medium/high)は実装済み(2026-07-24): GMが毎ターン`state_update.tension_level`で場面の緊張度を返し(`src/api/prompts.js`のスキーマ・システムプロンプト指示)、`state.tension_level`に保存されて次ターンのユーザーコンテンツ(「テンション: high」等)としてGMへ渡る。UI側ではタイプライター表示の速度に反映される(7章参照)。旧セッションや不正値はmedium扱い(`src/api/turnResult.js`)。

シナリオMarkdownの章構成に `climax_marker: true` 等のフラグを持たせ、GMがその章に向けてテンションを段階的に上げるよう指示する方式は未実装の将来案として残る。

## 14. 起動直後のUI

> 「システムを知らなくても遊べる」の「システム」は本アプリの内部実装(region/category分割・parsed.jsonキャッシュ等)を指す。TRPGのルールシステム(CoC/D&D5e等)は別の話であり、Ruleset選択ではルール名をそのまま表示してよい(プレイヤーが意図して選ぶ情報のため)。
>
> ただし実装では、素材ライブラリのWorldタブでregion/categoryへの分割結果をユーザーが直接閲覧・編集できる(14.3節)。これは「プレイ中の一般プレイヤーに内部用語を見せない」方針とは別に、素材を作り込みたいユーザー(GM/素材管理者)向けに分割結果を可視化・調整できるようにする設計判断であり、region/categoryという語自体が完全に隠蔽されているわけではない。

### 14.1 ホーム画面(`src/screens/Home.jsx`)
```
┌─────────────────────────────────────┐
│  [新規プレイ] [素材ライブラリ]           │
│                                        │
│  続きから再開                          │
│   ・セッションタイトル / シーン: ... / 12手│
│     直近のGM行の抜粋(60字程度)  [小説化] │
│   ・...                                │
└─────────────────────────────────────┘
```
セッション一覧カードにはタイトル・現在シーン名・手数(turn_count)・直近のGM発言1行程度のサマリを表示、カードのクリックで再開する。各カードに「小説化」ボタンがあり、`POST /api/sessions/:id/novelize`でAIにログを小説化させてから`GET /api/sessions/:id/novel`で取得し、Markdownファイルとしてダウンロードする(古いログのまま生成された場合は鮮度警告を表示)。挿絵のあるセッションにはさらに「挿絵付き」ボタンが表示され、`GET /api/sessions/:id/novel/illustrated`からbase64画像埋め込みの自己完結Markdownをダウンロードできる(2026-07-24追加、06-content-generation.md 10.5節参照)。世界観名・キャンペーン名の表示や章単位の進行表示は無い。

### 14.2 新規プレイ作成フロー(`src/screens/Setup.jsx`)
5ステップのウィザード(ステップインジケータに「1. 世界観 / 2. シナリオ / 3. ルール / 4. PC / 5. 確認」を表示):
```
1. 世界観   「既存を選ぶ」「新規に用意する」「空欄のまま進める」の3択。
             新規はテキスト貼り付け or ファイル/フォルダ取り込みに対応し、
             ゲーム開始時に自動でregion/categoryへ分割・ライブラリ保存される。
             空欄のままならAIが世界観を自由に構築する。
2. シナリオ  Worldを選んでいれば「既存を選ぶ」も選択可。「自分で用意する」
             (貼り付け/ファイル取り込み)、「AIに作ってもらう」(ジャンル要望入力)。
3. ルール    ビルトイン4種+ユーザー作成のカスタムRulesetから選ぶ。
             Scenarioに`recommendedRuleset`があれば自動選択されるが変更可。
4. PC        Worldを選んでいれば「既存を選ぶ」も選択可。「自由記述で新規作成」
             (goal/bonds推奨)。
5. 確認      セッション名を入力してゲーム開始。
```
World/Scenario/PCとも「既存を選ぶ」はWorldを選択している場合のみ有効(Worldが空欄・新規の間は無効化される)。新規作成した世界観・シナリオ・PCはWorldが確定していればゲーム開始時に素材ライブラリへ自動保存される(保存に失敗してもセッション開始自体は続行し、警告のみ表示)。

### 14.3 素材ライブラリ画面(`src/screens/Library.jsx`)
World/Character(PC・NPC)/Scenario/Rulesetの4タブ(**Campaignタブは無い**。Campaign自体が未実装、02-data-model.md 3.5節参照)。各タブで閲覧・編集・削除・新規作成が可能。

- Worldタブ: World本文に加え、region/category(地域/カテゴリ)への分割結果を一覧表示し、個別に内容の閲覧・編集ができる(内部実装用語だが、素材管理者向けに公開されている)。World・Character(PC/NPC)・Scenarioの各タブには「公開」/「公開中(再公開)」/「公開解除」ボタンがあり(`src/screens/library/WorldTab.jsx`・`CharacterTab.jsx`・`ScenarioTab.jsx`)、`shareClient.js`経由で`POST`/`DELETE /api/publish/*`を呼ぶ(Phase 2で追加。公開状態は`GET /api/publish/*`で取得しバッジ表示する)。
- World・Scenarioの編集フォームには「雰囲気」欄があり(`WorldTab.jsx`・`ScenarioTab.jsx`、Field label「雰囲気」hint「複数選択可。」)、固定8種(`src/constants/moods.js`の`MOODS`)をチップボタンとして横並び表示し、クリックでトグル選択する複数選択UI(`aria-pressed`で選択状態を示す)。一覧側にも雰囲気タグを設定済みの場合のみ`moods.join(' / ')`で表示する。Worldタブは分割結果の再生成(reimport)後に`moods`が引き継がれないため、再分割の保存時に本文とは別に`PUT /api/worlds/:id`へ`moods`を明示的に送り直す実装になっている。編集した雰囲気は保存時に`PUT /api/worlds/:id`・`PUT /api/worlds/:worldId/scenarios/:id`へ含まれ、公開時にそのまま公開メタへコピーされる(公開ギャラリーの雰囲気チップ絞り込みに使われる。[04-persistence.md](04-persistence.md)参照)。
- Characterタブ: PC/NPCの切り替えタブを持つ。NPCタブのみ`revealed`状態(開示済み/未開示)の一覧表示を含む(GM専用情報の管理を明示化するため)。
- Scenarioタブ・Rulesetタブ: それぞれ本文/hint・growthUnit等を編集できる(Rulesetタブに公開機能は無い)。

### 14.4 公開ギャラリー画面(`src/screens/Gallery.jsx`)

Phase 2で追加。ホーム画面から遷移し、「小説」「世界観」「キャラクター」「シナリオ」の4タブでユーザーが公開した素材を横断的に閲覧できる。

- 一覧は各タブ共通の`PublicItemList`コンポーネント(`src/components/share/PublicItemList.jsx`)が担い、`GET /api/public/:type`(`src/api/shareClient.js`の`listPublic`)を呼んで公開日時降順のカードを表示する(タイトル・公開者名・公開日、キャラクターはPC/NPC種別、シナリオは推奨ルールも併記)。**未ログインでも閲覧できる**(公開読み取りAPIは認証不要)。
- 検索・絞り込みUI: 上部にタイトル・作者名の自由文字列検索ボックスがあり、入力から300ms(デバウンス)後に実効クエリへ反映される(連続入力中は再取得しない)。その下にworlds/scenariosタブのみ雰囲気チップ(`MOODS`固定8種)が並び、クリックで複数選択のトグル(選択分はOR条件で絞り込み)。scenariosタブのみさらに推奨ルールの単一選択ドロップダウン(`RULESETS`+「すべて」)がある。worlds/scenarios以外(characters/novels)のタブではチップ・ドロップダウンとも非表示。
- タブ切り替え・検索語(デバウンス後)・雰囲気チップ・ルールセット・(ユーザーページの場合)`ownerId`のいずれかが変わるたびoffset=0で一覧を取り直し、既存の表示を置き換える。カード末尾に**「もっと見る」**ボタンがあり(APIレスポンスの`hasMore`がtrueの間だけ表示)、クリックで次ページ(`offset + 20`件目以降)を末尾に追記取得する。取得中は「読み込み中…」表示になりボタンは無効化される。取得リクエストには連番ガード(`reqRef`)があり、フィルタ変更等で新しい取得が始まった場合、古い取得の応答が後から返っても無視される(stale response guard)。
- 空状態は2パターンに分かれる: 検索語・雰囲気・ルールセットのいずれも指定していない状態で0件なら「まだ公開されたものがありません」、何か条件を指定した状態で0件なら「条件に合う公開物がありません」+「条件をクリア」ボタン(検索語・雰囲気・ルールセットを一括リセット)を表示する。
- カードをクリックすると詳細表示(`GET /api/public/:type/:publicId`)に切り替わり、本文(worldsはregion/category本文も含む)を表示する。
- 詳細表示では(小説タブを除き)「ライブラリに追加」ボタンからインポートできる(`importWorld`/`importCharacter`/`importScenario`、`POST /api/import/*`)。World以外はインポート先Worldを選ぶピッカーダイアログを表示する(`listWorlds`でユーザー自身のWorld一覧を取得)。**未ログイン時はボタンの代わりに「追加にはログインが必要です」という案内を表示**する(インポートAPIは認証必須のため)。

素材の「公開」自体はこの画面ではなく、ホーム画面(14.1節、セッション=小説)と素材ライブラリ画面(14.3節、World/Character/Scenario)の各素材カードに公開/解除ボタンとして実装されている。ホーム画面には公開ギャラリーへの導線ボタンもある(`Home.jsx`)。

### 14.5 ユーザーページ画面(`src/screens/UserPage.jsx`、Phase 3で追加)

URLのハッシュ`#/u/{userId}`で表示される、特定ユーザーの公開プロフィール+公開素材一覧画面。`src/router/useHashRoute.js`の`useHashRoute()`がハッシュを監視し、`App.jsx`は`routeUserId`が非nullの間、通常の画面遷移(home/setup/library/gallery/play)を素通りしてこのページのみを表示する(通常画面のstateは保持されたまま裏に残る)。未ログインでも認証不要APIのみで完結するため閲覧でき、URLをそのまま共有・ブックマークできる。

- 遷移経路: 公開ギャラリー画面(14.4節)のカードに表示される公開者名をクリックすると`navigateToUser(ownerId)`(`useHashRoute.js`)が呼ばれ`#/u/{ownerId}`に遷移する。
- 表示内容: `GET /api/users/:userId`(`displayName`・`avatarUrl`・`bio`)を取得し、上部にアバター(未設定時はイニシャル1文字のプレースホルダ)・表示名・`bio`(未設定なら非表示)を表示する。下の「小説」「世界観」「キャラクター」「シナリオ」の4タブ(タブ構成はGallery画面と共通)の公開素材一覧は、Galleryと同じ`PublicItemList`コンポーネントに`ownerId={userId}`を渡して描画する(検索ボックス・雰囲気チップ・ルールセットドロップダウン・「もっと見る」・空状態の出し分けもGalleryと同一挙動、14.4節参照)。タブごとに`GET /api/public/:type?ownerId={userId}`を呼んでそのユーザーの公開素材のみに絞り込む。**旧`GET /api/users/:userId/public`一括APIは廃止済み**で、現在はこの`ownerId`絞り込みに一本化されている。一覧のカードをクリックすると`GET /api/public/:type/:publicId`で詳細を取得し、Gallery画面と共通の`PublicItemDetail`コンポーネント(`src/components/share/PublicItemDetail.jsx`)で本文を表示する。
- ユーザーが存在しない場合(`404`)は「ユーザーが見つかりません」、その他の取得失敗時はエラーメッセージを表示し、いずれも「← 戻る」ボタン(`clearHash()`でハッシュを除去し通常画面に戻る)を出す。
- `bio`はAuthBar(`src/components/auth/AuthBar.jsx`)のプロフィール編集フォームから自分で設定でき、`PATCH /api/me`経由で保存した内容が自分のユーザーページにも反映される。
