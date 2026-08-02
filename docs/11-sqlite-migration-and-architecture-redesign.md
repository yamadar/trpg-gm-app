# SQLite 移行・全体再設計計画

> **文書種別:** 実装計画・進捗・運用判断
> **作成日:** 2026-08-02  
> **対象:** ファイルシステムからSQLiteへの切替、および将来のPostgreSQL移行
> **実装基準日:** 2026-08-02。SQLite互換store、モジュール別table/scoped repository、容量台帳、durable小説化job、ObjectStorage境界、画像状態機械、SQLite/S3移行・検証・backup CLI、readiness、保守モードまで実装済み。本番SQLite/S3カットオーバー、集約ごとの子tableへの完全正規化、残る非同期処理のjob化は未実施。現行仕様は [01-architecture.md](01-architecture.md)、[02-data-model.md](02-data-model.md)、[04-persistence.md](04-persistence.md)、[09-deployment.md](09-deployment.md) を正本とする。

---

## 1. 結論

現時点の推奨構成は次のとおり。

| 責務 | 採用技術 | 判断 |
|---|---|---|
| 構造化データ、Markdown、セッション状態 | SQLite | 単一インスタンス運用と現在の規模に合い、運用費を抑えられる |
| 画像 | S3 互換オブジェクトストレージ | DB と永続ディスクから大容量バイナリを分離する |
| ブラウザー一時保存 | IndexedDB | キャッシュ、未送信入力、障害復旧用。正本にはしない |
| 非同期処理 | SQLite の `jobs` テーブル + 同一プロセス内ワーカー | 再起動に耐える最小構成。外部ワーカーは PostgreSQL 移行後 |
| Redis | 初期導入しない | 複数 Web インスタンス、リアルタイム配信、分散レート制限が必要になった時点で追加 |
| 将来の主 DB | PostgreSQL | 水平スケール、高い書き込み並行性、PITR、別ワーカーが必要になった時点で移行 |

アプリケーション構造は「モジュラーモノリス」を維持する。DB、S3、AI API を明確なポートで分離し、ルートから直接ストレージを操作しない。SQLite を PostgreSQL の簡易版として抽象化するのではなく、業務操作単位のリポジトリ契約を両 DB で実装できる設計にする。

目標構成:

```text
Browser
  ├─ React UI
  └─ IndexedDB: cache / draft / recovery only
          │ HTTPS
          ▼
Node.js modular monolith (single Render instance initially)
  ├─ HTTP API / authorization / validation
  ├─ Domain services / deterministic game engine
  ├─ Durable job worker
  ├─ Repository ports ───────────────► SQLite on local persistent disk
  ├─ Object storage port ────────────► private S3-compatible bucket
  └─ AI provider port ───────────────► Gemini API

Later:
  Repository implementation switch ─► PostgreSQL
  Durable worker split              ─► separate worker service
  Realtime fan-out                  ─► Redis, only if required
```

---

## 2. 目的と非目的

### 2.1 目的

- ファイル単位更新による部分失敗を、DB トランザクションで防ぐ
- ユーザー別容量制限を、全走査ではなく台帳の原子的更新で保証する
- Party 共有データの課金先を、リクエスト実行者ではなくデータ所有者へ統一する
- 画像を S3 へ分離し、DB と永続ディスクの増加を抑える
- 再起動で失われない小説生成などのジョブ基盤を作る
- PostgreSQL 移行時に業務ロジックと API を書き換えない境界を作る
- 復元手順、監視指標、移行検証を通常運用へ組み込む

### 2.2 非目的

- 初回移行でマイクロサービス化しない
- SQLite を複数 Web インスタンスから共有しない
- 画像 BLOB を SQLite または PostgreSQL に格納しない
- Redis を永続データの正本にしない
- 現行データを一度に完全正規化しない
- オフライン編集を暗黙に双方向同期しない

---

## 3. 現行設計の評価

レビュー対象となった代表実装:

| 領域 | 実装 |
|---|---|
| アプリ組み立て・永続化注入 | [`server/index.js`](../server/index.js) |
| ファイルストアとパス | [`server/storage/`](../server/storage/) |
| 容量ガード | [`server/storage/storageGuard.js`](../server/storage/storageGuard.js) |
| Party 集約 | [`server/partyService.js`](../server/partyService.js)、[`server/storage/partyLibrary.js`](../server/storage/partyLibrary.js) |
| 小説生成ジョブ | [`server/novelJobs.js`](../server/novelJobs.js) |
| Session 同期・IndexedDB | [`src/api/sessionSyncClient.js`](../src/api/sessionSyncClient.js)、[`src/storage/indexedDbStore.js`](../src/storage/indexedDbStore.js) |
| UI 組み立て | [`src/App.jsx`](../src/App.jsx) |

### 3.1 維持する設計

- AI は提案を返し、状態確定とルール検証はコードが担う
- 認証、CSRF、防御的パス解決、ユーザー名前空間を持つ
- Solo セッションは revision による競合検知を持つ
- Party はコマンド入力と許可リスト方式の表示投影を持つ
- 永続化、認可、API のテスト資産が存在する
- UI とサーバーの責務が完全分離ではないものの、API 境界は既にある

### 3.2 解消する構造的課題

#### 複数ファイル更新に原子性がない

現行では、次の操作が複数ファイルへまたがる。

- ワールド本文とメタデータ
- 画像 2 種と manifest
- Party のイベント、スナップショット、ラウンド、参加者索引
- 公開、インポート、スターター素材の複製

途中失敗すると、片方だけ更新された状態が残り得る。DB トランザクションと、DB・S3 間の補償処理へ置き換える。

#### 容量制限が実データ所有者と一致しない

設計レビュー時点の容量ガードは主に `req.userId` を基準に予約・測定していた。一方、Party 参加者の書き込み先は Party 所有者の共有データとなるため、実行者と課金先がずれていた。Phase 0 対策で、保存済み Party の `ownerId` 解決、公開コピーの所有者課金、Party membership index の重複除外、小説化ジョブ完了までの予約保持を追加した。

残る誤差・性能要因:

