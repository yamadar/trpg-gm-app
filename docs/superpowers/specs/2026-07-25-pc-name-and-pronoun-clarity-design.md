# 小説の人物混同の解消(PC名の明示と代名詞の規律) 設計ドキュメント

## 1. 背景・目的

小説化された `novel.md` で、プレイヤーキャラクター(以下PC)と作中の別の男性キャラクターが、どちらも「彼」と書かれて読者が混乱する。実際に次のような本文が生成されている。

```
しかし彼の目に映るのは彼ではない。
```

```
彼はゲオルクの両肩を掴み、「落ち着け、まだ間に合う」と声をかけた。だが彼は突然、
その手を振り払い、「間に合う? お前に何が分かる!」と叫び、後退る。
```

後者は「最初の彼 = PC、二つ目の彼 = ゲオルク」だが、本文からは判別できない。

原因は二つある。

**原因1: 小説化に人物情報が一切渡っていない。**
生成に渡すのは `buildTranscriptWithMarkers()` が作る `PL:` / `GM:` 行だけで、PCシート(`session.pc.raw`)もPC名も渡していない(`server/novelJobs.js` の `run()`、`server/novelMarkers.js`)。

```js
// server/novelJobs.js
const { transcript, imageIds } = buildTranscriptWithMarkers(session.log);
const { text, truncated } = await generateNovel({ transcript, hasImages, pov, apiKey, fetchImpl });
```

**原因2: システムプロンプトに人物の書き分けに関する指示がない。**

```js
// server/novelGeneration.js
return `以下はTRPGセッションの進行ログである。…これを${voice}の小説として、
場面転換や心理描写を補いながら自然な文章に書き直せ。…`;
```

GMの地の文はPCを二人称で呼ぶため、これを三人称へ書き直す時点でモデルに使える語が「彼」しか残らない。他の男性キャラと衝突するのは構造的に必然である。

さらに、PC名はそもそもデータとして存在しない。PC設定は自由記述テキストエリア一つ(`src/screens/Setup.jsx` の `pcRaw`)で、名前を書くかどうかはプレイヤー任せである。

本ドキュメントは、上流(PCに名前を持たせる)と下流(プロンプトで曖昧な代名詞を禁じる)の両方を直し、読んで人物が取り違えられない小説を出す設計を定める。

## 2. スコープ

- Setup にPC名の必須入力を追加し、`session.pc.name` として保持する
- 既存PCを選んだ場合は、既存のシート解析パイプライン(`characterSheetParse`)に名前抽出を追加して拾う
- 小説化にPC名を渡す
- 小説化のシステムプロンプトに人物の書き分け規律を追加する。PC名が無い場合はモデルに固定の呼称を一つ定めさせる

### 対象外

- **素材ライブラリとSetupのPC一覧のID表示**。新規PCは `makeId('pc')` の生成ID(`pc-1753...-x9k2`)をライブラリのキーにしており、それがそのまま一覧のカード名として表示されている。関連はするが、`Character` メタへの `displayName` 追加とサーバールート・ストレージ層の変更が要るため別件として切る
- **生成済み `novel.md` の自動再生成**。ユーザーが再度「小説化」を押したときに新しいプロンプトが適用される
- **NPC同士の呼称衝突**。今回はPC起因の混同に絞る
- **PC名をストレージのキーにすること**。`characterDocPath` / `characterMetaKey` は名前をそのままパスへ埋めるため(`server/storage/paths.js`)、任意の日本語文字列をキーにはしない。PC名は表示・プロンプト用の値としてのみ扱い、キーは今まで通り `makeId()` のスラッグを使う

## 3. アーキテクチャ

変更は4箇所に分かれる。A・BがPC名を得る経路、C・Dが小説へ反映する経路である。

```
[A] Setup の必須PC名入力 ─┐
                          ├→ session.pc.name ─[C]→ generateNovel ─[D]→ システムプロンプト
[B] characterSheetParse ──┘                                              (書き分け規律)
    (既存PC選択時のname抽出)
```

### 3.1 [A] Setup に必須の「PC名」欄を追加

`src/screens/Setup.jsx`。

**UI**: `pcMode === 'new'` のとき、「PC設定」テキストエリアの上に独立した「PC名」入力欄を置く。ステップ3(PC)の「次へ」は、`pcMode === 'new'` かつこの欄が空のあいだだけ無効にする。

`pcMode === 'existing'` のときはこの欄を出さず、「次へ」も塞がない。名前は 3.2 の抽出で得る。

