# 素材ライブラリ サブプロジェクト4c: Setupウィザード連携 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/screens/Setup.jsx`のWorld/Scenario/PCステップを、素材ライブラリの「既存を選ぶ」「新規作成(ライブラリにも保存)」の2系統に対応させ、Scenarioの`recommendedRuleset`をRulesetステップのデフォルト選択に反映する。

**Architecture:** ライブラリへの書き込み(`importWorld`/`putScenario`/`putCharacter`)はすべて`handleStart`内にまとめ、個々のステップの「次へ」ボタンには非同期処理を追加しない(既存の`summarizeWorld`/`generateScenario`と同じタイミング)。既存を選ぶ場合の読み取り(`getWorld`/`getScenario`/`getCharacter`)は選択直後に即時fetchする。新規作成時の識別子は`slugify(タイトル) + '-' + Date.now()`で自動生成し、ユーザー入力は増やさない。

**Tech Stack:** React 18 + Vite、Vitest + @testing-library/react(既存のまま)

## Global Constraints

- `"type": "module"`(ESM)。`require()`は使わない。
- `session`のデータ構造(`world.raw`/`world.summary`/`scenario.raw`/`pc.raw`埋め込み)は変更しない。`src/api/prompts.js`(`buildSystemPrompt`)・`src/screens/Play.jsx`は無改修。
- Rulesetステップは既存の静的`RULESETS`(`src/data/rulesets.js`)のみを使用する。カスタムRuleset(サーバー保存分)は対象外。
- ライブラリへの書き込み(`importWorld`/`putScenario`/`putCharacter`)は個別に`try/catch`で包み、失敗してもセッション開始全体を止めない(`console.error`に記録し、`COLORS.stamp`色の非致命的な警告テキストを確認ステップに表示する)。ただし`worldMode === 'new'`で`importWorld`自体が失敗した場合、それ以降のScenario/PCライブラリ保存は`worldId`が無いためスキップする。
- 既存選択(`getWorld`/`getScenario`/`getCharacter`)のfetchは、連打による古いレスポンスでの上書きを防ぐため、種別ごとに独立したリクエストトークン(`useRef`カウンタ)で最新リクエストのみ結果を反映するガードを付ける(`src/screens/library/*Tab.jsx`で確立済みの`cancelled`フラグと同じ目的、ただしここはクリックハンドラなので同等の効果をトークン比較で実現する)。
- UIはCard/Button/Field/`src/theme.js`の既存パターン(Scenarioステップの2〜3択ボタン、Rulesetステップのカード選択)を踏襲する。
- 新規作成の識別子入力欄は追加しない(自動生成)。
- 各タスクの最後は該当ファイルのみをステージしてコミットする。

---

## Task 1: src/utils/slugify.js(共通ユーティリティ抽出)

**Files:**
- Create: `src/utils/slugify.js`
- Create: `src/utils/slugify.test.js`
- Modify: `src/api/worldSplit.js`

**Interfaces:**
- Produces: `slugify(value)` → `string`(小文字化・英数字とハイフン以外除去・64文字制限・空なら`'untitled'`)。Task 2の`Setup.jsx`が識別子自動生成に使う。`worldSplit.js`も同じ関数に差し替える。

- [ ] **Step 1: `src/utils/slugify.test.js`を書く(失敗する状態)**

```js
import { describe, it, expect } from 'vitest';
import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lowercases and strips non-alphanumeric characters', () => {
    expect(slugify('Water Deep!')).toBe('waterdeep');
  });

  it('truncates to 64 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long)).toHaveLength(64);
  });

  it('falls back to "untitled" when nothing ascii-alphanumeric remains', () => {
    expect(slugify('魔法体系')).toBe('untitled');
  });

  it('falls back to "untitled" for an empty string', () => {
    expect(slugify('')).toBe('untitled');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/utils/slugify.test.js`
Expected: FAIL(`slugify.js`が存在しない)

- [ ] **Step 3: `src/utils/slugify.js`を実装**

```js
export function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64) || 'untitled';
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/utils/slugify.test.js`
Expected: PASS(4 tests)

