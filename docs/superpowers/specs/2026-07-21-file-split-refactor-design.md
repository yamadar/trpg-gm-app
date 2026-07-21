# TRPG GM App: ファイル分割・アーキテクチャ移行 設計ドキュメント

## 1. 背景・目的

現在このプロジェクトは以下の2点が「1ファイル」構成になっている:

- `trpg-gm-app.jsx`(1223行): Claude.ai Artifacts向けの単一ファイルReactコンポーネント。`window.storage`という、Artifactサンドボックスが提供する永続化APIに依存している。Anthropic APIへの`fetch`にもAPIキーヘッダーが付与されておらず、Artifact実行環境がキー注入を代行している前提のコード。
- `docs/trpg_gm_app_design.md`(405行): 設計ドキュメント全体が1ファイル。

今後の開発をしやすくするため、適切な粒度でファイルを分割する。あわせて、Claude Artifacts依存(`window.storage`、キー無し直接fetch)を解消し、通常のWebアプリ(フロントエンド+バックエンド)として動作する構成に移行する。

## 2. デプロイ形態の変更

**Before**: Claude.ai Artifacts上で動く単一ファイルReactコンポーネント。`window.storage`でセッション永続化、Anthropic APIへの直接fetch(キー注入はサンドボックス任せ)。

**After**: 通常のWebアプリケーション。
- フロントエンド: Vite + React によるSPA(複数ファイルに分割)
- バックエンド: 小さなExpressサーバーがAnthropic APIへのプロキシと、サーバー側永続化の抽象化を担う
- ビルドツールなしのESモジュール分割ではなく、Viteによるビルドを導入する(通常のWebアプリとして配信するため)

## 3. プロジェクト構成(トップレベル)

モノレポ的なworkspaces分割はせず、単一`package.json`でフロントエンド(`src/`)とバックエンド(`server/`)を同居させる。`concurrently`パッケージで`npm run dev`が両方を起動する。

```
/
  package.json         # scripts: dev(client+server同時起動), build, start
  vite.config.js         # devサーバーで /api を server(Express)へプロキシ(CORS回避)
  index.html
  .env.example            # ANTHROPIC_API_KEY=
  .gitignore
  src/                  # フロントエンド(詳細は4節)
  server/               # バックエンド(詳細は5節)
  docs/                 # 設計ドキュメント(詳細は6節)
```

## 4. フロントエンド(`src/`)のモジュール分割

現行の`trpg-gm-app.jsx`を機能単位で分割する。分割元の対応関係も明記する。

```
src/
  main.jsx                    # エントリポイント(ReactDOM.createRoot)
  App.jsx                     # ルートコンポーネント(view切替: home/setup/play)。元: 「ルートコンポーネント」節
  theme.js                    # COLORS, F_DISPLAY/F_BODY/F_MONO, FONT_LINK, useGoogleFonts。元: 「デザイントークン」節
  data/
    rulesets.js                 # RULESETS定義
  engine/
    dice.js                      # rollD100, evaluateRoll
  api/
    client.js                     # callClaude(自前バックエンドの /api/messages を叩く形に変更), extractText, extractToolUse, parseJsonLoose
    prompts.js                     # ROLL_TOOL, buildSystemPrompt
    session.js                      # summarizeWorld, generateScenario, takeTurn(進行モードのオーケストレーション)
  storage/
    index.js                         # 公開インターフェース: isStorageAvailable(), listSessions(), getSession(id), saveSession(session)
    indexedDbStore.js                  # IndexedDB実装(`idb`パッケージ使用)
  utils/
    fileImport.js                       # htmlToText, readFilesAsEntries, combineEntries
  components/
    ui/
      Card.jsx
      Button.jsx
      Field.jsx
      Stamp.jsx
    FileImportRow.jsx
  screens/
    Home.jsx
    Setup.jsx
    Play.jsx
```

### 4.1 storage/ の設計(クライアント側永続化)

`window.storage`をIndexedDBへ置き換える。localStorageではなく最初からIndexedDBを採用する理由:
- localStorageとsessionStorageは容量上限がほぼ同じ(数MB程度)であり、sessionStorageに容量面の優位性はない
- sessionStorageはタブを閉じると消えるため、「続きから再開」機能と両立しない
- 将来的に画像等のバイナリデータを扱う計画があり、IndexedDBならBlobを直接扱え容量上限も大きい

`idb`パッケージ(軽量なIndexedDBラッパー)を使用し、`sessions`という1つのobject store(キー: session id)にセッション全体を保存する。

**簡素化点**: 現行コードは`sessions_index`という別キーで一覧用メタデータを手動同期していたが、IndexedDBでは`sessions`ストアに対して`getAll()`すれば全セッションを取得できるため、`sessions_index`の仕組みは廃止する。`listSessions()`は`getAll()`結果を`updatedAt`でソートして返す。

`storage/index.js`が唯一の公開インターフェースで、画面コンポーネントは`indexedDbStore.js`を直接importしない。将来IndexedDB実装を差し替える場合もこのインターフェースは変えない。

### 4.2 api/client.js の変更点

`callClaude`は現状`https://api.anthropic.com/v1/messages`へ直接fetchしているが、自前バックエンドの`/api/messages`へPOSTする形に変更する(5節参照)。リクエストボディの形式(`model`/`system`/`messages`/`tools`)は変えず、宛先とAPIキー注入の責務のみサーバー側へ移す。

## 5. バックエンド(`server/`)

