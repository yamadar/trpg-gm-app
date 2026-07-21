# GMロジック・判定システム

## 4. GMロジック(ターン処理フロー)

1. プレイヤー入力受付(自由記述 or 選択肢クリック)
2. Game EngineがAPI呼び出し用プロンプト構築
   - system: 世界観+シナリオ(GM専用情報含む、フィルタは出力側で行う)
   - 直前state(current_scene, flags, history_summary)
   - 直近ログ(recent_log)
   - プレイヤー入力
3. Claude API呼び出し
   - 判定必要と判断 → tool_use `roll_check(skill, difficulty)` 返す
   - Game Engine側でロール実行 → 結果をtool_resultとして返送 → 続きの物語生成
4. 応答から構造化出力を抽出
   ```json
   {
     "narrative": "地の文",
     "state_update": {"flags": {"...": true}, "current_scene": "..."},
     "choices": ["選択肢1", "選択肢2", "選択肢3"]
   }
   ```
5. Game Engineがstate_updateを検証・確定・保存(IndexedDB)
6. UIにnarrative・choices反映

**要約トリガー**: recent_logが一定件数超えたら、古い分をhistory_summaryに圧縮(別APIコール or 同コール内で指示)。

---

## 5. 判定システム

- ダイスロールは必ずクライアント側JSで実行(乱数・検証可能性の担保)
- AIの役割は「判定が必要かどうか」「難易度」の判断のみ、結果生成はしない
- tool_use形式で実装:
  ```json
  {"name": "roll_check", "input": {"skill": "回避", "difficulty": 15}}
  ```
- ロール結果(成功/失敗/クリティカル)をtool_resultとして返し、AIがそれを踏まえて地の文継続
