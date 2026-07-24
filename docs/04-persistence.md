# 状態管理・永続化

## クライアント側(IndexedDB)

- ブラウザのIndexedDBでセッション跨ぎ保存する。`sessions`という1つのobject store(キー: session id)にセッション全体を保存する。
- localStorage/sessionStorageではなくIndexedDBを採用する理由:
  - localStorageとsessionStorageは容量上限がほぼ同じ(数MB程度)であり、sessionStorageに容量面の優位性はない
  - sessionStorageはタブを閉じると消えるため、「続きから再開」機能と両立しない
  - 将来的に画像等のバイナリデータを扱う計画があり、IndexedDBならBlobを直接扱え容量上限も大きい
- 一覧表示(ホーム画面の「続きから再開」)はIndexedDBの`getAll()`で全セッションを取得し`updatedAt`降順にソートして使う。専用の索引(旧`sessions_index`)は持たない。
- スキーマバージョン管理: session内に`schema_version`を持たせ、将来の移行に対応(未実装、Phase以降で必要になれば追加)。

## サーバー側(dataStore / textStore)

- サーバーはJSON向けの`dataStore`とテキスト(Markdown等)向けの`textStore`という2つの抽象インターフェースを持つ。現状はどちらもローカルファイルシステム実装。
  - `dataStore`: 将来Redis等のキーバリューストアへの差し替えを想定
  - `textStore`: 将来S3等のクラウドストレージへの差し替えを想定
- 認証機能の追加に伴い、素材ライブラリ・セッション関連のキーはすべて**ユーザー単位の名前空間`users/{userId}/...`配下**に置かれる(`server/storage/paths.js`)。認証(識別情報・セッショントークン)自体はユーザー名前空間の外側に置かれる。
- Sessionsは`dataStore`経由で`users/{userId}/sessions/{id}`キーに保存され、`GET /api/sessions`・`GET /api/sessions/:id`・`PUT /api/sessions/:id`で読み書きできる(`req.userId`はログインセッションから解決され、他ユーザーのセッションにはアクセスできない)。**フロントエンドからの自動同期は実装済み**: `Play.jsx`が毎ターン、IndexedDBへの保存に加えて`putSessionToServer`(`src/api/sessionSyncClient.js`)経由で`PUT /api/sessions/:id`を呼び、サーバー側にもセッション全体を同期する(失敗してもプレイは継続、コンソールにエラーを出すのみ)。
- World/Character/Scenario/Rulesetについては、`server/storage/paths.js`のキー生成関数(`users/{userId}/worlds/{worldId}/...`等)を使った**保存API・素材ライブラリUIが両方稼働している**(データモデルは[02-data-model.md](02-data-model.md)の3.5節のフォルダ構造に対応)。フロントエンドの`src/screens/Library.jsx`(World/Character/Scenario/Rulesetタブ)からこれらのAPIを呼び出し、CRUDが完結する。
- World・Scenarioのメタ情報は`moods`(雰囲気タグ)フィールドを持つ(`server/storage/worldLibrary.js`・`scenarioLibrary.js`)。値は`server/storage/moods.js`の`MOODS`(固定8種: ホラー/冒険/ミステリー/日常/SF/ファンタジー/コメディ/シリアス)の部分集合の配列で、`PUT /api/worlds/:id`・`PUT /api/worlds/:worldId/scenarios/:id`のボディに`moods`があれば`isValidMoods`で検証し、語彙外の値を含む場合`400`(`moods must be an array of known mood labels`)を返す。省略時・未設定時は`[]`。フロントエンドの語彙定義は`src/constants/moods.js`にサーバーと同内容で複製されている(`server/storage/slugify.js`↔`src/utils/slugify.js`と同じ前例)。

### 認証関連のキー構造(`server/auth/*.js`)