**状態**: `const [pcName, setPcName] = useState(...)` を追加する。初期値は、`campaignContext?.pcRaw` から `PC名:` 行を正規表現で拾ったもの(無ければ空文字)。キャンペーンの章をまたぐたびに再入力させないための措置である。

```js
// PCシート本文の先頭付近にある「PC名: ○○」から名前を拾う。
// 見つからなければ空文字(呼び出し側で未設定として扱う)。
export function extractPcName(raw) { … }
```

この関数は `src/utils/pcName.js` に置き、Setup と(必要なら)他所から共用する。

**保存**: `handleStart()` で、`pcRaw` が `PC名:` 行を持たない場合に先頭へ `PC名: {pcName}` を合成してから使う。

```js
pc = composePcRaw(pcName, pcRaw);   // 既に PC名: 行があればそのまま
```

合成した本文がライブラリ原本(`putCharacter`)にもセッション(`session.pc.raw`)にも入るため、GMプロンプトの `# PC設定` 節(`src/api/prompts.js`)にも名前が載る。プレイ中の地の文が名前でPCを呼びやすくなる副次効果がある。

`pcRaw` が空でも `pcName` は必ずあるので、現行の `pc = pcRaw || '(自由記述なし)'` のフォールバックは `composePcRaw()` の結果が空にならないことで自然に解消される。

**セッション形状**: `session.pc` に `name` が加わる。

```js
pc: { name: pcName, raw: pc, goal: pcGoal, bonds: pcBonds }
```

既存セッションは `pc.name` を持たない。読み出し側は `session.pc?.name || ''` で未設定として扱い、3.4 のフォールバックに落とす。

### 3.2 [B] 既存PC選択時は解析パイプラインから名前を取る

`src/api/characterSheetParse.js` の出力スキーマに `name` を追加し、戻り値を `{ name, goal, bonds }` にする。

```js
name: {
  type: 'string',
  description: 'このキャラクターの名前(記載がなければ空文字列)',
},
```

`required` にも `name` を加え、system プロンプトを「以下のキャラクターシートから name(名前)・goal(目標)・bonds(因縁・関係)を抽出せよ。」に変える。

`src/screens/Setup.jsx` の `handleStart()` は、既存PC選択時に `parsed.name` を `session.pc.name` として使う。

**キャッシュの世代交代**: `getOrParseCharacter`(`src/api/characterSheetCache.js`)は `parsedHash === hashText(raw)` が一致するかぎり既存の `parsed` を再利用する。このままでは `name` を持たない古いキャッシュが使われ続け、既存PCで名前が取れない。ハッシュ計算にパーサのバージョン識別子を混ぜ、既存の全PCが次回使用時に一度だけ再パースされるようにする。

```js
// characterSheetParse.js
// 抽出スキーマを変えたらこの値を上げる。既存のparsedキャッシュが無効化され、
// 次回のgetOrParseCharacterで新しいスキーマとして解析し直される。
export const SHEET_PARSE_VERSION = 2;

// characterSheetCache.js
const currentHash = hashText(`v${SHEET_PARSE_VERSION}\n${character.raw}`);
```

コストは対象PCあたり1回の追加AI呼び出しで、進行モードとは別枠(データモデル 3.4 節の方針どおり)。

### 3.3 [C] 小説化にPC名を渡す

`server/novelJobs.js` の `run()`:

```js
const { text, truncated } = await generateNovel({
  transcript,
  hasImages: imageIds.length > 0,
  pcName: session.pc?.name || '',
  pov,
  apiKey,
  fetchImpl,
});
```

`server/novelGeneration.js` の `generateNovel()` は `pcName = ''` を受け取り、`buildNovelizeSystemPrompt(pov, pcName)` に渡す。既定値があるため、既存の呼び出しとテストは引数を足さなくても壊れない。

### 3.4 [D] システムプロンプトに人物の書き分け規律を追加

`buildNovelizeSystemPrompt(pov, pcName)` が、既存の本文に続けて次の節を足す。

**三人称(`pov !== 'first'`)、PC名あり**:

```
# 人物の書き分け
- 主人公の名前は「{pcName}」である。地の文では原則この名前で呼び、代名詞は直前の主語が
  明白なときだけ使うこと。
- 一つの段落の中で、二人以上の人物を「彼」「彼女」で受けないこと。片方は必ず名前、または
  立場・特徴による固有の呼称で書くこと。
- 会話の応酬では、どの台詞・動作が誰のものかが常に一意に定まるように書くこと。
```

**三人称、PC名なし**: 1行目を次に差し替える。残り2行は共通。

