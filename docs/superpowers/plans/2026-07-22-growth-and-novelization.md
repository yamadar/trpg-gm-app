# キャラクター成長・経験値 / ログの小説化書き出し Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Rulesetごとに呼び名が変わる単一の経験値カウンター(`session.state.xp`)をGMプロンプト・画面に組み込む。(B) セッションログのAI小説化書き出し機能(サーバー側`/api/sessions/:id/novelize`の実装 + ダウンロードUI)を実装する。

**Architecture:** 6タスクに分割する。Task 1-3はA(growthUnitフィールド→UI→GMプロンプト/表示)、Task 4-6はB(サーバー側novelize実装→クライアント同期→ダウンロードUI)。AとBは完全に独立しており、依存関係はTask内でのみ発生する(Task1→2、Task4→5→6)。

**Tech Stack:** React 18 + Vite、Express 4、Vitest + @testing-library/react + supertest(既存のまま)

## Global Constraints

- `"type": "module"`(ESM)。`require()`は使わない。
- 成長(XP)は演出のみ。`success_percent`判定には一切影響しない。Rulesetごとの計算式・閾値・レベル概念は実装しない。
- `growthUnit`未設定時は`経験値`にフォールバックする(静的4件・カスタムRuleset・`session.ruleset`のいずれの階層でも)。
- セッションのサーバー自動同期(`PUT /api/sessions/:id`)は失敗しても`console.error`のみでゲーム進行を止めない。
- 小説化のAnthropic API呼び出しはサーバー側で行う(`server/routes/messages.js`と同じ`apiKey`/`fetchImpl`注入パターン)。既存の501プレースホルダーテストは実装に合わせて置き換える。
- 小説化は全ログを一括投入する(章分割はしない。既知の制約として長大ログでの上限超過は対応しない)。
- 既存セッション(`state.xp`未定義、`ruleset`未定義)は`|| 0`/`|| RULESETS[0]`等で後方互換に扱う(既存の`buildSystemPrompt`のフォールバック方針を踏襲)。
- 各タスクの最後は該当ファイルのみをステージしてコミットする。

---

## Task 1: growthUnit — Rulesetデータ・保存層

**Files:**
- Modify: `src/data/rulesets.js`
- Modify: `src/data/rulesets.test.js`
- Modify: `server/storage/rulesetLibrary.js`
- Modify: `server/storage/rulesetLibrary.test.js`
- Modify: `server/routes/rulesets.js`
- Modify: `server/routes/rulesets.test.js`
- Modify: `src/api/rulesetLibraryClient.js`
- Modify: `src/api/rulesetLibraryClient.test.js`

**Interfaces:**
- Produces: `RULESETS`の各要素・`saveRuleset`/`putRuleset`の入出力に`growthUnit`(string)フィールドが追加される。Task 2の`RulesetTab.jsx`・`Setup.jsx`が消費する。

- [ ] **Step 1: 各テストファイルに`growthUnit`関連のアサーションを追記(失敗する状態)**

`src/data/rulesets.test.js`の`it('every entry has id/label/desc/hint fields', ...)`テストを次に置き換える:
```js
  it('every entry has id/label/desc/hint/growthUnit fields', () => {
    for (const r of RULESETS) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('label');
      expect(r).toHaveProperty('desc');
      expect(r).toHaveProperty('hint');
      expect(r).toHaveProperty('growthUnit');
    }
  });
```
ファイル末尾に追記:
```js
  it('uses "CP" as the growthUnit for gurps and "経験値" for the others', () => {
    const byId = Object.fromEntries(RULESETS.map((r) => [r.id, r]));
    expect(byId.simple.growthUnit).toBe('経験値');
    expect(byId.coc7e.growthUnit).toBe('経験値');
    expect(byId.dnd5e.growthUnit).toBe('経験値');
    expect(byId.gurps.growthUnit).toBe('CP');
  });
```

`server/storage/rulesetLibrary.test.js`の`it('saves and retrieves a ruleset', ...)`を次に置き換える:
```js
  it('saves and retrieves a ruleset', async () => {
    await saveRuleset(dataStore, {
      id: 'homebrew',
      label: '自作ルール',
      desc: '独自ルール',
      hint: '演出ヒント',
      growthUnit: 'CP',
    });
    const ruleset = await getRuleset(dataStore, 'homebrew');
    expect(ruleset).toMatchObject({
      id: 'homebrew',
      label: '自作ルール',
      desc: '独自ルール',
      hint: '演出ヒント',
      growthUnit: 'CP',
    });
    expect(typeof ruleset.updatedAt).toBe('number');
  });
```

`server/routes/rulesets.test.js`の`it('saves and retrieves a ruleset', ...)`を次に置き換える:
```js
  it('saves and retrieves a ruleset', async () => {
    await request(app)
      .put('/api/rulesets/homebrew')
      .send({ label: '自作ルール', desc: '独自ルール', hint: 'ヒント', growthUnit: 'CP' });
    const res = await request(app).get('/api/rulesets/homebrew');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'homebrew',
      label: '自作ルール',
      desc: '独自ルール',
      hint: 'ヒント',
      growthUnit: 'CP',
    });
  });
```

