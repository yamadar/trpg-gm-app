# 小説の人物混同の解消(PC名の明示と代名詞の規律) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 小説化された本文で、PCと他の登場人物がどちらも「彼」と書かれて読者が取り違える問題をなくす。

**Architecture:** 上流と下流の両方を直す。上流は、Setup にPC名の必須入力を足して `session.pc.name` として保持し、既存PCについては `characterSheetParse` の抽出項目に `name` を追加して拾う。下流は、小説化のシステムプロンプトにPC名と人物の書き分け規律を注入する。PC名を持たない既存セッションは、モデルに固定の呼称を一つ定めさせるフォールバック指示で救う。

**Tech Stack:** React 18 + Vite(クライアント) / Node.js + Express(サーバー) / Vitest + @testing-library/react(テスト)

**設計ドキュメント:** `docs/superpowers/specs/2026-07-25-pc-name-and-pronoun-clarity-design.md`

## Global Constraints

- テストランナーは Vitest。全体実行は `npm test`、単体は `npx vitest run <path>`、単一ケースは `npx vitest run <path> -t "<name>"`
- サーバー側テストはファイル先頭に `// @vitest-environment node` が必要(既存ファイルには既にある)
- コメントは日本語。「なぜそうしたか」を書き、コードを読めば分かることは書かない(既存ファイルの慣習に従う)
- 共有 `Button` コンポーネント(`src/components/ui/Button.jsx`)は `disabled` でネイティブの `disabled` 属性を付けず、`onClick` を無効化するだけ。テストで「押せないこと」を検証するときは `toBeDisabled()` ではなく「画面が遷移しないこと」で確かめる
- `Field` コンポーネントは `label` と入力要素を `htmlFor`/`id` で関連付けない。テストからの入力要素の取得は `getByPlaceholderText` を使う
- PC名はストレージのキーにしない。ライブラリのキーは今まで通り `makeId('pc')` のスラッグ
- 各タスクの最後にコミットする

---

### Task 1: PC名のユーティリティ

PCシート本文の「PC名: ○○」行を読み書きする純関数を用意する。Setup とテストの両方から使う。

**Files:**
- Create: `src/utils/pcName.js`
- Test: `src/utils/pcName.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `extractPcName(raw: string): string` — 本文中の `PC名: ○○` から `○○` を返す。無ければ `''`
  - `composePcRaw(name: string, raw: string): string` — 本文の先頭に `PC名: ○○` を足した文字列を返す。本文に既に `PC名:` 行があれば本文をそのまま返す

- [ ] **Step 1: Write the failing test**

`src/utils/pcName.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { extractPcName, composePcRaw } from './pcName.js';

describe('extractPcName', () => {
  it('picks the name out of a PC名 line', () => {
    expect(extractPcName('PC名: カイ・アーレンス\n能力値: STR10')).toBe('カイ・アーレンス');
  });

  it('accepts a full-width colon and surrounding spaces', () => {
    expect(extractPcName('  PC名 ： ミラ  ')).toBe('ミラ');
  });

  it('finds the line even when it is not the first line', () => {
    expect(extractPcName('# シート\nPC名: ゲオルク\ngoal: 復讐')).toBe('ゲオルク');
  });

  it('returns an empty string when there is no PC名 line', () => {
    expect(extractPcName('能力値: STR10\ngoal: 生き延びる')).toBe('');
  });

  it('returns an empty string for empty or nullish input', () => {
    expect(extractPcName('')).toBe('');
    expect(extractPcName(null)).toBe('');
    expect(extractPcName(undefined)).toBe('');
  });
});

