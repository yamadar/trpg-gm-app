# 監査修正 FX5: テスト補強 設計ドキュメント

## 1. 背景・目的

テスト監査で洗い出した高価値のカバレッジ欠落を埋める。FX1〜FX3の実装過程で一部(deleteWorld孤児化のpin、dice矛盾、WorldTab/Homeのタウトロジー修正)は既に埋まったため、本FX5は残る高価値ギャップに絞る。追加テストのみでプロダクションコードは変更しない(テストが実バグを検出した場合のみ最小修正する)。

## 2. スコープ(残存する高価値ギャップ)

現状確認済み:
- `src/screens/Play.test.jsx`は`fireEvent`ゼロ — プレイループの中核操作(自由入力送信・選択肢クリック・Enter/IME・AI不正JSON時のエラー経路・saveSession呼び出し)が未検証。
- クライアント↔サーバーの実結合テストが皆無(`supertest`使用ゼロ) — URL組み立てとルート期待が別ファイルで目視一致頼み。特にエンコードとボディ形状の突き合わせ。
- `parseJsonLoose`の現実的LLM失敗パターン(途中切れJSON・末尾散文・未エスケープ改行)が未検証。
- `Setup.jsx`の致命的エラー経路(`generateScenario`失敗時)が未検証。
- `src/storage/index.js`のIndexedDB失敗経路(4つのcatch)が未検証。

## 3. 追加テストの設計

### 3.1 Play.jsx 操作・エラー経路(`src/screens/Play.test.jsx`)
既存のHarness/fetchモック方式を流用し、以下を`fireEvent`で追加:
- **自由入力送信**: テキスト入力欄に入力→「送る」クリック→プレイヤー発言がログに出て、GM応答が描画される。
- **選択肢クリック**: 最後のGM応答の選択肢ボタンをクリック→そのテキストでターンが進む。
- **Enter送信 + IMEガード**: 入力後、`keyDown` Enter(`isComposing: false`)で送信されること。`isComposing: true`のEnterでは送信されないこと(`nativeEvent.isComposing`を`fireEvent.keyDown`で指定)。
- **不正JSONエラー経路**: `fetch`が有効なJSONを含まない応答(例: `parseJsonLoose`が投げる本文)を返した場合、「GM応答の取得に失敗した」が表示され、`busy`が解除され、送信したプレイヤー入力が入力欄に復元されること。
- **saveSession呼び出しのpin**: ターン後に`saveSession`(名前空間spy)が呼ばれることをアサートする(現状は永続化行を消してもテストが通るため、退行検出用にpinする)。

### 3.2 クライアント↔サーバー結合(新規`src/api/integration.test.js`、node環境)
`server/index.js`の`createApp({ apiKey, dataDir, fetchImpl })`を一時ディレクトリで生成し、`supertest`をラップした`fetch`シムをグローバルにstubして、実クライアント関数が実Expressルートへ往復するようにする。シムは相対URL(`/api/...`)+optionsをsupertestリクエストへ変換し、`{ ok, status, json, text }`を返す。以下の継ぎ目を検証:
- `putSessionToServer(session)` → `GET /api/sessions/:id`で往復し保存内容が一致。
- `putCharacter(worldId, 'pc', name, {...})`を**有効なASCIIスラグn ame**で保存→`getCharacter`で往復取得でき、URL構築とルート`:name`・ボディ形状の突き合わせが実際に成立すること(単純idはFX2のencodeURIComponentでも不変)。
- **FX3のパラメータガードのエンドツーエンド確認**: クライアントが`/`を含む不正なid/name(例`putCharacter(worldId, 'pc', 'a/b', {...})`、client側で`encodeURIComponent`され`%2F`→サーバーで`/`にデコード→`idParamGuard`が拒否)を送ると、実ルートで400になり、クライアントの`apiFetch`が`API error 400`をthrowすること。これで「クライアントの正当なエンコード + サーバーの厳格な拒否」の連携を退行検出する。
- `putWorld`+`putRegion`→`deleteWorld`(カスケード)→`listRegions`が空になる往復(FX3のカスケードをクライアント経路で確認)。
- クライアントのDELETE(`deleteWorld`等)が204でボディをparseしないことが実ルートで成立すること。

これにより、別ファイルで手作業一致させていたURL/ボディ形状・204処理・パラメータガードを一括で退行検出する。

### 3.3 parseJsonLoose 現実的失敗コーパス(`src/api/client.test.js`)
- 途中切れJSON(閉じ`}`無し)→ 「JSON not found」経路(`throws`)。
- 末尾に散文が続くJSON(`{...}\n以上です`)→ 最初の`{`〜最後の`}`を正しく抽出しparseできること。
- コードフェンス+前後プロローグ混在→ 正しく抽出できること。

### 3.4 Setup 致命的エラー経路(`src/screens/Setup.test.jsx`)
- `generateScenario`(`sessionApi`名前空間spy)を`mockRejectedValue`にし、`paste`空→fallback生成経路で失敗→「開始処理に失敗した」が表示され、`onStart`が呼ばれず、「ゲーム開始」ボタンが「準備中…」から復帰する(`busy`解除)ことを検証。

### 3.5 storage/index.js 失敗経路(`src/storage/index.test.js`)
`indexedDbStore`をモジュール名前空間spyで拒否させ、以下を検証:
- `isStorageAvailable()` → `putSession`/`getSessionById`拒否時に`false`。
- `saveSession()` → `putSession`拒否時に`false`(例外を投げない)。
- `listSessions()` → `getAllSessions`拒否時に`[]`。
- `getSession()` → `getSessionById`拒否時に`null`。

## 4. 非スコープ

- プロダクションコードの機能変更(テストがバグを検出した場合の最小修正を除く)。
- ドキュメント(FX4で完了)。
- E2E/ブラウザ自動化(既存の手動ブラウザ確認で代替)。

## 5. 完了条件

追加テストが全て通り、各対象の退行(該当プロダクションコードを壊すと失敗する)を検出できること。全体テスト+ビルドが緑。