`src/api/rulesetLibraryClient.test.js`の`describe('putRuleset', ...)`ブロックを次に置き換える:
```js
describe('putRuleset', () => {
  it('PUTs label, desc, hint, and growthUnit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'homebrew' }) });
    vi.stubGlobal('fetch', fetchMock);
    await putRuleset('homebrew', { label: '自作ルール', desc: '独自ルール', hint: '演出ヒント', growthUnit: 'CP' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/rulesets/homebrew',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ label: '自作ルール', desc: '独自ルール', hint: '演出ヒント', growthUnit: 'CP' }),
      })
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/data/rulesets.test.js server/storage/rulesetLibrary.test.js server/routes/rulesets.test.js src/api/rulesetLibraryClient.test.js`
Expected: FAIL(`growthUnit`が未実装)

- [ ] **Step 3: `src/data/rulesets.js`を修正**

ファイル全体を次に置き換える:
```js
export const RULESETS = [
  {
    id: 'simple',
    label: 'シンプル',
    desc: '判定は成功率%のみで統一。ルール色なし、テンポ重視。',
    hint: '',
    growthUnit: '経験値',
  },
  {
    id: 'coc7e',
    label: 'CoC7e風',
    desc: 'クトゥルフ神話TRPG風。恐怖・異常事態でSAN値チェックを演出。',
    hint: '恐怖・異常事態の場面では適宜roll_checkでSAN値チェックを表現し、成功してもSAN減少の描写を加えること。',
    growthUnit: '経験値',
  },
  {
    id: 'dnd5e',
    label: 'D&D5e風',
    desc: 'ファンタジー王道。戦闘のクリティカルを演出。',
    hint: '戦闘や罠ではクリティカル(会心/致命的失敗)を演出に反映すること。',
    growthUnit: '経験値',
  },
  {
    id: 'gurps',
    label: 'GURPS風',
    desc: '汎用ルール寄り。失敗の代償を細かく描写。',
    hint: '判定失敗の程度に応じて代償(時間・資源・状況悪化)を具体的に描写すること。',
    growthUnit: 'CP',
  },
];
```

- [ ] **Step 4: `server/storage/rulesetLibrary.js`を修正**

```js
export async function saveRuleset(dataStore, { id, label, desc, hint, growthUnit }) {
  const meta = { id, label, desc, hint, growthUnit, updatedAt: Date.now() };
  await dataStore.set(rulesetMetaKey(id), meta);
  return meta;
}
```
(`getRuleset`/`listRulesets`/`deleteRuleset`は無変更)

- [ ] **Step 5: `server/routes/rulesets.js`のPUTハンドラを修正**

```js
  router.put('/rulesets/:id', asyncHandler(async (req, res) => {
    const ruleset = await saveRuleset(dataStore, {
      id: req.params.id,
      label: req.body.label,
      desc: req.body.desc,
      hint: req.body.hint,
      growthUnit: req.body.growthUnit,
    });
    res.json(ruleset);
  }));
```

- [ ] **Step 6: `src/api/rulesetLibraryClient.js`の`putRuleset`を修正**