- 固定ヘッドルームは実際の差分容量と一致しない
- 更新ごとのディレクトリ再帰走査はファイル数に比例する
- 一部の利用量記録書き込みが容量ガード対象外

容量制限は「リクエスト単位」ではなく「所有者別台帳 + 書き込み予約」として設計し直す。

#### 長時間処理がプロセスメモリへ依存する

設計レビュー時点では小説生成の実行中Promiseがメモリだけにあり、再起動後はエラーへ倒れていた。現在はFile/SQLite共通job repositoryへ最小payloadとleaseを保存し、起動時に未完了小説化を再claimする。単一インスタンス前提のため別bootのleaseを起動時にstealする。Party AI解決、Campaign生成、画像生成はまだdurable job化されていない。

#### 一覧・公開検索が全件走査になる

ファイルシステムの列挙とメモリ内フィルタは、件数増加時に応答時間が線形増加する。所有者、種別、公開日時、タイトルなどを索引化する。

#### ブラウザーとサーバーに状態責務が分散する

IndexedDB とサーバーの双方が永続状態を持つと、競合時の正本が曖昧になる。サーバーを正本とし、IndexedDB はキャッシュ、編集中ドラフト、未送信操作に限定する。

### 3.3 設計上の優先順位

1. 所有権、認可、容量課金先を一つのモデルに統一
2. 構造化データを SQLite のトランザクション下へ移す
3. 画像を S3 へ移し、DB にはメタデータと参照だけを保存
4. 非同期処理を永続ジョブ化
5. クライアント状態をサーバー正本へ整理
6. PostgreSQL 移行条件をメトリクスで判定

---

## 4. SQLite 採用時のトレードオフ

### 4.1 利点

- DB サービスの固定費が不要
- 配備、接続管理、バージョン管理が単純
- 単一プロセスからの読み取り中心処理に十分な性能
- ACID トランザクション、外部キー、索引、制約を利用可能
- ローカル開発とテストが容易
- オンラインバックアップ API があり、一貫したスナップショットを作成可能

### 4.2 制約

| 制約 | 影響 | 対応 |
|---|---|---|
| 同時書き込みは実質 1 系列 | Party、チャット、ジョブ更新が集中すると待ち時間が増える | トランザクションを短くし、外部 API 呼び出しを含めない |
| DB ファイルは単一ホストのローカルディスクが前提 | Web を水平スケールできない | SQLite 期間は Web 1 インスタンスに固定 |
| Render の永続ディスクは単一サービスインスタンスへ接続 | ゼロダウンタイム配備や別ワーカーが難しい | 同一プロセス内ワーカーを使い、必要になれば PostgreSQL へ移行 |
| ネットワークファイルシステム上のロック信頼性が不足 | NFS/S3 マウントでは破損リスク | DB ファイルを S3、NFS、共有ボリュームへ置かない |
| WAL ファイルが増加し得る | 長い読み取りや checkpoint 不全でディスクを圧迫 | WAL サイズと checkpoint を監視 |
| 組み込み DB のため運用機能が少ない | PITR、自動フェイルオーバー、リードレプリカがない | 定期スナップショット、復元訓練、移行基準を設定 |
| SQL 型が PostgreSQL より緩い | 型不整合を DB だけで防ぎにくい | `STRICT` テーブル、`CHECK`、アプリ検証、契約テスト |

### 4.3 適用条件

SQLite を採用する条件:

- Web インスタンス 1 台で運用できる
- 書き込み競合が短時間かつ限定的
- 数分単位の計画停止を伴う配備・移行を許容できる
- 可用性要件をスナップショット復元で満たせる
- DB ファイルをローカル永続ディスクへ置ける

この条件を満たさない場合、初めから PostgreSQL を選ぶ。

### 4.4 接続初期設定

接続ごとに次を適用する。

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;
```

追加方針:

- 書き込みトランザクションは必要な SQL だけを含める
- Party コマンドなど、読み取り後の書き込み競合を避ける処理は `BEGIN IMMEDIATE`
- AI、S3、メール、HTTP 呼び出しをトランザクション内で実行しない
- WAL checkpoint の所要時間と失敗回数を計測する
- `synchronous=NORMAL` への変更は障害試験と耐久性要件の確認後に限定する
- 起動時 migration は単一プロセスだけが実行し、完了前にリクエスト受付を始めない
- 起動時に SQLite version を検査し、`STRICT` table、`RETURNING` など採用機能の最低 version を満たさなければ停止する

SQLite driver は domain contract に露出させない。選定時は transaction API、64-bit integer、Online Backup API、parameter binding、配備先 Node.js との互換性を検証する。

---

## 5. アプリケーション全体の再設計

### 5.1 モジュラーモノリス

推奨ディレクトリ境界:

```text
server/
  app/                    # createApp, middleware, route assembly
  modules/
    auth/
    library/              # worlds, characters, scenarios, rulesets
    sessions/             # Solo sessions, endings, novels
    campaigns/
    party/
    publishing/
    media/
    usage/
    jobs/
  domain/                 # shared domain policies and errors
  infrastructure/
    sqlite/
    postgres/             # 将来追加
    object-storage/
    ai/
  migrations/
  scripts/

shared/
  domain/                 # client/server 共用の決定的ルール
  schemas/                # API command/result validation
```

各モジュールは次の層を持つ。

```text
HTTP route → application/domain service → repository port → DB adapter
                                      └─ object storage / AI provider port
