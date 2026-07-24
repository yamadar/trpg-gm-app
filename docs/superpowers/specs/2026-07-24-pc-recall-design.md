# PCの「これまでを思い出す」(オンデマンド回想) 設計

2026-07-24 承認済み。キャラシートパネル(1.3)の「入手情報(既知フラグ)」表示に対するフィードバック対応。

## 背景・決定事項

- 生フラグ(`session.state.flags`)は英語snake_caseキーの内部状態であり、そのまま常時表示すると「呪文の羅列」のように見づらく、内部表現の露出で没入も削ぐ。
- 対応: **生フラグの常時一覧を撤去**し、代わりに「これまでを思い出す」ボタンでLLMがPC視点の自然な日本語の回想を**オンデマンド生成**する。生フラグはLLMへの入力に留め、プレイヤーには見せない。

## 現状(前提)

- `session.state.flags = { key: value }`(GMが毎ターン `state_update.flags` へ書き込む内部状態。秘匿情報は書かない設計)。`session.state.history_summary`(GMが毎ターン更新する物語要約)。`session.pc = { raw, goal, bonds }`。`session.state.recent_log`(直近ログ配列)。
- `src/api/session.js`: `takeTurn` 等が `callClaude`(`src/api/client.js`)経由で `/api/messages` プロキシを呼ぶ。`extractText`/`parseJsonLoose` あり。`/api/messages` は `messages` 日次上限を消費。
- `CharacterPanel`(`src/components/play/CharacterPanel.jsx`)は presentational で `{ session, docked, onClose }` を受け取る。現状フラグ一覧を表示している(この部分を置換)。
- `Play.jsx` が docked/drawer で `CharacterPanel` を描画。

## 変更設計

### 1. `src/api/session.js` に `recallMemory(session)`

```
recallMemory(session) -> Promise<string>
```
- `callClaude({ model: 'claude-sonnet-5', max_tokens: 600, thinking: { type: 'disabled' }, system, messages })` を呼ぶ。
- system: 「あなたはTRPGのGM。PCがこれまでに知り得たこと・手に入れたものを、PC視点で簡潔に思い返す短い地の文(200字程度)を書け。ゲーム的表現(フラグのキー名・数値・選択肢)は出さず、自然な日本語に翻訳すること。未開示の秘密やメタ情報は書かない。まだ何も無ければその旨を一言。」
- user: PCの人物像(`pc.raw` 抜粋 + goal/bonds)+ 物語要約(`history_summary`)+ 既知フラグ(`flags` を `key=value` で列挙、LLMが翻訳する材料)+ 直近ログ(`recent_log`)を埋め込む。
- 返り値: `extractText(data.content).trim()`。空なら「(まだ特に思い出すことはない)」にフォールバック。

### 2. `CharacterPanel` の変更

- 「入手情報」+ 生フラグ一覧のブロックを削除。
- 代わりに「これまでを思い出す」ボタン + 回想表示領域を追加。propに `onRecall: () => Promise<string>` を追加(任意。未指定ならセクションごと非表示)。
- 内部state: `recallText`(string|null)、`recalling`(bool)、`recallError`(string|null)。ボタン押下で `recalling=true` → `onRecall()` → 成功で `recallText`、失敗で `recallError`、finally `recalling=false`。
- 表示: 生成中は「思い出している…」、`recallText` があれば `whiteSpace: pre-wrap` で表示、`recallError` はインライン。パネルは同時1インスタンスのため内部stateで十分。永続化なし。

### 3. `Play.jsx` の変更

- `import { recallMemory } from '../api/session.js';`
- docked/drawer 双方の `<CharacterPanel ... />` に `onRecall={() => recallMemory(session)}` を渡す。

## データモデル・互換性

- データモデル変更なし。回想は永続化しない(押すたび再生成)。
- 既存セッション・移行不要。GM秘匿情報はフラグに書かれない設計 + systemの明示指示で二重防止。

## エラー処理

- `recallMemory` 失敗(ネットワーク/上限429/パース): throw し、パネルが `recallError`(「思い出せなかった: …」)を表示。
- 履歴・フラグが空: LLMが「まだ特に思い出すことはない」等を返す(またはフォールバック文言)。

## テスト方針

- `src/api/session.test.js`(追記): `recallMemory` が `/api/messages` を呼び、systemに翻訳指示、userに history_summary と flags が含まれる。レスポンスからテキスト抽出。空レスポンスでフォールバック。
- `src/components/play/CharacterPanel.test.jsx`(改修): 生フラグ一覧を表示しないこと。「これまでを思い出す」ボタン→ローディング→回想文表示。`onRecall` reject でエラー表示。`onRecall` 未指定でボタン非表示。
- `src/screens/Play.test.jsx`: 既存のパネル開閉テストが壊れないこと(必要なら `onRecall` 経由の表示を軽く確認)。

## スコープ外

- 回想の永続化・履歴化。
- フラグの構造化(アイテム/知識の分類)やGM出力スキーマ変更。
