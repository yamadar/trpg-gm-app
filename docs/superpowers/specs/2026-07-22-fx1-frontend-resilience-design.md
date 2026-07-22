# 監査修正 FX1: フロントエンド堅牢性 設計ドキュメント

## 1. 背景・目的

4観点監査(ドキュメント/サーバー/フロントエンド/テスト)で洗い出した不具合のうち、**プレイ中に静かにデータを失う/アプリを起動不能にする最も緊急なフロントエンドのCritical・Important**を修正する。全体は5サブプロジェクト(FX1〜FX5)に分割し、本ドキュメントはFX1のスコープ。

## 2. スコープ(本FX1で直す指摘)

1. **LLM出力の無検証によるセッション永続破損(Critical)**: `src/screens/Play.jsx`がGMのJSON応答(`result.narrative`/`result.choices`/`result.state_update`)を型検証せず`state`へ書き込みIndexedDBへ保存する。オブジェクト等が返るとレンダリング時にReactがクラッシュし(Home画面でも同じstateを描画するため)エラーバウンダリ不在の結果アプリ全体が起動不能になる。`xp_gained`が文字列だと`0 + "5" = "05"`の文字列連結が永久累積する。
2. **エラーバウンダリ不在(Critical要因)**: `src/main.jsx`/`src/App.jsx`にError Boundaryが無く、描画中の例外が白画面になる。
3. **saveSession失敗の握り潰し(Critical)**: `src/storage/index.js`が失敗時`false`を返すが`Play.jsx`が戻り値を無視。書き込み失敗が無警告で、リロードでターンが消える。
4. **dice.jsのファンブル判定が成功を上書き / NaN(Important)**: `success_percent ≥ 96`で成功ロールが「大失敗」になる。非数値`success_percent`で`p = NaN`となり常に失敗・「57/NaN」表示。
5. **IME変換確定Enterで途中送信(Important)**: `Play.jsx`の`onKeyDown`が`isComposing`を見ていない。
6. **ターン失敗時にプレイヤー入力が消失(Important)**: `submitFree`が`runTurn`前に入力欄をクリアし、失敗時に入力が失われる。

### 対象外(他のFXで扱う)

- Setup/ライブラリUIの状態リーク・WorldTab編集状態・Home並行小説化・ConfirmModal・URLエンコード → FX2
- サーバー側(パストラバーサル・deleteWorldカスケード・timeout・novel鮮度等) → FX3
- ドキュメント整合 → FX4
- テスト補強(Play操作テスト等) → FX5(ただしFX1で追加する各ユニットのテストはFX1内で書く)

## 3. 設計

### 3.1 LLM応答の正規化ユーティリティ(新規)

`src/api/turnResult.js`に純粋関数`normalizeTurnResult(result)`を新設する。信頼できないLLMの`result`オブジェクトを安全な値に変換して返す。**方針は「黙って矯正・旧値保持」**(監査での決定): 数値はクランプ、非数値は無視、不正な型のフィールドは呼び出し側で旧値を保持できるよう`null`を返す。

```js
normalizeTurnResult(result) → {
  narrative: string,          // typeof string ならそのまま、そうでなければ '(描写を取得できませんでした)' 等の安全な既定文字列
  choices: string[],          // Array.isArray かつ各要素 typeof string のみ残す。それ以外は []
  stateUpdate: {
    current_scene: string | null,   // 非空stringのみ、そうでなければ null
    flags: object | null,           // プレーンオブジェクト(非null・非配列)のみ、そうでなければ null
    history_summary: string | null, // typeof string のみ、そうでなければ null
    xpGain: number,                 // Number(...)が有限なら Math.max(0, ...) にクランプ、そうでなければ 0
  }
}
```

- `xpGain`は非負にクランプ(累計カウンターの負値ドレインを防ぐ)。文字列`"5"`は`Number("5")=5`で受け入れるが、`"abc"`や`NaN`は0にする。
- `current_scene`が空文字や非stringなら`null`を返し、呼び出し側が旧`current_scene`を保持する。

### 3.2 Play.jsxの統合

`runTurn`を次のように変更する:
- `const norm = normalizeTurnResult(result)`で正規化した値のみを使う。
- `current_scene: norm.stateUpdate.current_scene ?? session.state.current_scene`
- `flags: norm.stateUpdate.flags ? { ...session.state.flags, ...norm.stateUpdate.flags } : session.state.flags`
- `history_summary: norm.stateUpdate.history_summary ?? session.state.history_summary`
- `xp: (Number.isFinite(session.state.xp) ? session.state.xp : 0) + norm.stateUpdate.xpGain`
- `turn_count: (Number.isFinite(session.state.turn_count) ? session.state.turn_count : 0) + 1`(旧形式セッションの`NaN手`回避も兼ねる)
- ログ追記は`norm.narrative`/`norm.choices`を使う。
- `runTurn`は成功可否を示すため`return true`/`return false`(catch側で`false`)にする。
- `saveSession`の戻り値を検査し、`false`なら永続化警告用のstate(`saveWarning`)にメッセージを設定、成功時はクリアする。警告はログ下部に`COLORS.stamp`で表示するが、ゲーム進行はブロックしない。

`submitFree`を変更する:
- IMEガード: `onKeyDown`を`(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) submitFree(); }`にする。
- 入力保持: `submitFree`で`text`を保持し、`runTurn(text, text)`が`false`を返したら`setInput(text)`で入力欄を復元する。

`submitChoice`は変更不要(選択肢は最後のGM応答上に再描画され再クリック可能)。

### 3.3 エラーバウンダリ(新規)

`src/components/ErrorBoundary.jsx`にクラスコンポーネント`ErrorBoundary`を新設する。`getDerivedStateFromError`/`componentDidCatch`で描画中の例外を捕捉し、フォールバックUI(「表示中に問題が発生しました」+ 再読み込みボタン)を表示する。`src/main.jsx`で`<App/>`を`<ErrorBoundary>`でラップする。既存の`App.test.jsx`は無影響(正常時は`children`をそのまま描画するため)。

### 3.4 dice.jsの修正

`src/engine/dice.js`の`evaluateRoll`を次のように修正する:
- 非数値ガード: `const raw = Number(successPercent); const p = Number.isFinite(raw) ? Math.max(1, Math.min(99, Math.round(raw))) : 50;`(非数値時は中立の50にフォールバック)。
- degree判定を成功/失敗で排他にする:
```js
const success = roll <= p;
let degree;
if (success) {
  degree = roll <= Math.max(1, Math.round(p * 0.05)) ? 'critical' : 'success';
} else {
  degree = roll >= 96 ? 'fumble' : 'fail';
}
```
これにより成功ロールが`fumble`になる矛盾が消える。既存テスト(critical/fumbleを別々に検証)は失敗ケースのrollを使っているため、`fumble`テスト(`evaluateRoll(60)`, roll=97)は依然`fail`側なので`fumble`のまま通る。ただし境界の新規テストを追加する。

## 4. 非スコープの再掲

- Setup/ライブラリ/サーバー/ドキュメント/追加のインテグレーションテストはFX2〜FX5。
- `history_summary`にオブジェクトが来たケースは`null`扱いで旧値保持(プロンプトへの`[object Object]`注入を防ぐ)。
- flagsの個々の値の型検証までは行わない(flags全体がオブジェクトかのみ検証。値は`${k}=${v}`表示にのみ使われ、クラッシュ要因にならない)。