```

禁止事項:

- route から SQL、ファイルパス、S3 SDK を直接呼ばない
- 汎用 `get(key) / set(key) / list(prefix)` を新 DB 設計へ持ち込まない
- 認可を route だけに置かない。サービス層でも所有者または Party 権限を検証する
- クライアント提供の `ownerId`、使用量、revision を無条件に信用しない

### 5.2 リポジトリ契約

ストレージ方式ではなく、業務上の原子操作を契約にする。

```text
UserRepository
LibraryRepository
SessionRepository.compareAndSwap(...)
CampaignRepository.updateWithRevision(...)
PartyRepository.executeCommandInTransaction(...)
PublishingRepository.publishVersion(...)
MediaRepository.reserve / commit / release
UsageRepository.consumeAtomically(...)
JobRepository.enqueue / claim / heartbeat / complete / fail
```

SQLite と将来の PostgreSQL は同じ契約テストを通す。SQL の完全共通化は目的にしない。各 DB に適した SQL をアダプター内部へ隔離する。

### 5.3 正本と所有権

| データ | 正本 | 所有者・課金先 |
|---|---|---|
| ユーザープロフィール | DB | ユーザー |
| ワールド、NPC、シナリオ、ルール | DB | 作成ユーザー |
| Solo セッション、キャンペーン | DB | 作成ユーザー |
| Party 共有状態、イベント、チャット | DB | Party オーナー |
| 公開コンテンツ | DB の immutable version | 公開元ユーザー。公開 version の論理 byte を加算 |
| 画像本体 | S3 | `media_assets.owner_id` |
| 画像メタデータ・参照 | DB | 参照先エンティティの所有者 |
| IndexedDB | キャッシュ | 容量課金対象外 |

Party 参加者による共有データ更新も、容量計算と監査ログは Party オーナーへ帰属させる。操作実行者は別列 `actor_user_id` で記録する。

### 5.4 API と競合制御

- 更新 API は revision または ETag を必須にする
- 競合時は `409 Conflict` と最新 revision を返す
- 再送可能なコマンドには `Idempotency-Key` を受け付ける
- エラー形式を `code`, `message`, `requestId`, `details` に統一する
- 一覧は cursor pagination を使い、全件返却を避ける
- API 境界の入力を共有 schema で検証する
- 内部例外と stack trace はサーバーログへ記録し、レスポンスへ出さない

Solo 更新例:

```sql
UPDATE game_sessions
SET state_json = ?, revision = revision + 1, updated_at_ms = ?
WHERE id = ? AND owner_id = ? AND revision = ?
RETURNING revision;
```

更新件数 0 の場合、未存在、非所有、revision 競合を情報漏えいなく判定する。

Party コマンド:

1. `BEGIN IMMEDIATE`
2. Party、参加者権限、現在 revision を取得
3. コマンドを決定的ルールで検証
4. snapshot、round、participant を更新
5. event sequence を採番してイベント追加
6. revision 更新
7. commit

AI 判定が必要な場合、先にジョブまたは pending command を記録して commit する。AI 呼び出し後、入力 revision が同一の場合だけ結果を別トランザクションで確定する。

---

## 6. 論理データモデル

### 6.1 型の互換規約

PostgreSQL への変換を前提に、次の規約を使う。

| 意味 | SQLite | PostgreSQL 移行時 | 規約 |
|---|---|---|---|
| ID | `TEXT` | `uuid` または `text` | アプリ側で生成。外部公開 ID に連番を使わない |
| 時刻 | `INTEGER` | 当初 `bigint` | epoch millisecond。日時型への変換は別 migration |
| 真偽値 | `INTEGER CHECK (x IN (0,1))` | `boolean` | adapter が変換 |
| JSON | `TEXT CHECK (json_valid(x))` | `jsonb` | 業務上検索する属性は通常列へ出す |
| enum | `TEXT CHECK (...)` | `text CHECK` または lookup | PostgreSQL 固有 enum を避ける |
| 金額・容量 | `INTEGER` | `bigint` | byte、token など単位を列名に含める |

全テーブルを可能な範囲で `STRICT` とする。配列、関連 ID、タグをカンマ区切り文字列で保存しない。

### 6.2 認証

| テーブル | 主な列 | 制約・用途 |
|---|---|---|
| `users` | `id`, `display_name`, `avatar_url`, `bio`, timestamps | アプリ内ユーザー |
| `external_identities` | `provider`, `provider_subject`, `user_id` | `(provider, provider_subject)` 一意 |
| `auth_sessions` | `token_hash`, `user_id`, `expires_at_ms` | 生トークンを保存しない。期限索引を持つ |

### 6.3 ライブラリとキャンペーン

| テーブル | 主な列 | 備考 |
|---|---|---|
| `worlds` | `id`, `owner_id`, `title`, `moods_json`, `revision`, timestamps | 検索対象属性は通常列 |
| `world_sections` | `id`, `world_id`, `kind`, `title`, `body_md`, `position` | 地域・設定本文など |
| `characters` | `id`, `world_id`, `owner_id`, `kind`, `display_name`, `body_md`, `parsed_json`, `revealed` | PC/NPC を kind で区別 |
| `scenarios` | `id`, `world_id`, `owner_id`, `title`, `body_md`, `ruleset_id`, `moods_json`, `guide_json` | シナリオ正本 |
| `rulesets` | `id`, `owner_id`, `name`, `body_md`, `rules_json`, `revision` | 表示本文と機械判定用 JSON を分離 |
| `campaigns` | `id`, `owner_id`, `world_id`, `ruleset_id`, `title`, `state_json`, `revision` | キャンペーン集約ルート |
| `campaign_chapters` | `id`, `campaign_id`, `position`, `title`, `body_md`, `state_json` | 順序を通常列で保持 |
| `campaign_drafts` | `campaign_id`, `kind`, `body_md`, `updated_at_ms` | pitch、outline、執筆途中データ |

既存 JSON/Markdown の完全分解は避ける。所有権、タイトル、種別、状態、revision、時刻など、検索・制約・関連付けに使う属性だけを列へ出す。ゲーム固有で変化しやすい内容は検証済み JSON として保持する。

### 6.4 Solo セッション

| テーブル | 主な列 | 備考 |
|---|---|---|
| `game_sessions` | `id`, `owner_id`, `mode`, `title`, `world_id`, `campaign_id`, `ruleset_id`, `state_json`, `revision`, timestamps | サーバー正本。1 MiB 制約は検証層でも維持 |
| `session_log_entries` | `session_id`, `seq`, `role`, `text`, `payload_json`, `created_at_ms` | 将来の差分取得用。初回移行では state JSON 内ログでも可 |
| `novels` | `session_id`, `body_md`, `source_hash`, `source_revision`, `truncated`, `unread`, timestamps | 入力状態と生成物を関連付ける |
| `endings` | `session_id`, `owner_id`, `ending_json`, timestamps | 終了状態 |
| `session_tombstones` | `session_id`, `owner_id`, `deleted_revision`, `deleted_at_ms`, `expires_at_ms` | オフライン端末の遅延 PUT による復活を防止。保持期限後に削除 |

初回移行では互換性を優先し、現行 Session JSON を `state_json` へ保存する。その後、ログ件数や検索要件が増えた時点で `session_log_entries` へ段階分割する。

### 6.5 Party

| テーブル | 主な列 | 備考 |
|---|---|---|
| `party_sessions` | `id`, `owner_id`, `title`, `status`, `snapshot_json`, `revision`, `event_seq`, `chat_seq`, timestamps | Party 集約ルート |
| `party_participants` | `session_id`, `user_id`, `role`, `pc_id`, `joined_at_ms`, `left_at_ms` | Party 一覧はこの表から導出。別 membership 索引を同期しない |
| `party_pcs` | `id`, `session_id`, `owner_user_id`, `name`, `state_json`, `revision` | PC 単位状態 |
| `party_rounds` | `id`, `session_id`, `round_no`, `status`, `state_json`, timestamps | `(session_id, round_no)` 一意 |
| `party_events` | `session_id`, `seq`, `actor_user_id`, `type`, `audience_json`, `payload_json`, `created_at_ms` | `(session_id, seq)` 一意 |
| `party_chat` | `session_id`, `seq`, `actor_user_id`, `body`, `created_at_ms` | `(session_id, seq)` 一意 |
| `party_invites` | `token_hash`, `session_id`, `expires_at_ms`, `max_uses`, `used_count` | token 原文を保存しない |

参加者一覧、所有者一覧、Party 状態を別々の JSON ファイルとして重複保持しない。必要な表示形は query または read model で作る。

### 6.6 公開とインポート

| テーブル | 主な列 | 備考 |
|---|---|---|
| `content_versions` | `id`, `entity_type`, `source_entity_id`, `metadata_json`, `body_md`, `created_at_ms` | 公開時点の immutable snapshot |
| `published_items` | `id`, `owner_id`, `type`, `content_version_id`, `published_at_ms`, `withdrawn_at_ms` | 一覧・検索対象 |
| `import_provenance` | `target_type`, `target_id`, `source_public_id`, `source_version_id`, `imported_at_ms` | 再インポートと監査用 |

公開データをユーザーディレクトリから物理コピーし続けない。公開時に immutable version を作り、公開項目は version を参照する。インポートは編集可能な独立データを作るが、出典を記録する。

### 6.7 画像、容量、利用量

```text
storage_accounts
  owner_id PK
  used_bytes
  reserved_bytes
  limit_bytes
  updated_at_ms

