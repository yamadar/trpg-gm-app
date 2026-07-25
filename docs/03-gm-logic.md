# GMロジック・判定システム

## 4. GMロジック(ターン処理フロー)

1. プレイヤー入力受付(自由記述 or 選択肢クリック)
2. Game Engine(`src/api/prompts.js`の`buildSystemPrompt`)がsystemプロンプトを構築
   - 世界観(`session.world.summary`。3.2.1節参照)、シナリオ(GM専用情報含む、プレイヤー出力からのフィルタは出力側=AI自身への指示で行う)
   - PC設定(`session.pc.raw`)。goal/bondsが抽出済みなら別枠で明示
   - ルール性向(`ruleset.label`/`hint`)
   - 直前state(current_scene, flags, history_summary)
   - 直近ログ(recent_log)
3. Claude API呼び出し(`src/api/session.js`の`takeTurn`)
   - 判定必要と判断 → tool_use `roll_check({check_label, success_percent, check_kind?})` を返す。`check_kind`はアダプタが副作用kind(coc7eの`sanity`等)を持つ場合のみスキーマに追加される任意フィールド(`src/api/prompts.js`の`buildRollTool`)
   - Game Engine側(`src/engine/rulesetAdapters.js`の`getAdapter(formula).evaluate`。simpleは`src/engine/dice.js`の`evaluateRoll`に委譲)でd100ロールと判定式アダプタ別のdegree算出を実行 → `check_kind`に対応する副作用があれば`sideEffect`が決定論的にリソース増減(SAN等)を計算・反映 → 結果(roll/success/degree、副作用があれば`san_loss`/`san_now`)をtool_resultとして返送 → 続きの物語生成(詳細は5章)
4. 応答から構造化出力を抽出(実際の出力形式。`src/api/prompts.js`の指示文)
   ```json
   {
     "narrative": "地の文(150〜250字程度)",
     "state_update": {
       "current_scene": "更新後のシーン名",
       "flags": {"追加/更新分のみ": true},
       "history_summary": "更新後の物語要約(300字程度)",
       "xp_gained": 0,
       "ending_reached": false
     },
     "choices": ["選択肢1", "選択肢2", "選択肢3"]
   }
   ```
   `xp_gained`は`ruleset.growthUnit`単位の成長ポイント増分(02-data-model.md 3.5.1節参照)。`ending_reached`は**実装済み(2026-07-25)**のboolean で、物語が結末(エンディング)に到達しこれ以上続ける必要がない場合のみtrue、それ以外は必ずfalse。trueが返ると`state.ending_reached`に反映され、Play画面が終了確定の案内カードを出す(02-data-model.md 3.3節・05-ui-ux.md参照)。出力の揺れは`src/api/turnResult.js`の正規化処理で吸収する。
5. Game Engineがstate_updateを検証・確定・保存(IndexedDB。加えてサーバーへも自動同期。04章参照)
6. UIにnarrative・choices反映

**履歴管理**: `history_summary`は毎ターンGM自身が書き換える(閾値超過を検知して圧縮する専用トリガーは無い)。`recent_log`は直近12件の`{role, text}`を保持するだけの簡易バッファで、超過分は`Play.jsx`が先頭から捨てる。

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