- **`auth/identities/{provider}/{providerUserId}`**: OAuthプロバイダ(google/discord/x)のユーザーIDから自サービスの内部`userId`への対応(`server/auth/users.js`の`identityKey`)。初回ログイン時に`findOrCreateUser`が作成し、以後の同一プロバイダアカウントでのログインをこのキーで突き合わせる。
- **`auth/sessions/{tokenHash}`**: サーバーサイドセッション本体(`server/auth/sessions.js`)。`{ userId, createdAt, expiresAt }`を保持し、キーはセッショントークンそのものではなくそのSHA-256ハッシュ(`tokenHash`)。トークン自体はhttpOnlyクッキー(`gmdesk_session`)としてのみクライアントに渡り、有効期限は30日(残り15日未満でアクセスがあれば自動延長)。
- **`users/{userId}/profile`**: ユーザープロフィール(`server/auth/users.js`の`userProfileKey`)。`{ id, displayName, avatarUrl, bio, createdAt, updatedAt }`。`bio`は自己紹介文(最大500字、未設定時は`''`)で、Phase 3で追加。`GET/PATCH /api/me`で参照・更新する。
- **`users/{userId}/usage/{YYYY-MM-DD}`**: ユーザー・日(UTC日付)単位のAI呼び出し回数カウンタ(`server/auth/usage.js`の`usageKey`)。`{ messages: n, novelize: n }`形式で、`LIMIT_MESSAGES_PER_DAY`/`LIMIT_NOVELIZE_PER_DAY`(環境変数、既定200/10)を超えると`429`を返す。

### 公開(共有)関連のキー構造(`server/storage/paths.js`, `server/storage/shareLibrary.js`)

Phase 2で追加された「公開ギャラリー」機能は、ユーザー名前空間の外側にある**公開ツリー`public/...`**と、各ユーザー名前空間内の**公開状態マッピング`users/{userId}/publish/...`**の2つのキー空間からなる。公開は素材の**コピー**であり、公開元(`users/{userId}/...`)や他ユーザーのインポート結果とは独立に読み書きされる(参照ではない)。

- **`public/{type}/{publicId}`**(`dataStore`、`publicMetaKey`): 公開メタ情報。`type`は`worlds`/`characters`/`scenarios`/`novels`のいずれか、`publicId`は公開時に採番される`pub_`プレフィックス+ランダム12桁hexのID(`newPublicId`)。共通フィールドは`{ publicId, ownerId, ownerName, publishedAt, updatedAt }`で、`publishedAt`は初回公開時刻を再公開後も維持し`updatedAt`のみ更新する。`type`別の追加フィールド: worlds=`{ title, regions, categories, moods }`(region/category名の配列、`moods`は公開元Worldの`moods`をそのままコピー)、characters=`{ title, kind, name, worldId, worldTitle }`(`worldId`/`worldTitle`は所属Worldの参照。`worldTitle`は公開時点のWorldメタから取得したタイトルのスナップショットで、取得できなければ`null`)、scenarios=`{ title, recommendedRuleset, moods, worldId, worldTitle }`、novels=`{ title }`。**`moods`/`worldId`/`worldTitle`は検索・絞り込み機能の追加(本節末尾のクエリAPI)に伴い公開処理(`publishWorld`/`publishCharacter`/`publishScenario`、`server/storage/shareLibrary.js`)へ後から追加されたフィールドであり、追加前に公開済みだったメタには存在しない(自動バックフィルは行わない。再公開すれば最新のWorld/Scenarioメタから作り直されるため反映される)**。公開が公開元のコピー(参照ではない)であるという既存のスナップショット方針をこれらのフィールドにも踏襲している。
- **`public/worlds/{publicId}/world.md`・`/regions/{region}.md`・`/categories/{category}.md`**、**`public/characters/{publicId}/sheet.md`**、**`public/scenarios/{publicId}/scenario.md`**、**`public/novels/{publicId}/novel.md`**(`textStore`): 公開Markdown本文一式。World再公開時は対象ディレクトリを`textStore.deleteDir`で一度削除してから書き直すため、再公開後に削除されたregion/categoryの残骸は残らない。
- **`users/{userId}/publish/worlds/{worldId}`**・**`users/{userId}/publish/worlds/{worldId}/characters/{kind}/{name}`**・**`users/{userId}/publish/worlds/{worldId}/scenarios/{scenarioId}`**・**`users/{userId}/publish/sessions/{sessionId}`**(`dataStore`): 「このユーザーのこの素材は公開済みか」を示すマッピングで、値は`{ publicId }`のみ。再公開時は既存の`publicId`を引き継ぐ(同じ公開ページが上書き更新される)ため、マッピングが無いときだけ新規`publicId`を採番する。
- 公開解除(`unpublishWorld`/`unpublishCharacter`/`unpublishScenario`/`unpublishNovel`)はマッピングと`public/{type}/{publicId}`のメタ・本文一式を削除するのみ。他ユーザーが既にインポートしたコピー(`users/{別のuserId}/...`配下)には一切影響しない。
- World削除時のカスケード(`unpublishWorldCascade`、`server/routes/worlds.js`の`DELETE /api/worlds/:id`から呼ばれる)は、配下の公開済みCharacter(pc/npc)・Scenarioを先に解除してからWorld自体の公開を解除する。