storage_reservations
  id PK
  owner_id
  reserved_bytes
  purpose
  expires_at_ms

storage_items
  owner_id
  resource_type
  resource_id
  charged_bytes
  updated_at_ms
  PRIMARY KEY (owner_id, resource_type, resource_id)

media_assets
  id PK
  resource_key
  owner_id
  object_key UNIQUE
  byte_size
  sha256
  mime_type
  state           # pending / ready / deleting / deleted / failed
  created_at_ms

media_bindings
  resource_key PK
  asset_id
  updated_at_ms

daily_usage
  scope_type      # user / system
  scope_id        # user ID または予約済み system ID
  usage_day
  kind
  units
  PRIMARY KEY (scope_type, scope_id, usage_day, kind)
```

構造化データ更新では `delta_bytes = new_bytes - old_bytes` を計算し、次の条件付き更新を対象データと同じトランザクションで実行する。

```sql
UPDATE storage_accounts
SET used_bytes = used_bytes + :delta_bytes,
    updated_at_ms = :now_ms
WHERE owner_id = :owner_id
  AND (
    :delta_bytes <= 0
    OR used_bytes + reserved_bytes + :delta_bytes <= limit_bytes
  )
  AND used_bytes + :delta_bytes >= 0;
```

画像など外部 I/O を伴う作成では、同様の条件付き更新で `reserved_bytes` を先に増やす。確定時に予約を減らし、実 byte を `used_bytes` と `storage_items` へ反映する。ディレクトリ全走査は移行検証と定期監査だけに使う。

課金対象は SQLite ファイルの物理 page 数ではなく、正規化済み JSON/Markdown の UTF-8 byte 数と、S3 object の実 byte 数からなる論理容量とする。索引、WAL、backup、DB page overhead はユーザー容量へ含めず、運用ディスク容量として別監視する。

容量ポリシー:

- private/editable data は所有者へ課金
- Party 共有データは Party オーナーへ課金し、実行者は監査列へ記録
- 公開時に作る immutable version は公開元ユーザーへ新規課金
- 公開 version の参照自体は重複課金しない
- インポートで作る独立データはインポート先ユーザーへ課金
- starter、global metadata、システム監査情報は予約済み system scope へ課金
- キャッシュ、索引、期限付き job lease はユーザー quota 対象外とする

テキスト更新は旧 `storage_items.charged_bytes` と新 byte 数の差分を、対象データと同じトランザクションで台帳へ反映する。画像生成は最大予定量を予約し、S3 保存後に実 byte 数へ精算する。失敗・期限切れ予約は解放する。

### 6.8 ジョブと冪等性

```text
jobs
  id PK
  type
  aggregate_type
  aggregate_id
  status          # queued / running / succeeded / failed / canceled
  input_json
  input_revision
  input_hash
  idempotency_key UNIQUE
  attempts
  max_attempts
  available_at_ms
  lease_until_ms
  last_error_code
  created_at_ms
  updated_at_ms

idempotency_records
  actor_user_id
  operation
  idempotency_key
  request_hash
  status
  response_json
  expires_at_ms
  PRIMARY KEY (actor_user_id, operation, idempotency_key)