- [ ] **Step 5: `src/api/worldSplit.js`を共通utilに差し替える**

現在のファイル冒頭:
```js
import { callClaude, extractText, parseJsonLoose } from './client.js';

function slugify(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 64) || 'untitled';
}

function dedupeIds(items) {
```

を次に置き換える(ローカルの`slugify`関数を削除し、共通utilをimport):
```js
import { callClaude, extractText, parseJsonLoose } from './client.js';
import { slugify } from '../utils/slugify.js';

function dedupeIds(items) {
```

ファイル内の他の箇所(`splitWorld`関数内での`slugify(...)`呼び出し)は変更不要(同名関数を呼ぶだけなので挙動は同一)。

- [ ] **Step 6: 既存の`worldSplit.test.js`が通ることを確認(回帰確認)**

Run: `npx vitest run src/api/worldSplit.test.js`
Expected: PASS(既存の全テストが通る。`slugify`の抽出元テストが間接的に新実装を検証する)

- [ ] **Step 7: Commit**

```bash
git add src/utils/slugify.js src/utils/slugify.test.js src/api/worldSplit.js
git commit -m "refactor(frontend): extract shared slugify utility from worldSplit"
```

---

## Task 2: src/screens/Setup.jsx 素材ライブラリ連携

**Files:**
- Modify: `src/screens/Setup.jsx`
- Modify: `src/screens/Setup.test.jsx`

**Interfaces:**
- Consumes: `slugify`(Task 1)、`listWorlds`/`getWorld`(`src/api/worldLibraryClient.js`)、`importWorld`(`src/api/worldImport.js`)、`listScenarios`/`getScenario`/`putScenario`(`src/api/scenarioLibraryClient.js`)、`listCharacters`/`getCharacter`/`putCharacter`(`src/api/characterLibraryClient.js`)、既存の`summarizeWorld`/`generateScenario`(`src/api/session.js`)
- Produces: `Setup`のUI・`onStart(session)`呼び出し(既存のsession形状を維持)。`App.jsx`は無改修(既存の`onStart`/`onCancel`インターフェースを維持するため)。

- [ ] **Step 1: `src/screens/Setup.test.jsx`を書き換える(失敗する状態)**

既存の2テストに加え、新しいテストを含む全体を次の内容に置き換える:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Setup from './Setup.jsx';
import * as worldLibraryClient from '../api/worldLibraryClient.js';
import * as worldImport from '../api/worldImport.js';
import * as scenarioLibraryClient from '../api/scenarioLibraryClient.js';
import * as characterLibraryClient from '../api/characterLibraryClient.js';
import * as sessionApi from '../api/session.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(worldLibraryClient, 'listWorlds').mockResolvedValue([]);
  // worldIdが確定するテスト(既存World選択・新規World作成)ではPCステップのuseEffectが
  // listCharacters(worldId, 'pc')を呼ぶため、未モックの実fetchを避けるデフォルトを用意する。
  vi.spyOn(characterLibraryClient, 'listCharacters').mockResolvedValue([]);
});