describe('composePcRaw', () => {
  it('prepends a PC名 line to a sheet that has none', () => {
    expect(composePcRaw('カイ', 'goal: 生き延びる')).toBe('PC名: カイ\ngoal: 生き延びる');
  });

  it('leaves a sheet that already names the PC untouched', () => {
    const raw = 'PC名: ハワード\ngoal: 真相を暴く';
    expect(composePcRaw('カイ', raw)).toBe(raw);
  });

  it('returns just the name line when the sheet body is empty', () => {
    expect(composePcRaw('カイ', '')).toBe('PC名: カイ');
  });

  it('returns the body unchanged when no name is given', () => {
    expect(composePcRaw('', 'goal: 生き延びる')).toBe('goal: 生き延びる');
    expect(composePcRaw('   ', 'goal: 生き延びる')).toBe('goal: 生き延びる');
  });

  it('trims the name and the body', () => {
    expect(composePcRaw('  カイ  ', '  goal: 生き延びる  ')).toBe('PC名: カイ\ngoal: 生き延びる');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/pcName.test.js`
Expected: FAIL — `Failed to resolve import "./pcName.js"`

- [ ] **Step 3: Write minimal implementation**

`src/utils/pcName.js`:

```js
// PCシート本文の「PC名: ○○」行の読み書き。
// PC名はストレージのキーにはせず(characterDocPathが名前をそのままパスへ埋めるため)、
// 表示とプロンプトのための値として本文の中に持たせる。

// 全角コロンも許す。プレイヤーが日本語入力のまま書いた本文を弾かないため。
const PC_NAME_LINE = /^[ \t]*PC名[ \t]*[:：][ \t]*(.+?)[ \t]*$/m;

export function extractPcName(raw) {
  const m = String(raw ?? '').match(PC_NAME_LINE);
  return m ? m[1] : '';
}

// 既にPC名行がある本文には足さない。プレイヤーが書いた表記(愛称・肩書き込みなど)を
// 入力欄の値で上書きしてしまわないため。
export function composePcRaw(name, raw) {
  const body = String(raw ?? '').trim();
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return body;
  if (extractPcName(body)) return body;
  return body ? `PC名: ${trimmed}\n${body}` : `PC名: ${trimmed}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/pcName.test.js`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add src/utils/pcName.js src/utils/pcName.test.js
git commit -m "feat(utils): PCシート本文のPC名行を読み書きするユーティリティを追加"
```

---

### Task 2: 小説化プロンプトへ人物の書き分け規律を追加

このタスク単体で、既に名無しで遊び終わったセッションの再小説化が改善する。

**Files:**
- Modify: `server/novelGeneration.js:25-29`(`buildNovelizeSystemPrompt`)、`server/novelGeneration.js:48-57`(`generateNovel` の引数)
- Test: `server/novelGeneration.test.js`

**Interfaces:**
- Consumes: なし
- Produces: `generateNovel({ transcript, hasImages, pcName = '', pov, apiKey, fetchImpl, maxContinuations, timeoutMs })` — `pcName` は省略可(既定 `''`)

- [ ] **Step 1: Write the failing test**

`server/novelGeneration.test.js` の `describe('generateNovel', ...)` の末尾(既存の `uses a first person prompt when pov is first` の直後)に追記:

```js
  it('names the protagonist in the system prompt when pcName is given', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, pcName: 'カイ', fetchImpl });

    expect(bodyOf(fetchImpl, 0).system).toContain('主人公の名前は「カイ」である');
  });

  // 名無しのまま遊び終わった既存セッションの救済。呼称をモデルに一つ決めさせる。
  it('tells the model to coin one consistent designation when pcName is empty', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, fetchImpl });

    const system = bodyOf(fetchImpl, 0).system;
    expect(system).toContain('一つだけ定め');
    expect(system).not.toContain('主人公の名前は「');
  });

  it('forbids receiving two people with 彼/彼女 in one paragraph, named or not', async () => {
    for (const pcName of ['カイ', '']) {
      const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
      await generateNovel({ ...BASE, pcName, fetchImpl });
      expect(bodyOf(fetchImpl, 0).system).toContain('二人以上の人物を「彼」「彼女」で受けないこと');
    }
  });

  // 一人称では主人公が「私」等になり、他の人物と衝突しない。主人公の行は不要。
  it('drops the protagonist rule in first person but keeps the rule for the rest of the cast', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, pov: 'first', pcName: 'カイ', fetchImpl });

    const system = bodyOf(fetchImpl, 0).system;
    expect(system).not.toContain('主人公の名前は「カイ」である');
    expect(system).not.toContain('一つだけ定め');
    expect(system).toContain('二人以上の人物を「彼」「彼女」で受けないこと');
  });

  // 挿絵マーカーの指示は書き分け規律の後ろに来る(既存の連結位置を変えていないことの確認)。
  it('keeps the marker instruction after the cast rules', async () => {
    const fetchImpl = sequenceFetch({ text: '本文', stop_reason: 'end_turn' });
    await generateNovel({ ...BASE, hasImages: true, pcName: 'カイ', fetchImpl });

    const system = bodyOf(fetchImpl, 0).system;
    expect(system.indexOf('人物の書き分け')).toBeLessThan(system.indexOf('挿絵挿入位置'));
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/novelGeneration.test.js`
Expected: FAIL — 新規5件のうち少なくとも `names the protagonist…`(`system` に「主人公の名前は「カイ」である」が含まれない)と `forbids receiving two people…` が失敗する

- [ ] **Step 3: Write minimal implementation**

`server/novelGeneration.js` の `buildNovelizeSystemPrompt` を次で置き換える:

```js
// 主人公と他の人物がどちらも「彼」になり、読者が取り違える事故を防ぐための規律。
// トランスクリプトのGM地の文はPCを二人称で呼ぶため、三人称へ書き直す時点で
// モデルに使える語が「彼」しか残らない。指示がないと衝突は構造的に必ず起きる。
const CAST_RULES_COMMON = `- 一つの段落の中で、二人以上の人物を「彼」「彼女」で受けないこと。片方は必ず名前、または立場・特徴による固有の呼称で書くこと。
- 会話の応酬では、どの台詞・動作が誰のものかが常に一意に定まるように書くこと。`;

const NAMELESS_PC_RULE =
  '- 主人公の名前はログに存在しない。世界観に合う呼称(名前、または「その傭兵」のような固定の呼び名)を一つだけ定め、全編を通して一貫して使うこと。場面ごとに呼び方を変えないこと。';

// 一人称では主人公は「私」等になり他の人物と衝突しないため、主人公の行は出さない。
function buildCastRules(pov, pcName) {
  const lines =
    pov === 'first'
      ? [CAST_RULES_COMMON]
      : [
          pcName
            ? `- 主人公の名前は「${pcName}」である。地の文では原則この名前で呼び、代名詞は直前の主語が明白なときだけ使うこと。`
            : NAMELESS_PC_RULE,
          CAST_RULES_COMMON,
        ];
  return `\n\n# 人物の書き分け\n${lines.join('\n')}`;
}

// pov: 'third'(既定)または 'first'。pcName が空なら呼称をモデルに決めさせる。
function buildNovelizeSystemPrompt(pov, pcName) {
  const voice = pov === 'first' ? 'PC視点の一人称' : '三人称';
  return (
    `以下はTRPGセッションの進行ログである。プレイヤー発言とGMの地の文が交互に並んでいる。これを${voice}の小説として、場面転換や心理描写を補いながら自然な文章に書き直せ。ゲーム的な表現(選択肢・判定結果の数値等)はそのまま出力せず、物語として自然に溶け込ませること。説明文やコードブロック記号は付けず、小説本文のみを出力すること。` +
    buildCastRules(pov, pcName)
  );
}
```

同じファイルの `generateNovel` の引数と `system` の組み立てを変える:

```js
export async function generateNovel({
  transcript,
  hasImages = false,
  pcName = '',
  pov,
  apiKey,
  fetchImpl = fetch,
  maxContinuations = NOVELIZE_MAX_CONTINUATIONS,
  timeoutMs = NOVELIZE_UPSTREAM_TIMEOUT_MS,
}) {
  const system = buildNovelizeSystemPrompt(pov, pcName) + (hasImages ? MARKER_INSTRUCTION : '');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/novelGeneration.test.js`
Expected: PASS — 既存の全ケース + 新規5件。既存の `uses a first person prompt when pov is first` と `includes the marker instruction only when…` も通ること

- [ ] **Step 5: Commit**

```bash
git add server/novelGeneration.js server/novelGeneration.test.js
git commit -m "feat(server): 小説化プロンプトに人物の書き分け規律を追加する"
```

---

### Task 3: 小説化ジョブがPC名を生成へ渡す

**Files:**
- Modify: `server/novelJobs.js:63-69`(`run()` 内の `generateNovel` 呼び出し)
- Test: `server/novelJobs.test.js`

**Interfaces:**
- Consumes: Task 2 の `generateNovel({ …, pcName })`
- Produces: なし(`session.pc.name` を読むだけ)

- [ ] **Step 1: Write the failing test**

`server/novelJobs.test.js` の `describe('createNovelJobRunner', ...)` の中、`saves the novel text and meta on success` の直後に追記:

```js
  it('passes the session PC name into the generated system prompt', async () => {
    const fetchImpl = okFetch();
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', { ...SESSION, pc: { name: 'カイ', raw: 'PC名: カイ' } }, 'third');
    await runner.pending.get('u1/s1');

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.system).toContain('主人公の名前は「カイ」である');
  });

  // pc.name を持たない既存セッションでも落ちず、呼称をモデルに決めさせる側へ倒れる。
  it('falls back to the nameless prompt for sessions that predate pc.name', async () => {
    const fetchImpl = okFetch();
    const runner = createNovelJobRunner({ dataStore, textStore, apiKey: 'k', fetchImpl, bootId: 'b1' });
    await runner.start('u1', 's1', SESSION, 'third');
    await runner.pending.get('u1/s1');

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.system).toContain('一つだけ定め');
    expect(await runner.read('u1', 's1')).toMatchObject({ status: 'done' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/novelJobs.test.js -t "passes the session PC name"`
Expected: FAIL — `system` に「主人公の名前は「カイ」である」が含まれない(`pcName` が渡っていないため名無し側の指示になる)

- [ ] **Step 3: Write minimal implementation**

`server/novelJobs.js` の `run()` 内の呼び出しを次にする:

```js
      const { text, truncated } = await generateNovel({
        transcript,
        hasImages: imageIds.length > 0,
        // 旧セッションは pc.name を持たない。空文字で渡し、呼称の決定はモデルに委ねる。
        pcName: session.pc?.name || '',
        pov,
        apiKey,
        fetchImpl,
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/novelJobs.test.js`
Expected: PASS — 既存の全ケース + 新規2件

- [ ] **Step 5: Commit**

```bash
git add server/novelJobs.js server/novelJobs.test.js
git commit -m "feat(server): 小説化ジョブがセッションのPC名を生成へ渡す"
```

---

### Task 4: キャラクターシートの解析に name を追加し、キャッシュを世代交代させる

`getOrParseCharacter` は `parsedHash` が一致するかぎり既存の `parsed` を再利用する。スキーマを変えただけでは古いキャッシュが使われ続けて `name` が取れないため、ハッシュにパーサのバージョンを混ぜて一度だけ再解析させる。

**Files:**
- Modify: `src/api/characterSheetParse.js`(スキーマ・system・戻り値・バージョン定数)
- Modify: `src/api/characterSheetCache.js`(ハッシュ計算)
- Test: `src/api/characterSheetParse.test.js`、`src/api/characterSheetCache.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `SHEET_PARSE_VERSION: number`(`src/api/characterSheetParse.js` から export、初期値 `2`)
  - `parseCharacterSheet(raw: string): Promise<{ name: string, goal: string, bonds: string }>`
  - `getOrParseCharacter(worldId, kind, name): Promise<{ name, goal, bonds }>`(戻り値の形が上に追随。関数シグネチャは不変)

- [ ] **Step 1: Write the failing test**

`src/api/characterSheetParse.test.js` を次で全面的に置き換える(既存3件の期待値が `name` を含む形に変わるため):

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCharacterSheet, SHEET_PARSE_VERSION } from './characterSheetParse.js';
import * as client from './client.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('parseCharacterSheet', () => {
  it('parses name, goal and bonds from the model response', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [
        { type: 'text', text: JSON.stringify({ name: 'アリス', goal: '妹を救い出す', bonds: '幼馴染のNPC' }) },
      ],
    });
    const result = await parseCharacterSheet('PC名: アリス\ngoal: 妹を救い出す\nbonds: 幼馴染のNPC');
    expect(result).toEqual({ name: 'アリス', goal: '妹を救い出す', bonds: '幼馴染のNPC' });
  });

  it('defaults every field to an empty string when the model omits them', async () => {
    vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({}) }],
    });
    const result = await parseCharacterSheet('PC名: ボブ');
    expect(result).toEqual({ name: '', goal: '', bonds: '' });
  });

  it('sends the raw character sheet as the user message', async () => {
    const callClaudeMock = vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ name: '', goal: '', bonds: '' }) }],
    });
    await parseCharacterSheet('PC名: キャロル');
    expect(callClaudeMock.mock.calls[0][0].messages[0].content).toBe('PC名: キャロル');
  });

  it('asks the model for the name in the output schema', async () => {
    const callClaudeMock = vi.spyOn(client, 'callClaude').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ name: '', goal: '', bonds: '' }) }],
    });
    await parseCharacterSheet('PC名: キャロル');
    const schema = callClaudeMock.mock.calls[0][0].output_config.format.schema;
    expect(schema.properties).toHaveProperty('name');
    expect(schema.required).toContain('name');
  });

  // キャッシュの世代交代に使う。スキーマを変えたら必ず上げる。
  it('exposes a parser version above the original name-less schema', () => {
    expect(SHEET_PARSE_VERSION).toBeGreaterThanOrEqual(2);
  });
});
```

`src/api/characterSheetCache.test.js` を次で全面的に置き換える(既存3件のハッシュ期待値が変わるため):

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrParseCharacter } from './characterSheetCache.js';
import * as characterSheetParse from './characterSheetParse.js';
import { SHEET_PARSE_VERSION } from './characterSheetParse.js';
import * as characterLibraryClient from './characterLibraryClient.js';
import { hashText } from '../utils/hashText.js';

// キャッシュの鍵は「パーサのバージョン + 原文」。抽出項目を増やしたときに
// 古い parsed が使われ続けないようにするための取り決め。
const versionedHash = (raw) => hashText(`v${SHEET_PARSE_VERSION}\n${raw}`);

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('getOrParseCharacter', () => {
  it('returns the cached parsed result when the hash matches', async () => {
    const raw = 'PC名: アリス\ngoal: 妹を救い出す';
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw,
      parsed: { name: 'アリス', goal: '妹を救い出す', bonds: '' },
      parsedHash: versionedHash(raw),
    });
    const parseSpy = vi.spyOn(characterSheetParse, 'parseCharacterSheet');
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed');

    const result = await getOrParseCharacter('w1', 'pc', 'alice');

    expect(result).toEqual({ name: 'アリス', goal: '妹を救い出す', bonds: '' });
    expect(parseSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('re-parses and saves when there is no cached parsed result', async () => {
    const raw = 'PC名: ボブ';
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({ raw, parsed: null, parsedHash: null });
    vi.spyOn(characterSheetParse, 'parseCharacterSheet').mockResolvedValue({ name: 'ボブ', goal: 'x', bonds: 'y' });
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed').mockResolvedValue({});

    const result = await getOrParseCharacter('w1', 'pc', 'bob');

    expect(result).toEqual({ name: 'ボブ', goal: 'x', bonds: 'y' });
    expect(putSpy).toHaveBeenCalledWith('w1', 'pc', 'bob', {
      parsed: { name: 'ボブ', goal: 'x', bonds: 'y' },
      parsedHash: versionedHash(raw),
    });
  });

  it('re-parses when the stored hash does not match the current raw text', async () => {
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw: '新しい原文',
      parsed: { name: '', goal: '古い目標', bonds: '' },
      parsedHash: 'stale-hash',
    });
    vi.spyOn(characterSheetParse, 'parseCharacterSheet').mockResolvedValue({
      name: '',
      goal: '新しい目標',
      bonds: '',
    });
    const putSpy = vi.spyOn(characterLibraryClient, 'putCharacterParsed').mockResolvedValue({});

    const result = await getOrParseCharacter('w1', 'pc', 'alice');

    expect(result).toEqual({ name: '', goal: '新しい目標', bonds: '' });
    expect(putSpy).toHaveBeenCalled();
  });

  // name抽出を足す前に保存されたキャッシュは、原文が同じでも作り直す必要がある。
  it('re-parses a cache written by the previous parser version', async () => {
    const raw = 'PC名: アリス';
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw,
      parsed: { goal: '妹を救い出す', bonds: '' },
      parsedHash: hashText(raw), // バージョンを含まない旧世代のハッシュ
    });
    const parseSpy = vi
      .spyOn(characterSheetParse, 'parseCharacterSheet')
      .mockResolvedValue({ name: 'アリス', goal: '妹を救い出す', bonds: '' });
    vi.spyOn(characterLibraryClient, 'putCharacterParsed').mockResolvedValue({});

    const result = await getOrParseCharacter('w1', 'pc', 'alice');

    expect(parseSpy).toHaveBeenCalled();
    expect(result.name).toBe('アリス');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/characterSheetParse.test.js src/api/characterSheetCache.test.js`
