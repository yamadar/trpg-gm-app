# リスク・ロードマップ・設計決定事項

## 8. 留意点・リスク一覧

| 種別 | リスク | 対策 |
|---|---|---|
| 技術 | コンテキスト長超過 | 実装は`history_summary`の毎ターンGM書き換え+`recent_log`直近12件保持のみ。閾値超過での自動圧縮トリガーは未実装(03-gm-logic.md参照) |
| 技術 | 一貫性崩壊(設定忘れ・矛盾) | state=真実源、AIには毎回全量注入 |
| 技術 | 判定改ざん | ロールはコード側実行に固定 |
| 技術 | 自由入力パース失敗 | 不明時はGMが確認質問を返す設計 |
| 設計 | GM専用情報の漏洩 | プロンプト内で明確に区分、出力後フィルタも検討 |
| 設計 | シナリオ逐語 vs 裁量のバランス | シナリオMarkdown内で「厳守」「裁量可」を明示タグ分け |
| 設計 | セーブデータ互換性 | schema_versionによる移行処理(**未実装**。04-persistence.mdと整合) |
| 運用 | APIコスト・レイテンシ | ターンあたりトークン量の監視、要約で圧縮 |
| コンテンツ | 暴力/性描写等の扱い | 年齢層・利用規約に応じた事前フィルタ方針を明文化 |

## 9. 実装フェーズ計画

**Phase 1 (MVP)**
- 単一シナリオ、単一PC、テキストのみ
- 判定システム実装(tool_use + ローカルロール)
- state永続化(IndexedDB)

**Phase 2 — 以下はすべて実装済み**
- キャラクター成長・経験値: `ruleset.growthUnit`単位の成長ポイント。GMが毎ターン`state_update.xp_gained`で提示し`state.xp`に加算、Play画面に表示(`src/data/rulesets.js`, `src/api/prompts.js`, `src/screens/Play.jsx`)
- ログの小説化書き出し: `POST /api/sessions/:id/novelize`でAIがログを小説形式に書き直し保存(2026-07-25に非同期ジョブ化、06-content-generation.md 10.6節参照)、Home画面から「小説化する」ボタンで開始し完了後「小説をDL」でプレーンMarkdown、挿絵があれば「挿絵付きでDL」で画像内包HTMLをダウンロード(`server/routes/sessions.js`, `server/novelJobs.js`, `src/screens/Home.jsx`)
- シナリオ複数対応: 素材ライブラリ(ScenarioタブでWorldごとに複数保存)+ Setupのシナリオステップで既存Scenarioから選択可能(選択画面という単独UIではなくSetupフローに統合される形)

**Phase 3**
- マルチプレイヤー
- 画像生成連携(シーン挿絵): 全サブプロジェクト実装済み(2026-07-24、06-content-generation.md 10.5節)。1=基盤+Playシーン挿絵+テキスト方式の見た目一貫性、2=挿絵付き小説化、3=自動ポートレート+参照画像による強い一貫性。ライブラリCharacterタブでのポートレート表示のみ将来候補。
- NPC記憶モデル

## 10. 設計決定事項

| 論点 | 決定 |
|---|---|
| 入力方式 | 自由記述を主とする。GMが選択を絞りたい場面のみ「AとBどちら?」「Yes/No?」等の形で問いかける(選択肢ボタンは補助) |
| ルールシステム | **実装済み(2026-07-25)**。判定式アダプタ(`src/engine/rulesetAdapters.js`、`getAdapter`)により`formula`ごとにsimple(旧来のd100成功率%判定)/coc7e(ハード・イクストリーム成功、SAN副作用)/dnd5e(固定5%クリティカル・96+ファンブル)/gurps(同左+margin付与)を切り替え。未知の`formula`は`simple`にフォールバック。詳細は10.1節 |
| GM専用情報の漏洩対策 | 一旦プロンプト設計のみで対応。2段階検証(別AIによる出力フィルタ)は必要になった時点でPhase以降に追加 |
| セッション長 | シナリオ依存で可変(15分〜3時間)。固定のターン数設計はせず、要約トリガーを時間ではなくターン数/トークン量ベースで動作させる |

### 10.1 ルールシステム非依存化の実装方針(実装済み)
**実装済み(2026-07-25)**。判定式は`formula`ベースでアダプタ化されている(`src/engine/rulesetAdapters.js`の`getAdapter`)。各アダプタは`degrees`(成功度語彙: fumble/fail/success/hard/extreme/critical)・`evaluate(successPercent, rng)`・`resourceDefs`・`sideEffectKinds`・`sideEffect(kind, degree, rng)`・`promptText`を持つ。simpleは旧来の`evaluateRoll`(`src/engine/dice.js`)委譲、coc7eは出目1でcritical/100または(p<50かつ96+)でfumble/ceil(p/5)でextreme/ceil(p/2)でhard、dnd5e/gurpsは成功率によらず固定5%critical・96+fumbleを成功判定より先に評価する(gurpsはさらにmargin=成功率-出目をAIに渡す)。未対応の`formula`は`simple`にフォールバック(サーバー書き込み時にも丸められる)。ビルトインRulesetは`formula`を持ち、カスタムRulesetもライブラリのRulesetタブで基準式を選択できる。

