# GMロジック・判定システム

## 4. GMロジック(ターン処理フロー)

1. プレイヤー入力受付(自由記述 or 選択肢クリック)
2. Game Engine(`src/api/prompts.js`の`buildSystemPrompt`)がsystemプロンプトを構築
   - 世界観(`session.world.summary`。3.2.1節参照)、シナリオ(GM専用情報含む、プレイヤー出力からのフィルタは出力側=AI自身への指示で行う)
   - PC設定(`session.pc.raw`)。goal/bondsが抽出済みなら別枠で明示
   - ルール性向(`ruleset.label`/`hint`)
   - 直前state(current_scene, flags, history_summary, explained_terms)
   - 直近ログ(recent_log)
3. Google Gemini API呼び出し(`src/api/session.js`の`takeTurn`、サーバー変換は`server/textProvider.js`)
   - 判定必要と判断 → tool_use `roll_check({check_label, success_percent, check_kind?})` を返す。`check_kind`はアダプタが副作用kind(coc7eの`sanity`等)を持つ場合のみスキーマに追加される任意フィールド(`src/api/prompts.js`の`buildRollTool`)
   - Game Engine側(`src/engine/rulesetAdapters.js`の`getAdapter(formula).evaluate`。simpleは`src/engine/dice.js`の`evaluateRoll`に委譲)でd100ロールと判定式アダプタ別のdegree算出を実行 → `check_kind`に対応する副作用があれば`sideEffect`が決定論的にリソース増減(SAN等)を計算・反映 → 結果(roll/success/degree、副作用があれば`san_loss`/`san_now`)をtool_resultとして返送 → 続きの物語生成(詳細は5章)
4. 応答から構造化出力を抽出(実際の出力形式。`src/api/prompts.js`の指示文)
   ```json
   {
     "narrative": "地の文(150〜250字程度)",
     "state_update": {
       "current_scene": "更新後のシーン名",
       "flags": [{"key": "追加/更新分のみ", "value": true}],
       "history_summary": "更新後の物語要約(300字程度)",
       "xp_gained": 0,
       "tension_level": "medium",
       "ending_reached": false,
       "newly_explained_terms": ["このターンで初出説明した用語"]
     },
     "choices": ["選択肢1", "選択肢2", "選択肢3"]
   }
   ```
   `flags`は構造化出力制約に合わせた`{key, value}`配列で受け取り、Game Engineがstate保存前にオブジェクトへ変換する。`xp_gained`は`ruleset.growthUnit`単位の成長ポイント増分(02-data-model.md 3.5.1節参照)。`ending_reached`は**実装済み(2026-07-25)**のbooleanで、物語が結末(エンディング)に到達しこれ以上続ける必要がない場合のみtrue、それ以外は必ずfalse。trueが返ると`state.ending_reached`に反映され、Play画面が終了確定の案内カードを出す(02-data-model.md 3.3節・05-ui-ux.md参照)。`newly_explained_terms`はこのターンで初出説明した一般的でない用語・地名だけを返し、`state.explained_terms`へ重複なく蓄積する。初出説明はnarrative内で行う(choices・current_sceneへ新語を出す場合も、同ターンのnarrativeで先に登場させて説明させる)。出力の揺れは`src/api/turnResult.js`の正規化処理で吸収する。
5. Game Engineがstate_updateを検証・確定・保存(IndexedDB。加えてサーバーへも自動同期。04章参照)
6. UIにnarrative・choices反映

**選択肢のネタバレ防止**: `choices`はPCがその時点で知覚・把握している材料(同ターンのnarrativeで実際に描写した内容、`recent_log`、`history_summary`、既知フラグ、PC設定、`explained_terms`)だけで組み立てるよう指示している。そのどこにも出ていない人物・場所・物・出来事・事実を選択肢で初出させない、まだ確かめていない結果や隠された真相・PCが抱いていない推理を先取りしない、というのが要点。情報開示はnarrative側の役割で、開示したい手掛かりは先にnarrativeでPCが見聞きする形にしてから選択肢にする(同ターン内でよい)。指示は`src/api/prompts.js`の「選択肢の作り方」節・`choices`スキーマのdescription・`buildTurnUserContent`の毎ターン注意書きの3箇所に置いている。開示をnarrativeへ寄せる分、narrativeの150〜250字を圧迫するため、同節で紙幅の配分も指定している(新要素は1ターン1〜2個まで、優先順位は「行動の結果 > 新要素の導入 > 情景の装飾」、収まらない手掛かりは出さず次ターンへ回す)。字数指示自体はソフトな目安で、切り詰めや検証は行っていない(ハード上限は`src/api/session.js`の`max_tokens`のみ)。