```js
export async function putRuleset(id, { label, desc, hint, growthUnit }) {
  return apiFetch(`/api/rulesets/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, desc, hint, growthUnit }),
  });
}
```

- [ ] **Step 7: テストが通ることを確認**

Run: `npx vitest run src/data/rulesets.test.js server/storage/rulesetLibrary.test.js server/routes/rulesets.test.js src/api/rulesetLibraryClient.test.js`
Expected: 全PASS

- [ ] **Step 8: Commit**

```bash
git add src/data/rulesets.js src/data/rulesets.test.js server/storage/rulesetLibrary.js server/storage/rulesetLibrary.test.js server/routes/rulesets.js server/routes/rulesets.test.js src/api/rulesetLibraryClient.js src/api/rulesetLibraryClient.test.js
git commit -m "feat: add growthUnit field to Ruleset data model"
```

---

## Task 2: growthUnit — RulesetTab UI・Setupのsession.ruleset埋め込み

**Files:**
- Modify: `src/screens/library/RulesetTab.jsx`
- Modify: `src/screens/library/RulesetTab.test.jsx`
- Modify: `src/screens/Setup.jsx`
- Modify: `src/screens/Setup.test.jsx`

**Interfaces:**
- Consumes: `growthUnit`(Task 1)
- Produces: `session.ruleset.growthUnit`(string)、`session.state.xp`(number、初期値0)。Task 3の`prompts.js`・`Play.jsx`が消費する。

- [ ] **Step 1: `src/screens/library/RulesetTab.test.jsx`を更新(失敗する状態)**

`describe('RulesetTab', ...)`ブロック内の`it('creates a new ruleset via putRuleset', ...)`を次に置き換える:
```jsx
  it('creates a new ruleset via putRuleset, including growthUnit', async () => {
    vi.spyOn(rulesetLibraryClient, 'listRulesets').mockResolvedValue([]);
    const putSpy = vi.spyOn(rulesetLibraryClient, 'putRuleset').mockResolvedValue({});
    render(<RulesetTab />);
    await waitFor(() => expect(rulesetLibraryClient.listRulesets).toHaveBeenCalled());

    fireEvent.click(screen.getByText('+ 新規Ruleset'));
    fireEvent.change(screen.getByPlaceholderText('例: homebrew'), { target: { value: 'homebrew' } });
    fireEvent.change(screen.getByPlaceholderText('ラベル'), { target: { value: '自作ルール' } });
    fireEvent.change(screen.getByPlaceholderText('説明'), { target: { value: '独自ルール' } });
    fireEvent.change(screen.getByPlaceholderText('例: 経験値'), { target: { value: 'CP' } });
    fireEvent.click(screen.getByText('作成する'));

    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith('homebrew', {
        label: '自作ルール',
        desc: '独自ルール',
        hint: '',
        growthUnit: 'CP',
      })
    );
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/library/RulesetTab.test.jsx`
Expected: FAIL(`growthUnit`入力欄が無い)

- [ ] **Step 3: `src/screens/library/RulesetTab.jsx`を修正**

state追加(`newHint`/`editHint`の直後にそれぞれ追加):
```js
  const [newHint, setNewHint] = useState('');
  const [newGrowthUnit, setNewGrowthUnit] = useState('');
```
```js
  const [editHint, setEditHint] = useState('');
  const [editGrowthUnit, setEditGrowthUnit] = useState('');
```

`useEffect`(選択時の取得)を修正:
```js
        setEditLabel(r.label);
        setEditDesc(r.desc);
        setEditHint(r.hint || '');
        setEditGrowthUnit(r.growthUnit || '');
```

`handleCreate`を修正:
```js
      await putRuleset(newId, { label: newLabel, desc: newDesc, hint: newHint, growthUnit: newGrowthUnit });
      setNewId('');
      setNewLabel('');
      setNewDesc('');
      setNewHint('');
      setNewGrowthUnit('');
```

`handleSave`を修正:
```js
      await putRuleset(selectedId, { label: editLabel, desc: editDesc, hint: editHint, growthUnit: editGrowthUnit });
```

新規作成フォームの「演出ヒント(hint)」`Field`の直後に追加:
```jsx
          <Field label="成長の呼び名(growthUnit)" hint="任意。未入力なら「経験値」として扱われる。例: 経験値・CP・SP等。">
            <input
              value={newGrowthUnit}
              onChange={(e) => setNewGrowthUnit(e.target.value)}
              placeholder="例: 経験値"
              style={inputStyle}
            />
          </Field>
```

編集フォームの「演出ヒント(hint)」`Field`の直後に追加:
```jsx
          <Field label="成長の呼び名(growthUnit)" hint="任意。未入力なら「経験値」として扱われる。">
            <input value={editGrowthUnit} onChange={(e) => setEditGrowthUnit(e.target.value)} style={inputStyle} />
          </Field>
```

- [ ] **Step 4: `RulesetTab.test.jsx`が通ることを確認**

Run: `npx vitest run src/screens/library/RulesetTab.test.jsx`
Expected: PASS(4 tests)

- [ ] **Step 5: `src/screens/Setup.test.jsx`を更新(失敗する状態)**

既存の`it("carries the selected Scenario's recommendedRuleset through as the default Ruleset on session start", ...)`テストの末尾(`expect(session.ruleset.label).toBe('CoC7e風');`の直後)に1行追加:
```js
    expect(session.ruleset.growthUnit).toBe('経験値');
    expect(session.state.xp).toBe(0);
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: FAIL(`session.ruleset.growthUnit`/`session.state.xp`が未実装)

- [ ] **Step 7: `src/screens/Setup.jsx`を修正**

現在の`session`構築部分:
```js
      const resolvedRuleset = allRulesets.find((r) => r.id === rulesetId) || RULESETS[0];

      const session = {
        id: 'sess_' + Date.now(),
        title: title || 'セッション ' + new Date().toLocaleDateString('ja-JP'),
        world: { raw: worldRawForSession, summary: worldSummary },
        scenario: { raw: scenario },
        rulesetId,
        ruleset: {
          id: resolvedRuleset.id,
          label: resolvedRuleset.label,
          desc: resolvedRuleset.desc,
          hint: resolvedRuleset.hint,
        },
        pc: { raw: pc, goal: pcGoal, bonds: pcBonds },
        state: {
          current_scene: '冒頭',
          flags: {},
          history_summary: '',
          recent_log: [],
          turn_count: 0,
        },
        log: [],
        updatedAt: Date.now(),
      };
```
を次に置き換える:
```js
      const resolvedRuleset = allRulesets.find((r) => r.id === rulesetId) || RULESETS[0];

      const session = {
        id: 'sess_' + Date.now(),
        title: title || 'セッション ' + new Date().toLocaleDateString('ja-JP'),
        world: { raw: worldRawForSession, summary: worldSummary },
        scenario: { raw: scenario },
        rulesetId,
        ruleset: {
          id: resolvedRuleset.id,
          label: resolvedRuleset.label,
          desc: resolvedRuleset.desc,
          hint: resolvedRuleset.hint,
          growthUnit: resolvedRuleset.growthUnit || '経験値',
        },
        pc: { raw: pc, goal: pcGoal, bonds: pcBonds },
        state: {
          current_scene: '冒頭',
          flags: {},
          history_summary: '',
          recent_log: [],
          turn_count: 0,
          xp: 0,
        },
        log: [],
        updatedAt: Date.now(),
      };
```

- [ ] **Step 8: テストが通ることを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: PASS

- [ ] **Step 9: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 10: Commit**

```bash
git add src/screens/library/RulesetTab.jsx src/screens/library/RulesetTab.test.jsx src/screens/Setup.jsx src/screens/Setup.test.jsx
git commit -m "feat: add growthUnit input to RulesetTab and embed it + initial xp into new sessions"
```

---

## Task 3: state.xp — GMプロンプトへの指示・Play画面での加算と表示

**Files:**
- Modify: `src/api/prompts.js`
- Modify: `src/api/prompts.test.js`
- Modify: `src/screens/Play.jsx`
- Modify: `src/screens/Play.test.jsx`

**Interfaces:**
- Consumes: `session.ruleset.growthUnit`・`session.state.xp`(Task 2)
- Produces: `buildSystemPrompt`の出力JSON形式に`state_update.xp_gained`が追加される。`Play.jsx`が`state.xp`に加算し、画面に「{growthUnit}: {xp}」を表示する。

- [ ] **Step 1: `src/api/prompts.test.js`にテストを追記(失敗する状態)**

`describe('buildSystemPrompt', ...)`ブロックの末尾に追記:
```js
  it('instructs the GM to consider xp_gained using the growthUnit label', () => {
    const prompt = buildSystemPrompt(
      makeSession({ ruleset: { id: 'gurps', label: 'GURPS風', desc: '', hint: '', growthUnit: 'CP' } })
    );
    expect(prompt).toContain('xp_gained');
    expect(prompt).toContain('CP');
  });

  it('falls back to "経験値" as the growthUnit label when session.ruleset is absent', () => {
    const prompt = buildSystemPrompt(makeSession());
    expect(prompt).toContain('経験値');
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/prompts.test.js`
Expected: FAIL(`xp_gained`指示が未実装)

- [ ] **Step 3: `src/api/prompts.js`の`buildSystemPrompt`を修正**

`const rs = session.ruleset || RULESETS.find((r) => r.id === session.rulesetId) || RULESETS[0];`の直後に1行追加:
```js
  const growthUnit = session.ruleset?.growthUnit || '経験値';
```

出力形式の指示部分、現在:
```
# 出力形式(厳守)
説明文やコードブロック記号を一切付けず、次のJSONのみを出力すること:
{"narrative": "地の文(150〜250字程度)", "state_update": {"current_scene": "更新後のシーン名", "flags": {"追加/更新分のみ": true}, "history_summary": "更新後の物語要約(300字程度)"}, "choices": ["選択肢1", "選択肢2", "選択肢3"]}
choices は自由記述を促したい場面では空配列 [] でよい。flags は新規/更新分のみでよい(既存分は保持される)。
```
を次に置き換える(テンプレートリテラル内、`growthUnit`変数を埋め込む):
```
# 出力形式(厳守)
説明文やコードブロック記号を一切付けず、次のJSONのみを出力すること:
{"narrative": "地の文(150〜250字程度)", "state_update": {"current_scene": "更新後のシーン名", "flags": {"追加/更新分のみ": true}, "history_summary": "更新後の物語要約(300字程度)", "xp_gained": 0}, "choices": ["選択肢1", "選択肢2", "選択肢3"]}
choices は自由記述を促したい場面では空配列 [] でよい。flags は新規/更新分のみでよい(既存分は保持される)。xp_gained は物語が進展・成功した節目でのみ${growthUnit}として適切と思われる量を設定し(呼び名・量の目安はルール性向のヒントに従う)、通常は0でよい。
```

(テンプレートリテラル内で`${growthUnit}`を使うため、`buildSystemPrompt`関数の戻り値のテンプレートリテラル文字列内に直接埋め込む形にする。)

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/prompts.test.js`
Expected: PASS(既存8テスト + 新規2テスト = 10テスト)

- [ ] **Step 5: `src/screens/Play.test.jsx`にテストを追記(失敗する状態)**

`beforeEach`の`fetch`モックを、`state_update`に`xp_gained`を含む形に変更:
```js
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              narrative: '物語が始まった。',
              state_update: { xp_gained: 5 },
              choices: ['進む'],
            }),
          },
        ],
      }),
    })
  );
});
```

`describe('Play', ...)`ブロックの末尾に追記:
```jsx
  it('accumulates xp_gained into session.state.xp and displays it with the growthUnit label', async () => {
    const session = makeSession({ ruleset: { id: 'gurps', label: 'GURPS風', desc: '', hint: '', growthUnit: 'CP' } });
    render(<Harness initialSession={session} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('CP: 5')).toBeInTheDocument();
  });

  it('defaults the growth label to "経験値" when session.ruleset is absent', async () => {
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    expect(screen.getByText('経験値: 5')).toBeInTheDocument();
  });
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: FAIL(xp加算・表示が未実装)

