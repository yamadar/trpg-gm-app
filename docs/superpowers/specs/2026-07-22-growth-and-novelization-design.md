# キャラクター成長・経験値 / ログの小説化書き出し 設計ドキュメント

## 1. 背景・目的

`docs/07-risks-and-roadmap.md` §9のPhase 2項目のうち、未着手だった2件を実装する。

1. キャラクター成長・経験値
2. ログの小説化書き出し

## 2. 事前調査で判明した事実

- 現在のシステムには数値化されたスキル/能力値が一切無く、`success_percent`は毎ターンAIが自由記述PCシート(`session.pc.raw`)を読んで即興で決めている(`src/api/prompts.js`の`ROLL_TOOL`定義参照)。固定の技能値テーブルはコード上どこにも存在しない。
- `server/routes/sessions.js`に`POST /api/sessions/:id/novelize`という501プレースホルダーが既にある。同ファイルの`GET/PUT /api/sessions/:id`(サーバー側`dataStore`保存)も実装済みだが、現状のアプリからは一度も呼ばれていない(セッションは`src/storage/index.js`経由でブラウザのIndexedDBにのみ保存されている)。
- `server/routes/messages.js`が既にサーバー側から直接Anthropic APIを呼ぶパターン(`apiKey`/`fetchImpl`注入、テスト容易性のため)を持っている。小説化のAI呼び出しはこれと同じ構造をサーバー側の新規ルートで再利用する。
- アプリ全体を通じて、ファイルダウンロード(Blob+`URL.createObjectURL`)の前例は無い。今回が初導入となる。

## 3. A. キャラクター成長・経験値

### 3.1 設計方針の要約(検討の結果)

TRPGシステムによって成長概念(D&D5eの経験値テーブル、GURPSのCP、CoC7eのスキル成長ロール等)は大きく異なり、これを機械的に実装しようとするとキャラクターシート計算そのものに踏み込みスコープが際限なく拡大する。そのため以下の方針を採る:

- **成長は演出のみ**。実際の判定(`success_percent`)には一切影響しない。
- **数値の計算ロジックは単一の累計カウンター**(`session.state.xp`、単純に増加するだけ、レベル・閾値の概念は持たない)。Rulesetによる計算式の違いは実装しない。
- **呼び名(「経験値」「CP」等)と桁感の調整はRuleset側の自由記述領域に委ねる**。具体的には、Ruleset(静的4件+カスタム)に`growthUnit`という短いラベル文字列を追加し、画面表示とGMへの指示文の両方で使う。桁感(1ターンあたりどの程度の量を付与するか)はAIの常識的判断に委ねハードコードしない。

### 3.2 Rulesetへの`growthUnit`追加

**対象:** `src/data/rulesets.js`(静的4件)、`server/storage/rulesetLibrary.js`・`server/routes/rulesets.js`(カスタムRuleset)、`src/api/rulesetLibraryClient.js`、`src/screens/library/RulesetTab.jsx`

静的4件のデフォルト値:
- `simple` → `経験値`
- `coc7e` → `経験値`
- `dnd5e` → `経験値`
- `gurps` → `CP`

カスタムRulesetは`RulesetTab.jsx`の作成/編集フォームに`growthUnit`入力欄を追加する(任意項目、未入力なら`session.ruleset`組み立て時・GMプロンプト生成時に`経験値`にフォールバックする)。

サーバー側の`saveRuleset`/PUTルートは`growthUnit`を素通しで保存する(既存の`label`/`desc`/`hint`と同じ扱い)。

### 3.3 `session.ruleset`への反映

**対象:** `src/screens/Setup.jsx`

`handleStart`内で`allRulesets.find((r) => r.id === rulesetId) || RULESETS[0]`から`session.ruleset`を組み立てている箇所に`growthUnit`を追加する:
```js
session.ruleset = { id, label, desc, hint, growthUnit: resolvedRuleset.growthUnit || '経験値' }
```

### 3.4 `session.state.xp`とGMプロンプトへの指示

**対象:** `src/api/prompts.js`、`src/screens/Play.jsx`

`buildSystemPrompt`の出力JSON形式に`state_update.xp_gained`(任意の数値。0または省略可)を追加する。指示文には次の趣旨を含める:「物語が進展・成功した節目で、{growthUnit}として適切と思われる量を`xp_gained`に設定すること。呼び名や量の目安はルール性向のヒントに従うこと」。`growthUnit`は`session.ruleset.growthUnit`(無ければ`経験値`)を使う。

