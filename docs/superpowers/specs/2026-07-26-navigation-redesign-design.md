# ナビゲーション再設計 — 設計書

作成日: 2026-07-26

## 背景と目的

現状のアプリには次の問題がある。

1. **画面が全体的に地味**（本設計の範囲外。後続フェーズで扱う）
2. **グローバルメニューが無い**
3. **Home から別画面へ移ると上部の見た目が大きく変わる**
4. **いま自分がどの画面のどの階層に居るのか分からない**

コードを調査した結果、2〜4 は同一の構造的原因から生じている。

### 原因: ナビゲーションが3系統に分裂している

| 系統 | 実体 | 問題 |
|---|---|---|
| ① `view` state | `src/App.jsx:28` の `'home'\|'setup'\|'library'\|'gallery'\|'play'` | URL に一切現れない。ブラウザの「戻る」でアプリごと離脱する |
| ② hash route | `src/App.jsx:78-121` の `#/u/:id` `#/endings` `#/achievements` | 早期 return で画面全体を置換するため、①の世界と行き来できない |
| ③ AuthBar | `src/components/auth/AuthBar.jsx:40` の `position: fixed` | 唯一の常設要素だが、中身はアカウント操作のみでアプリの主要導線を含まない |

**「上部メニューがガラッと変わる」の正体**: 主要導線（素材ライブラリ／公開ギャラリー／エンディング図鑑）は `src/screens/Home.jsx:702-715` の本文中にあるボタン列であり、Home を離れると消滅する。グローバルメニューが「無い」のではなく、Home 専用メニューがグローバルメニューだと錯覚される状態になっている。

**「どこを押すべきか迷う」の正体**: 戻り導線の語彙と位置が画面ごとに異なる。

| 画面 | ラベル | 位置 |
|---|---|---|
| Library / Gallery | `閉じる` | 右上 |
| Gallery 詳細 | `← 一覧に戻る` | 左上 |
| Play | `← ホーム` | 左上 |
| Setup | `やめる` / `戻る` | フッター |
| UserPage | `← 戻る` | 左上 |

加えて `+ 新規プレイ` 以外はすべて `variant="ghost"` で並ぶため、視覚的な優先度差が無い。

**「現在地が分からない」の正体**: パンくず・現在地表示が存在しない。素材ライブラリは「タブ → World 選択 → 一覧 → 詳細」で実質4階層あるが、画面上部の表示は `素材ライブラリ` の1行のみ。

### 目的

上記 2〜4 を解消する。**ビジュアルのリッチ化（1）は本設計の範囲外**とし、後続フェーズで扱う。

## 決定事項

| 論点 | 決定 |
|---|---|
| URL 化の範囲 | 全画面を hash route に統一する（React Router は導入しない） |
| 対象環境 | PC・スマホを同等に重視する |
| 情報構造 | 4タブ（ホーム／素材／さがす／記録）＋ アカウントメニュー |
| Play・Setup | 集中モード（グローバルナビを出さず、戻る＋現在地のみ） |
| 現在地表示 | パンくずを常時表示し、URL から導出する |
| アイコン | `lucide-react` をナビに限定して導入する |

**貫くルール**: 「回遊する画面 = グローバルナビあり／1つのタスクを完遂する画面 = 戻る＋現在地のみ」。画面ごとの見た目の変化を無くすのではなく、**変化を1本の規則で予測可能にする**。

### 情報構造（4タブ）

| タブ | 中身 | 位置づけ |
|---|---|---|
| **ホーム** | セッション一覧・続きから・新規プレイ | 自分の進行中の物語 |
| **素材** | 素材ライブラリ（World/Character/Scenario/Campaign/Ruleset） | 自分が作るもの |
| **さがす** | 公開ギャラリー（スターター含む） | 他人のもの・取り込むもの |
| **記録** | エンディング図鑑 ＋ 実績 | 自分が達成したもの |
| *(右上)* アカウント | 自分のページ／プロフィール編集／ログアウト | 常設 |

エンディング図鑑（`src/screens/EndingGallery.jsx`）と実績（`src/screens/AchievementList.jsx`）は構造がほぼ同じ「コレクション閲覧」画面のため、「記録」タブ配下に統合する。

「自分のページ」（`src/screens/UserPage.jsx`）は `#/u/:id` で他人からも開ける**公開プロフィール**であり、「自分の成果を振り返る場所」ではなく「他人からの見え方」であるため、記録タブには入れずアカウントメニューに残す。

## アーキテクチャ

### URL 設計

`view` state と hash route の二重管理を廃し、全画面を hash route に一本化する。`useHashRoute.js` を「1本の hash を構造化オブジェクトに変換するパーサ」へ拡張する（新規依存なし）。