Expected: FAIL — `SHEET_PARSE_VERSION` が undefined、`parseCharacterSheet` の戻り値に `name` が無い、`re-parses a cache written by the previous parser version` でキャッシュが再利用されてしまう

- [ ] **Step 3: Write minimal implementation**

`src/api/characterSheetParse.js` を次で置き換える:

```js
import { callClaude, extractText, parseJsonLoose } from './client.js';

// 抽出スキーマを変えたらこの値を上げる。characterSheetCache がハッシュに混ぜており、
// 既存の parsed キャッシュが無効化されて次回使用時に一度だけ解析し直される。
// v2: name(キャラクター名)を追加。
export const SHEET_PARSE_VERSION = 2;

const SHEET_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'goal', 'bonds'],
    properties: {
      name: {
        type: 'string',
        description: 'このキャラクターの名前(記載がなければ空文字列)',
      },
      goal: {
        type: 'string',
        description: 'このキャラクターが物語を通じて達成したいこと(記載がなければ空文字列)',
      },
      bonds: {
        type: 'string',
        description: '他PC/NPC/世界との因縁・関係(記載がなければ空文字列)',
      },
    },
  },
};

export async function parseCharacterSheet(raw) {
  const data = await callClaude({
    model: 'claude-sonnet-5',
    max_tokens: 1000,
    thinking: { type: 'disabled' },
    output_config: { format: SHEET_OUTPUT_FORMAT },
    system: '以下のキャラクターシートから name(名前)・goal(目標)・bonds(因縁・関係)を抽出せよ。',
    messages: [{ role: 'user', content: raw }],
  });
  const text = extractText(data.content);
  const parsed = parseJsonLoose(text);
  return {
    name: parsed.name || '',
    goal: parsed.goal || '',
    bonds: parsed.bonds || '',
  };
}
```

