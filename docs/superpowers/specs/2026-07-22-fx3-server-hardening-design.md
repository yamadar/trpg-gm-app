# 監査修正 FX3: サーバー堅牢化 設計ドキュメント

## 1. 背景・目的

監査で洗い出したサーバー側のCritical・Important・関連Minorを修正する。FX1(フロント破損防止)・FX2(UI整合)に続く3番目のサブプロジェクト。パストラバーサル、データ一貫性(deleteWorld孤児化・reimport残留)、上流呼び出しのタイムアウト、novel鮮度、入力検証を対象とする。

## 2. スコープ(本FX3で直す指摘)

1. **全ルートのパストラバーサル(Critical, C1)**: `req.params`の`worldId`/`id`/`region`/`category`/`name`/`kind`/`sessionId`が正規化なしで`paths.js`→`path.join(rootDir, ...)`へ流れ、`..%2f`等でデータディレクトリ外の任意ファイルの読み書き削除が可能。
2. **deleteWorldが子コンテンツを孤児化(Important, I1)**: `deleteWorld`はmeta + `world.md`のみ削除し、`source.md`/`regions/*`/`categories/*`/`pc|npc/*`/`scenarios/**`を残す。同名World再作成で亡霊データが復活する。
3. **reimportで減ったregion/categoryが残留(Important, I2)**: 世界再分割で以前より少ないregion/categoryになっても古いファイルが消えず`listRegions`が返し続ける。
4. **上流Anthropic呼び出しにタイムアウト無し(Important, I3)**: `messages.js`・`sessions.js`(novelize)の`fetch`にタイムアウトが無く、上流ストールでExpressのリクエストが無制限に開いたまま残る。
5. **novelが元セッションのバージョンと紐づかない(Important, I5)**: novelize後に続きをプレイしても`GET .../novel`は古いテキストを「最新」として返す。
6. **novelizeが切り詰め/空出力を黙って保存(Important, I6)**: `max_tokens`固定で`stop_reason`未確認。予期しないレスポンス形状でも空の`novel.md`を`{ok:true}`で保存し得る。
7. **入力未検証(Minor, M1/M2/M5)**: `raw`欠落で`fs.writeFile(undefined)`→500(400が適切)。`PUT /sessions/:id`が`req.body`を無検証保存(文字列/配列で破損)。`title`/`label`欠落でmetaにキーが欠ける。
8. **グローバルエラーハンドラが全て500に潰す(Minor, M4)**: `index.js`が全`next(err)`を500にし、検証失敗やENOENTの本来のステータスが失われる。
9. **非アトミックな書き込み(Minor, M3)**: `writeFile`が一時ファイル+renameでないため、書き込み中の障害・同時書き込みで部分破損しうる。

### 対象外(スコープ外の理由)

- **プロキシの認証(I4)**: `POST /api/messages`はアプリ自身のAI呼び出し用の設計上の中継であり、真の認証はデプロイモデル(ローカル単一ユーザー→公開/多ユーザー)というプロダクト判断を要する。本FX3では**比例的な緩和**(`max_tokens`の上限クランプ・`messages`が配列であることの検証・巨大bodyは既存の2MB制限)に留め、ネットワーク公開前に認証が必要である旨をドキュメント(FX4)に明記する。
- サーバー側novel鮮度のUI表示はFX3(サーバーが`stale`を返す)+ 最小のHome表示までを含める。ドキュメント整合はFX4。

## 3. 設計

### 3.1 パラメータ検証(C1)— Express router.param ガード