```

初期は Web プロセス内ワーカーが claim する。起動時に期限切れ lease を回収する。AI 呼び出しは DB トランザクション外で実行し、結果保存時に `input_revision` または `input_hash` を再確認する。

再送可能コマンドは結果と idempotency record を同じトランザクションで保存する。同じ key と同じ request hash の再送には保存済み結果を返す。同じ key で request hash が異なる場合は `409 Conflict` とする。

### 6.9 必須索引と制約

- 全所有データに `owner_id` index
- `game_sessions(owner_id, updated_at_ms DESC)`
- `published_items(type, published_at_ms DESC)`
- `party_participants(user_id, left_at_ms)`
- `party_events(session_id, seq)` と `party_chat(session_id, seq)` の一意制約
- `jobs(status, available_at_ms, lease_until_ms)`
- `storage_reservations(owner_id, expires_at_ms)`
- 全子テーブルの外部キーと削除方針

全文検索は初回移行の必須要件にしない。必要になれば SQLite FTS5 を read model として追加し、PostgreSQL 移行時は別実装へ置き換える。FTS index を正本にしない。

---

## 7. S3 画像設計

### 7.1 基本方針

- private bucket を使う
- object key にユーザー入力のパスを直接使わない
- immutable key を生成する
- DB へ `object_key`, `sha256`, `byte_size`, `mime_type`, `state` を保存する
- 配信は認可 API、短期 presigned URL、または認可済み CDN を使う
- 同一画像の複数サイズは別 asset とし、派生元を記録できるようにする
- Content-Type、最大 byte 数、画像デコード後寸法をサーバー側で検証する

新規書き込みのobject key:

```text
media/{owner-id}/{asset-id}.webp
```

既存画像は移行時に従来keyを維持する。`media_bindings.resource_key`が論理API pathとimmutable physical keyの対応を持つ。

### 7.2 DB と S3 の整合性

DB と S3 を一つの ACID トランザクションにはできない。状態機械で整合させる。

作成:

1. DB で `media_assets(state='pending')` を作成
2. transaction commit
3. S3 へ upload
4. DB transactionで`ready`化、`media_bindings`差替え、容量台帳更新、旧assetの`deleting`化
5. upload失敗は`failed`化し旧bindingを維持。process restart時は`pending` objectを照合してactivateまたはfail

削除:

1. DB で参照を外し `deleting` へ更新
2. commit
3. S3 object を削除
4. DB で `deleted` を確定。容量台帳はbinding削除時点で減算済み

起動時reconcilerが`pending`/`deleting`を回復する。孤立objectのbucket全件監査とdurable retry jobは追加課題。S3削除は冪等に扱う。

### 7.3 重複排除

`sha256` による重複排除は将来機能とする。初回実装では所有者単位の重複のみ許可し、異なるユーザー間で物理 asset を共有しない。ユーザー削除、公開解除、容量課金、アクセス制御が単純になる。

---

## 8. フロントエンド再設計

### 8.1 状態管理

- サーバーを永続状態の正本とする
- IndexedDB は取得済みスナップショット、未送信フォーム、障害復旧情報だけを保存する
- 保存成功レスポンスに revision を含める
- オフライン時は読み取りと下書きを許可し、再接続時に明示的な送信・競合解決を行う
- オフライン協調編集が必要になった場合だけ、全文 PUT ではなく operation log または専用同期方式を設計する

### 8.2 ゲームエンジン

能力値計算、ルール検証、Party コマンド適用など、決定的ロジックを `shared/domain` へ移す。サーバーは同じ関数を authoritative に実行し、クライアントはプレビューへ再利用する。

AI の自由形式出力を直接状態へマージしない。schema 検証、許可コマンド変換、ドメイン検証を通す。

### 8.3 配信サイズ

画面単位の lazy loading を導入する。Party、キャンペーン編集、公開ライブラリなどを route または機能単位で分割し、初期 bundle へ全画面を含めない。

---

## 9. 配備と運用

### 9.1 SQLite 期間の配備

```text
Render Web Service: exactly 1 instance
Persistent Disk:
  /data/gmdesk.sqlite3
  /data/backups/          # 一時生成のみ。最終バックアップは S3
S3-compatible bucket:
  media objects
  encrypted SQLite backup snapshots