- [ ] **Step 7: `src/screens/Play.jsx`を修正**

`runTurn`内、現在:
```js
        const newFlags = { ...session.state.flags, ...(result.state_update?.flags || {}) };
        const newLog = [...session.log];
```
を次に置き換える:
```js
        const newFlags = { ...session.state.flags, ...(result.state_update?.flags || {}) };
        const newXp = (session.state.xp || 0) + (result.state_update?.xp_gained || 0);
        const newLog = [...session.log];
```

`updated`オブジェクトの`state`部分、現在:
```js
        const updated = {
          ...session,
          state: {
            ...session.state,
            current_scene: result.state_update?.current_scene || session.state.current_scene,
            flags: newFlags,
            history_summary: result.state_update?.history_summary ?? session.state.history_summary,
            recent_log: recent,
            turn_count: session.state.turn_count + 1,
          },
          log: newLog,
          updatedAt: Date.now(),
        };
```
を次に置き換える:
```js
        const updated = {
          ...session,
          state: {
            ...session.state,
            current_scene: result.state_update?.current_scene || session.state.current_scene,
            flags: newFlags,
            history_summary: result.state_update?.history_summary ?? session.state.history_summary,
            recent_log: recent,
            turn_count: session.state.turn_count + 1,
            xp: newXp,
          },
          log: newLog,
          updatedAt: Date.now(),
        };
```