### サーバーAPIサーフェス(`server/routes/*.js`, `server/auth/routes.js`)

- **auth**: `GET /auth/:provider/start`(OAuth開始・PKCEのcode_verifier発行・stateをクッキーに保持してプロバイダへリダイレクト)、`GET /auth/:provider/callback`(コールバック。state検証・コード交換・プロフィール取得・ユーザー作成/取得・セッション発行後`/`へリダイレクト)、`POST /auth/logout`(セッション破棄)。いずれも認証不要。
- **me / providers**: `GET /api/auth/providers`(有効な(クライアントID/シークレットが設定された)プロバイダ名の一覧。認証不要)、`GET /api/me`(ログイン中ユーザー情報。未ログイン時は`user: null`。認証不要)、`PATCH /api/me`(`displayName`/`avatarUrl`/`bio`の更新。`bio`は最大500字の文字列。ログイン必須で未ログインは`401`)
- **sessions**: `GET /api/sessions`(一覧)、`GET /api/sessions/:id`、`PUT /api/sessions/:id`、`POST /api/sessions/:id/novelize`(ログをAI小説化して保存)、`GET /api/sessions/:id/novel`(小説本文+鮮度フラグ`stale`を返す)
- **worlds**: `GET /api/worlds`、`GET /api/worlds/:id`、`PUT /api/worlds/:id`、`DELETE /api/worlds/:id`(関連するCharacter/Scenario/region/categoryをカスケード削除)
- **worldContent**: `GET/PUT /api/worlds/:worldId/source`、`GET/PUT/DELETE /api/worlds/:worldId/regions/:region`、`GET /api/worlds/:worldId/regions`(一覧)、`GET/PUT/DELETE /api/worlds/:worldId/categories/:category`、`GET /api/worlds/:worldId/categories`(一覧)
- **characters**: `GET /api/worlds/:worldId/characters/:kind`(一覧、kindはpc/npc)、`GET/PUT/DELETE /api/worlds/:worldId/characters/:kind/:name`、`PUT /api/worlds/:worldId/characters/:kind/:name/parsed`(goal/bonds構造化キャッシュの保存)
- **scenarios**: `GET /api/worlds/:worldId/scenarios`、`GET/PUT/DELETE /api/worlds/:worldId/scenarios/:id`
- **rulesets**: `GET /api/rulesets`、`GET/PUT/DELETE /api/rulesets/:id`
- **public(公開ギャラリー閲覧、`server/routes/publicContent.js`)**: `GET /api/public/:type`(`type`は`worlds`/`characters`/`scenarios`/`novels`のいずれか。未知の`type`は`404`)、`GET /api/public/:type/:publicId`(個別詳細。worldsのみregion/category本文も含めて返す。`type`または`publicId`が不明なら`404`)。**いずれも認証不要**(`server/index.js`で`authRouter`の直後・`requireAuth`より前にマウントされ、未ログインでもギャラリー閲覧ができる)。
  - `GET /api/public/:type`のクエリパラメータ(すべて任意、`queryPublic`、`server/storage/shareLibrary.js`): `q`(自由文字列。小文字化した上で`title`・`ownerName`・`worldTitle`の連結文字列に対する部分一致。前後空白はtrim、空文字なら絞り込みなし)、`moods`(カンマ区切りの雰囲気語彙。`MOODS`語彙外の値は黙って無視され、複数指定時はOR一致でmeta.moodsと1つでも重なれば通過。PUT系のバリデーションと異なりここでは不正値でも`400`にはならない)、`ruleset`(`recommendedRuleset`との完全一致。`recommendedRuleset`フィールドを持つのはscenariosのみのため、worlds/characters/novelsに対して指定すると常に0件になる)、`ownerId`(完全一致)、`limit`(正の数値なら`Math.min(limit, 100)`、それ以外は既定`20`)、`offset`(正の数値ならその値、それ以外は`0`)。絞り込みは常に`publishedAt`降順にソート済みの一覧に対して行われるため、結果の順序は絞り込み前と同じ`publishedAt`降順を保つ。
  - レスポンス形式は`{ items, total, hasMore }`(`items`: 絞り込み後・`offset`〜`offset+limit`のページ分の配列、`total`: 絞り込み後の全件数(ページングとは無関係)、`hasMore`: `offset + items.length < total`)。旧来の「公開メタの配列をそのまま返す」形式(`listPublic`)から変更されている。