当初案との差分は2点。(1) `side_effect_triggers`はシナリオ側がイベントにタグを振る方式ではなく、`roll_check`ツールに追加した`check_kind`(副作用kindを持つアダプタのみ)をAIが判定時に指定することで発火し、減少量自体はエンジン側(`sideEffect`)が決定論的に計算して`san_loss`/`san_now`としてAIへ返す方式にした(`src/api/prompts.js`, `src/api/session.js`)。(2) リソースはSAN(正気度、coc7eのみ、`max: 99, initial: 60`)の1種類のみを実装し、HP等の追加リソースやSANをPOW等の能力値から導出する仕組み・回復ルール・狂乱表・SAN0での強制的なPCロスは対象外とした(SAN0はAIに狂気の描写を指示するのみで、ゲーム的なセッション終了処理は行わない)。取得したSANはセッション作成時に`session.state.resources`へ初期化され、`CharacterPanel`に表示、`takeTurn`が返す`resourceChange`を`Play.jsx`側でstateへマージする(セッションをエンジン内で直接変更しない設計)。**意図的な仕様**として、キャンペーンが次章へ進む際の引き継ぎ(`carriedPc`)はPCシート本文とxpのみを対象とし、`state.resources`は含まない。そのため次章では前章終盤のSAN残量に関わらず60/99へ再初期化される(02-data-model.md 3.5節参照)。

以下は当初の設計案(判定式アダプタ化の出発点になったJSON)を経緯として残す。
```json
{
  "ruleset": "coc7e",
  "check_formula": "d100_under_skill",
  "params": {"skill_source": "skills"},
  "success_degrees": ["fumble", "fail", "success", "critical"],
  "side_effect_triggers": [
    {"on": "horror_event", "effect": "sanity_check", "note": "成功してもSAN減少あり"}
  ]
}
```
シナリオ側で `ruleset` を指定 → Game Engineが対応する判定関数をロード。未対応rulesetは`simple`(成功度なし、副作用トリガーなしの単純%判定)にフォールバック。

`side_effect_triggers`はシナリオ側のイベント(`horror_event`等)とルール側の副作用(`sanity_check`)を結びつける役割。世界観・シナリオ作者がイベントにタグを振り、rulesetアダプタがそのタグに対応する副作用を発火させる。

## 11. 実施済みの対策(FX1〜FX3)

初期実装後の監査(FX1〜FX3)で、以下の堅牢化を実施済み。

- **LLM出力の正規化+エラーバウンダリ**: GM応答JSONの型が崩れていても`narrative`/`choices`/`state_update`の各フィールドをデフォルト値にフォールバックさせる`normalizeTurnResult`(`src/api/turnResult.js`)を追加。加えてReactの`ErrorBoundary`(`src/main.jsx`)で予期しない例外時にも画面が白くならないようにした。
- **saveSession失敗の顕在化**: IndexedDBへの保存が失敗した場合、`Play.jsx`が警告バナーを表示し、そのターンが保存されていない可能性をユーザーに伝える(以前は失敗が握りつぶされていた)。
- **ロール判定の修正**: `evaluateRoll`のfumble判定・NaN(不正なsuccess_percent)時のフォールバックを修正(`src/engine/dice.js`)。
- **UIの状態リーク/並行実行/エンコード修正**: Home画面での小説化の同時クリック・二重ダウンロード防止、ライブラリ画面でのWorld切り替え時のリクエスト競合(古いレスポンスでの上書き)防止、APIクライアントでの`encodeURIComponent`によるパスパラメータエンコード漏れ修正など。
- **パストラバーサル対策**: サーバー側の全パスパラメータを`idParamGuard`/`kindParamGuard`(`server/routes/validateId.js`)で検証し、`..`や不正文字を含むIDを`400`で拒否(04-persistence.md参照)。
- **deleteWorldカスケード**: World削除時に配下のCharacter/Scenario/region/categoryもまとめて削除するようにし、孤立データが残らないようにした。
- **上流タイムアウト**: `/api/messages`・`/api/sessions/:id/novelize`のGemini呼び出しに`AbortSignal.timeout`を設定し、ハングを防止。
- **novel鮮度管理**: 小説化後にセッションが進行した場合、`GET /api/sessions/:id/novel`が`stale`フラグを返し、Home画面が古い小説であることを警告する。また小説化が`max_tokens`で打ち切られた場合は継続リクエストで書き足させ、継続上限に達してもなお終わらなければ`truncated`フラグ付きで保存してHome画面が末尾欠落の可能性を警告する(06-content-generation.md 10.6.1節)。
- **入力検証・アトミック書き込み**: PUT系エンドポイントの必須フィールド型チェック、`dataStore.set`のtmpファイル+rename方式によるアトミック書き込み(書き込み中のクラッシュでファイルが壊れないようにする)。

## 12. 運用リスク: API利用コスト

`POST /api/messages`は`createRequireAuth`配下にあり、有効なログインセッションを必須とする。サーバー側のGemini APIキーをブラウザへ公開せず、ユーザー単位の日次利用制限と`max_tokens`上限を適用する。残るリスクは、登録ユーザー全体の利用料をサービス運営者のAPIキーへ集約する点。公開運用時は`LIMIT_MESSAGES_PER_DAY`を利用者数・予算に合わせて設定する。