`Play.jsx`の`runTurn`で、既存の`flags`/`current_scene`等と同様に`state.xp`へ`xp_gained`を加算する:
```js
const newXp = (session.state.xp || 0) + (result.state_update?.xp_gained || 0);
```
既存セッション(`state.xp`未定義)は`|| 0`で後方互換に扱う。

### 3.5 画面表示

**対象:** `src/screens/Play.jsx`

セッションタイトル・シーン表示のそばに「{growthUnit}: {xp}」を表示する(`session.ruleset?.growthUnit || '経験値'`、`session.state.xp || 0`)。

## 4. B. ログの小説化書き出し

### 4.1 セッションのサーバー自動同期

**対象:** `src/screens/Play.jsx`、新規`src/api/sessionSyncClient.js`

`Play.jsx`の`runTurn`が`saveSession`(IndexedDB)を呼んだ直後に、同じセッション全体を`PUT /api/sessions/:id`へ自動送信する。この同期は非致命的に扱う(失敗しても`console.error`のみでゲーム進行は止めない。IndexedDBへの保存が正であり、サーバー同期はあくまで小説化機能のための副次的な複製)。

新規`src/api/sessionSyncClient.js`:
```js
putSessionToServer(session) → サーバーにPUT
novelizeSession(id) → POST /api/sessions/:id/novelize(生成をトリガー、完了まで待つ)
getNovel(id) → GET /api/sessions/:id/novel(生成済みテキストを取得)
```

### 4.2 サーバー側: 小説化生成・保存

**対象:** `server/routes/sessions.js`、`server/index.js`(ルーター初期化への`apiKey`/`fetchImpl`/`textStore`追加)、`server/storage/paths.js`(`sessionNovelDocPath`追加)

`POST /api/sessions/:id/novelize`(既存501プレースホルダーを置き換え):
1. `dataStore`から`sessionKey(id)`でセッションを取得。無ければ404。
2. セッションの`log`配列(`{role, text}`の連続)を「PL: ...\nGM: ...\n...」形式のプレーンテキストに変換する。
3. `server/routes/messages.js`と同じ`fetchImpl('https://api.anthropic.com/v1/messages', {...})`パターンで、小説化用のsystem prompt+上記テキストをAnthropicに直接送信する(`apiKey`が無ければ`messages.js`同様500を返す)。
4. レスポンスからテキストを抽出し(`content`配列内の`type: 'text'`ブロックを結合。`src/api/client.js`の`extractText`と同じロジックをサーバー側にも実装する)、`textStore`に`sessionNovelDocPath(id)`で保存する。
5. `{ ok: true }`程度の完了確認を返す(本文そのものは返さない。取得は別エンドポイント)。

`GET /api/sessions/:id/novel`(新規ルート):
1. `textStore`から`sessionNovelDocPath(id)`を読む。無ければ404。
2. `{ text }`を返す。

`paths.js`に追加:
```js
export function sessionNovelDocPath(sessionId) {
  return `sessions/${sessionId}/novel.md`;
}
```

### 4.3 小説化プロンプトの方針

セッションの`log`全体を一括でAIに投入する(章単位分割は行わない。非常に長いセッションでは`max_tokens`やコンテキスト長の制限に達するリスクがあるが、今回は対応しない既知の制約とする)。System promptの趣旨:「以下はTRPGセッションの進行ログである。プレイヤー発言とGMの地の文が交互に並んでいる。これを一人称または三人称の小説として、場面転換や心理描写を補いながら自然な文章に書き直せ。ゲーム的な表現(選択肢・判定結果の数値等)はそのまま出力せず、物語として自然に溶け込ませること」。

### 4.4 クライアント側: ダウンロードUI

**対象:** `src/screens/Home.jsx`

各セッションカードに「小説化」ボタンを追加する。押すと:
1. `novelizeSession(id)`を呼ぶ(busy状態表示。既存のライブラリ画面のボタン無効化パターンを踏襲)。
2. 成功したら`getNovel(id)`を呼ぶ。
3. 取得したテキストを`Blob`(`type: 'text/markdown'`)化し、`URL.createObjectURL`+一時的な`<a download>`要素のクリックでファイルダウンロードを発火する(ファイル名は`${session.title}.md`、`/`等のファイル名に使えない文字は除去する)。
4. 失敗時はカード内にエラーメッセージを表示する(`COLORS.stamp`、既存パターン踏襲)。

## 5. 非スコープ

- Ruleset間の実際の成長計算式の違い(GURPSのCP計算、D&D5eの経験値テーブル等)
- 「レベル」概念(閾値・レベルアップ判定)
- 小説化の章単位分割・長大ログへの対応
- 小説化結果の再生成・複数バージョン管理(常に最新の1件のみ上書き保存)
- NPCの成長・経験値