| URL | 画面 | モード |
|---|---|---|
| `#/` | ホーム（セッション一覧・続きから） | 回遊 |
| `#/library/:tab` | 素材ライブラリ　`tab` = `world`\|`character`\|`scenario`\|`campaign`\|`ruleset` | 回遊 |
| `#/library/:tab/:worldId` | World 選択済み（`character`\|`scenario`\|`campaign` のみ） | 回遊 |
| `#/browse/:tab` | 公開ギャラリー　`tab` = `starters`\|`novels`\|`worlds`\|`characters`\|`scenarios` | 回遊 |
| `#/browse/:tab/:publicId` | 公開アイテム詳細（`starters` を除く） | 回遊 |
| `#/records/endings` | エンディング図鑑 | 回遊 |
| `#/records/achievements` | 実績 | 回遊 |
| `#/u/:userId` | 公開プロフィール（既存 URL を維持） | 回遊 |
| `#/setup` | 新規プレイ ウィザード | 集中 |
| `#/play/:sessionId` | プレイ中 | 集中 |

`tab` の値は既存の定義に揃える。`library` は `src/screens/Library.jsx:12-18` の `TABS`、`browse` は `src/constants/publicContent.js` の `GALLERY_TABS` に対応する。

`browse` の `starters` タブは公開アイテムの一覧／詳細ではなく「パックを一括取り込みする単位」であり `/api/public/:type` の対象外のため（`src/constants/publicContent.js:11-13`）、`#/browse/starters/:publicId` は存在しない。この形の URL は `#/browse/starters` へ `replaceState` する。

「記録」タブ配下の `endings` と `achievements` は、各画面の上部に置く**内部タブ**で切り替える。既存の Library・Gallery と同じ「タブ列」の見た目を用い、パンくずの2段目（`記録 › エンディング図鑑`）と連動させる。

**正規化ルール**

- `#/library` → `#/library/world`、`#/browse` → `#/browse/starters`、`#/records` → `#/records/endings` へ `replaceState` で寄せる（履歴を汚さない）
- 未知の hash・不正な `tab` 値 → `#/` へフォールバック
- 旧 URL `#/endings` `#/achievements` は `#/records/endings` `#/records/achievements` へリダイレクトする（ブックマーク済みの可能性があるため）

**Setup のコンテキストは URL に載せない**

`src/screens/Setup.jsx:20` が受け取る `campaignContext` / `starterContext` は `world.summary`・`scenario` オブジェクト・`pcRaw`・`xp` を含む大きなオブジェクトで（`src/screens/Home.jsx:428` などで生成）、URL に載せられない。これらは従来どおり React state で保持し、`#/setup` を直接開いた場合およびリロード時は「素のウィザード（step 0）」として起動する。

リロードでウィザードの入力が失われるのは現状と同じ挙動（現在も state はメモリのみ）であり、機能後退はない。

**`#/play/:sessionId` はリロードで復元する**

セッションは IndexedDB／サーバに保存済みのため、`sessionId` から `getSession()` で読み直す。これは現状（リロードでホームに戻る）より改善となる。読めなかった場合は `#/` へフォールバックし、トーストで通知する。

**Library の `worldId` を URL に入れる理由**

`src/screens/Library.jsx:80-100` の World セレクトは現在 state のみで保持されており、パンくずの3段目（`素材 › Character › アーカム 1920s`）の情報源が無い。URL に入れることでパンくずが URL の純粋な関数になり、共有・リロードにも耐える。

### コンポーネント構成

```
src/navigation/
  routes.js               ルート定義 / parse / build / 正規化 / 静的ラベル
  useRoute.js             hash 購読 + navigate()   ← 現 useHashRoute.js を置換
  BreadcrumbContext.jsx   動的ラベルの登録口

src/components/nav/
  AppShell.jsx      骨格。route からモード(回遊/集中)を判定してヘッダーを出し分ける
  GlobalNav.jsx     PC=上部横並び / SP=下部タブバー
  Breadcrumb.jsx    URL の純粋な関数
  FocusHeader.jsx   集中モード用(戻る + タイトル + 進行度)
  AccountMenu.jsx   現 AuthBar を移設・改名
```

各ユニットの責務は次のとおり。

- **`routes.js`**: 副作用を持たない純関数のみ。`parse(hash) -> route`、`build(route) -> hash`、`normalize(route) -> route | null`。テストが最も容易で、ルーティングの正しさはここに集約される。
- **`useRoute.js`**: `hashchange` の購読と `navigate()` / `replace()` の提供。ブラウザ API との唯一の接点。
- **`BreadcrumbContext.jsx`**: 画面が `useBreadcrumbLabel(label)` で動的ラベルを登録し、`Breadcrumb` が読む。両者は互いを import しない。
- **`AppShell.jsx`**: route を受け取りモードを判定し、ヘッダーとコンテンツを配置する。画面の中身は知らない。
- **`GlobalNav` / `Breadcrumb` / `FocusHeader` / `AccountMenu`**: いずれも props と context のみに依存する表示コンポーネント。

