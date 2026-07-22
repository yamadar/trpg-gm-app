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
   - 判定必要と判断 → tool_use `roll_check({check_label, success_percent})` を返す
   - Game Engine側(`src/engine/dice.js`)でd100ロール実行 → 結果(roll/success/degree)をtool_resultとして返送 → 続きの物語生成
4. 応答から構造化出力を抽出(実際の出力形式。`src/api/prompts.js`の指示文)
   ```json
   {
     "narrative": "地の文(150〜250字程度)",
     "state_update": {
       "current_scene": "更新後のシーン名",
       "flags": {"追加/更新分のみ": true},
       "history_summary": "更新後の物語要約(300字程度)",
       "xp_gained": 0
     },
     "choices": ["選択肢1", "選択肢2", "選択肢3"]
   }
   ```
   `xp_gained`は`ruleset.growthUnit`単位の成長ポイント増分(02-data-model.md 3.5.1節参照)。出力の揺れは`src/api/turnResult.js`の正規化処理で吸収する。
5. Game Engineがstate_updateを検証・確定・保存(IndexedDB。加えてサーバーへも自動同期。04章参照)
6. UIにnarrative・choices反映

**履歴管理**: `history_summary`は毎ターンGM自身が書き換える(閾値超過を検知して圧縮する専用トリガーは無い)。`recent_log`は直近12件の`{role, text}`を保持するだけの簡易バッファで、超過分は`Play.jsx`が先頭から捨てる。

---

## 5. 判定システム

- ダイスロールは必ずクライアント側JSで実行(乱数・検証可能性の担保)。全Rulesetで共通の`d100 <= success_percent`判定式(`src/engine/dice.js`)。
- AIの役割は「判定が必要かどうか」の判断と、その状況での**成功確率(success_percent, 0-100)の設定**。skill値や難易度クラスのペアではなく、AIが確率を直接決める。結果そのもの(ロール)は生成しない。
- tool_use形式で実装(`src/api/prompts.js`の`ROLL_TOOL`):
  ```json
  {"name": "roll_check", "input": {"check_label": "崖を登る", "success_percent": 60}}
  ```
- `evaluateRoll`はsuccess_percentを1-99にクランプしd100を振る。成功かつロール値が`success_percent`の5%以内ならcritical、失敗かつロール値が96以上ならfumble。Ruleset間の差は判定式ではなく、system prompt中の`hint`による演出指定のみ(例: CoC7e風はSAN値チェックの描写、D&D5e風はクリティカル演出)。判定式を切り替える「アダプタ方式」は未実装(07章参照)。
- ロール結果(roll/success/degree)をtool_resultとして返し、AIがそれを踏まえて地の文継続