describe('Setup', () => {
  it('renders the first wizard step (世界観) with the three World-source mode buttons', async () => {
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    await waitFor(() => expect(worldLibraryClient.listWorlds).toHaveBeenCalled());
    expect(screen.getByText('既存を選ぶ')).toBeInTheDocument();
    expect(screen.getByText('新規に用意する')).toBeInTheDocument();
    expect(screen.getByText('空欄のまま進める')).toBeInTheDocument();
  });

  it('shows the step indicator for all 5 steps', () => {
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    // ステップタブ("1. 世界観"等)とForm 0のField labelの両方が"世界観"を含みうるため、
    // 厳密一致のgetByTextではなく部分一致のgetAllByTextで存在確認する。
    ['世界観', 'シナリオ', 'ルール', 'PC', '確認'].forEach((label) => {
      expect(screen.getAllByText(new RegExp(label)).length).toBeGreaterThan(0);
    });
  });

  it('lists existing Worlds and loads the selected one', async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });

    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalledWith('w1'));
  });

  it('disables the Scenario "既存を選ぶ" button until a World is selected', () => {
    render(<Setup onStart={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('次へ')); // World(デフォルトskip) -> Scenario
    expect(screen.getByText('既存を選ぶ')).toBeDisabled();
  });

  it("carries the selected Scenario's recommendedRuleset through as the default Ruleset on session start", async () => {
    worldLibraryClient.listWorlds.mockResolvedValue([{ id: 'w1', title: 'Waterdeep', updatedAt: 1 }]);
    vi.spyOn(worldLibraryClient, 'getWorld').mockResolvedValue({ id: 'w1', title: 'Waterdeep', raw: '要約本文' });
    vi.spyOn(scenarioLibraryClient, 'listScenarios').mockResolvedValue([
      { id: 'sc1', worldId: 'w1', title: '失踪事件', recommendedRuleset: 'coc7e' },
    ]);
    vi.spyOn(scenarioLibraryClient, 'getScenario').mockResolvedValue({
      id: 'sc1',
      title: '失踪事件',
      raw: 'シナリオ本文',
      recommendedRuleset: 'coc7e',
    });
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('既存を選ぶ')); // World: 既存
    await waitFor(() => expect(screen.getByText('Waterdeep')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Waterdeep'));
    await waitFor(() => expect(worldLibraryClient.getWorld).toHaveBeenCalled());

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('既存を選ぶ'));
    await waitFor(() => expect(screen.getByText('失踪事件')).toBeInTheDocument());
    fireEvent.click(screen.getByText('失踪事件'));
    await waitFor(() => expect(scenarioLibraryClient.getScenario).toHaveBeenCalledWith('w1', 'sc1'));

    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    const session = onStart.mock.calls[0][0];
    expect(session.rulesetId).toBe('coc7e');
    expect(session.world.raw).toBe('要約本文');
    expect(session.scenario.raw).toBe('シナリオ本文');
  });

  it('creates a new World in the library and starts the session with the split summary', async () => {
    vi.spyOn(worldImport, 'importWorld').mockResolvedValue({ world: '分割済み要約', regions: [], categories: [] });
    // scenarioModeは既定の'paste'のままscenarioRawを空で進めるため、handleStart内の
    // フォールバック(自動生成)経路でgenerateScenarioが呼ばれる。未モックだと実fetchが走るため必ずモックする。
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('自動生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('新規に用意する'));
    // slugifyは英数字とハイフン以外を除去するため、日本語タイトルだと"untitled"にfallbackしてしまい
    // slugify自体の変換が検証できない。ここでは意図的にASCIIタイトルを使い、生成idの中身を検証する。
    fireEvent.change(screen.getByPlaceholderText('World名'), { target: { value: 'Test World' } });
    fireEvent.change(screen.getByPlaceholderText(/世界観の資料を貼る/), { target: { value: '世界観の原文' } });

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(worldImport.importWorld).toHaveBeenCalledWith(
      expect.stringMatching(/^testworld-\d+$/),
      'Test World',
      '世界観の原文'
    );
    const session = onStart.mock.calls[0][0];
    expect(session.world.summary).toBe('分割済み要約');
    expect(session.world.raw).toBe('世界観の原文');
  });

  it('does not block session start when a library save fails, and shows a non-fatal warning', async () => {
    vi.spyOn(worldImport, 'importWorld').mockRejectedValue(new Error('network down'));
    vi.spyOn(sessionApi, 'generateScenario').mockResolvedValue('生成されたシナリオ');
    const onStart = vi.fn();

    render(<Setup onStart={onStart} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('新規に用意する'));
    fireEvent.change(screen.getByPlaceholderText('World名'), { target: { value: 'テスト世界' } });
    fireEvent.change(screen.getByPlaceholderText(/世界観の資料を貼る/), { target: { value: '世界観の原文' } });

    fireEvent.click(screen.getByText('次へ')); // -> Scenario
    fireEvent.click(screen.getByText('次へ')); // -> Ruleset
    fireEvent.click(screen.getByText('次へ')); // -> PC
    fireEvent.click(screen.getByText('次へ')); // -> 確認
    fireEvent.click(screen.getByText('ゲーム開始'));

    await waitFor(() => expect(onStart).toHaveBeenCalled());
    expect(screen.getByText(/素材ライブラリへの保存に失敗した/)).toBeInTheDocument();
    const session = onStart.mock.calls[0][0];
    expect(session.world.raw).toBe('世界観の原文');
    expect(session.world.summary).toBe('世界観の原文');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: FAIL(新しいUI要素・振る舞いが存在しない)

- [ ] **Step 3: `src/screens/Setup.jsx`を書き換える**

ファイル全体を次の内容に置き換える:

```jsx
import { useState, useEffect, useRef } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../theme.js';
import { RULESETS } from '../data/rulesets.js';
import { summarizeWorld, generateScenario } from '../api/session.js';
import { listWorlds, getWorld } from '../api/worldLibraryClient.js';
import { importWorld } from '../api/worldImport.js';
import { listScenarios, getScenario, putScenario } from '../api/scenarioLibraryClient.js';
import { listCharacters, getCharacter, putCharacter } from '../api/characterLibraryClient.js';
import { slugify } from '../utils/slugify.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Field from '../components/ui/Field.jsx';
import FileImportRow from '../components/FileImportRow.jsx';
import { combineEntries } from '../utils/fileImport.js';

function makeId(base) {
  return slugify(base || 'untitled') + '-' + Date.now();
}

export default function Setup({ onStart, onCancel }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [libraryWarning, setLibraryWarning] = useState('');

  // World
  const [worldMode, setWorldMode] = useState('skip'); // existing | new | skip
  const [worldTitle, setWorldTitle] = useState('');
  const [worldRaw, setWorldRaw] = useState('');
  const [worldFiles, setWorldFiles] = useState([]);
  const [existingWorlds, setExistingWorlds] = useState([]);
  const [selectedWorld, setSelectedWorld] = useState(null); // { id, title, raw } | null

  // Scenario
  const [scenarioMode, setScenarioMode] = useState('paste'); // existing | paste | generate
  const [scenarioTitle, setScenarioTitle] = useState('');
  const [scenarioRaw, setScenarioRaw] = useState('');
  const [scenarioFiles, setScenarioFiles] = useState([]);
  const [genre, setGenre] = useState('');
  const [existingScenarios, setExistingScenarios] = useState([]);
  const [selectedScenario, setSelectedScenario] = useState(null); // { id, title, raw, recommendedRuleset } | null

  const [rulesetId, setRulesetId] = useState('simple');

  // PC
  const [pcMode, setPcMode] = useState('new'); // existing | new
  const [pcRaw, setPcRaw] = useState('');
  const [existingPCs, setExistingPCs] = useState([]);
  const [selectedPC, setSelectedPC] = useState(null); // { name, raw } | null

  const [title, setTitle] = useState('');

  const worldTokenRef = useRef(0);
  const scenarioTokenRef = useRef(0);
  const pcTokenRef = useRef(0);

  const worldId = worldMode === 'existing' ? selectedWorld?.id ?? null : null;

  const steps = ['世界観', 'シナリオ', 'ルール', 'PC', '確認'];

  useEffect(() => {
    listWorlds()
      .then(setExistingWorlds)
      .catch((e) => setError('World一覧の取得に失敗した: ' + e.message));
  }, []);

  useEffect(() => {
    if (!worldId) {
      setExistingScenarios([]);
      return;
    }
    listScenarios(worldId)
      .then(setExistingScenarios)
      .catch((e) => setError('Scenario一覧の取得に失敗した: ' + e.message));
  }, [worldId]);

  useEffect(() => {
    if (!worldId) {
      setExistingPCs([]);
      return;
    }
    listCharacters(worldId, 'pc')
      .then(setExistingPCs)
      .catch((e) => setError('PC一覧の取得に失敗した: ' + e.message));
  }, [worldId]);

  useEffect(() => {
    if (selectedScenario?.recommendedRuleset && RULESETS.some((r) => r.id === selectedScenario.recommendedRuleset)) {
      setRulesetId(selectedScenario.recommendedRuleset);
    }
  }, [selectedScenario]);

  async function selectWorld(id) {
    const tok = ++worldTokenRef.current;
    try {
      const full = await getWorld(id);
      if (worldTokenRef.current !== tok) return;
      setSelectedWorld(full);
    } catch (e) {
      if (worldTokenRef.current === tok) setError('World取得に失敗した: ' + e.message);
    }
  }

  async function selectScenario(id) {
    const tok = ++scenarioTokenRef.current;
    try {
      const full = await getScenario(worldId, id);
      if (scenarioTokenRef.current !== tok) return;
      setSelectedScenario(full);
    } catch (e) {
      if (scenarioTokenRef.current === tok) setError('Scenario取得に失敗した: ' + e.message);
    }
  }

  async function selectPC(name) {
    const tok = ++pcTokenRef.current;
    try {
      const full = await getCharacter(worldId, 'pc', name);
      if (pcTokenRef.current !== tok) return;
      setSelectedPC(full);
    } catch (e) {
      if (pcTokenRef.current === tok) setError('PC取得に失敗した: ' + e.message);
    }
  }

  async function handleStart() {
    setBusy(true);
    setError('');
    setLibraryWarning('');
    try {
      async function trySaveToLibrary(fn) {
        try {
          await fn();
        } catch (e) {
          console.error('library save failed', e);
          setLibraryWarning('素材ライブラリへの保存に失敗した(セッションはこのまま開始できる): ' + e.message);
        }
      }

      let resolvedWorldId = null;
      let worldSummary;
      let worldRawForSession;

      if (worldMode === 'existing' && selectedWorld) {
        resolvedWorldId = selectedWorld.id;
        worldSummary = selectedWorld.raw;
        worldRawForSession = selectedWorld.raw;
      } else if (worldMode === 'new') {
        worldRawForSession = worldRaw;
        try {
          const generatedId = makeId(worldTitle);
          const split = await importWorld(generatedId, worldTitle || '無題の世界観', worldRaw);
          resolvedWorldId = generatedId;
          worldSummary = split.world;
        } catch (e) {
          console.error('World library save failed', e);
          setLibraryWarning('素材ライブラリへの保存に失敗した(セッションはこのまま開始できる): ' + e.message);
          worldSummary = worldRaw || '(特に指定なし)';
        }
      } else {
        worldRawForSession = worldRaw;
        worldSummary = worldRaw.length > 1500 ? await summarizeWorld(worldRaw) : worldRaw || '(特に指定なし)';
      }

      let scenario;
      if (scenarioMode === 'existing' && selectedScenario) {
        scenario = selectedScenario.raw;
      } else if (scenarioMode === 'generate') {
        scenario = await generateScenario(genre, pcRaw, worldSummary);
        if (resolvedWorldId) {
          const scenarioId = makeId(scenarioTitle || genre);
          await trySaveToLibrary(() =>
            putScenario(resolvedWorldId, scenarioId, {
              title: scenarioTitle || genre || '無題のシナリオ',
              raw: scenario,
              recommendedRuleset: null,
            })
          );
        }
      } else {
        scenario = scenarioRaw;
        if (!scenario) {
          scenario = await generateScenario('自由なジャンルで', pcRaw, worldSummary);
        } else if (resolvedWorldId) {
          const scenarioId = makeId(scenarioTitle);
          await trySaveToLibrary(() =>
            putScenario(resolvedWorldId, scenarioId, {
              title: scenarioTitle || '無題のシナリオ',
              raw: scenario,
              recommendedRuleset: null,
            })
          );
        }
      }

      let pc;
      if (pcMode === 'existing' && selectedPC) {
        pc = selectedPC.raw;
      } else {
        pc = pcRaw || '(自由記述なし)';
        if (resolvedWorldId && pcRaw) {
          const pcId = makeId('pc');
          await trySaveToLibrary(() => putCharacter(resolvedWorldId, 'pc', pcId, { raw: pcRaw, revealed: undefined }));
        }
      }

      const session = {
        id: 'sess_' + Date.now(),
        title: title || 'セッション ' + new Date().toLocaleDateString('ja-JP'),
        world: { raw: worldRawForSession, summary: worldSummary },
        scenario: { raw: scenario },
        rulesetId,
        pc: { raw: pc },
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
      onStart(session);
    } catch (e) {
      console.error(e);
      setError('開始処理に失敗した: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 20px' }}>
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 24,
          fontFamily: F_MONO,
          fontSize: 11,
          color: COLORS.faint,
        }}
      >
        {steps.map((s, i) => (
          <div
            key={s}
            style={{
              padding: '4px 10px',
              borderRadius: 3,
              background: i === step ? COLORS.ink : 'transparent',
              color: i === step ? COLORS.paper : COLORS.faint,
              border: `1px solid ${i === step ? COLORS.ink : COLORS.line}`,
            }}
          >
            {i + 1}. {s}
          </div>
        ))}
      </div>

      <Card style={{ minHeight: 320 }}>
        {step === 0 && (
          <>
            <Field label="Worldの用意方法">
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant={worldMode === 'existing' ? 'primary' : 'ghost'} onClick={() => setWorldMode('existing')}>
                  既存を選ぶ
                </Button>
                <Button variant={worldMode === 'new' ? 'primary' : 'ghost'} onClick={() => setWorldMode('new')}>
                  新規に用意する
                </Button>
                <Button variant={worldMode === 'skip' ? 'primary' : 'ghost'} onClick={() => setWorldMode('skip')}>
                  空欄のまま進める
                </Button>
              </div>
            </Field>

            {worldMode === 'existing' && (
              <Field label="既存Worldを選ぶ">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {existingWorlds.map((w) => (
                    <Card
                      key={w.id}
                      onClick={() => selectWorld(w.id)}
                      style={{
                        cursor: 'pointer',
                        borderColor: selectedWorld?.id === w.id ? COLORS.brass : COLORS.line,
                      }}
                    >
                      <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{w.title}</div>
                    </Card>
                  ))}
                  {existingWorlds.length === 0 && (
                    <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
                      素材ライブラリにWorldがまだ無い。
                    </div>
                  )}
                </div>
              </Field>
            )}

            {worldMode === 'new' && (
              <>
                <Field label="タイトル">
                  <input
                    value={worldTitle}
                    onChange={(e) => setWorldTitle(e.target.value)}
                    placeholder="World名"
                    style={inputStyle}
                  />
                </Field>
                <Field
                  label="世界観"
                  hint="資料を貼るか、分割済みファイル(またはフォルダ)をそのまま取り込める。長ければ自動で要約してから使う。"
                >
                  <FileImportRow
                    entries={worldFiles}
                    onImport={(entries) => {
                      const merged = [...worldFiles, ...entries];
                      setWorldFiles(merged);
                      setWorldRaw(combineEntries(merged));
                    }}
                    onClear={() => {
                      setWorldFiles([]);
                      setWorldRaw('');
                    }}
                  />
                  <textarea
                    value={worldRaw}
                    onChange={(e) => setWorldRaw(e.target.value)}
                    rows={10}
                    placeholder="世界観の資料を貼る、ファイルを取り込む"
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
                  />
                </Field>
              </>
            )}

            {worldMode === 'skip' && (
              <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
                世界観を指定しない。AIが自由に構築する。
              </div>
            )}
          </>
        )}

        {step === 1 && (
          <>
            <Field label="シナリオの用意方法">
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  variant={scenarioMode === 'existing' ? 'primary' : 'ghost'}
                  onClick={() => setScenarioMode('existing')}
                  disabled={!worldId}
                >
                  既存を選ぶ
                </Button>
                <Button
                  variant={scenarioMode === 'paste' ? 'primary' : 'ghost'}
                  onClick={() => setScenarioMode('paste')}
                >
                  自分で用意する
                </Button>
                <Button
                  variant={scenarioMode === 'generate' ? 'primary' : 'ghost'}
                  onClick={() => setScenarioMode('generate')}
                >
                  AIに作ってもらう
                </Button>
              </div>
            </Field>

            {scenarioMode === 'existing' && (
              <Field label="既存Scenarioを選ぶ">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {existingScenarios.map((s) => (
                    <Card
                      key={s.id}
                      onClick={() => selectScenario(s.id)}
                      style={{
                        cursor: 'pointer',
                        borderColor: selectedScenario?.id === s.id ? COLORS.brass : COLORS.line,
                      }}
                    >
                      <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{s.title}</div>
                    </Card>
                  ))}
                  {existingScenarios.length === 0 && (
                    <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
                      このWorldにはScenarioがまだ無い。
                    </div>
                  )}
                </div>
              </Field>
            )}

            {scenarioMode === 'paste' && (
              <>
                <Field label="タイトル">
                  <input
                    value={scenarioTitle}
                    onChange={(e) => setScenarioTitle(e.target.value)}
                    placeholder="シナリオタイトル"
                    style={inputStyle}
                  />
                </Field>
                <Field label="シナリオ本文" hint="分割済みファイル(章ごと等)をそのまま取り込める。">
                  <FileImportRow
                    entries={scenarioFiles}
                    onImport={(entries) => {
                      const merged = [...scenarioFiles, ...entries];
                      setScenarioFiles(merged);
                      setScenarioRaw(combineEntries(merged));
                    }}
                    onClear={() => {
                      setScenarioFiles([]);
                      setScenarioRaw('');
                    }}
                  />
                  <textarea
                    value={scenarioRaw}
                    onChange={(e) => setScenarioRaw(e.target.value)}
                    rows={8}
                    placeholder="シナリオ本文を貼る、またはファイルを取り込む"
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
                  />
                </Field>
              </>
            )}

            {scenarioMode === 'generate' && (
              <Field label="やりたいジャンル・要望" hint="例:「推理物がしたい」「洋館からの脱出」等">
                <input
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="例: 冒険者らしい探索と戦闘がしたい"
                  style={inputStyle}
                />
              </Field>
            )}
          </>
        )}

        {step === 2 && (
          <Field label="ルール性向" hint="判定は成功率%に統一して実行する(どのルールでも公平に判定できる)。ここでの選択は主に演出の色付けに使う。">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {RULESETS.map((r) => (
                <Card
                  key={r.id}
                  onClick={() => setRulesetId(r.id)}
                  style={{
                    cursor: 'pointer',
                    borderColor: rulesetId === r.id ? COLORS.brass : COLORS.line,
                    background: rulesetId === r.id ? COLORS.paperDark : COLORS.card,
                  }}
                >
                  <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>
                    {r.label}
                  </div>
                  <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft }}>
                    {r.desc}
                  </div>
                </Card>
              ))}
            </div>
          </Field>
        )}

        {step === 3 && (
          <>
            <Field label="PCの用意方法">
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  variant={pcMode === 'existing' ? 'primary' : 'ghost'}
                  onClick={() => setPcMode('existing')}
                  disabled={!worldId}
                >
                  既存を選ぶ
                </Button>
                <Button variant={pcMode === 'new' ? 'primary' : 'ghost'} onClick={() => setPcMode('new')}>
                  自由記述で新規作成
                </Button>
              </div>
            </Field>

            {pcMode === 'existing' && (
              <Field label="既存PCを選ぶ">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {existingPCs.map((c) => (
                    <Card
                      key={c.name}
                      onClick={() => selectPC(c.name)}
                      style={{
                        cursor: 'pointer',
                        borderColor: selectedPC?.name === c.name ? COLORS.brass : COLORS.line,
                      }}
                    >
                      <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>{c.name}</div>
                    </Card>
                  ))}
                  {existingPCs.length === 0 && (
                    <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.faint }}>
                      このWorldにはPCがまだ無い。
                    </div>
                  )}
                </div>
              </Field>
            )}

            {pcMode === 'new' && (
              <Field
                label="PC設定"
                hint="自由記述でよい。goal(目標)・bonds(因縁・関係)を書いておくと、GMがそれを絡めた展開を作りやすくなる。"
              >
                <textarea
                  value={pcRaw}
                  onChange={(e) => setPcRaw(e.target.value)}
                  rows={8}
                  placeholder={'PC名: ...\n能力値・スキル: ...\ngoal: ...\nbonds: ...'}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
                />
              </Field>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <Field label="セッション名">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="任意(未入力なら日付から自動生成)"
                style={inputStyle}
              />
            </Field>
            <div style={{ fontFamily: F_BODY, fontSize: 13, color: COLORS.inkSoft }}>
              世界観・シナリオ・ルール・PCの準備ができたらゲームを開始する。
              {worldMode === 'skip' && worldRaw.length > 1500 && ' 世界観は長いため開始時に自動で要約する。'}
              {worldMode === 'new' && ' 世界観は開始時に素材ライブラリへ保存され、自動で地域/カテゴリに分割される。'}
              {scenarioMode === 'generate' && ' シナリオはAIが開始時に生成する。'}
            </div>
            {error && (
              <div style={{ color: COLORS.stamp, fontSize: 13, marginTop: 12 }}>{error}</div>
            )}
            {libraryWarning && (
              <div style={{ color: COLORS.stamp, fontSize: 12, marginTop: 8 }}>{libraryWarning}</div>
            )}
          </>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <Button variant="ghost" onClick={step === 0 ? onCancel : () => setStep(step - 1)}>
          {step === 0 ? 'やめる' : '戻る'}
        </Button>
        {step < steps.length - 1 ? (
          <Button variant="primary" onClick={() => setStep(step + 1)}>
            次へ
          </Button>
        ) : (
          <Button variant="brass" onClick={handleStart} disabled={busy}>
            {busy ? '準備中…' : 'ゲーム開始'}
          </Button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/screens/Setup.test.jsx`
Expected: PASS(7 tests)

- [ ] **Step 5: 全体テストを実行**

Run: `npx vitest run`
Expected: 全テストPASS

- [ ] **Step 6: ビルドを確認**

Run: `npm run build`
Expected: 成功

- [ ] **Step 7: Commit**

```bash
git add src/screens/Setup.jsx src/screens/Setup.test.jsx
git commit -m "feat(frontend): integrate Setup wizard with the asset library"
```

---

## Self-Review Notes

- **Spec coverage**: spec docの4.1(World)→Task 2のworldMode分岐、4.2(Scenario)→scenarioMode分岐、4.3(Ruleset)→recommendedRuleset連動useEffect、4.4(PC)→pcMode分岐、5節(handleStartの処理順序)→handleStart内の直列処理、6節(UI規約・エラー処理)→`trySaveToLibrary`とlibraryWarning表示、いずれもTask 2でカバーされている。3節(slugify)→Task 1でカバー。
- **Placeholder scan**: 「TBD」等の記述なし。
- **Type consistency**: `selectedWorld`/`selectedScenario`/`selectedPC`はいずれも対応するAPIクライアントの`get*`関数の戻り値形状(`{id, title, raw, ...}`または`{name, raw, ...}`)とそのままの型で扱っており、`worldId`/`Field`propsとの受け渡しも一貫している。
- **既存パターンとの一貫性**: 既存選択のクリックハンドラに`useRef`ベースのトークンガードを追加し、`src/screens/library/*Tab.jsx`で確立済みの「古い非同期レスポンスによる上書き防止」パターンと同じ目的を満たす。ライブラリ書き込み失敗の非致命的ハンドリングは、既存の`Setup.jsx`のエラー表示パターン(`COLORS.stamp`)を踏襲しつつ、`session`構築自体をブロックしない設計にしている。
- **非スコープの遵守**: `session`データ構造・`buildSystemPrompt`・`Play.jsx`・カスタムRulesetの利用・Campaignは、どのタスクにも含まれていない。