```
- 主人公の名前は与えられていない。ログから読み取れるならその名前を使い、読み取れなければ
  世界観に合う呼称(「その傭兵」のような固定の呼び名)を一つだけ定めること。いずれの場合も
  全編を通して一貫して使い、場面ごとに呼び方を変えないこと。
```

これにより、既に名無しで遊び終わったセッションも、再度小説化すれば読める本文になる。

**一人称(`pov === 'first'`)**: 主人公は「私」「俺」で書かれるため、PCと他人物の衝突は原理的に起きない。主人公に関する1行目を落とし、他人物同士の混同を防ぐ2行だけを残す。

節の並びは `本文の指示` → `# 人物の書き分け` → `挿絵マーカー指示(MARKER_INSTRUCTION)` の順とし、既存の `MARKER_INSTRUCTION` の連結位置(`generateNovel()` 内)は変えない。

### 3.5 継続リクエストとの関係

小説化は出力打ち切り時に継続リクエストを重ねる(`NOVELIZE_MAX_CONTINUATIONS`)。システムプロンプトは全リクエストで同一のものが使われるため、書き分け規律は継続部分にも効く。トランスクリプトの `cache_control` にも影響しない(system は別枠)。追加の対処は不要。

## 4. データ移行と後方互換

| 対象 | 状態 | 挙動 |
|---|---|---|
| 既存セッション | `pc.name` なし | `session.pc?.name \|\| ''` で空。3.4 の「PC名なし」プロンプトが適用され、再小説化で改善する |
| 既存の `parsed` キャッシュ | `name` なし | `SHEET_PARSE_VERSION` によりハッシュ不一致になり、次回使用時に一度だけ再パースされる |
| 生成済み `novel.md` | 旧プロンプト産 | 自動再生成はしない。ユーザーが「小説化」を押し直したときに置き換わる |
| 既存のライブラリPC原本 | `PC名:` 行の有無はまちまち | 3.2 の抽出が拾えれば名前になり、拾えなければ空。壊れない |

破壊的変更はない。スキーマのバージョン上げによる一度きりの再解析コストのみが増える。

## 5. テスト

**`server/novelGeneration.test.js`**
- `pcName` を渡すと、システムプロンプトに「主人公の名前は「◯◯」である」が含まれる
- `pcName` が空だと、代わりに「呼称を一つだけ定め」の指示が含まれる
- どちらの場合も「二人以上の人物を「彼」「彼女」で受けないこと」が含まれる
- `pov: 'first'` では主人公の名前・呼称に関する行が出ず、他人物の書き分け行だけが残る

**`server/novelJobs.test.js`**
- `session.pc.name` が `generateNovel` の引数として渡る
- `session.pc` に `name` が無いセッションでも例外にならず、空文字が渡る

**`src/api/characterSheetParse.test.js`**
- シートから `name` を抽出する
- 名前の記載が無いシートでは空文字を返す

**`src/api/characterSheetCache.test.js`**
- `parsedHash` がパーサバージョンを含み、旧世代のキャッシュ(バージョンなしのハッシュ)では再パースが走る

**`src/screens/Setup.test.jsx`**
- `pcMode === 'new'` でPC名が空のあいだ、ステップ3の「次へ」が無効
- 入力したPC名が `session.pc.name` に入り、`session.pc.raw` の先頭に `PC名: ◯◯` として合成される
- 既に `PC名:` 行を持つ本文には二重に合成しない
- `campaignContext.pcRaw` に `PC名:` 行があれば、PC名欄の初期値になる

**`src/utils/pcName.test.js`(新規)**
- `extractPcName` が `PC名:` 行を拾う。行が無ければ空文字
- `composePcRaw` が `PC名:` 行の無い本文にだけ先頭行を足す

## 6. 変更ファイル一覧

| ファイル | 変更 |
|---|---|
| `src/utils/pcName.js` (新規) | `extractPcName(raw)` / `composePcRaw(name, raw)` |
| `src/screens/Setup.jsx` | PC名の状態・必須入力UI・ステップ3のゲート・`session.pc.name` |
| `src/api/characterSheetParse.js` | 出力スキーマへ `name` 追加、`SHEET_PARSE_VERSION` の公開 |
| `src/api/characterSheetCache.js` | ハッシュにパーサバージョンを混ぜる |
| `server/novelJobs.js` | `pcName` を `generateNovel` へ渡す |
| `server/novelGeneration.js` | `buildNovelizeSystemPrompt(pov, pcName)` と書き分け規律 |
| `docs/02-data-model.md` | `session.pc` に `name` が加わったことを記載 |
| 上記に対応するテスト | 5章のとおり |