シーン表示部分、現在:
```jsx
          <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>
            シーン: {session.state.current_scene}
          </div>
```
を次に置き換える(成長ポイント表示を別の`div`として追加する。同じ`div`内のテキストを連結すると
`screen.getByText('CP: 5')`のような完全一致クエリが「シーン: 冒頭 ・ CP: 5」という結合済みテキスト
に対して不一致になるため、Testing Libraryの完全一致マッチングと相性が良いよう独立した要素にする):
```jsx
          <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>
            シーン: {session.state.current_scene}
          </div>
          <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>
            {session.ruleset?.growthUnit || '経験値'}: {session.state.xp || 0}
          </div>
```

- [ ] **Step 8: テストが通ることを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS(既存3テスト + 新規2テスト = 5テスト)

- [ ] **Step 9: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 10: Commit**

```bash
git add src/api/prompts.js src/api/prompts.test.js src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "feat: instruct the GM to award xp_gained and display accumulated xp during play"
```

---

## Task 4: 小説化 — サーバー側インフラ(paths.js・sessions.js・index.js)

**Files:**
- Modify: `server/storage/paths.js`
- Modify: `server/routes/sessions.js`
- Modify: `server/routes/sessions.test.js`
- Modify: `server/index.js`

**Interfaces:**
- Produces: `sessionNovelDocPath(sessionId)`。`createSessionsRouter({ dataStore, textStore, apiKey, fetchImpl })`(引数追加)。`POST /api/sessions/:id/novelize`(実装)、`GET /api/sessions/:id/novel`(新規)。Task 5の`sessionSyncClient.js`が消費する。

- [ ] **Step 1: `server/routes/sessions.test.js`を書き換える(失敗する状態)**

ファイル全体を次の内容に置き換える:
```js
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createSessionsRouter } from './sessions.js';
import { createFsDataStore } from '../storage/dataStore.js';
import { createFsTextStore } from '../storage/textStore.js';

let dir;
let dataStore;
let textStore;
let app;

function buildApp({ apiKey = 'test-key', fetchImpl } = {}) {
  app = express();
  app.use(express.json());
  app.use('/api', createSessionsRouter({ dataStore, textStore, apiKey, fetchImpl }));
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-route-test-'));
  dataStore = createFsDataStore(dir);
  textStore = createFsTextStore(dir);
  buildApp();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('sessions routes', () => {
  it('returns 404 for a missing session', async () => {
    const res = await request(app).get('/api/sessions/missing');
    expect(res.status).toBe(404);
  });

  it('saves and retrieves a session', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'My Session' });
    const res = await request(app).get('/api/sessions/s1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 's1', title: 'My Session' });
  });

  it('lists saved sessions', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A' });
    await request(app).put('/api/sessions/s2').send({ title: 'B' });
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body.map((s) => s.id).sort()).toEqual(['s1', 's2']);
  });

  it('returns 404 from novelize when the session does not exist', async () => {
    const res = await request(app).post('/api/sessions/missing/novelize');
    expect(res.status).toBe(404);
  });

  it('returns 500 from novelize when no API key is configured', async () => {
    buildApp({ apiKey: undefined });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(500);
  });

  it('generates and stores a novelization from the session log, retrievable via GET', async () => {
    const fetchImpl = async (url, options) => {
      const body = JSON.parse(options.body);
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(body.messages[0].content).toContain('波止場を調べる');
      return {
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: '小説化された本文。' }] }),
      };
    };
    buildApp({ fetchImpl });

    await request(app)
      .put('/api/sessions/s1')
      .send({
        title: 'A',
        log: [
          { role: 'player', text: '波止場を調べる' },
          { role: 'gm', text: '波止場には誰もいなかった。' },
        ],
      });

    const postRes = await request(app).post('/api/sessions/s1/novelize');
    expect(postRes.status).toBe(200);
    expect(postRes.body).toEqual({ ok: true });

    const getRes = await request(app).get('/api/sessions/s1/novel');
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({ text: '小説化された本文。' });
  });

  it('returns 404 from GET novel when nothing has been generated yet', async () => {
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    const res = await request(app).get('/api/sessions/s1/novel');
    expect(res.status).toBe(404);
  });

  it('returns 502 from novelize when the upstream call fails', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'boom' });
    buildApp({ fetchImpl });
    await request(app).put('/api/sessions/s1').send({ title: 'A', log: [] });
    const res = await request(app).post('/api/sessions/s1/novelize');
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run server/routes/sessions.test.js`
Expected: FAIL(novelize/novelが未実装)

- [ ] **Step 3: `server/storage/paths.js`に`sessionNovelDocPath`を追加**

ファイル冒頭の`sessionKey`関数の直後に追加:
```js
export function sessionNovelDocPath(sessionId) {
  return `sessions/${sessionId}/novel.md`;
}
```

- [ ] **Step 4: `server/routes/sessions.js`を書き換える**

