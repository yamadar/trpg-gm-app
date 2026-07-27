# コンテンツ生成・世界観活用

### 3.2.1 大規模世界観の分割・選択的注入
フォーゴトン・レルム規模の世界観は1ファイル全文注入だと毎ターンのコストが破綻する。地域・カテゴリ単位に分割し、毎ターン全部ではなく必要な範囲だけ注入する。

**分割構造**
```
/worlds/{world_id}/
  world.md                    目次+要約(各region/categoryの一行概要とリンクのみ)
  regions/{region}.md         地域ごとの詳細
  categories/{topic}.md       魔法体系/宗教/歴史/種族/組織など
```

**注入ルール(未実装。現状は下記「実装の現状」を参照)**
- `world.md`(目次)は常時注入(軽量なので問題なし)
- 現在地域(`state.current_region`)の詳細ファイルのみ都度注入
- シナリオの各章に`relevant_docs`(参照すべきregion/categoryファイル一覧)を著者がタグ付け → コード側で決定的にファイルを絞り込む。AIの裁量に「必要な情報を選ばせる」設計にはしない

**フォールバック(未タグ領域への遷移、未実装)**
PCが想定外の地域へ移動した場合、`world.md`目次に対するキーワード一致で該当region/categoryを動的に追加注入する案。目次自体が小さいため単純なキーワードマッチで足りる想定。真に巨大(用語集数百項目規模)な世界観では埋め込み検索(RAG)への発展をPhase 3候補として留める。

**実装の現状**: `state.current_region`・`relevant_docs`・キーワードマッチによる選択的注入はいずれも未実装。実際の`buildSystemPrompt`(`src/api/prompts.js`)は`session.world.summary`(=分割時に生成された`world.md`相当の要約1本)を毎ターンそのままsystem promptに注入するのみで、region/categoryファイルを個別に選んで注入する経路は無い。region/category分割自体(下記3.2.2)は実装済みで、素材ライブラリのWorldタブから内容を閲覧・編集できるが、GMプロンプトへの注入は行われていない。

### 3.2.2 大規模世界観のインポートパイプライン
ユーザーはregion/category分割を意識する必要はない。長大な世界観テキストをそのまま貼る/アップロードするだけで、分割はシステムが裏で行う。