`src/api/characterSheetCache.js` を次で置き換える:

```js
import { parseCharacterSheet, SHEET_PARSE_VERSION } from './characterSheetParse.js';
import { getCharacter, putCharacterParsed } from './characterLibraryClient.js';
import { hashText } from '../utils/hashText.js';

export async function getOrParseCharacter(worldId, kind, name) {
  const character = await getCharacter(worldId, kind, name);
  // 原文だけでなくパーサのバージョンも鍵に含める。抽出項目を増やしたとき、
  // 原文が変わっていない既存キャッシュが古い形のまま使われ続けるのを防ぐ。
  const currentHash = hashText(`v${SHEET_PARSE_VERSION}\n${character.raw}`);
  if (character.parsed && character.parsedHash === currentHash) {
    return character.parsed;
  }
  const parsed = await parseCharacterSheet(character.raw);
  await putCharacterParsed(worldId, kind, name, { parsed, parsedHash: currentHash });
  return parsed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/characterSheetParse.test.js src/api/characterSheetCache.test.js`
Expected: PASS — parse 5件、cache 4件

- [ ] **Step 5: Commit**

```bash
git add src/api/characterSheetParse.js src/api/characterSheetParse.test.js src/api/characterSheetCache.js src/api/characterSheetCache.test.js
git commit -m "feat(api): キャラクターシート解析にname抽出を追加しキャッシュを世代交代させる"
```

