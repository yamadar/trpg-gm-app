import { useState, useEffect, useRef, useMemo } from 'react';
import { COLORS, F_DISPLAY, F_BODY, inputStyle } from '../theme.js';
import { RULESETS } from '../data/rulesets.js';
import { summarizeWorld, generateScenario } from '../api/session.js';
import { listWorlds, getWorld } from '../api/worldLibraryClient.js';
import { importWorld } from '../api/worldImport.js';
import { listScenarios, getScenario, putScenario } from '../api/scenarioLibraryClient.js';
import { listCharacters, getCharacter, putCharacter } from '../api/characterLibraryClient.js';
import { makeId } from '../utils/makeId.js';
import { listRulesets } from '../api/rulesetLibraryClient.js';
import { getOrParseCharacter } from '../api/characterSheetCache.js';
import { getAdapter } from '../engine/rulesetAdapters.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Field from '../components/ui/Field.jsx';
import FileImportRow from '../components/FileImportRow.jsx';
import { combineEntries } from '../utils/fileImport.js';
import { extractPcName, composePcRaw } from '../utils/pcName.js';
import FocusHeader from '../components/nav/FocusHeader.jsx';
import ConfirmModal from '../components/library/ConfirmModal.jsx';
import { navigateHash } from '../navigation/useRoute.js';