ファイル全体を次の内容に置き換える:
```js
import { Router } from 'express';
import { sessionKey, sessionNovelDocPath } from '../storage/paths.js';
import { asyncHandler } from './asyncHandler.js';

function extractText(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function logToTranscript(log) {
  return (log || []).map((entry) => `${entry.role === 'player' ? 'PL' : 'GM'}: ${entry.text}`).join('\n');
}

const NOVELIZE_SYSTEM_PROMPT =
  '以下はTRPGセッションの進行ログである。プレイヤー発言とGMの地の文が交互に並んでいる。これを一人称または三人称の小説として、場面転換や心理描写を補いながら自然な文章に書き直せ。ゲーム的な表現(選択肢・判定結果の数値等)はそのまま出力せず、物語として自然に溶け込ませること。説明文やコードブロック記号は付けず、小説本文のみを出力すること。';

export function createSessionsRouter({ dataStore, textStore, apiKey, fetchImpl = fetch }) {
  const router = Router();

  router.get('/sessions', asyncHandler(async (req, res) => {
    const keys = await dataStore.list('sessions');
    const sessions = await Promise.all(keys.map((k) => dataStore.get(k)));
    res.json(sessions.filter(Boolean));
  }));

  router.get('/sessions/:id', asyncHandler(async (req, res) => {
    const session = await dataStore.get(sessionKey(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    res.json(session);
  }));

  router.put('/sessions/:id', asyncHandler(async (req, res) => {
    const session = { ...req.body, id: req.params.id };
    await dataStore.set(sessionKey(req.params.id), session);
    res.json(session);
  }));

  router.post('/sessions/:id/novelize', asyncHandler(async (req, res) => {
    if (!apiKey) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server' });
      return;
    }
    const session = await dataStore.get(sessionKey(req.params.id));
    if (!session) {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    const transcript = logToTranscript(session.log);
    const upstream = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        system: NOVELIZE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: transcript }],
      }),
    });
    if (!upstream.ok) {
      const t = await upstream.text().catch(() => '');
      res.status(502).json({ error: `upstream request failed: ${t.slice(0, 200)}` });
      return;
    }
    const data = await upstream.json();
    const text = extractText(data.content);
    await textStore.write(sessionNovelDocPath(req.params.id), text);
    res.json({ ok: true });
  }));

  router.get('/sessions/:id/novel', asyncHandler(async (req, res) => {
    const text = await textStore.read(sessionNovelDocPath(req.params.id));
    if (text === null) {
      res.status(404).json({ error: 'novel not found' });
      return;
    }
    res.json({ text });
  }));

  return router;
}
```

- [ ] **Step 5: `server/index.js`のルーター初期化を修正**

現在:
```js
  app.use('/api', createMessagesRouter({ apiKey, fetchImpl }));
  app.use('/api', createSessionsRouter({ dataStore }));
```
を次に置き換える:
```js
  app.use('/api', createMessagesRouter({ apiKey, fetchImpl }));
  app.use('/api', createSessionsRouter({ dataStore, textStore, apiKey, fetchImpl }));
```

- [ ] **Step 6: テストが通ることを確認**

Run: `npx vitest run server/routes/sessions.test.js`
Expected: PASS(8 tests)

- [ ] **Step 7: `server/index.test.js`が通ることを確認(回帰確認)**

Run: `npx vitest run server/index.test.js`
Expected: PASS(既存の`GET /api/sessions`が空配列を返すテストは無影響のはず)

- [ ] **Step 8: Commit**

```bash
git add server/storage/paths.js server/routes/sessions.js server/routes/sessions.test.js server/index.js
git commit -m "feat(server): implement session novelization endpoint"
```

---

## Task 5: 小説化 — クライアント同期(sessionSyncClient.js・Play.jsx自動同期)

**Files:**
- Create: `src/api/sessionSyncClient.js`
- Create: `src/api/sessionSyncClient.test.js`
- Modify: `src/screens/Play.jsx`
- Modify: `src/screens/Play.test.jsx`

**Interfaces:**
- Consumes: `POST/GET /api/sessions/:id*`(Task 4)
- Produces: `putSessionToServer(session)`・`novelizeSession(id)`・`getNovel(id)`。Task 6の`Home.jsx`が`novelizeSession`/`getNovel`を消費する。`Play.jsx`は`putSessionToServer`をターンごとに呼ぶ。

- [ ] **Step 1: `src/api/sessionSyncClient.test.js`を書く(失敗する状態)**

```js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { putSessionToServer, novelizeSession, getNovel } from './sessionSyncClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('putSessionToServer', () => {
  it('PUTs the full session object', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 's1' }) });
    vi.stubGlobal('fetch', fetchMock);
    const session = { id: 's1', title: 'A' };
    await putSessionToServer(session);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/sessions/s1',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(session) })
    );
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(putSessionToServer({ id: 's1' })).rejects.toThrow('API error 500: boom');
  });
});

describe('novelizeSession', () => {
  it('POSTs to the novelize endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    await novelizeSession('s1');
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/novelize', expect.objectContaining({ method: 'POST' }));
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => 'upstream down' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(novelizeSession('s1')).rejects.toThrow('API error 502: upstream down');
  });
});

describe('getNovel', () => {
  it('GETs the generated novel text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: '小説本文' }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await getNovel('s1');
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/s1/novel', expect.objectContaining({ method: 'GET' }));
    expect(result).toEqual({ text: '小説本文' });
  });

  it('throws with status and truncated body on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    vi.stubGlobal('fetch', fetchMock);
    await expect(getNovel('s1')).rejects.toThrow('API error 404: not found');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/api/sessionSyncClient.test.js`
Expected: FAIL(`sessionSyncClient.js`が存在しない)

- [ ] **Step 3: `src/api/sessionSyncClient.js`を実装**

```js
async function apiFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

export async function putSessionToServer(session) {
  return apiFetch(`/api/sessions/${session.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
}

export async function novelizeSession(id) {
  return apiFetch(`/api/sessions/${id}/novelize`, { method: 'POST' });
}