---

### Task 5: Setup にPC名の必須入力を追加する

新規作成モードのときだけ、PCステップの先頭にPC名の入力欄を出し、空のあいだは次のステップへ進めない。既存PCを選ぶモードでは欄を出さず、進行も塞がない(名前は Task 4 の抽出で得るため)。

このタスクで既存のSetupテスト9件が「PCステップを通過できない」ことで失敗する。同じタスクの中で直す。

**Files:**
- Modify: `src/screens/Setup.jsx`(import 追加、PC名の state、step 3 の描画、「次へ」のゲート、PC設定テキストエリアの placeholder)
- Test: `src/screens/Setup.test.jsx`

**Interfaces:**
- Consumes: Task 1 の `extractPcName(raw)`
- Produces: PC名入力欄。placeholder は `例: カイ・アーレンス`(テストからの取得キー)

- [ ] **Step 1: Write the failing test**

`src/screens/Setup.test.jsx` の `describe('Setup', ...)` の中(`does not attempt to resolve goal/bonds when the PC has no library link` の直後)に追記:

```js
  it('blocks the PC step until a PC name is entered in the new-PC mode', () => {
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('次へ')); // World(skip) -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC

    // 共有Buttonはdisabled時もネイティブのdisabled属性を付けないため、
    // 「押しても確認ステップへ進まない」ことで検証する。
    fireEvent.click(screen.getByText('次へ'));
    expect(screen.queryByText('セッション名')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'カイ' } });
    fireEvent.click(screen.getByText('次へ'));
    expect(screen.getByText('セッション名')).toBeInTheDocument();
  });

  it('does not block the PC step when an existing PC is picked from the library', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);

    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('既存を選ぶ')); // PC: 既存

    expect(screen.queryByPlaceholderText('例: カイ・アーレンス')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('次へ'));
    expect(screen.getByText('セッション名')).toBeInTheDocument();
  });

  // キャンペーンの章をまたぐたびに名前を打ち直させないための前埋め。
  it('prefills the PC name from the carried sheet when a campaignContext is given', async () => {
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    render(
      <Setup
        onStart={vi.fn()}
        onCancel={vi.fn()}
        campaignContext={{
          worldId: 'w1',
          world: { raw: 'World原文', summary: 'World要約' },
          moods: [],
          pcRaw: 'PC名: カイ(熟練)',
          xp: 12,
          rulesetId: 'simple',
          campaignId: 'cp1',
        }}
      />
    );
    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC

    expect(screen.getByPlaceholderText('例: カイ・アーレンス')).toHaveValue('カイ(熟練)');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/Setup.test.jsx -t "blocks the PC step"`