- **users(公開プロフィール、`server/routes/publicContent.js`、Phase 3で追加)**: `GET /api/users/:userId`(`{ id, displayName, avatarUrl, bio }`を返す公開プロフィール。ユーザーが存在しなければ`404`)。**認証不要**(publicルーターと同じ位置、`requireAuth`より前にマウント)。**`GET /api/users/:userId/public`(そのユーザーの公開素材を`{ worlds, characters, scenarios, novels }`の4配列にまとめて返す一括APIは廃止済み**。ユーザーページ(`src/screens/UserPage.jsx`)は現在、Galleryと共通の`PublicItemList`コンポーネントに`ownerId`を渡し、タブごとに`GET /api/public/:type?ownerId={userId}`を呼ぶ方式に統一されている(詳細は[05-ui-ux.md](05-ui-ux.md)14.4/14.5節)。
- **publish(公開/解除、`server/routes/publish.js`)**: `POST /api/publish/worlds/:worldId`・`POST /api/publish/worlds/:worldId/characters/:kind/:name`・`POST /api/publish/worlds/:worldId/scenarios/:scenarioId`・`POST /api/publish/sessions/:sessionId/novel`(公開または再公開し、成功時`{ publicId }`を返す。対象素材が存在しなければ`404`、小説が未生成なら`409`)。対応する`DELETE /api/publish/worlds/:worldId`等(公開解除、成功時`204`)。`GET /api/publish/worlds`・`GET /api/publish/worlds/:worldId/characters/:kind`・`GET /api/publish/worlds/:worldId/scenarios`・`GET /api/publish/sessions`(呼び出しユーザー自身の公開状態マップ`{ 素材名: publicId }`を返す)。**すべて認証必須**(`requireAuth`より後にマウント。`req.userId`所有の素材のみ操作可能)。
- **import(コピー取り込み、`server/routes/imports.js`)**: `POST /api/import/worlds/:publicId`(公開Worldをregion/categoryごと自分のライブラリへ独立コピーとして保存し`201`で保存結果を返す。存在しなければ`404`)、`POST /api/import/characters/:publicId`・`POST /api/import/scenarios/:publicId`(ボディに`targetWorldId`必須。欠落/不正なIDは`400`、取り込み先Worldが存在しなければ`404`)。**認証必須**。インポートは公開ツリーからの独立コピーであり、以後公開元が解除・削除されても取り込んだコピーには影響しない(Characterはインポート時`revealed: false`にリセットされる)。
- **認証必須・利用制限**: 上記の`sessions`/`worlds`/`worldContent`/`characters`/`scenarios`/`rulesets`/`publish`/`import`および`POST /api/messages`は`createRequireAuth`ミドルウェア(`server/auth/middleware.js`)を通り、有効なセッションクッキーがなければ`401`を返す(`/auth/*`・`GET /api/auth/providers`・`GET /api/me`・`GET /api/public/*`・`GET /api/users/*`のみ例外)。加えて`POST /api/messages`と`POST /api/sessions/:id/novelize`はユーザー単位の日次利用制限に達すると`429`を返す(`server/auth/usage.js`)。またミューテーション系メソッド(POST/PUT/PATCH/DELETE)は`Origin`ヘッダが`BASE_URL`と一致しない場合`403`(`createOriginCheck`、CSRF対策)。

### 入力堅牢化(FX3で追加)

- 全ルートの`:id`/`:worldId`/`:name`等のパスパラメータは`idParamGuard`(`server/routes/validateId.js`)を通り、空文字・128文字超・`..`を含む・先頭ドット・許可文字集合(英数字/`.`/`_`/`-`)外の値は`400`で拒否する(パストラバーサル対策)。`kind`パラメータも`pc`/`npc`以外を`400`で拒否する。
- PUT系エンドポイントは必須フィールドの型チェック(例: `raw`/`title`/`label`が文字列でなければ`400`)を行う。
- `dataStore.set`はテンポラリファイルへの書き込み後に`rename`するアトミック書き込み(`server/storage/dataStore.js`)。
- `deleteWorld`はWorld本体だけでなく配下のCharacter/Scenario/region/categoryもまとめて削除するカスケード処理。
- `POST /api/sessions/:id/novelize`と`POST /api/messages`はいずれもAnthropicへの上流リクエストにタイムアウト(`AbortSignal.timeout`)を設定する。