```
server/
  index.js                  # Express起動、ミドルウェア設定、ルートマウント
  routes/
    messages.js                # POST /api/messages → Anthropic APIへプロキシ。ANTHROPIC_API_KEYは環境変数から読み込みリクエストヘッダーに付与
    sessions.js                  # GET /api/sessions, GET /api/sessions/:id, PUT /api/sessions/:id, POST /api/sessions/:id/novelize
  storage/
    dataStore.js                 # JSON読み書きの抽象インターフェース + ローカルファイルシステム実装。将来Redis等への差し替えを想定したインターフェース設計
    textStore.js                  # Markdown/プレーンテキスト読み書きの抽象インターフェース + ローカルファイルシステム実装。将来S3等クラウドストレージへの差し替えを想定
    paths.js                       # docs/02-data-model.md のフォルダ構造(worlds/{id}/…, sessions/{id}/… 等)に対応するキー/パス生成関数
  data/                        # 実データ格納先。.gitignore対象、初回起動時に自動作成
```

### 5.1 messages.js(Anthropic APIプロキシ)

フロントエンドの`callClaude`からのリクエストをそのまま受け取り、`ANTHROPIC_API_KEY`(サーバー環境変数)をヘッダーに付与してAnthropic APIへ転送し、レスポンスをそのまま返す。ロジックは持たない薄いプロキシ。

### 5.2 dataStore.js / textStore.js(保存層の抽象化)

- `dataStore`: `get(key)`, `set(key, value)`, `list(prefix)`, `delete(key)` を持つインターフェース。値はJSONとして扱う。ローカル実装はファイルシステム上のJSONファイルとして永続化する。将来Redis化する場合、このインターフェースを満たす別実装に差し替えるだけで済む。
- `textStore`: `read(path)`, `write(path, content)`, `list(prefix)` を持つインターフェース。値は生テキスト(Markdown等)として扱う。ローカル実装はファイルシステム上のテキストファイルとして永続化する。将来S3等クラウドストレージ化する場合も同様に差し替え可能。

### 5.3 World/Character/Scenario/Rulesetの扱い(今回のスコープ)

`paths.js`にこれらのエンティティ用キー生成関数(`worldPath(id)`, `scenarioPath(worldId, scenarioId)`等、docs/02-data-model.mdのフォルダ構造に対応)を用意し、`dataStore`/`textStore`の抽象化が実際にこれらのエンティティ構造に対応できることを示す。ただし、**実際の保存API配線・フロントエンドからの呼び出しは今回のスコープに含めない**。現行のSetupウィザードは既存World/PC等を選択するUIを持たず毎回新規テキスト入力する作りであり(docs 14.2で構想されている「既存選択」フローは未実装)、その変更は別タスクとする。

### 5.4 Sessionsの扱い(今回のスコープ)

`dataStore`を使った最小限のAPI(`GET /api/sessions`, `GET /api/sessions/:id`, `PUT /api/sessions/:id`)を実装し、「サーバー側保存を可能にする」という要求を満たす。ただし、**フロントエンド(Play画面)からこのAPIへ自動的に同期する配線は今回のスコープに含めない**。フロントエンドは引き続きIndexedDBのみで完結する。自動バックアップの要否・同期タイミング・競合解決方針は別途設計が必要なため、次のタスクとして切り出す。

### 5.5 小説化(novelization)プレースホルダー

`POST /api/sessions/:id/novelize`エンドポイントを用意するが、実装は`501 Not Implemented`を返すのみとする。docs記載のPhase 2項目であり、実際のAI生成ロジックは今回実装しない。

## 6. 設計ドキュメント(`docs/`)の分割

`docs/trpg_gm_app_design.md`(405行)を関心事ごとに分割する。

```
docs/
  README.md                  # 概要・目的・スコープ(現1章)+ 各docへのリンク索引
  01-architecture.md         # アーキテクチャ図・設計原則(現2章)。Webアプリ移行後の構成図に更新
  02-data-model.md           # 全データモデル(現3章: キャラシート/世界観/state/ストレージ構造)
  03-gm-logic.md             # ターン処理フロー・判定システム(現4,5章)
  04-persistence.md          # 状態管理・永続化(現6章)。IndexedDB(クライアント)+ dataStore/textStore抽象化(サーバー)の内容に更新
  05-ui-ux.md                # UI/UX方針・演出方針・起動UI(現7,13,14章)
  06-content-generation.md   # シナリオ自動生成・世界観分割/インポート・活用方針(現3.2.1-3.2.2, 11, 12章)
  07-risks-and-roadmap.md    # リスク一覧・実装フェーズ・設計決定事項(現8,9,10章)
```

各ファイルの内容は原則として元の章をそのまま移すが、04-persistence.mdと01-architecture.mdは今回のアーキテクチャ変更(IndexedDB化、バックエンドプロキシ追加)を反映して更新する。他の章は内容の変更を伴わない純粋な分割とする。

## 7. 依存パッケージ(新規追加想定)

- フロントエンド: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `idb`
- バックエンド: `express`, `dotenv`
- 共通(dev): `concurrently`

## 8. 非スコープ(今回やらないこと)

- 「素材ライブラリ」画面(World/Character/Scenario/Rulesetの一覧・編集・既存選択UI、docs 14.3, Phase2相当)の実装
- セッションのサーバー自動同期(Play画面からの自動バックアップ配線)
- AIによるセッション小説化生成ロジック
- 認証・レート制限等、プロキシサーバーのセキュリティ強化
- Git初期化・コミット(現在このディレクトリはGitリポジトリではない)