Expected: FAIL — `Unable to find an element with the placeholder text of: 例: カイ・アーレンス`

- [ ] **Step 3: Write minimal implementation**

`src/screens/Setup.jsx` の import 群に追加:

```js
import { extractPcName } from '../utils/pcName.js';
```

`// PC` の state 宣言(現在 `const [pcMode, …]` から始まるブロック)を次にする:

```js
  // PC
  const [pcMode, setPcMode] = useState(starterContext ? 'existing' : 'new'); // existing | new
  const [pcRaw, setPcRaw] = useState(campaignContext ? campaignContext.pcRaw || '' : '');
  // キャンペーンの章をまたぐときは引き継いだシートから拾い、打ち直させない。
  const [pcName, setPcName] = useState(campaignContext ? extractPcName(campaignContext.pcRaw) : '');
  const [existingPCs, setExistingPCs] = useState([]);
  const [selectedPC, setSelectedPC] = useState(null); // { name, raw } | null
```

`const steps = […]` の直後に導出値を足す:

```js
  // 小説化したときにPCが他の登場人物と「彼」で衝突しないよう、新規作成のPCには
  // 名前を必須にする(既存PCは解析でシートから名前を取れるので塞がない)。
  const pcNameMissing = step === 3 && pcMode === 'new' && !pcName.trim();
```

step 3 の `{pcMode === 'new' && (` ブロックを次で置き換える:

```jsx
            {pcMode === 'new' && (
              <>
                <Field
                  label="PC名"
                  hint="物語の地の文で主人公を指す名前。小説にしたときに他の登場人物と取り違えられないために必要。"
                >
                  <input
                    value={pcName}
                    onChange={(e) => setPcName(e.target.value)}
                    placeholder="例: カイ・アーレンス"
                    style={inputStyle}
                  />
                </Field>
                <Field
                  label="PC設定"
                  hint="自由記述でよい。goal(目標)・bonds(因縁・関係)を書いておくと、GMがそれを絡めた展開を作りやすくなる。"
                >
                  <textarea
                    value={pcRaw}
                    onChange={(e) => setPcRaw(e.target.value)}
                    rows={8}
                    placeholder={'能力値・スキル: ...\ngoal: ...\nbonds: ...'}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
                  />
                </Field>
              </>
            )}
```

画面下部の「次へ」ボタンを次にする:

```jsx
        {step < steps.length - 1 ? (
          <Button variant="primary" onClick={() => setStep(step + 1)} disabled={pcNameMissing}>
            次へ
          </Button>
        ) : (
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx vitest run src/screens/Setup.test.jsx -t "PC name"`
Expected: PASS — 新規3件

- [ ] **Step 5: Fix the existing tests that walk through the PC step**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: FAIL — PCステップを新規作成モードのまま通過していた既存9件が、確認ステップへ進めずに失敗する

次の9件それぞれで、PCステップから確認ステップへ進む `fireEvent.click(screen.getByText('次へ'));` の**直前**に、この1行を挿入する:

```js
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'テスト太郎' } });
```

対象のテスト:

1. `carries the selected Scenario's recommendedRuleset through as the default Ruleset on session start`
2. `既存World選択時はWorldのmoodsがsession.moodsへ継承される(Scenarioより優先)`
3. `respects a manual Ruleset pick made after a Scenario recommendedRuleset was applied, instead of reverting it`
4. `creates a new World in the library and starts the session with the split summary`
5. `does not block session start when a library save fails, and shows a non-fatal warning`
6. `lists custom Rulesets from the library and embeds the resolved ruleset into the session`
7. `does not attempt to resolve goal/bonds when the PC has no library link`
8. `clears a previously selected Scenario when the World changes`
9. `surfaces a fatal error and does not start the session when scenario generation fails`(`次へ` が4回連続する。4回目の直前に挿入する)

対象外(修正不要)。理由も残しておくこと:
- `embeds the selected PC's parsed goal/bonds into the session when the PC is library-linked` — 既存PCモードなのでゲートが効かない
- `campaignContextを渡すとworld/pc/rulesetを前埋めし、worldId/campaignId/xpをセッションへ反映する` — `campaignContext.pcRaw` から前埋めされる
- `starts a session carrying the starter world, scenario, moods and ruleset` — `starterContext` は `pcMode` を `existing` で開始する

- [ ] **Step 6: Run the whole Setup suite to verify it passes**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: PASS — 全ケース

- [ ] **Step 7: Commit**

```bash
git add src/screens/Setup.jsx src/screens/Setup.test.jsx
git commit -m "feat(setup): 新規PCにPC名の必須入力を追加する"
```

---

### Task 6: PC名をセッションへ載せ、シート本文にも合成する

**Files:**
- Modify: `src/screens/Setup.jsx`(`handleStart()` の PC ブロック、`session.pc`)
- Modify: `docs/02-data-model.md`(3.1節・3.4節)
- Test: `src/screens/Setup.test.jsx`

**Interfaces:**
- Consumes: Task 1 の `composePcRaw(name, raw)`、Task 4 の `getOrParseCharacter` の戻り値 `{ name, goal, bonds }`
- Produces: `session.pc = { name, raw, goal, bonds }`。`name` は文字列(取れなければ `''`)。Task 3 の `session.pc?.name` がこれを読む

- [ ] **Step 1: Write the failing test**

`src/screens/Setup.test.jsx` の Task 5 で足した3件の直後に追記:

```js
  it('carries the entered PC name into the session and prepends it to the sheet', async () => {
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('次へ')); // World(skip) -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'カイ' } });
    fireEvent.change(screen.getByPlaceholderText(/能力値・スキル/), { target: { value: 'goal: 生き延びる' } });
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.pc.name).toBe('カイ');
    expect(session.pc.raw).toBe('PC名: カイ\ngoal: 生き延びる');
  });

  it('does not duplicate a PC名 line that the player already wrote in the sheet', async () => {
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ'));
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.change(screen.getByPlaceholderText('例: カイ・アーレンス'), { target: { value: 'カイ' } });
    fireEvent.change(screen.getByPlaceholderText(/能力値・スキル/), {
      target: { value: 'PC名: ハワード\ngoal: 真相を暴く' },
    });
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.pc.raw).toBe('PC名: ハワード\ngoal: 真相を暴く');
  });

  it("takes the session PC name from the library sheet's parsed name when an existing PC is picked", async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([]);
    characterLibraryClient.listCharacters.mockResolvedValue([
      { id: 'w1/pc/alice', worldId: 'w1', kind: 'pc', name: 'alice', revealed: null },
    ]);
    vi.spyOn(characterLibraryClient, 'getCharacter').mockResolvedValue({
      raw: 'PC名: アリス',
      revealed: null,
      name: 'alice',
    });
    vi.spyOn(characterSheetCache, 'getOrParseCharacter').mockResolvedValue({
      name: 'アリス',
      goal: '真相を暴く',
      bonds: '姉との再会',
    });
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('alice')).toBeInTheDocument());
    fireEvent.click(screen.getByText('alice'));
    await waitFor(() => expect(characterLibraryClient.getCharacter).toHaveBeenCalledWith('w1', 'pc', 'alice'));

    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.pc.name).toBe('アリス');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/Setup.test.jsx -t "PC name into the session"`