**フロー**
1. ユーザーが世界観テキストを生のまま入力(構造化不要、コピペでよい)
2. 「インポートモード」の一度限りAPI呼び出し(11章のシナリオ自動生成、3.4節の構造化パイプラインと同じ「生成モード/進行モード分離」パターン)
   - system: 「以下のテキストをregion/categoryに分割し、world.md(目次)+regions/*.md+categories/*.mdのスキーマで出力せよ」。各region/categoryは英数字IDとは別にUI表示用の自然な`title`を必須出力し、本文は実改行を使うMarkdownとする
3. 生成物を`/worlds/{world_id}/`配下に保存(3.5節の構造に従う)。モデルが`\n`を二重エスケープした場合は保存前に実改行へ正規化し、region/categoryの`{ id, title }`メタも本文と併せて保存する
4. ユーザーには分割結果の**目次のみ**確認表示(「◯◯地方、△△の歴史、□□の魔法体系…に分かれました」程度)。全文レビューは要求しない
5. 気になる分割があれば自由記述で修正依頼→再度インポートAPI呼び出しで微調整(原本自体は保持、再分割のみ)

**UI上の扱い**: 「region」「category」「relevant_docs」等の内部用語はユーザーに見せない。14.2の新規プレイ作成フロー内「World新規作成」ステップで「世界観の資料を貼ってください(長文可)」の一入力で完結させ、分割処理は自動発火・非表示にする。

## 10.5 場面挿絵の生成(実装済み 2026-07-24、サブプロジェクト1)

環境変数`GEMINI_IMAGE_MODEL`で指定したGoogle Geminiモデル(`server/imageProvider.js`)でPlay画面のGMログエントリ毎に挿絵を生成する。

- **プロンプト構築**(`server/imagePrompt.js`): 地の文(先頭400字)+ `session.moods` の画風キーワード(8種)+ 登場人物の見た目から組み立てる。人物がいる場合は、場面の出来事に反応した動作・重心・手足・視線・表情を状況と緊張度に合わせ、場面が要求しない棒立ち・記念写真風ポーズ・無表情を避けるよう明示する。
- **登場人物の一貫性**: `server/sceneAnalysis.js` がGeminiテキストモデル(構造化出力)で地の文から登場人物を特定し、未登録者の見た目を生成する。結果はセッション専用の**見た目レジストリ** `session.appearances`(名前→見た目)に蓄積され、以降の挿絵プロンプトに差し込まれてキャラの見た目が一貫する。PCシートに見た目の記述があればそれを優先。
  - `present_names` は**その場に実際に居合わせ挿絵に描かれる人物のみ**。話題に上るだけ・伝聞・回想など不在の人物は含めず、挿絵プロンプトの「登場人物」にも載らない。`present_names` に無い名前の `new_appearances` はサーバ側でも捨てる(ポートレート生成の無駄消費を防ぐ)。
  - `description` は**見た目だけ**を記録し、挿絵ごとに変化しやすい種族(人間も明記)・肌色・髪型と髪色・服装の種類と主要色・年齢層・体格・目の色・装身具や身体的特徴を必須化する。武器を持つ人物は種類・素材・形状・色、持たない人物は「武器なし」まで固定する。性格・役割・関係・登場有無などの物語情報は書かせない(画像生成プロンプトが汚れるため)。**シナリオ本文は書き換えない**(公開・インポートされる共有素材のため)。解析はプレイヤー可視の地の文のみを入力とし、失敗しても挿絵生成は止めない(見た目条件なしで続行)。
- **保存・配信**: 画像バイトは `server/storage/imageStore.js`(バイナリストア)がファイル保存し、`GET /api/sessions/:id/images/:imageId` で `image/png` 配信。セッションJSONには `log[i].image.imageId` 参照のみを持たせ、IndexedDBとユーザー別サーバーセッションへrevision付きで同期する(競合処理は04-persistence.md参照)。
- **設定・制限**: 画像生成はenv `GEMINI_IMAGE_API_KEY`(未設定なら `GET /api/config` が `imageGen:false` を返しUIごと無効化)と`GEMINI_IMAGE_MODEL`を使う。登場人物解析は別系統の`GEMINI_TEXT_API_KEY`/`GEMINI_TEXT_MODEL`を使う。日次上限は`LIMIT_IMAGES_PER_DAY`(既定30、`usage` 機構の `images` 種別。挿絵1回=解析1+画像1の計2 upstream呼び出しを1ユニットとして計上)。
- **挿絵付き小説化(サブプロジェクト2、実装済み 2026-07-24)**: novelize時に挿絵を持つGMエントリの位置へ `〈挿絵N〉` マーカーを埋め込み(`server/novelMarkers.js`)、モデルに「対応場面の切れ目に行独立で残せ」と指示。`GET /api/sessions/:id/novel/illustrated` がマーカーをbase64 data URIの画像に置換した自己完結HTMLを返す(`server/illustratedNovel.js`。本文に現れなかった画像は末尾「挿絵」節へ救済)。AI生成タイトル・本文は先にHTMLエスケープし、限定的なMarkdown(小見出し・太字・段落)だけをHTML要素へ変換する。画像・印刷用CSSを単一ファイルへ内包し、意味のない連番キャプション(`挿絵N`)は表示せず画像の代替テキストも空にする。プレーン `GET /novel` はマーカー除去済みを返す。公開時はマーカー入り本文と対応画像を公開領域へ独立スナップショットとして複製し、公開詳細画面がマーカー位置へ画像を差し込む。本文に残らなかった画像も末尾へ表示する。Home画面は挿絵があり小説が生成済みのセッションのみ「挿絵付きでDL」ボタンを表示し、`${title}-挿絵付き.html`としてダウンロードする(2026-07-27にMarkdownからHTMLへ変更。10.6節・05-ui-ux.md 14.1節参照)。
- **キャラポートレート+参照画像一貫性(サブプロジェクト3、実装済み 2026-07-24)**: シーン解析で見つかった初登場キャラのポートレート(バストアップ・無地背景、`server/imagePrompt.js` の `buildPortraitPrompt`)を自動生成し、見た目レジストリ項目に `imageId` を保存する。以降のシーン挿絵生成では、登場キャラのポートレートを**参照画像(最大3枚)**としてGeminiへ渡し(`server/imageProvider.js` の `referenceImages`→`inlineData`)、プロンプトに「参照画像の人物の外見を厳密に維持」と付記して外見を強く一貫させる。ポートレートの生成失敗・日次上限超過は非致命で、テキストのみの一貫性へフォールバックする。1.1(場面挿絵の生成)は全サブプロジェクト完了。ライブラリCharacterタブでのポートレート表示は未実装の将来候補。

## 10.6 小説化(novelize)の非同期実行(実装済み 2026-07-25)

Home画面のカードで「小説化する」を押すと、`POST /api/sessions/:id/novelize`は生成を待たず`202 { status: 'running' }`を即座に返す(以前は同期処理で応答を待っており、長いセッションでは`AbortSignal.timeout(120000)`超過で失敗していた)。実際のAI呼び出しはサーバー側`server/novelJobs.js`がバックグラウンドで行い、上流タイムアウトは応答を待たなくなった分120秒→300秒に延長された。進行状態はデータストアの`novelJob`レコード(`users/{userId}/sessions/{sessionId}/novelJob`。02-data-model.md 3.5節参照)へ永続化される。

生成本文はMarkdownとし、場面転換・時間や場所の変化・物語上の区切りへ適切な粒度の`##`小見出しを付ける。物語の鍵になる固有名詞・手掛かり・アイテム・決定的な言葉は重要箇所だけ`**太字**`にする。継続リクエストにも同じ書式維持を指示するため、長文が分割生成されても構造を保つ。

人物の語尾・口癖・方言・一人称・語彙・話し方は、トランスクリプト内の話者本人の台詞だけから判断する。PL行の口調は主人公だけに属し、NPCや地の文へ転用しない。複数人物の会話では台詞ごとに話者を再確認し、口調設定を読み取れない人物は標準口調にする。ログ内に既に人物間の口調混入があっても同じ人物の他の台詞と照合して修正し、小説全体へ広げない。この分離規則は初回生成のsystem promptと打ち切り後の継続指示の両方へ入る。

Home画面はマウント時に`GET /api/novel-jobs`(全セッション分のジョブ状態を1リクエストで返す新規エンドポイント)を取得し、`running`のジョブが1件でもある間だけ5秒間隔でポーリングする(全て終われば停止)。サーバー側が真実源になるため、リロード・画面遷移・別タブを跨いでも「小説化中…」の表示が保たれ、生成中に再度押しても二重起動として扱われる(利用枠を消費せず現在のジョブ状態をそのまま`202`で返す)。

**生成完了時に自動ダウンロードは行わない**(タブを閉じていた場合に取り逃す、意図しないタイミングでファイルが落ちるのを避けるため)。ユーザーはカード操作層の「小説をDL」/「挿絵付きでDL」ボタンを押して改めて取得する(ダウンロード自体は既存の`GET /sessions/:id/novel`・`GET /sessions/:id/novel/illustrated`のままで変更なし。05-ui-ux.md 14.1節参照)。

**固まらないための異常系処理**: `running`のまま読み取られたジョブは、以下のいずれかに該当すると読み取り時点で`error`として扱われる(バックグラウンドの監視プロセスは持たず、読み取り時の遅延評価)。
- サーバープロセスが再起動しジョブを開始した`bootId`と現在のプロセスの`bootId`が食い違う場合
- ジョブ開始から`NOVEL_JOB_TIMEOUT_MS`(30分)を超えても完了記録が無い場合。継続リクエスト(10.6.1節)の最悪ケース(初回+継続4回がそれぞれ上流タイムアウト300秒ぎりぎりまでかかる)を包含する必要があるため、上流タイムアウトと継続上限から算出している

この判定は`GET /api/novel-jobs`と`POST /novelize`の二重起動防止チェックの両方が共有する同じ純粋関数で行われる。利用枠(`usage`の`novelize`カウント)は生成が失敗しても戻らない(現行仕様どおり、変更なし)。

### 10.6.1 出力打ち切りの継続リクエスト(実装済み 2026-07-25)

セッションのターン数に上限は無いため、単発リクエストでは長いログの小説化が`max_tokens`で途中打ち切りになる。以前はこの場合に生成済み本文を破棄して`error`に倒していた(利用枠を消費して何も残らない)。

現在は`server/novelGeneration.js`の`generateNovel()`が継続ループを持つ。Geminiの`finishReason: MAX_TOKENS`は互換層で`stop_reason: max_tokens`へ変換される。それまでの出力を**中間の**modelターンとして積み、末尾をuserターンの継続指示(「切れた箇所の直後から、繰り返さず、前置き無しで書き続けよ」)にして再送する。返った本文は区切り文字なしで連結する。

- **末尾modelターンのプレフィルは使わない**。`[user(トランスクリプト), model(既出力), user(継続指示)]`という完了済み会話履歴として送り、常に新しいuser指示から続行させる
- `max_tokens`は12000→16000。非ストリーミングで安全に受け取れる範囲で継続回数を減らす
- Gemini 3.xは思考トークンも出力上限を消費するため、`thinking_level: minimal`を指定して小説本文用の枠を確保する。未対応の旧モデルには送らない
- 継続上限は`NOVELIZE_MAX_CONTINUATIONS`(4回、初回と合わせて最大5リクエスト)。モデルが終われない場合にコストが際限なく膨らむのを防ぐ頭打ち
- トランスクリプトは継続のたびに先頭へ同じ内容で再送する。Gemini 2.5以降のimplicit cachingが共通prefixを認識しやすい配置にする
- 継続の途中で上流がエラーを返した場合・本文が空だった場合は、部分的な結果を保存せず従来どおり`error`に倒す(再実行で解決しうるため)

**上限に達しても完結しなかった場合**は、そこまでの本文を保存して`status`は`done`とし、小説メタ(`users/{userId}/sessions/{sessionId}/novel`)に`truncated: true`を記録する。`GET /api/novel-jobs`が`truncated`を返し、Home画面のカードが「小説が出力上限に達したため、末尾が欠けている可能性があります。」と警告する(`stale`警告と同じ表示形式・同時表示しうる)。この変更以前に生成された小説はメタに`truncated`を持たないが、完結扱い(`false`)になるためマイグレーションは不要。

ジョブのライフサイクル管理(状態の永続化・二重起動抑止・タイムアウト判定)は`server/novelJobs.js`、プロンプト構築と上流呼び出し・継続ループは`server/novelGeneration.js`と責務を分けている。

## 10.7 エンディング命名(実装済み 2026-07-25)

Play画面で「この物語を終える」を確定すると(05-ui-ux.md 7章)、`POST /api/sessions/:id/ending`が`server/endingNaming.js`の`nameEnding()`でGeminiテキストモデルを1回呼び、GMに結末を命名させる。

**入力**(GM専用情報は渡さない、既存方針を踏襲): `state.history_summary`(物語要約)、PC設定(`session.pc.raw`/`goal`/`bonds`)、結末付近の地の文4件(直近のGMログエントリ、`CLOSING_NARRATION_COUNT`)。シナリオ本文・GM専用情報・フラグ等は入力に含めない。

**出力**: structured outputsで`{ ending_title, summary }`を得る。クライアント互換形式の`output_config.format.schema`は`server/textProvider.js`がGeminiの`generationConfig.responseJsonSchema`へ変換する。`ending_title`は20字程度の日本語タイトル、`summary`は2〜3文の総括。system promptはゲーム的表現(フラグのキー名・数値・選択肢)や物語内で明かされなかった秘密を書かないよう指示する。

命名は短い構造化出力だが、Gemini 3.xの思考トークンも出力上限を消費する。`max_tokens`を4096とし、Gemini 3.xでは`thinking_level: minimal`を指定して、JSON本文生成前の`max_tokens`打ち切りを防ぐ。旧モデルには未対応パラメータを送らない。

AI呼び出しは既存の`messages`日次利用枠に相乗りする(専用の新種別は作らない)。失敗時(上流エラー・不正なJSON・空タイトル)はエンディングの記録自体を作らず`502`を返し、Play画面・Home画面は再試行ボタンを出す(04-persistence.md・05-ui-ux.md参照)。ダイス統計(`stats`)自体はここでは生成せず、クライアントが`summarizeRolls`(`src/engine/rollStats.js`)で計算しリクエストボディに含めて送る(02-data-model.md 3.6節参照)。

## 11. シナリオ自動生成モード

「用意されたシナリオがない」場合、ジャンル要望(冒険/推理/ホラー等)からAIにシナリオを生成させる。実装は`src/api/session.js`の`generateScenario`。

### 11.1 フロー(実装)
1. ユーザーがSetupのシナリオステップで「AIに作ってもらう」を選び、ジャンル・要望を自由記述で入力(「自分で用意する」で本文を空のまま進めた場合も、開始時に自由なジャンルでの自動生成にフォールバックする)
2. `handleStart`内で進行モードとは別の1回限りのAPIコールを発行
   - system: ジャンル要望+世界観要約(`worldSummary`)+PC設定を埋め込み、「シナリオ概要/GM専用情報/章構成」の見出し構成でMarkdownを出力するよう指示。PCのgoal/bondsに関連する引き(hook)を導入部に必ず含めるよう指示する
3. 生成結果はそのままセッションの`scenario.raw`として使われ、Worldが確定していれば素材ライブラリにも保存される
4. 生成後は通常の進行フローに合流する

**未実装の項目**: ジャンルテンプレート表(11.2、ジャンルごとの構造ヒント)は無く、ユーザーが入力した生ジャンル文字列(自由記述)をそのままプロンプトに渡すのみ。生成結果をユーザーに一度提示して微調整依頼を挟むプレビューステップも無く、生成即座にセッションが開始される。

### 11.2 ジャンルテンプレート例(未実装・将来案)
| ジャンル | 構造ヒント |
|---|---|
| 冒険 | 目的地・道中の障害・最終目標・報酬 |
| 推理 | 事件・容疑者リスト・手掛かり配置・ミスリード・真相 |
| ホラー | 不安の種・段階的な情報開示・脱出/対抗手段 |
| 群像劇 | NPC間関係図・PCの立場・複数エンディング条件 |

現状はこの表のような構造化テンプレートを使わず、ジャンル文字列をそのままAIに渡して自由に生成させている。将来この構造ヒントで生成品質を上げる案として残す。

## 12. 世界観・キャラ設定の活用方針

state注入だけでは「参照されるが活かされない」問題が起きやすい。対策と実装状況:

- **goal/bonds抽出は実装済み**: ライブラリ紐づき(Worldに保存済み)のPCについて、`getOrParseCharacter`(`src/api/characterSheetCache.js`)がキャラシートの`raw`ハッシュをチェックし、未パース or 変更検知時のみAI呼び出しで`goal`/`bonds`をJSON抽出して`parsed`にキャッシュする(`src/api/characterSheetParse.js`)。Setup画面がセッション開始時にこれを呼び出し、`session.pc.goal`/`session.pc.bonds`として埋め込む。
- system promptへの反映(`buildSystemPrompt`, `src/api/prompts.js`): goal/bondsが抽出済みなら「PCの目標・因縁(抽出済み)」という専用セクションで明示するが、絡める指示自体は**緩い**もの:「可能な範囲でPCのgoal/bondsや世界観の特徴を絡めること」。**「最低1つ」を必須とする指示や、数ターンごとの定期リマインドは実装されていない**(演出方針の一文として毎ターン同じトーンで添えられるのみ)。
- 世界観の固有名詞・設定を「全文」system promptに注入する処理は無い。実際に注入されるのは`session.world.summary`という要約1本のみで、region/categoryファイルの全文や個別の固有名詞を優先配置する仕組みは無い(3.2.1節の「実装の現状」と同一の結論)。世界観を全文注入するとコストが破綻するため要約注入に統一されている、という単一の設計方針として理解すること。

## 13. スターターコンテンツ(実装済み2026-07-25)

素材の正本は`content/starters/{packId}/`にMarkdown + `pack.json`で置く(`server/data/`はgitignore対象のため、配布物はリポジトリ側に置く必要がある)。`content/starters/index.json`にパックidの配列があり、現在7パック: `arkham-1920s`(アーカム 1920s・coc7e)、`alden-frontier`(アルデン辺境領・dnd5e)、`midgard-eve`(ミッドガルド 終焉前夜・simple)、`hyakki-yagyo`(百鬼夜行 — 平安京・coc7e)、`neo-yokohama`(臨海特区ネオヨコハマ・gurps)、`dying-mars`(死にゆく火星・simple)、`war-of-the-worlds`(宇宙戦争 — 1898年ロンドン・gurps)。

`server/starters/loadPacks.js`の`loadStarterPacks()`が読み込みと検証を行う:
- `pack.json`: `id`がディレクトリ名と一致・`title`/`tagline`が非空文字列・`source`は文字列かnull・`moods`が`MOODS`語彙(`server/storage/moods.js`)の非空配列・`recommendedRuleset`がビルトイン4種(simple/coc7e/dnd5e/gurps)のいずれか・`scenario.id`が有効なid・`scenario.title`が非空文字列
- `world.md`・`scenario.md`は存在し非空。`scenario.md`は`## シナリオ概要`と`## GM専用情報`の両見出しを含むこと
- `pc`・`npc`はそれぞれちょうど2体。各名前は**`server/routes/validateId.js`の`isValidId`をそのままimportして再利用**した検証(`^[A-Za-z0-9._-]+$`。独自の正規表現を再実装すると本物のバリデータと食い違う恐れがあるため)で、ローマ字スラッグのみ許可し重複も禁止。`pc/{name}.md`は`goal:`と`bonds:`を両方含むこと(日本語の`PC名:`等の表示名はMarkdown本文側に書き、`name`自体はファイルパスにもなるASCIIスラッグに保つ。02-data-model.md「キャラクターの`name`はASCIIに限られる」参照)

いずれかの検証に失敗すると`loadStarterPacks()`が例外を投げ、シード自体が失敗する仕組みで、壊れたパックが気づかれずに公開される事態を防ぐ。シードは`server/index.js`のサーバー起動時と、`npm run seed`(`scripts/seedStarters.js`)の両方から同じ`seedStarters()`が呼ばれる。

`server/starters/seed.js`の`seedStarters()`は、まず公式ユーザー`usr_official`(表示名「公式サンプル」)を用意する。このアカウントは`auth/identities/*`を持たないためログイン不可だが、公開ギャラリーの作者リンク(`GET /api/users/:userId`)からは通常のユーザーと同様に参照できる。各パックをこのユーザーのライブラリへ`saveWorld`/`saveScenario`/`saveCharacter`で保存したうえで、既存の`publishWorld`/`publishScenario`/`publishCharacter`(`server/storage/shareLibrary.js`)でそのまま公開する。採番された`publicId`一式はマニフェスト`public/starters`(`starterManifestKey()`、`GET /api/starters`が返す)に集約される。

シードは冪等: `shareLibrary.js`の`resolvePublicId`が公開元→`publicId`のマッピング(`users/{userId}/publish/...`)を見て、既にマッピングがあればその`publicId`を再利用し、無ければ新規採番する(通常の再公開と同じ仕組み)。そのため、素材の文面を直して再シードすると公開済みの内容だけが更新され、既にインポート済みのユーザーの手元(独立コピー)は変わらない。

パックの一括インポート(`POST /api/starters/:packId/import`、`server/routes/imports.js`)はサーバー側の1呼び出しにまとめてある。クライアントから`/api/import/*`を個別に(World→Scenario→PC×2→NPC×2の計6回)叩く実装だと、途中で失敗したときに「Worldだけできて中身が無い」状態が残り、リトライで`-2`付きの重複IDが生えてしまうため。`importWorld`には`{ preferredId: pack.packId }`を渡し、日本語タイトルが`slugify`で`untitled`に潰れる問題を避けて意味のあるWorld idにする(02-data-model.md「`importWorld`の`preferredId`」参照)。

**権利方針**: 実在の世界観を下敷きにしたパックはパブリックドメイン作品のみ(クトゥルフ神話・北欧神話・日本の伝承・E.R.バローズの火星シリーズ・H.G.ウェルズ『宇宙戦争』)。フォーゴトン・レルム系やサイバーパンク作品のような権利者のいる既存世界観は使わず、同ジャンルのオリジナル世界観(アルデン辺境領・臨海特区ネオヨコハマ)で代替している。PD由来のパックは`pack.json`の`source`に出典を持ち、`StarterPackList`のカード下部にそのまま表示される。バローズ作品由来のパックは「バルスーム」「ジョン・カーター」等の商標を避け、パック名を「死にゆく火星」とし登場人物もオリジナルにしている。