`App.jsx` は現在の 217 行の分岐塊から、`AppShell` に route を渡して中身を差し込むだけに縮む。

### レイアウト

**PC（回遊モード）**

```
┌──────────────────────────────────────────────────────┐
│ GM's Desk    ホーム  素材  さがす  記録        (◯ syatin ▾) │ sticky
├──────────────────────────────────────────────────────┤
│ 素材 › Character › アーカム 1920s                        │
├──────────────────────────────────────────────────────┤
│  content                                              │
```

**スマホ（回遊モード）**

```
┌────────────────────────┐
│ … › アーカム 1920s   (◯▾) │ 上部: パンくず末尾2段 + アカウント
├────────────────────────┤
│         content         │
├────────────────────────┤
│  🏠     📚     🔍    🏆  │ 下部タブバー(固定)
│ ホーム  素材  さがす  記録 │
└────────────────────────┘
```

**集中モード（Play / Setup）— PC・スマホ共通**

```
┌──────────────────────────────────────────────────────┐
│ ← ホーム │ 丘の上の写真館            世界 › 舞台 › ⬤PC › 確認 │
└──────────────────────────────────────────────────────┘
```

### 個別の設計判断

**1. `AuthBar` の `position: fixed` を廃止する**

現在 `src/components/auth/AuthBar.jsx:40` は右上に浮いており、各画面のコンテンツとレイヤーが無関係になっている。シェルのヘッダー内に組み込むことで、スクロール時に本文と衝突せず、スマホでも位置が安定する。

**2. 画面ごとの「閉じる／戻る」ボタンを全廃する**

`src/screens/Library.jsx:44` の `閉じる`、`src/screens/Gallery.jsx:53` の `閉じる`、`src/screens/Gallery.jsx:94` の `← 一覧に戻る`、`src/screens/UserPage.jsx:101` の `← 戻る` は、すべてパンくず＋グローバルナビが担う。Play の `← ホーム`（`src/screens/Play.jsx:283`）と Setup の `やめる` / `戻る`（`src/screens/Setup.jsx:657`）は `FocusHeader` に統合する。

なお Setup の `戻る`（ステップを1つ戻す）は `FocusHeader` の戻るとは意味が異なるため、**ウィザード内のステップ移動としてフッターに残す**。`FocusHeader` の `← ホーム` はウィザード自体からの離脱を意味する。

**3. パンくずの動的ラベルは画面側から登録する**

`素材 › Character › アーカム 1920s` の3段目や公開アイテム詳細のタイトルは、URL の ID からは決まらない。シェル側で再取得すると二重フェッチになるため、画面が既に持っているデータを `useBreadcrumbLabel('アーカム 1920s')` で登録する方式にする。ラベル未登録の間はその段を非表示にし（ID を露出しない）、確定後に差し込む。レイアウトの跳ねを防ぐためパンくず行の高さは固定する。

**4. アイコンは `lucide-react` を導入する**

スマホの下部タブバーはラベルのみでは判別しづらく、アイコンが実質必須である。本設計ではナビ4項目・アカウント・パンくずの区切りに限定して使う。Game-icons.net（世界観・ルールセット・実績などコンテンツ側の意匠）は後続のビジュアル刷新フェーズで扱い、本設計には含めない。

**5. ナビ項目は未ログイン時も消さない**

未ログイン時、`src/screens/Home.jsx:703` の `+ 新規プレイ` と素材ライブラリは実質使えない。タブは消さずに残し、押した先で「ログインが必要です」を案内する。項目が出たり消えたりする方が現在地の把握を壊すため。

## データフロー

```
window.location.hash
  └─ useRoute()  ──parse──▶ route オブジェクト
                              │
                              ├──▶ AppShell        モード判定(回遊/集中)
                              ├──▶ GlobalNav       アクティブタブ判定
                              ├──▶ Breadcrumb      静的ラベル段の導出
                              └──▶ 各画面           タブ・選択状態・ID

各画面 ──useBreadcrumbLabel()──▶ BreadcrumbContext ──▶ Breadcrumb  動的ラベル段

ユーザー操作 ──navigate(route)──▶ build ──▶ window.location.hash
```

state は URL を単一の情報源とする。画面内部で `useState` に持っていたタブ・選択 ID は URL へ移す。ただし Setup の `campaignContext` / `starterContext` は前述のとおり例外的に `App` の state に残す。

## エラー処理

