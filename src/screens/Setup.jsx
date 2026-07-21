import { useState } from 'react';
import { COLORS, F_DISPLAY, F_BODY, F_MONO, inputStyle } from '../theme.js';
import { RULESETS } from '../data/rulesets.js';
import { summarizeWorld, generateScenario } from '../api/session.js';
import Card from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';
import Field from '../components/ui/Field.jsx';
import FileImportRow from '../components/FileImportRow.jsx';
import { combineEntries } from '../utils/fileImport.js';

export default function Setup({ onStart, onCancel }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [worldRaw, setWorldRaw] = useState('');
  const [worldFiles, setWorldFiles] = useState([]);
  const [scenarioMode, setScenarioMode] = useState('paste'); // paste | generate
  const [scenarioRaw, setScenarioRaw] = useState('');
  const [scenarioFiles, setScenarioFiles] = useState([]);
  const [genre, setGenre] = useState('');
  const [rulesetId, setRulesetId] = useState('simple');
  const [pcRaw, setPcRaw] = useState('');
  const [title, setTitle] = useState('');

  const steps = ['世界観', 'シナリオ', 'ルール', 'PC', '確認'];

  async function handleStart() {
    setBusy(true);
    setError('');
    try {
      const worldSummary =
        worldRaw.length > 1500 ? await summarizeWorld(worldRaw) : worldRaw || '(特に指定なし)';

      let scenario = scenarioRaw;
      if (scenarioMode === 'generate') {
        scenario = await generateScenario(genre, pcRaw, worldSummary);
      }
      if (!scenario) {
        scenario = await generateScenario('自由なジャンルで', pcRaw, worldSummary);
      }

      const session = {
        id: 'sess_' + Date.now(),
        title: title || 'セッション ' + new Date().toLocaleDateString('ja-JP'),
        world: { raw: worldRaw, summary: worldSummary },
        scenario: { raw: scenario },
        rulesetId,
        pc: { raw: pcRaw || '(自由記述なし)' },
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
          <Field
            label="世界観"
            hint="資料を貼るか、分割済みファイル(またはフォルダ)をそのまま取り込める。長ければ自動で要約してから使う。未入力ならAIが自由に構築する。"
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
              placeholder="世界観の資料を貼る、ファイルを取り込む、または空欄のままでよい"
              style={{ ...inputStyle, resize: 'vertical', fontFamily: F_BODY }}
            />
          </Field>
        )}

        {step === 1 && (
          <>
            <Field label="シナリオの用意方法">
              <div style={{ display: 'flex', gap: 8 }}>
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
            {scenarioMode === 'paste' ? (
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
            ) : (
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
              {worldRaw.length > 1500 && ' 世界観は長いため開始時に自動で要約する。'}
              {scenarioMode === 'generate' && ' シナリオはAIが開始時に生成する。'}
            </div>
            {error && (
              <div style={{ color: COLORS.stamp, fontSize: 13, marginTop: 12 }}>{error}</div>
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