**履歴管理**: `history_summary`は毎ターンGM自身が書き換える(閾値超過を検知して圧縮する専用トリガーは無い)。`recent_log`は直近12件の`{role, text}`を保持するだけの簡易バッファで、超過分は`Play.jsx`が先頭から捨てる。初出説明の判定は短期ログだけに頼らず、セッション全体で保持する`explained_terms`を使う。

### 4.1 Partyラウンド処理(実装済み2026-08-01)

Partyはクライアントごとのターン処理を行わない。`server/partyService.js`が全参加者のcommandを直列化し、一つの共有stateを次の順で更新する。

1. 各参加者が担当PCの行動を提出・更新・撤回し、提出済み行動は全員へ公開する。
2. 全アクティブ参加者ready後の5秒grace、またはサーバー時刻の締切でラウンドをlockする。入力中leaseが残る未提出者がいれば15秒ずつ最大90秒延長する。
3. 未提出PCへ`awayPolicy`に従う防御・警戒・援護のauto intentを補い、2ラウンド連続無反応なら`away_auto`へ移す。人間行動が一件も無ければAIを呼ばず停止する。
4. `server/partyGeneration.js`が全行動の両立・主行動と援護・別Scene・排他的決定・必要判定を一度に計画する。排他的なParty決定だけ2〜4案の投票へ移し、多数決、同数なら持ち回り先導PCの票で決める。
5. コードが`rulesetAdapters`で判定を実行する。判定は1PCにつき最大1件、合計PC数以下。AIは出目・成功を決めない。
6. 確定した判定結果をAIへ戻し、一つのglobal更新、Scene/PC更新、`all|scene|pcs` audience付き描写、PC別選択肢を生成する。構造検証後だけsnapshotへ一度適用する。

AI失敗・不正出力・利用枠超過時は提出行動を保持したまま`paused`へ移す。チャット本文は計画・描写どちらのAI入力にも含めない。

---

## 5. 判定システム

- ダイスロールは必ずクライアント側JSで実行(乱数・検証可能性の担保)。判定式は`formula`ごとにアダプタ化されている(**実装済み・2026-07-25**、`src/engine/rulesetAdapters.js`の`getAdapter`)。詳細は07-risks-and-roadmap.md 10.1節参照。
- AIの役割は「判定が必要かどうか」の判断と、その状況での**成功確率(success_percent, 0-100)の設定**。skill値や難易度クラスのペアではなく、AIが確率を直接決める。結果そのもの(ロール)は生成しない。
- tool_use形式で実装(`src/api/prompts.js`の`buildRollTool`。副作用kindを持たないアダプタでは静的な`ROLL_TOOL`と同一):
  ```json
  {"name": "roll_check", "input": {"check_label": "崖を登る", "success_percent": 60, "check_kind": "sanity"}}
  ```
- 各アダプタの`evaluate(successPercent, rng)`はsuccess_percentを1-99にクランプ(NaNは50)しd100を振り、アダプタ別の評価順でdegreeを決める。共通degree語彙は`critical`(会心)/`extreme`(イクストリーム成功、coc7eのみ)/`hard`(ハード成功、coc7eのみ)/`success`(通常成功)/`fail`(失敗)/`fumble`(大失敗)の部分集合:
  - `simple`(既定・旧来踏襲): 成功判定が先。roll ≤ success_percentなら成功側(さらに上位5%相当でcritical)、それ以外はfail/fumble(roll ≥ 96)。
  - `coc7e`: roll==1でcritical、roll==100または(p<50かつroll≥96)でfumble、以下ceil(p/5)でextreme、ceil(p/2)でhard、pまでsuccess、それ以外fail。加えて`resourceDefs`にSAN(正気度、`max:99, initial:60`)を持ち、`check_kind:'sanity'`のとき`sideEffect`が判定結果に応じてSANを決定論的に増減する(hard/extreme/criticalは0、successは-1、failは-1d6、fumbleは-1d10)。
  - `dnd5e`/`gurps`: 成功率によらず固定でroll≤5がcritical、roll≥96がfumble(いずれも成功判定より先に評価)。gurpsはさらに`margin`(success_percent−roll)を返す。
  - 未知/未指定の`formula`は`simple`にフォールバックする。
- ロール結果(roll/success/degree、副作用があれば`san_loss`/`san_now`)をtool_resultとして返し、AIがそれを踏まえて地の文継続
