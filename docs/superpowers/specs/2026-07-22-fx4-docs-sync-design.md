# 監査修正 FX4: ドキュメント整合 設計ドキュメント

## 1. 背景・目的

監査で洗い出したドキュメント(`docs/*.md` 8ファイル)と実装の乖離を修正する。ドキュメントは早期に書かれ、その後多くの機能(素材ライブラリ、Setup連携、goal/bonds注入、カスタムRuleset、growthUnit/xp、サーバー同期、小説化、FX1〜FX3の堅牢化)が実装されたため、多数の記述が実態とずれている。本FX4はコード変更を伴わず、ドキュメントを現行実装に一致させる。

## 2. スコープ

`docs/README.md`, `docs/01-architecture.md`, `docs/02-data-model.md`, `docs/03-gm-logic.md`, `docs/04-persistence.md`, `docs/05-ui-ux.md`, `docs/06-content-generation.md`, `docs/07-risks-and-roadmap.md` を実装に一致させる。`docs/superpowers/`配下(spec/plan)は履歴記録であり変更しない。

## 3. 各ドキュメントの修正内容(実装を正とする)

### 3.1 docs/03-gm-logic.md
- `roll_check`のスキーマを実装(`src/api/prompts.js`の`ROLL_TOOL`)に合わせる: 入力は`{check_label: string, success_percent: integer(0-100)}`。AIは成功確率を直接設定する(skill/difficultyのペアではない)。「AIの役割は難易度判断のみ」を「成功確率の設定」に訂正。
- 判定エンジンは全Ruleset共通の`d100 <= success_percent`(1-99クランプ、成功時5%以内でcritical、失敗時96以上でfumble)。Ruleset差は演出hintのみで判定式は同一である旨を明記。
- ターン出力JSONを実装(`prompts.js`)に合わせる: `state_update`は`{current_scene, flags, history_summary, xp_gained}`、加えて`narrative`/`choices`。
- 履歴管理: `recent_log`は毎ターンGMが`history_summary`を書き換える方式で、閾値超過での圧縮トリガーは未実装(`src/screens/Play.jsx`は直近12件保持のみ)である旨に訂正。

### 3.2 docs/02-data-model.md
- `session.state`の形状を実装(`Setup.jsx`/`Play.jsx`)に一致: `{current_scene, flags, history_summary, recent_log, turn_count, xp}`。`current_region`/`tension_level`/`revealed_facts`はコードに存在しないため削除または「未実装(将来案)」と明記。`recent_log`は文字列配列ではなく`{role, text}`オブジェクト配列(最大12件)。
- §3.3と§3.5のstate形状の矛盾を解消(単一の正しい形状に統一)。
- 構造化キャッシュ: `*.parsed.json`は独立ファイルではなく、Characterの主メタレコード(`worlds/{worldId}/{kind}/{name}.parsed.json`)に`parsed`/`parsedHash`フィールドとしてネストされる(`server/storage/characterLibrary.js`)。抽出は`goal`/`bonds`のみ、PCのみ(NPCは未パース)。statsは抽出しない。
- `goal`(単数)に統一(コードは`goal`)。
- Characterフォルダ位置を`worlds/{world_id}/pc|npc/`に統一(§3.1.1のトップレベル記述を訂正)。
- Ruleset(§3.5)に`growthUnit`フィールドを追加。ユーザー作成のカスタムRulesetが存在することを明記。
- `session`に`ruleset`(埋め込みスナップショット`{id,label,desc,hint,growthUnit}`)と`rulesetId`が併存し、`buildSystemPrompt`は`ruleset`を優先することを明記。
- World `source.md`(原文保持)、`sessions/{id}/novel.md`(小説)、`sessions/{id}/novel.json`(鮮度メタ)の保存位置をフォルダツリーに追加。
- **Campaign**: データモデルに一級市民として記載されているが未実装(パスヘルパ`campaignMetaKey`のみ、ルート/ストレージ/UIなし)である旨を明記(「将来対応」扱いに)。

### 3.3 docs/04-persistence.md
- 「フロントエンドからサーバーAPIへ同期する配線は未実装」を訂正: `Play.jsx`が毎ターン`PUT /api/sessions/:id`で自動同期する(`src/api/sessionSyncClient.js`)。
- 「World/Character/Scenario/Rulesetの保存API配線は未実装」を訂正: 全CRUDルート稼働 + 素材ライブラリUI稼働。
- サーバーAPIサーフェスを追記: worlds/characters/scenarios/rulesets CRUD、worldContent(source/region/category、list含む)、sessions(get/put/list、`POST .../novelize`、`GET .../novel`)。
- `schema_version`は依然未実装である旨(§07との整合)。
- FX3で追加した堅牢化(パラメータ検証で不正idを400拒否、入力検証、アトミック書き込み、deleteWorldカスケード)を追記。

