# キャラシート常設パネル 設計 (08-feature-ideas.md 1.3)

2026-07-24 承認済み。[05-ui-ux.md](../../05-ui-ux.md) 7章で「未実装」と明記されたキャラシートパネルを実装する。現状Play画面はPC情報を見るのにライブラリのCharacterタブへ戻る必要がある。

## 決定事項(ブレインストーミング結果)

- レイアウト: **レスポンシブ**。広い画面(`min-width: 1024px`)では右端に常時ドッキング表示、狭い画面ではヘッダーの「PC」トグルで右からドロワー表示。
- 内容: **PCシート本文 + goal/bonds + 成長ポイント(xp) + 既知フラグ(入手情報)**。
- パネルは**読み取り専用**(編集はライブラリのCharacterタブ)。

## 現状(前提)

- セッション: `session.pc = { raw, goal, bonds }`(`src/screens/Setup.jsx` 260行付近)。`session.state.xp`(成長点)、`session.state.flags = { key: value }`(既知フラグ)、`session.ruleset.growthUnit`(成長単位ラベル、既定「経験値」)。
- Play画面(`src/screens/Play.jsx`)は中央1カラム(`maxWidth:720; margin:0 auto`)+ 下部固定入力バー(`position:fixed; left:0; right:0`)。ヘッダー右に「挿絵を自動生成」トグル(imageGen時)と「ホームへ」ボタン。
- `motionAllowed()`(`src/theme.js`)が既に `window.matchMedia` を使う前例。テスト環境(jsdom)は matchMedia 非対応。
- スタイルは `theme.js` の COLORS/フォント + インラインstyle方式。

## コンポーネント

### 1. `src/hooks/useMediaQuery.js`(新規)

```
useMediaQuery(query: string) -> boolean
```
- `window.matchMedia` が無ければ `false`(SSR/テスト既定)。
- 初期値 `matchMedia(query).matches`。`change` イベントを購読して再レンダリング、アンマウントで解除。

### 2. `src/components/play/CharacterPanel.jsx`(新規・presentational)

```
<CharacterPanel session docked onClose />
```
- 表示要素:
  - 見出し「PCシート」+ 成長ポイント行 `{session.ruleset?.growthUnit || '経験値'}: {session.state.xp || 0}`。
  - `session.pc.goal` があれば「目標: …」、`session.pc.bonds` があれば「因縁: …」を強調(`COLORS.brassDark`)。
  - PCシート本文 `session.pc.raw` を `whiteSpace: pre-wrap` のスクロール可能ブロックで表示(`session.pc.raw` 無しは「(PC設定なし)」)。
  - 入手情報: `Object.entries(session.state.flags || {})` を `key = value` の一覧で表示。空なら「まだなし」。
  - `docked` が false のときのみ右上に「×」閉じるボタン(`onClose`)。
- 配置スタイルは呼び出し側(Play)が包む。CharacterPanel自体は内容のみ描画(docked/drawerの外枠はPlayが与える)か、`docked` に応じて自前で `position:fixed` 枠を持つ。**実装方針: CharacterPanelが枠(fixed配置)まで持ち、`docked` で常設/ドロワーの見た目を切り替える**(Playは開閉状態とbackdropのみ管理)。
  - docked: `position:fixed; right:0; top:0; bottom:0; width:320px; borderLeft; overflowY:auto`。
  - drawer: 同上 + 影 + 右上閉じるボタン(Play側でbackdropを別途描画)。

### 3. `src/screens/Play.jsx` 統合

- `const docked = useMediaQuery('(min-width: 1024px)');`、`const [panelOpen, setPanelOpen] = useState(false);`。
- ヘッダー: `!docked` のとき「PC」トグルボタンを追加(`onClick={() => setPanelOpen((v) => !v)}`)。「挿絵を自動生成」「ホームへ」の並びの左に置く。
- ドッキング時(`docked`): 本文ルート `div` に `paddingRight: 320`、下部固定入力バーの内側 `right` オフセット(バーの `right: 320`)を付与し、`<CharacterPanel session docked />` を常設描画。
- 非ドッキング時: `panelOpen` の間のみ、半透明backdrop(`position:fixed; inset:0; background:rgba(0,0,0,0.3)`、クリックで閉じる)+ `<CharacterPanel session docked={false} onClose={() => setPanelOpen(false)} />` を描画。
- パネルはセッションの表示のみ。入力・保存・API呼び出しは行わない。

## データモデル変更

なし(既存の `session.pc` / `session.state` を読むだけ)。

## エラー処理・互換性

- `session.pc` が `{ raw }` のみ(goal/bonds無し): 各セクションは存在時のみ描画。
- `session.state.flags` 空/未定義: 「まだなし」表示。
- matchMedia 非対応(テスト・古い環境): `docked=false` に倒れ、トグル+ドロワー方式で動作。
- 既存セッション・データ移行不要。

## テスト方針

- `src/hooks/useMediaQuery.test.js`: matchMedia mock(matches初期値・changeイベントで更新・removeEventListener呼び出し)、matchMedia非対応でfalse。
- `src/components/play/CharacterPanel.test.jsx`: PCシート本文・goal/bonds・成長点(growthUnitラベル)・flags一覧・空flagsの「まだなし」・docked=trueで閉じるボタンなし/false で閉じるボタンあり(onClose発火)。
- `src/screens/Play.test.jsx`(追記): matchMedia無し(既定)で「PC」トグルが出て、クリックでパネル本文(pc.raw)が表示され、閉じるで消える。既存テストが壊れないこと(パネル既定非表示・トグル追加のみ)。

## スコープ外

- パネルからのシート編集(編集はライブラリのCharacterタブ)。
- HP等データモデルに無い新規項目。
- NPC情報・登場人物一覧の表示。