| 事象 | 挙動 |
|---|---|
| 未知の hash（`#/foo`） | `#/` へ `replaceState` |
| 不正な `tab` 値（`#/library/xxx`） | 既定タブへ `replaceState` |
| 旧 URL（`#/endings` `#/achievements`） | `#/records/…` へ `replaceState` |
| `#/play/:id` のセッションが存在しない | `#/` へ移動し、トーストで「セッションが見つかりません」 |
| `#/library/:tab/:worldId` の World が存在しない | World 未選択状態（`#/library/:tab`）へ `replaceState` |
| 未ログインで `#/library/*` | 画面は表示し、本文で「ログインが必要です」を案内（ナビは維持） |
| パンくずの動的ラベル取得失敗 | その段を非表示のままにする（ID を露出しない） |

既存の `src/components/ErrorBoundary.jsx` は `AppShell` の内側・コンテンツの外側に置く。画面がクラッシュしてもナビが生き残り、ユーザーが他所へ移動できるようにするため。

## アクセシビリティ

- `GlobalNav` は `<nav>` ＋ `aria-current="page"`、パンくずは `<nav aria-label="現在地"><ol>` で構成する
- 下部タブバーのタップ領域を 44×44px 以上にする（現在の `src/screens/Library.jsx:64` のタブは `padding: 6px 14px` で不足）
- アクティブなタブ・パンくずを色だけで区別しない（下線／太字を併用する）
- キーボードでナビを操作でき、本文への「スキップリンク」を置く
- 現在のタブは `src/screens/Gallery.jsx:61-74` のように `<div onClick>` で実装されておりキーボードで到達できない。シェル化に伴い `<button>` へ直す

## テスト

**新規（純関数中心）**

- `routes.js` — `parse` / `build` / `normalize` を表駆動テストで網羅する。URL 文字列 → route オブジェクト → URL の往復一致を検証する
- `useRoute.js` — `hashchange` の購読、`navigate` / `replace` の履歴操作
- `Breadcrumb` — URL からの段の導出、動的ラベルの遅延差し込み、スマホでの末尾2段省略
- `GlobalNav` — アクティブタブ判定、未ログイン時も項目が消えないこと
- `AppShell` — `#/play/*` `#/setup` で集中モード、それ以外で回遊モードになること

**書き換えが必要な既存テスト（10ファイル）**

`App.test.jsx` / `useHashRoute.test.jsx` / `Library.test.jsx` / `Gallery.test.jsx` / `UserPage.test.jsx` / `Play.test.jsx` / `Setup.test.jsx` / `EndingGallery.test.jsx` / `AchievementList.test.jsx` / `AuthBar.test.jsx`

`onClose` / `onCancel` プロップが消えるため、「コールバックが呼ばれたか」の検証を「URL が期待どおり変わったか」の検証へ置き換える。これが本作業で最大の工数を占める。検証対象が「関数が呼ばれた」から「URL がこうなった」に変わるのは、テストとして強くなる方向である。

## 移行の順序

`main` から作成したワークツリーで作業する。各段階の終了時点でテストが通る状態を保つ。

| 段階 | 内容 | 影響範囲 |
|---|---|---|
| 1 | `routes.js` ＋ `useRoute.js` を新規作成。`useHashRoute.js` の既存 API（`navigateToUser` など）は薄いラッパとして残す | 追加のみ。既存は無傷 |
| 2 | `AppShell` / `GlobalNav` / `Breadcrumb` / `FocusHeader` / `AccountMenu` を作り、`App.jsx` を置換 | `App.jsx`, `AuthBar.jsx` |
| 3 | 各画面の内部タブ・選択状態を URL 駆動に変更し、`閉じる` / `戻る` を撤去 | `Library`, `Gallery`, `UserPage`, `Play`, `Setup`, `EndingGallery`, `AchievementList` |
| 4 | 旧 `useHashRoute.js` ラッパを削除 | クリーンアップ |

## 本設計に含まれないもの

- ビジュアルのリッチ化（配色・階調・質感・余白の刷新）
- Game-icons.net によるコンテンツ側の意匠
- デザイントークンの整備（現在 `src/theme.js` の `COLORS` とインラインスタイルが混在している）
- 各画面の内部レイアウトの作り直し

これらは本設計の完了後、別の設計として扱う。

## 成功条件

1. ブラウザの「戻る」「進む」が全画面で期待どおり動作する
2. 任意の画面でリロードしても同じ場所に留まる（Setup のウィザード途中を除く）
3. どの画面からでも4タブとアカウントメニューに到達でき、位置が変わらない
4. 回遊画面ではパンくずが、集中画面ではタイトルとステップ表示が、それぞれ現在地を示す
5. 「閉じる」「戻る」「やめる」「← 一覧に戻る」の語彙の混在が解消される
6. `npm test` が全件通る