export async function getNovel(id) {
  return apiFetch(`/api/sessions/${id}/novel`, { method: 'GET' });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/api/sessionSyncClient.test.js`
Expected: PASS(6 tests)

- [ ] **Step 5: `src/screens/Play.test.jsx`にテストを追記(失敗する状態)**

ファイル冒頭のimportに1行追加:
```jsx
import * as sessionSyncClient from '../api/sessionSyncClient.js';
```

`describe('Play', ...)`ブロックの末尾に追記:
```jsx
  it('syncs the updated session to the server after a turn, without blocking on failure', async () => {
    const putSpy = vi.spyOn(sessionSyncClient, 'putSessionToServer').mockRejectedValue(new Error('offline'));
    render(<Harness initialSession={makeSession()} onExit={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('物語が始まった。')).toBeInTheDocument());
    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    // 同期失敗してもUIはエラー表示しない(ゲーム進行は止めない)
    expect(screen.queryByText(/GM応答の取得に失敗した/)).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: テストが失敗することを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: FAIL(サーバー同期が未実装)

- [ ] **Step 7: `src/screens/Play.jsx`を修正**

importに1行追加:
```js
import { putSessionToServer } from '../api/sessionSyncClient.js';
```

`runTurn`内、現在:
```js
        setSession(updated);
        await saveSession(updated);
```
を次に置き換える:
```js
        setSession(updated);
        await saveSession(updated);
        putSessionToServer(updated).catch((e) => console.error('session server sync failed', e));
```

(意図的に`await`しない。サーバー同期の失敗・遅延がゲーム進行をブロックしないようにするため。)

- [ ] **Step 8: テストが通ることを確認**

Run: `npx vitest run src/screens/Play.test.jsx`
Expected: PASS(既存5テスト + 新規1テスト = 6テスト)

- [ ] **Step 9: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 10: Commit**

```bash
git add src/api/sessionSyncClient.js src/api/sessionSyncClient.test.js src/screens/Play.jsx src/screens/Play.test.jsx
git commit -m "feat(frontend): auto-sync sessions to the server after each turn"
```

---

## Task 6: 小説化 — Home画面のダウンロードUI

**Files:**
- Modify: `src/screens/Home.jsx`
- Modify: `src/screens/Home.test.jsx`

**Interfaces:**
- Consumes: `novelizeSession`・`getNovel`(Task 5)
- Produces: セッションカードの「小説化」ボタン→`.md`ファイルダウンロード。

- [ ] **Step 1: `src/screens/Home.test.jsx`を更新(失敗する状態)**

ファイル冒頭のimportを次に置き換える:
```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Home from './Home.jsx';
import * as sessionSyncClient from '../api/sessionSyncClient.js';
```

`describe('Home', ...)`ブロックの直前に追加:
```jsx
beforeEach(() => {
  vi.restoreAllMocks();
});
```

`describe('Home', ...)`ブロックの末尾に追記:
```jsx
  it('novelizes a session and triggers a file download when "小説化" is clicked, without navigating into the session', async () => {
    const novelizeSpy = vi.spyOn(sessionSyncClient, 'novelizeSession').mockResolvedValue({ ok: true });
    vi.spyOn(sessionSyncClient, 'getNovel').mockResolvedValue({ text: '小説本文' });
    const createObjectURLSpy = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURLSpy = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: createObjectURLSpy, revokeObjectURL: revokeObjectURLSpy });

    const sessions = [{ id: 's1', title: 'セッションA', updatedAt: 1, state: {}, log: [] }];
    const onContinue = vi.fn();
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={onContinue} onOpenLibrary={vi.fn()} />);

    fireEvent.click(screen.getByText('小説化'));

    await waitFor(() => expect(novelizeSpy).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(sessionSyncClient.getNovel).toHaveBeenCalledWith('s1'));
    await waitFor(() => expect(createObjectURLSpy).toHaveBeenCalled());
    // 「小説化」ボタンはカード全体のonClick(onContinue、セッションへの遷移)の内側にあるため、
    // イベント伝播を止めていないと誤って遷移してしまう。stopPropagationの検証。
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('shows an error message when novelization fails', async () => {
    vi.spyOn(sessionSyncClient, 'novelizeSession').mockRejectedValue(new Error('upstream down'));
    const sessions = [{ id: 's1', title: 'セッションA', updatedAt: 1, state: {}, log: [] }];
    render(<Home sessions={sessions} storageOk={true} onNew={vi.fn()} onContinue={vi.fn()} onOpenLibrary={vi.fn()} />);

    fireEvent.click(screen.getByText('小説化'));

    await waitFor(() => expect(screen.getByText(/小説化に失敗した/)).toBeInTheDocument());
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: FAIL(「小説化」ボタンが存在しない)

- [ ] **Step 3: `src/screens/Home.jsx`を修正**

ファイル全体を次の内容に置き換える:
```jsx
import { useState } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO } from '../theme.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import { novelizeSession, getNovel } from '../api/sessionSyncClient.js';

function lastLineOf(session) {
  const lastGm = [...session.log].reverse().find((e) => e.role === 'gm');
  if (!lastGm) return '(まだ進行なし)';
  return lastGm.text.slice(0, 60) + (lastGm.text.length > 60 ? '…' : '');
}

function sanitizeFilename(title) {
  return (title || 'session').replace(/[\\/:*?"<>|]/g, '_');
}

export default function Home({ sessions, storageOk, onNew, onContinue, onOpenLibrary }) {
  const [novelizingId, setNovelizingId] = useState(null);
  const [novelizeError, setNovelizeError] = useState({});

  async function handleNovelize(e, session) {
    e.stopPropagation();
    setNovelizingId(session.id);
    setNovelizeError((prev) => ({ ...prev, [session.id]: '' }));
    try {
      await novelizeSession(session.id);
      const { text } = await getNovel(session.id);
      const blob = new Blob([text], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(session.title)}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNovelizeError((prev) => ({ ...prev, [session.id]: '小説化に失敗した: ' + err.message }));
    } finally {
      setNovelizingId(null);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px' }}>
      <h1
        style={{
          fontFamily: F_DISPLAY,
          fontSize: 32,
          color: COLORS.ink,
          marginBottom: 4,
          letterSpacing: 1,
        }}
      >
        GM's Desk
      </h1>
      <p
        style={{
          fontFamily: F_BODY,
          color: COLORS.inkSoft,
          fontSize: 14,
          marginBottom: 32,
        }}
      >
        AIがGMを務めるインタラクティブ物語
      </p>

      {!storageOk && (
        <div
          style={{
            fontFamily: F_MONO,
            fontSize: 12,
            color: COLORS.stamp,
            border: `1px solid ${COLORS.stamp}`,
            borderRadius: 4,
            padding: '10px 12px',
            marginBottom: 24,
          }}
        >
          この環境では保存機能(IndexedDB)が使えていない。「続きから再開」は動作せず、ページを離れると進行が失われる。ブラウザのコンソールにエラー詳細が出ている。
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 32 }}>
        <Button variant="brass" onClick={onNew}>
          + 新規プレイ
        </Button>
        <Button variant="ghost" onClick={onOpenLibrary}>
          素材ライブラリ
        </Button>
      </div>

      {sessions.length > 0 && (
        <>
          <div
            style={{
              fontFamily: F_DISPLAY,
              fontSize: 13,
              color: COLORS.brassDark,
              marginBottom: 12,
              letterSpacing: 0.5,
            }}
          >
            続きから再開
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sessions.map((s) => (
              <Card key={s.id} style={{ cursor: 'pointer' }} onClick={() => onContinue(s.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        marginBottom: 4,
                      }}
                    >
                      <div style={{ fontFamily: F_DISPLAY, fontSize: 15, color: COLORS.ink }}>
                        {s.title}
                      </div>
                      {s.state?.current_scene && (
                        <div
                          style={{
                            fontFamily: F_MONO,
                            fontSize: 11,
                            color: COLORS.brassDark,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          シーン: {s.state.current_scene}
                          {typeof s.state.turn_count === 'number' ? ` / ${s.state.turn_count}手` : ''}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: F_BODY,
                        fontSize: 13,
                        color: COLORS.inkSoft,
                        opacity: 0.8,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {lastLineOf(s)}
                    </div>
                    {novelizeError[s.id] && (
                      <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.stamp, marginTop: 4 }}>
                        {novelizeError[s.id]}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <div
                      style={{
                        fontFamily: F_MONO,
                        fontSize: 12,
                        color: COLORS.brass,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      続ける →
                    </div>
                    <Button
                      variant="ghost"
                      onClick={(e) => handleNovelize(e, s)}
                      disabled={novelizingId === s.id}
                      style={{ fontSize: 11, padding: '4px 8px' }}
                    >
                      {novelizingId === s.id ? '小説化中…' : '小説化'}
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Home.test.jsx`
Expected: PASS(既存5テスト + 新規2テスト = 7テスト)

- [ ] **Step 5: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 6: ビルドを確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 7: Commit**

```bash
git add src/screens/Home.jsx src/screens/Home.test.jsx
git commit -m "feat(frontend): add novelization download to session cards on Home"
```

---

## Self-Review Notes

- **Spec coverage**: spec docの§3(growthUnit・state.xp・GMプロンプト・画面表示)→Task 1-3、§4(サーバー側novelize・クライアント同期・ダウンロードUI)→Task 4-6、いずれもカバーされている。
- **Placeholder scan**: 「TBD」等の記述なし。
- **Type consistency**: `growthUnit`は`RULESETS`(Task 1)→`RulesetTab`フォーム(Task 2)→`Setup.jsx`の`session.ruleset`(Task 2)→`prompts.js`の`buildSystemPrompt`(Task 3)→`Play.jsx`の表示(Task 3)まで、フィールド名・フォールバック値(`|| '経験値'`)が一貫している。`sessionNovelDocPath`(Task 4)は`server/routes/sessions.js`の2箇所(POST/GET)で同一の関数を使っている。`sessionSyncClient.js`の3関数(Task 5)はTask 6の`Home.jsx`が呼ぶ名前・シグネチャと一致している。
- **既存パターンとの一貫性**: `sessionSyncClient.js`は既存の`apiFetch`ヘルパーパターン(`worldLibraryClient.js`等)を踏襲。サーバー側の小説化AI呼び出しは`server/routes/messages.js`の`apiKey`/`fetchImpl`注入・エラーハンドリングパターンを踏襲。ダウンロード機能はこのアプリで初めてのBlobダウンロードパターンだが、既存のエラー表示(`COLORS.stamp`)・busyボタン無効化パターンは踏襲している。
- **後方互換性**: `session.state.xp`・`session.ruleset`が無い既存セッションは、Play.jsx側で`|| 0`・オプショナルチェイニング(`session.ruleset?.growthUnit`)により安全にフォールバックする。`prompts.js`側も同様。
- **非スコープの遵守**: Ruleset間の実際の成長計算式の違い、レベル概念、小説化の章分割、複数バージョン管理、NPCの成長は、どのタスクにも含まれていない。