`server/routes/validateId.js`(新規)に次を実装する:
- `HttpError`クラス(`status`プロパティを持つ`Error`サブクラス)。
- `isValidId(value)`: `string`かつ空でなく、`..`を含まず、`/`・`\`・NUL等の制御文字を含まず、先頭がドットでなく、長さ128以下、を満たすとき`true`。
- `idParamGuard(req, res, next, value)`: `isValidId(value)`が偽なら`res.status(400).json({ error: 'invalid path parameter' })`、真なら`next()`。
- `kindParamGuard(req, res, next, value)`: `value === 'pc' || value === 'npc'`のみ許可、他は400。

各ルーター(`worlds.js`/`characters.js`/`scenarios.js`/`rulesets.js`/`worldContent.js`/`sessions.js`)で`router.param('worldId', idParamGuard)`、`router.param('id', idParamGuard)`、`router.param('region', idParamGuard)`、`router.param('category', idParamGuard)`、`router.param('name', idParamGuard)`、`router.param('kind', kindParamGuard)`を宣言する(そのルーターが使うパラメータのみ)。`router.param`は該当パラメータを持つ全ルートで自動的に発火するため、各ハンドラの個別変更は不要。

### 3.2 deleteWorldのカスケード削除(I1)

`textStore`に`deleteDir(prefix)`を追加する(`fs.rm(dir, { recursive: true, force: true })`)。`worldLibrary.js`の`deleteWorld`を、meta削除に加えて`textStore.deleteDir('worlds/' + id)`で`worlds/{id}/`配下(source/world.md/regions/categories/characters/scenarios)を一括削除するよう変更する。ただし`dataStore`と`textStore`は同じrootDir配下でファイル拡張子が異なる(`.json` vs `.md`)ため、`worlds/{id}/`ディレクトリ配下には両者のファイルが混在する。`deleteDir('worlds/'+id)`はディレクトリごと消すため両方消える。metaファイル(`worlds/{id}.json`、ディレクトリ外)は従来通り`dataStore.delete`で消す。

### 3.3 reimport残留のprune(I2)

クライアント側で対応する。`src/api/worldLibraryClient.js`に`deleteRegion(worldId, region)`/`deleteCategory(worldId, category)`(既存のサーバーDELETEルートに対応)を追加する。`src/api/worldImport.js`の`reimportWorld`で、再分割結果を保存する前に`listRegions`/`listCategories`で現在のidを取得し、新しい分割結果に含まれないidを`deleteRegion`/`deleteCategory`で削除する。`importWorld`(新規World)はprune不要(既存無し)。

### 3.4 上流呼び出しのタイムアウト(I3)

`messages.js`・`sessions.js`(novelize)の`fetch`/`fetchImpl`呼び出しに`AbortSignal.timeout(ミリ秒)`を渡す。定数は`MESSAGES_TIMEOUT_MS = 120000`(2分)、`NOVELIZE_TIMEOUT_MS = 120000`。タイムアウト時は`AbortError`が投げられ、`messages.js`は既存のtry/catchで502、`sessions.js`のnovelizeはasyncHandler経由でエラーになるが、502相当を返すよう明示的にtry/catchで包む。`fetchImpl`(テスト注入)は`options.signal`を無視してよいため既存テストに無影響。

### 3.5 novelの鮮度検出(I5)+ 切り詰め/空出力の拒否(I6)

- **鮮度**: `paths.js`に`sessionNovelMetaKey(sessionId)`(= `sessions/{sessionId}/novel`、dataStore用)を追加。novelize成功時に`dataStore.set(sessionNovelMetaKey(id), { turnCount: session.state?.turn_count ?? null, updatedAt: Date.now() })`を保存。`GET .../novel`は、テキストに加えてnovel metaの`turnCount`と現在のセッションの`state.turn_count`を比較し、`{ text, stale }`(`stale = 保存時turnCount != 現在turnCount`、metaが無ければ`false`)を返す。
- **切り詰め/空**: novelize時、`data.stop_reason === 'max_tokens'`なら切り詰め扱いとし`502`(またはエラー)を返し保存しない。`extractText(data.content)`が空文字なら`502`を返し保存しない(空`novel.md`で既存を上書きしない)。`max_tokens`は`8000`のまま(切り詰め時は明示エラーにするため上限自体は据え置き)。

### 3.6 入力検証と400化(M1/M2/M5)+ グローバルエラーのステータス尊重(M4)

- `index.js`のグローバルエラーミドルウェアを、`err.status`(または`err.statusCode`)が数値ならそれを使い、無ければ500にするよう変更する。レスポンスbodyは`{ error: err.message || 'internal server error' }`。
- 各PUTハンドラで必須bodyフィールドを検証する。`worlds.js`/`worldContent.js`(source/region/category)/`characters.js`/`scenarios.js`の`raw`、`worlds.js`の`title`、`rulesets.js`の`label`が文字列でない場合は`HttpError(400, 'xxx is required')`を投げる(asyncHandler→グローバルハンドラ→400)。`scenarios.js`の`title`も必須。
- `sessions.js`の`PUT /sessions/:id`で、`req.body`がプレーンオブジェクトでない(文字列/配列/null)場合は`HttpError(400)`を投げる。

### 3.7 アトミック書き込み(M3)

`dataStore.set`と`textStore.write`を、一時ファイルへ書いてから`fs.rename`する方式に変更する。一時名は`${file}.tmp-${process.pid}-<単調増加カウンタ>`。renameは同一ファイルシステム内で原子的であり、部分書き込み・同時書き込みのlast-writer-winsを安全にする。既存テストは最終的なファイル内容のみ検証するため無影響。

### 3.8 Homeのnovel鮮度表示(I5のUI最小対応)

`src/screens/Home.jsx`の`handleNovelize`で、`getNovel`が`{ text, stale }`を返すようになるため、ダウンロードは従来通り行いつつ、`stale === true`の場合はそのセッションカードに注意書き(「ダウンロードした小説は最新のログを反映していない可能性があります」)を表示する。ただし本フローは常に直前に`novelizeSession`(再生成)を呼ぶため通常は`stale`にならない。将来novelを再生成せず取得だけする経路が増えた場合の安全表示。

## 4. 非スコープの再掲

- プロキシ認証(I4本体)。デプロイモデルのプロダクト判断が必要。比例的緩和のみ実施。
- ドキュメント整合(FX4)、追加インテグレーションテスト(FX5)。