```

環境変数例:

```text
DATABASE_DRIVER=sqlite
SQLITE_PATH=/data/gmdesk.sqlite3
OBJECT_STORAGE_DRIVER=s3
OBJECT_STORAGE_BUCKET=...
OBJECT_STORAGE_REGION=...
OBJECT_STORAGE_ENDPOINT=...   # AWS S3 なら省略可
OBJECT_STORAGE_PREFIX=gmdesk
OBJECT_STORAGE_FORCE_PATH_STYLE=false
```

SQLite DB を S3 マウント、NFS、複数インスタンス共有ディスクへ置かない。永続ディスクが一つのインスタンスへしか接続できないため、SQLite 期間は `WEB_CONCURRENCY=1` 相当を構成上保証する。

### 9.2 migration

- migration は連番 SQL とし、`schema_migrations` に適用履歴と checksum を保存する
- 起動前または release command で一度だけ実行する
- 展開と破壊的変更を分ける expand/contract を使う
- migration 失敗時はリクエスト受付を開始しない
- 本番データ相当のコピーで所要時間を事前計測する

### 9.3 バックアップ

- 稼働中 DB の単純なファイルコピーをしない
- `npm run backup:sqlite -- --output=...`でNode Online Backup APIの一貫したsnapshotを作る
- snapshot を暗号化された S3 bucket へ転送する
- 日次、週次、月次の保持数を定める
- backup ごとに `PRAGMA integrity_check`、サイズ、checksum を記録する
- 定期的に別環境へ復元し、件数・ログイン・代表シナリオを確認する
- Render disk snapshot だけを唯一のバックアップにしない

実装CLIは出力先の暗黙上書きを拒否し、作成後に`PRAGMA integrity_check`、`PRAGMA foreign_key_check`、byte数、SHA-256をJSON出力する。Node Online Backup API使用のためNode `>=24.15.0 <25`へ固定する。画像ファイルはこのDB snapshotに含まれないため、disk snapshot/別archiveも必須。

推奨初期目標:

- RPO: 24 時間
- RTO: 4 時間
- データ量と利用頻度増加後、RPO 1 時間を検討

### 9.4 ヘルスチェックと監視

`/live` はプロセス生存だけを返す。`/ready` は読み取り専用 DB query、migration version、書き込み停止フラグを検査する。S3 は起動時設定検証と継続メトリクスで扱い、一時障害だけで全 API を不健康にしない。

主要メトリクス:

- SQLite `BUSY` 発生数、write transaction 時間、query p95/p99
- WAL サイズ、checkpoint 時間、DB とディスク空き容量
- job queue 件数、最古 job の待ち時間、retry、期限切れ lease
- 容量予約残高、期限切れ予約、台帳と実測の差
- pending/deleting media 数、孤立 object 数、S3 エラー率
- AI 呼び出し時間、失敗率、token/画像利用量
- API 409、429、5xx、Party command latency

構造化ログへ `requestId`, `userId`, `ownerId`, `aggregateId`, `jobId` を含める。token、Cookie、AI 入力全文、private object URL は記録しない。

### 9.5 定期保守

- 期限切れ auth session、invite、storage reservation、job lease を掃除
- 参照のない media asset を grace period 後に削除
- Party セッション保持期間を明文化
- daily usage の集約・保持期間を設定
- `ANALYZE`、必要に応じた `PRAGMA optimize` を実施
- DB 容量、free page、WAL 増加を監視し、必要時だけ `VACUUM` を計画停止で実施

---

## 10. ファイルシステムからの移行計画

### Phase 0: 現行実装の安全化

目的: 移行前に所有権と削除不能問題を塞ぐ。

実装状況 (2026-08-02):

- [x] Party 更新の容量課金先を保存済み Party オーナーへ変更
- [x] 公開スナップショットを公開者へ課金し、Party membership index の重複課金を除外
- [x] 小説化ジョブ終了まで容量予約を保持
- [x] Session の削除 UI/API、生成物・公開小説のカスケード削除、復活防止 tombstone を追加
- [x] シーン画像の個別削除 API と参照除去を追加
- [x] SQLiteの所有者別差分台帳、trigger、期限付き予約を実装
- [x] Party/public/user/system/derivedの所有者判定をadapterとimporterへ実装
- [x] legacy keyごとの所有者判定と、認証前namespace用`--legacy-owner`を実装
- [x] 全データの件数、byte数、checksum、孤立参照を出すdry-run監査を実装
- [ ] 所有者・課金対象表を独立ADR文書として固定

完了条件:

- 誰の容量へ加算するか、全書き込み API で一意に決まる
- 上限到達ユーザーが不要データを削除できる
- legacy データの移行前 manifest を生成できる

### Phase 1: 永続化境界の導入

目的: 挙動を変えずに、route とファイルストアを分離する。

実装状況:

- [x] `createPersistence`、File/SQLite adapter、transaction注入、driver feature flag
- [x] data/text store contract、usage/job/storage repository contract
- [x] 利用量、job、容量を業務単位repositoryへ分離
- [x] routeへ許可moduleだけを公開するscoped repositoryを注入し、scope外アクセスを拒否
- [x] ObjectStorageをfilesystem/S3共通契約へ分離し、routeからSDKと物理pathを隠蔽
- [ ] route APIを汎用data/text操作から集約固有repository methodへ段階置換

- 業務操作単位の repository interface を定義
- 現行ファイルシステムを `File*Repository` adapter として包む
- `createApp` で dependency injection する
- repository contract test を作る
- `DATABASE_DRIVER=filesystem|sqlite` feature flag を追加

現段階の完了条件:

- route と domain service が物理filesystem、SQL、S3 SDKを直接参照しない
- 現行 adapter で既存テストが通る

### Phase 2: SQLite schema と adapter

目的: PostgreSQL と共有できる論理モデルを実装する。

実装状況:

- [x] checksum付き連番migration、SQLite最低version検査、WAL/FK/busy timeout/FULL同期
- [x] auth/library/session/campaign/party/publishing/usage/job/system別record tableと、module別document table
- [x] `domain_records`/`documents`を容量trigger・原子的rollback用mirrorとして同一transaction更新
- [x] 専用`usage_counters`/`jobs`/`storage_*`、`media_assets`/`media_bindings`
- [x] 単一coordinator、`BEGIN IMMEDIATE`、rollback/busy/transaction時間メトリクス
- [x] Party serviceを共通transaction境界へ接続
- [x] Session revision CASを`session_records.revision`の条件付きSQL更新へ移行
- [ ] JSON payload内の子要素を集約固有table・FK・unique制約へ完全分解

- versioned migration runner を作る
- auth、library、sessions、campaigns、party、publishing、usage、jobs の順に schema 作成
- SQLite repository adapter を実装
- foreign key、unique、check、revision 条件を DB で保証
- busy、transaction、checkpoint のメトリクスを追加

完了条件:

- repository contract test が File/SQLite の双方で通る
- Party、quota、Session CAS の並行性テストが通る
- migration を空 DB と旧 version DB の双方へ適用できる

### Phase 3: 移行ツール

目的: 再実行可能で検証可能なデータ変換を作る。

実装状況: 完了。`npm run migrate:sqlite`が`--dry-run`、`--validate-only`、`--confirm-offline`、journal、quarantine、checksum、owner manifest、孤立参照検査を持つ。認証前namespaceは`--legacy-owner`必須。新しい認証後コピーと重複する旧レコードは、同一IDかつ`updatedAt`が古い場合だけ`--accept-superseded-legacy`で明示承認し、旧ファイルを残したままjournalへ`superseded`を記録する。

移行ツール要件:

- オフライン実行を正とする
- legacy path/key と target table/id の対応を migration journal に保存
- 同じ入力を再実行しても重複しない
- JSON parse 失敗、参照欠落、owner 不明を quarantine へ分離
- 件数、byte 数、主要 checksum、孤立参照をレポートする
- dry-run と validate-only を持つ
- 変換不能データを暗黙に捨てない

移行順序:

1. users と external identities
2. worlds、characters、scenarios、rulesets
3. campaigns と chapters/drafts
4. Solo sessions、novels、endings
5. Party sessions、participants、PC、rounds、events、chat
6. published items と provenance
7. daily usage
8. storage account 初期値

初回移行では JSON 本文を保ち、意味的な完全変換を避ける。既存 ID は可能な限り維持する。

### Phase 4: SQLite カットオーバー

小規模運用では dual-write より短い maintenance window を選ぶ。dual-write は新旧の部分失敗と rollback 条件を複雑にする。

コード・runbookは実装済み。本番環境での実カットオーバーだけ未実施。ローカル実データ相当リハーサル結果: 413ファイル、14,338,393 byte、source checksum `05b3bf05d31284d2487a498358d3ec281cdbec17687e86e9fcc39844b8592808`、396件import、16 media保持、旧重複1件superseded、quarantine 0、孤立参照0、validate 413/413。module auditはrecord 267件、document 130件、全moduleでnormalized/mirror件数一致、mismatch 0。Online Backupは2,252,800 byte、`integrity_check`合格、foreign key違反0。所要時間は1秒未満だったが、本番永続ディスクI/Oで再計測する。

手順:

1. 事前リハーサルで時間とエラーを測定
2. アプリを read-only maintenance mode へ変更
3. ファイルデータの一貫した backup と manifest を取得
4. importer を実行
5. 件数、所有者別 byte、代表レコード、参照整合性を検証
6. `DATABASE_DRIVER=sqlite` へ切り替え
7. smoke test 後に書き込みを再開
8. legacy ファイルを read-only で保持

rollback 条件:

- 認証または主要集約の欠落
- 検証不能な容量差分
- 重大 API の repository 契約不一致
- 許容時間を超える lock/busy

rollback は書き込み再開前なら設定を File adapter へ戻す。書き込み再開後の逆同期は行わない。復旧判断が完了するまで maintenance mode を維持する。

### Phase 5: 画像を S3 へ移行

実装状況: コード完了、本番S3カットオーバー未実施。

- [x] `FilesystemObjectStorage`/`S3ObjectStorage`の同一contractとcontract test
- [x] private object、prefix namespace、pagination、checksum receipt、冪等delete
- [x] `media_assets`/`media_bindings`/`object_migration_journal` migrationとlegacy backfill
- [x] pending/ready/deleting/deleted/failed状態機械、置換時の旧binding維持、起動時reconcile
- [x] `npm run migrate:media:s3`のdry-run/import/validate-only、checksum/byte検証、再実行skip
- [x] インメモリObjectStorageによる移行contract test
- [ ] 本番private bucket/IAM/backup policy作成
- [ ] 本番データのoffline upload・validate・driver切替
- [ ] 保持期限と復元訓練後のローカル画像削除

DB 移行と画像移行を別 phase にして、障害範囲を限定する。過渡期は `FilesystemObjectStorage` と `S3ObjectStorage` の同じ契約を使う。

### Phase 6: 永続ジョブとサーバー正本化

実装状況:

- [x] 小説化jobの永続enqueue/claim/complete/fail、lease所有者、起動時回復
- [x] 回復時のSession存在確認と容量予約
- [x] S3 `pending`/`deleting`の起動時reconcile
- [ ] Party AI解決、Campaign生成、画像生成、S3補償retryのdurable job化
- [ ] IndexedDBをcache/draftだけへ限定するauthority整理

- 小説生成、重い AI 生成、S3 補償処理を `jobs` へ移す
- restart recovery、retry、idempotency、stale result discard を実装
- IndexedDB を cache/draft へ限定
- Session と Campaign の revision 更新を統一
- Party polling 負荷を測定し、必要なら単一プロセス向け SSE/WebSocket を導入

### Phase 7: 整理

実装状況: 未着手。File adapterは本番切替後の期限付きrollback用に保持する。

- legacy File adapter を feature flag 下で一定期間保持
- 復元訓練完了後に通常 runtime から File adapter を外す
- データ監査用 importer/validator は保守ツールとして残す
- 旧ディレクトリ削除は別作業とし、backup 保持期限と承認を設ける

---

## 11. PostgreSQL へ移行しやすくする規約

### 11.1 今から守る事項

- route/domain から SQL dialect を見せない
- repository contract test を DB 非依存にする
- DB 生成値へ依存せず、ID と時刻をアプリ境界で生成する
- query 対象属性を JSON の深い位置へ閉じ込めない
- SQLite 固有 PRAGMA、FTS5、`json_each` を infrastructure 層へ隔離する
- PostgreSQL 固有 enum、array、trigger 前提の domain contract を作らない
- transaction callback 内で外部 I/O を実行しない
- migration は SQLite 用と PostgreSQL 用に分け、論理 version を対応付ける
- SQL placeholder、boolean、JSON、時刻変換は adapter に閉じ込める

### 11.2 PostgreSQL 移行判断のトリガー

次のいずれかが継続的に発生した時点で移行を開始する。

- 複数 Web インスタンスまたはゼロダウンタイム配備が必要
- worker を Web サービスと別プロセス・別ホストへ分離したい
- `SQLITE_BUSY`、write transaction p95、WAL 増加が SLO を超える
- Party、チャット、ジョブの同時書き込みが増え、一 writer がボトルネック
- PITR、自動 failover、read replica が事業要件になる
- 計画停止による schema migration が許容できない

初期 SLO 例:

- 通常 API p95 < 300 ms（AI 処理を除く）
- DB write transaction p95 < 100 ms
- `SQLITE_BUSY` による最終失敗率 < 0.1%
- WAL が checkpoint 後も継続増加しない

SLO の単発超過ではなく、利用ピークを含む 2 週間以上の観測で判断する。可用性要件はメトリクスに関係なく優先する。

### 11.3 PostgreSQL 移行手順

1. `Postgres*Repository` を同じ contract で実装
2. PostgreSQL schema migration を作成
3. CI で SQLite/PostgreSQL の repository contract test を並列実行
4. SQLite Online Backup から一貫した snapshot を取得
5. maintenance mode で最終差分を停止
6. 外部キー順に PostgreSQL へ bulk load
7. JSON TEXT を `jsonb`、boolean を `boolean` へ変換
8. 件数、checksum、所有者別容量、参照整合性を検証
9. `DATABASE_DRIVER=postgres` へ変更
10. Web を stateless 化し、必要に応じて worker を分離
11. SQLite snapshot を rollback 保持期間中保存

S3 object key は変更しない。DB の media metadata だけを移す。

PostgreSQL で初めて利用する最適化:

- job claim の `FOR UPDATE SKIP LOCKED`
- JSONB GIN index（実測で必要な query に限定）
- connection pool
- read replica（必要時のみ）
- transactional outbox と別 worker

---

## 12. Redis 導入判断

Redis は SQLite と PostgreSQL の代替ではない。次の用途が必要になった時だけ追加する。

- 複数 Web インスタンス間の WebSocket/SSE fan-out
- 短寿命 presence、typing indicator
- 分散 rate limit
- 高頻度かつ消失可能な cache

永続ジョブ、ユーザー使用量、Party 正本、セッション正本は Redis へ移さない。Redis 障害時も DB 正本から回復できる設計にする。

---

## 13. テスト戦略

### 13.1 必須テスト

- Repository contract: File、SQLite、将来 PostgreSQL
- Migration fixture: 現行ディレクトリ構造の正常系・欠損・破損・旧形式
- Concurrency: Session CAS、Party command、event sequence、quota reserve
- Fault injection: AI timeout、S3 upload 後の DB failure、process restart、disk full
- Authorization: Party participant/owner、public/private、media access
- Idempotency: command retry、job retry、S3 delete retry、importer 再実行
- Backup restore: snapshot からの起動と主要 API smoke test
- Load: 想定ピークの Party、チャット、session save、job claim

### 13.2 データ移行の照合

| 照合項目 | 基準 |
|---|---|
| ユーザー件数 | legacy manifest と一致 |
| 集約件数 | 種別・所有者別に一致 |
| 本文 | 正規化前 byte または canonical checksum が一致 |
| Party event/chat | session ごとの件数と最大 sequence が一致 |
| 参照 | dangling foreign key 0 |
| 画像 | checksum、byte、参照数が一致 |
| 容量 | 定義済み課金対象の再計算値と台帳が一致 |
| quarantine | 0、または全件を手動承認 |

---

## 14. 実装順と見積もり単位

実装は巨大な一括 PR にしない。次の単位へ分割する。

現ブランチで1〜11のうち、module別table/scoped repository、Solo Session CAS、ObjectStorage/S3移行基盤、小説化job、backup/readinessまで実装。5〜7の集約内JSONを子tableへ分解する完全正規化と12のclient authority整理は段階移行。10は本番bucketへの実カットオーバーだけ未実施。

1. 所有権・容量ポリシー ADR と Phase 0 修正
2. Repository port と File adapter
3. SQLite connection/migration 基盤
4. Auth/usage repository
5. Library/campaign repository
6. Solo session repository
7. Party repository と transaction
8. Importer/validator
9. SQLite cutover
10. ObjectStorage port と S3 migration
11. Durable jobs
12. Client cache/authority 整理
13. Backup、監視、restore drill

各 PR は schema、adapter、contract test、運用手順を同時に含める。新旧実装が並存する期間を最短化する。

---

## 15. 意思決定記録

| ID | 決定 | 理由 | 再検討条件 |
|---|---|---|---|
| ADR-001 | SQLite を当面の主 DB とする | 現在の単一インスタンス構成で固定費を抑えられる | 複数インスタンス、write contention、PITR 要件 |
| ADR-002 | 画像は S3、Markdown は DB | バイナリ容量を分離しつつ本文 transaction を維持 | 大規模本文配信・全文検索要件 |
| ADR-003 | DB はユーザー別でなく 1 ファイル | Party、公開、認証、全体利用量の横断整合性が必要 | 法的な物理分離要件 |
| ADR-004 | Redis を初期導入しない | 現時点で正本・ジョブ用途に不要 | 複数 Web の realtime fan-out |
| ADR-005 | モジュラーモノリスを維持 | 運用複雑性を増やさず境界を改善できる | 独立スケール・独立リリース要件 |
| ADR-006 | カットオーバーは maintenance window | dual-write の整合性コストが規模に見合わない | 停止時間を許容できなくなった場合 |
| ADR-007 | IndexedDB はキャッシュ | 競合時の正本を一意にする | 正式な offline-first 要件 |

---

## 16. 最終受け入れ条件

### 16.1 SQLiteカットオーバー完了

- `MAINTENANCE_MODE=read-only`中に最終importとvalidate-onlyが`ok:true`
- quarantine・孤立参照0、または全件に承認記録
- Online Backup APIで作ったsnapshotが`integrity_check`/`foreign_key_check`合格
- `DATABASE_DRIVER=sqlite`で`/ready`が200、migration版一致
- 認証、代表CRUD、Session同期、Party、公開/Import、小説化のsmoke test合格
- 容量台帳監査で`usedBytes == measuredBytes`
- 書き込み再開前のfilesystem rollback手順確認
- legacyファイルを削除せずread-only保持

### 16.2 全体再設計・SQLite/S3移行完了

以下はコード実装だけでなく、本番カットオーバーと運用検証を含む最終条件。現時点では未達。

- 通常リクエストが legacy data directory を読み書きしない
- 全永続更新が repository/domain service を通る
- Party 共有更新の所有者・実行者・課金先が記録される
- 容量台帳が原子的に更新され、定期監査と一致する
- 複数エンティティ更新が DB transaction で完結する
- DB・S3 間の pending/deleting が自動回復する
- 小説生成がプロセス再起動後に再開または安全に retry される
- Online Backup から別環境へ復元できる
- `SQLITE_BUSY`、WAL、job、quota、media の主要指標を監視できる
- File adapter へ戻す期限付き rollback 手順が検証済み
- PostgreSQL repository contract を追加できる境界が保たれる

---

## 17. 参考資料

- [SQLite: Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html)
- [SQLite: Isolation In SQLite](https://www.sqlite.org/isolation.html)
- [SQLite: Write-Ahead Logging](https://sqlite.org/wal.html)
- [SQLite: Online Backup API](https://www.sqlite.org/backup.html)
- [SQLite: SQLite Over a Network](https://www.sqlite.org/useovernet.html)
- [Render: Persistent Disks](https://render.com/docs/disks)
- [PostgreSQL: JSON Types](https://www.postgresql.org/docs/current/datatype-json.html)
- [PostgreSQL: INSERT](https://www.postgresql.org/docs/current/sql-insert.html)
- [PostgreSQL: SELECT / SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html)
- [Amazon S3: Data consistency model](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html)
