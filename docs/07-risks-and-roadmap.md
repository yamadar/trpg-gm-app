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
- ログの小説化書き出し: `POST /api/sessions/:id/novelize`でAIがログを小説形式に書き直し保存、Home画面から「小説化」ボタンでMarkdownダウンロード(`server/routes/sessions.js`, `src/screens/Home.jsx`)
- シナリオ複数対応: 素材ライブラリ(ScenarioタブでWorldごとに複数保存)+ Setupのシナリオステップで既存Scenarioから選択可能(選択画面という単独UIではなくSetupフローに統合される形)

**Phase 3**
- マルチプレイヤー
- 画像生成連携(シーン挿絵): 全サブプロジェクト実装済み(2026-07-24、06-content-generation.md 10.5節)。1=基盤+Playシーン挿絵+テキスト方式の見た目一貫性、2=挿絵付き小説化、3=自動ポートレート+参照画像による強い一貫性。ライブラリCharacterタブでのポートレート表示のみ将来候補。
- NPC記憶モデル

## 10. 設計決定事項

| 論点 | 決定 |
|---|---|
| 入力方式 | 自由記述を主とする。GMが選択を絞りたい場面のみ「AとBどちら?」「Yes/No?」等の形で問いかける(選択肢ボタンは補助) |
| ルールシステム | システム非依存を志向していたが、**実装は全Ruleset共通のd100成功率%判定に統一**(`src/engine/dice.js`)。Ruleset(D&D5e/CoC/GURPS風等)による差は演出hintのみで、判定式そのものを切り替えるアダプタ方式(10.1節)は未実装 |
| GM専用情報の漏洩対策 | 一旦プロンプト設計のみで対応。2段階検証(別AIによる出力フィルタ)は必要になった時点でPhase以降に追加 |
| セッション長 | シナリオ依存で可変(15分〜3時間)。固定のターン数設計はせず、要約トリガーを時間ではなくターン数/トークン量ベースで動作させる |

### 10.1 ルールシステム非依存化の実装方針(未実装・将来案)
**現状は未実装**。実装では全Rulesetが`roll_check`ツール経由でAIが設定した`success_percent`に対する`d100 <= success_percent`判定式を共通で使い(`src/engine/dice.js`)、Ruleset差(CoC7e風/D&D5e風/GURPS風等)は system prompt内の`hint`による演出指定のみに留まる(03-gm-logic.mdの5章、02-data-model.mdの3.5.1節参照)。以下は将来、判定式自体をルールごとに切り替えたくなった場合の設計案として残す。

判定式をアダプタ化する。成功率だけでなく、成功度の扱いと副作用トリガーも持たせる(単純な確率変換だけでは「成功度」や「判定に伴う副作用」を再現できないため)。
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
- **上流タイムアウト**: `/api/messages`・`/api/sessions/:id/novelize`のAnthropic呼び出しに`AbortSignal.timeout`を設定し、ハングを防止。
- **novel鮮度管理**: 小説化後にセッションが進行した場合、`GET /api/sessions/:id/novel`が`stale`フラグを返し、Home画面が古い小説であることを警告する。また小説化が`max_tokens`で打ち切られた場合は保存せずエラーを返す(途中で切れた小説を保存しない)。
- **入力検証・アトミック書き込み**: PUT系エンドポイントの必須フィールド型チェック、`dataStore.set`のtmpファイル+rename方式によるアトミック書き込み(書き込み中のクラッシュでファイルが壊れないようにする)。

## 12. 未対応のリスク: プロキシ認証

`POST /api/messages`は現状、ローカル単一ユーザー利用を前提にした**無認証の中継エンドポイント**である。呼び出し元を検証する仕組みが無いため、このサーバーをそのままネットワークに公開したり複数ユーザーで共有したりすると、Anthropic APIキーを誰でも使い放題にできてしまう。FX3では`max_tokens`の上限チェック(`max_tokens too large`で拒否)等、比例的な緩和策のみ実施した。ネットワーク公開や多ユーザー化を行う前には、認証(APIキー・セッショントークン等)の追加が必須。