Expected: FAIL — `expected undefined to be 'カイ'`(`session.pc.name` が存在しない)

- [ ] **Step 3: Write minimal implementation**

`src/screens/Setup.jsx` の import に追加(Task 5 で入れた `extractPcName` と同じ行にまとめる):

```js
import { extractPcName, composePcRaw } from '../utils/pcName.js';
```

`handleStart()` の PC ブロック(`let pc;` から `pc: { raw: pc, … }` まで)を次にする:

```js
      let pc;
      let pcResolvedName = '';
      let pcGoal;
      let pcBonds;
      let pcLibraryName = null;

      if (pcMode === 'existing' && selectedPC) {
        pc = selectedPC.raw;
        pcLibraryName = selectedPC.name;
      } else {
        // 入力されたPC名をシート本文にも残す。ライブラリ原本とGMプロンプトの
        // 「# PC設定」節の両方に名前が載り、プレイ中の地の文も名前で呼べるようになる。
        pc = composePcRaw(pcName, pcRaw);
        pcResolvedName = extractPcName(pc);
        // 保存の条件は従来どおり「自由記述が書かれていること」。名前だけのPCを
        // ライブラリに増やさないため、ここは広げない。
        if (resolvedWorldId && pcRaw) {
          const pcId = makeId('pc');
          let pcSaved = false;
          await trySaveToLibrary(async () => {
            await putCharacter(resolvedWorldId, 'pc', pcId, { raw: pc, revealed: undefined });
            pcSaved = true;
          });
          if (pcSaved) {
            pcLibraryName = pcId;
          }
        }
      }

      if (resolvedWorldId && pcLibraryName) {
        try {
          const parsed = await getOrParseCharacter(resolvedWorldId, 'pc', pcLibraryName);
          pcGoal = parsed.goal;
          pcBonds = parsed.bonds;
          // 既存PCを選んだ経路では、名前はここでしか得られない。
          if (parsed.name) pcResolvedName = parsed.name;
        } catch (e) {
          console.error('name/goal/bonds parse failed', e);
        }
      }
```

`session` オブジェクトの `pc` を次にする:

```js
        pc: { name: pcResolvedName, raw: pc, goal: pcGoal, bonds: pcBonds },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: PASS — 全ケース

- [ ] **Step 5: Update the data model doc**

`docs/02-data-model.md` の 3.1節、`原本は自由記述のまま保持…` で始まる段落の直後に次を挿入する:

```markdown
`PC名`はSetupの新規作成モードで必須入力になっており(2026-07-25)、入力値は原本の先頭行へ `PC名: ○○` として合成されると同時に、セッションへ `session.pc.name` としても持たれる。小説化がPCと他の登場人物を「彼」で取り違えないために使う(`server/novelGeneration.js`)。既存PCを選んだ場合は3.4節のパイプラインが抽出した`name`が入る。`pc.name`を持たない旧セッションは空文字として扱われ、小説化側がモデルに呼称を一つ決めさせる。
```

同ファイルの 3.4節、`現状はPCのgoal/bondsのみを対象とする。NPCの構造化パース、statsの抽出は未実装。` を次に置き換える:

```markdown
現状はPCのname/goal/bondsのみを対象とする。NPCの構造化パース、statsの抽出は未実装。抽出スキーマを変更したときは`SHEET_PARSE_VERSION`(`src/api/characterSheetParse.js`)を上げること。この値は`parsedHash`の計算に混ざっており、原本が変わっていない既存キャッシュを一度だけ作り直させる。
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — 全テストファイル

- [ ] **Step 7: Commit**

```bash
git add src/screens/Setup.jsx src/screens/Setup.test.jsx docs/02-data-model.md
git commit -m "feat(setup): PC名をセッションとシート本文へ反映する"
```

---

## 完了条件

- `npm test` が全て通る
- 新規セッションを名前ありで作ると `session.pc.name` に名前が入り、小説化のシステムプロンプトに `主人公の名前は「◯◯」である` が現れる
- `pc.name` を持たない既存セッションを再小説化すると、モデルが呼称を一つ定めて一貫して使う
