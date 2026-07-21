import { useState, useEffect, useRef, useMemo } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../theme.js';
import { RULESETS } from '../data/rulesets.js';
import { summarizeWorld, generateScenario } from '../api/session.js';
import { listWorlds, getWorld } from '../api/worldLibraryClient.js';
import { importWorld } from '../api/worldImport.js';
import { listScenarios, getScenario, putScenario } from '../api/scenarioLibraryClient.js';
import { listCharacters, getCharacter, putCharacter } from '../api/characterLibraryClient.js';
import { slugify } from '../utils/slugify.js';
import { listRulesets } from '../api/rulesetLibraryClient.js';
import { getOrParseCharacter } from '../api/characterSheetCache.js';
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
  const [customRulesets, setCustomRulesets] = useState([]);

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
  const allRulesets = useMemo(() => [...RULESETS, ...customRulesets], [customRulesets]);

  const steps = ['世界観', 'シナリオ', 'ルール', 'PC', '確認'];

  useEffect(() => {
    listWorlds()
      .then(setExistingWorlds)
      .catch((e) => setError('World一覧の取得に失敗した: ' + e.message));
  }, []);

  useEffect(() => {
    listRulesets()
      .then(setCustomRulesets)
      .catch((e) => setError('カスタムRuleset一覧の取得に失敗した: ' + e.message));
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
    if (selectedScenario?.recommendedRuleset && allRulesets.some((r) => r.id === selectedScenario.recommendedRuleset)) {
      setRulesetId(selectedScenario.recommendedRuleset);
    }
  }, [selectedScenario, allRulesets]);

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
      let pcGoal;
      let pcBonds;
      let pcLibraryName = null;

      if (pcMode === 'existing' && selectedPC) {
        pc = selectedPC.raw;
        pcLibraryName = selectedPC.name;
      } else {
        pc = pcRaw || '(自由記述なし)';
        if (resolvedWorldId && pcRaw) {
          const pcId = makeId('pc');
          let pcSaved = false;
          await trySaveToLibrary(async () => {
            await putCharacter(resolvedWorldId, 'pc', pcId, { raw: pcRaw, revealed: undefined });
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
        } catch (e) {
          console.error('goal/bonds parse failed', e);
        }
      }

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
              {allRulesets.map((r) => (
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