### 3.4 docs/05-ui-ux.md
- 「キャラシートパネル常時表示」は未実装(`Play.jsx`はタイトル/シーン/成長ポイント/ログ/入力のみ)である旨に訂正。HP追跡はデータモデルに無い。
- Setupフロー(§14.2)を実装に一致: 5ステップ(世界観/シナリオ/ルール/PC/確認)、各ステップで既存選択/新規作成/(Worldは空欄スキップ)を選べる。ファイル/フォルダ取り込み対応。
- Home画面(§14.1)を実装に一致: セッションカードはタイトル+シーン+手数+直近GM行、各カードに「小説化」ボタン(ダウンロード)。
- 素材ライブラリ画面(§14.3)を実装に一致: World/Character(PC/NPC)/Scenario/Rulesetのタブ(Campaignタブは無い)。region/category内訳の表示・編集がある。
- 「region/category等の内部用語をユーザーに見せない」記述は、実際のライブラリUIがこれらを表示・編集するため実態に合わせて訂正(素材管理者向けには表示する方針であることを明記)。
- Play画面に成長ポイント(`{growthUnit}: {xp}`)表示がある旨を追記。

### 3.5 docs/06-content-generation.md
- 世界観注入は実装では要約(`session.world.summary`)のみを毎ターン注入する。current_regionに応じた選択的region注入・`relevant_docs`・キーワードマッチは未実装である旨に訂正。
- §3.2.1(全文注入はコスト破綻)と§12(固有名詞は全文注入)の矛盾を解消(実態=要約注入に統一)。
- goal/bonds: 実装は毎ターンの緩い指示(「可能な範囲で絡める」)。必須「最低1つ」や定期リマインドは未実装。ライブラリ紐づきPCのgoal/bonds抽出→プロンプト注入が稼働している旨を明記(`characterSheetCache.js`/`prompts.js`)。
- シナリオ生成: 実装は`handleStart`内で一度生成しプレビュー/微調整ステップは無い。ジャンルテンプレート表は未実装で生ジャンル文字列を渡す旨に訂正。

### 3.6 docs/07-risks-and-roadmap.md
- Phase 2項目のうち実装済みを明記: キャラクター成長・経験値(growthUnit/xp)、ログの小説化書き出し(novelize)、シナリオ複数対応(素材ライブラリ+Setup選択)。
- §10.1のルールアダプタ方式(判定式切替・skill値・success_degrees・side_effect_triggers)は**未実装**で、現状は全Rulesetが同一の%判定である旨を明記(将来案として残す)。
- `schema_version`による移行処理は依然未実装(§04と整合)。
- FX1〜FX3で実施した堅牢化のサマリを「実施済みの対策」として追記: LLM出力の正規化+エラーバウンダリ、saveSession失敗の顕在化、ロール判定の修正、UIの状態リーク/並行/エンコード修正、パストラバーサル対策、deleteWorldカスケード、上流タイムアウト、novel鮮度、入力検証、アトミック書き込み。
- **プロキシ認証の未対応**を明記: `POST /api/messages`は現状ローカル単一ユーザー前提の無認証中継であり、ネットワーク公開・多ユーザー化の前に認証が必要(FX3で`max_tokens`上限等の比例的緩和のみ実施)。

### 3.7 docs/01-architecture.md
- 「プロキシは中継のみ(ロジックを持たない)」を訂正: サーバーは小説化(独自プロンプト+Anthropic直接呼び出し+保存)と全ライブラリCRUDのビジネスロジックを持つ。中継は`/api/messages`のみ。
- 「アダプタ方式」(ルール判定式切替)は未実装で将来案である旨を反映。

### 3.8 docs/README.md
- ルール判定の「アダプタ方式」記述を、現状は全Ruleset共通の%判定(演出のみRuleset差)である旨に訂正。実装済み機能の概要(素材ライブラリ、成長ポイント、小説化書き出し)を反映。

## 4. 非スコープ

- コード変更は一切行わない(ドキュメントのみ)。
- `docs/superpowers/`配下の履歴(spec/plan)は変更しない。
- 追加テストはFX5。

## 5. 完了条件

各ドキュメントの主要な事実記述が現行コードと一致すること(レビューでコードと突き合わせて確認)。ビルド/テストへの影響は無い(ドキュメントのみ)。