export default function Setup({ onStart, campaignContext = null, starterContext = null }) {
  // starterContext はスターターパックを一括インポートした直後の状態。World/Scenario/Ruleset を
  // 選択済みにして PC 選択(step 3)から開く。PCまで自動選択しないのは、どちらを演じるかが
  // 初回ユーザーの最初の選択であり、「PCはWorldに属していて選ぶもの」を最短で伝えるため。
  const [step, setStep] = useState(starterContext ? 3 : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [libraryWarning, setLibraryWarning] = useState('');
  // 離脱確認モーダルの開閉。「やめる」を押した時点で失う入力があるときだけ開く。
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // World
  const [worldMode, setWorldMode] = useState(campaignContext || starterContext ? 'existing' : 'skip'); // existing | new | skip
  const [worldTitle, setWorldTitle] = useState('');
  const [worldRaw, setWorldRaw] = useState('');
  const [worldFiles, setWorldFiles] = useState([]);
  const [existingWorlds, setExistingWorlds] = useState([]);
  const [selectedWorld, setSelectedWorld] = useState(
    campaignContext
      ? { id: campaignContext.worldId, raw: campaignContext.world.summary }
      : starterContext
      ? starterContext.world
      : null
  ); // { id, title, raw } | null

  // Scenario
  const [scenarioMode, setScenarioMode] = useState(starterContext ? 'existing' : 'paste'); // existing | paste | generate
  const [scenarioTitle, setScenarioTitle] = useState('');
  const [scenarioRaw, setScenarioRaw] = useState('');
  const [scenarioFiles, setScenarioFiles] = useState([]);
  const [genre, setGenre] = useState('');
  const [existingScenarios, setExistingScenarios] = useState([]);
  const [selectedScenario, setSelectedScenario] = useState(starterContext ? starterContext.scenario : null); // { id, title, raw, recommendedRuleset } | null

  const [rulesetId, setRulesetId] = useState(
    campaignContext ? campaignContext.rulesetId || 'simple' : starterContext ? starterContext.rulesetId : 'simple'
  );
  const [customRulesets, setCustomRulesets] = useState([]);

  // PC
  const [pcMode, setPcMode] = useState(starterContext ? 'existing' : 'new'); // existing | new
  const [pcRaw, setPcRaw] = useState(campaignContext ? campaignContext.pcRaw || '' : '');
  // キャンペーンの章をまたぐときは引き継いだシートから拾い、打ち直させない。
  const [pcName, setPcName] = useState(campaignContext ? extractPcName(campaignContext.pcRaw) : '');
  const [existingPCs, setExistingPCs] = useState([]);
  const [selectedPC, setSelectedPC] = useState(null); // { name, raw } | null

  const [title, setTitle] = useState(starterContext ? starterContext.scenario.title : '');

  const worldTokenRef = useRef(0);
  const scenarioTokenRef = useRef(0);
  const pcTokenRef = useRef(0);

  const worldId = worldMode === 'existing' ? selectedWorld?.id ?? null : null;
  // worldId が変わったときだけ従属する選択をリセットする。campaignContext/starterContext のように
  // 最初から worldId が埋まっている場合、マウント時のリセットで選択が消えてしまうため、
  // 現在値で初期化してマウント直後は「変化なし」として扱う。
  const prevWorldIdRef = useRef(worldId);
  const allRulesets = useMemo(() => [...RULESETS, ...customRulesets], [customRulesets]);

  // 「やめる」を押したときに何かを失うか。以前は「やめる」がstep0にしか無く、
  // そこでは失うものが無かった。今はどのステップからでも押せる集中ヘッダーに
  // 乗ったため、入力済みの自由記述(貼り付け/ファイル取り込み含む)・既存素材の
  // 選択・ルールの変更・セッション名のいずれかがあれば「失うもの」とみなす。
  // campaignContext/starterContext からの引き継ぎ(既存World/Scenarioの選択や
  // ルールの指定)もここに含める。取り込み直後に無自覚に離脱すると、選び直した
  // 文脈が黙って消えるため。
  const hasUnsavedWork =
    Boolean(worldTitle.trim()) ||
    Boolean(worldRaw.trim()) ||
    Boolean(selectedWorld) ||
    Boolean(scenarioTitle.trim()) ||
    Boolean(scenarioRaw.trim()) ||
    Boolean(genre.trim()) ||
    Boolean(selectedScenario) ||
    rulesetId !== 'simple' ||
    Boolean(pcRaw.trim()) ||
    Boolean(pcName.trim()) ||
    Boolean(selectedPC) ||
    Boolean(title.trim());

  function handleExitClick() {
    if (hasUnsavedWork) {
      setShowExitConfirm(true);
    } else {
      navigateHash('#/');
    }
  }

  const steps = ['世界観', 'シナリオ', 'ルール', 'PC', '確認'];
  // 小説化したときにPCが他の登場人物と「彼」で衝突しないよう、新規作成のPCには
  // 名前を必須にする(既存PCは解析でシートから名前を取れるので塞がない)。
  const pcNameMissing = step === 3 && pcMode === 'new' && !pcName.trim();

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
    if (prevWorldIdRef.current !== worldId) {
      setSelectedScenario(null);
      setSelectedPC(null);
      prevWorldIdRef.current = worldId;
    }
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
        worldRawForSession = '';
        worldSummary = '(特に指定なし)';
      }

      const pcForGen = pcMode === 'existing' && selectedPC ? selectedPC.raw : pcRaw;
      let scenario;
      if (scenarioMode === 'existing' && selectedScenario) {
        scenario = selectedScenario.raw;
      } else if (scenarioMode === 'generate') {
        scenario = await generateScenario(genre, pcForGen, worldSummary);
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
          scenario = await generateScenario('自由なジャンルで', pcForGen, worldSummary);
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
      let pcResolvedName = '';
      let pcGoal;
      let pcBonds;
      let pcLibraryName = null;

      if (pcMode === 'existing' && selectedPC) {
        pc = selectedPC.raw;
        pcLibraryName = selectedPC.name;
        // シート本文の「PC名:」行から先に名前を取っておく。AI解析(下のgetOrParseCharacter)は
        // ネットワーク越しでオフライン・429・キー無しだと失敗しうるので、それだけに頼らない。
        pcResolvedName = extractPcName(selectedPC.raw);
      } else {
        // 入力されたPC名をシート本文にも残す。ライブラリ原本とGMプロンプトの
        // 「# PC設定」節の両方に名前が載り、プレイ中の地の文も名前で呼べるようになる。
        pc = composePcRaw(pcName, pcRaw) || '(自由記述なし)';
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
          // 新規PC経路ではユーザーが今入力した名前が確定済みなので上書きしない。
          // 既存PC経路はシート本文の抽出結果をAI解析の結果で補強・上書きしてよい。
          if (pcMode === 'existing' && parsed.name) pcResolvedName = parsed.name;
        } catch (e) {
          console.error('name/goal/bonds parse failed', e);
        }
      }

      const resolvedRuleset = allRulesets.find((r) => r.id === rulesetId) || RULESETS[0];
      const adapter = getAdapter(resolvedRuleset.formula);
      const resources = Object.fromEntries(
        adapter.resourceDefs.map((d) => [d.key, { value: d.initial, max: d.max }])
      );

      const session = {
        id: 'sess_' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        title: title || 'セッション ' + new Date().toLocaleDateString('ja-JP'),
        worldId: resolvedWorldId || undefined,
        campaignId: campaignContext?.campaignId,
        world: { raw: worldRawForSession, summary: worldSummary },
        scenario: { raw: scenario },
        // 雰囲気タグ: World優先、無ければScenarioから継承(Play画面の配色に使う)
        moods:
          worldMode === 'existing' && selectedWorld?.moods?.length
            ? selectedWorld.moods
            : scenarioMode === 'existing' && selectedScenario?.moods?.length
            ? selectedScenario.moods
            : [],
        rulesetId,
        ruleset: {
          id: resolvedRuleset.id,
          label: resolvedRuleset.label,
          desc: resolvedRuleset.desc,
          hint: resolvedRuleset.hint,
          growthUnit: resolvedRuleset.growthUnit || '経験値',
          formula: resolvedRuleset.formula,
        },
        pc: { name: pcResolvedName, raw: pc, goal: pcGoal, bonds: pcBonds },
        state: {
          current_scene: '冒頭',
          flags: {},
          history_summary: '',
          recent_log: [],
          turn_count: 0,
          xp: campaignContext?.xp || 0,
          ...(Object.keys(resources).length ? { resources } : {}),
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
    <div>
      <FocusHeader
        title="新規プレイ"
        steps={steps}
        currentStep={step}
        exitLabel="やめる"
        onExit={handleExitClick}
      />
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '40px 20px' }}>
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
                        素材ライブラリにWorldがまだ無い。公開ギャラリーの「おすすめ」から一式を取り込むか、「新規に用意する」で自分で書く。
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
                        このWorldにはScenarioがまだ無い。「自分で用意する」で貼り付けるか、「AIに作ってもらう」を選ぶ。
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
            <Field label="ルール性向" hint="判定の出方(成功度の段階・大失敗の出やすさ)がルールごとに変わる。CoC7e風はハード/イクストリーム成功が加わり、正気度(SAN)も追加される。開始後は変更できない。">
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
                        このWorldにはPCがまだ無い。「自由記述で新規作成」で書くか、素材ライブラリのCharacterタブで先に作る。
                      </div>
                    )}
                  </div>
                </Field>
              )}

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
                {worldMode === 'new' && ' 世界観は開始時に素材ライブラリへ保存され、自動で地域/カテゴリに分割される。'}
                {scenarioMode === 'generate' && ' シナリオはAIが開始時に生成する。'}
              </div>
            </>
          )}
        </Card>

        {error && <div style={{ color: COLORS.stamp, fontSize: 13, marginTop: 12 }}>{error}</div>}
        {libraryWarning && <div style={{ color: COLORS.stamp, fontSize: 12, marginTop: 8 }}>{libraryWarning}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
          <Button
            variant="ghost"
            onClick={() => setStep(step - 1)}
            disabled={busy || step === 0}
          >
            戻る
          </Button>
          {step < steps.length - 1 ? (
            <Button variant="primary" onClick={() => setStep(step + 1)} disabled={pcNameMissing}>
              次へ
            </Button>
          ) : (
            <Button variant="brass" onClick={handleStart} disabled={busy}>
              {busy ? '準備中…' : 'ゲーム開始'}
            </Button>
          )}
        </div>
      </div>

      <ConfirmModal
        open={showExitConfirm}
        message="入力した内容を破棄してウィザードを離れる。よいか?"
        confirmLabel="破棄して離れる"
        onConfirm={() => navigateHash('#/')}
        onCancel={() => setShowExitConfirm(false)}
      />
    </div>
  );
}
