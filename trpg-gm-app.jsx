import React, { useState, useEffect, useRef, useCallback } from 'react';

/* ============================================================
   デザイントークン
   紙(kraft)+インク台帳のテーブルトップ卓上感。ダイス判定結果は
   赤インクスタンプ風に見せる(このアプリ唯一の"見せ場"要素)。
   ============================================================ */
const COLORS = {
  paper: '#EDE6D6',
  paperDark: '#E2D9C3',
  card: '#F6F1E6',
  ink: '#1F2A38',
  inkSoft: '#3B372E',
  brass: '#9C7A45',
  brassDark: '#7C6136',
  stamp: '#A13D3D',
  stampDark: '#7E2E2E',
  line: '#C9BFA3',
  faint: '#B8AE93',
};

const FONT_LINK =
  'https://fonts.googleapis.com/css2?family=Special+Elite&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500&display=swap';

const F_DISPLAY = "'Special Elite', 'Courier New', monospace";
const F_BODY = "'Source Serif 4', Georgia, serif";
const F_MONO = "'IBM Plex Mono', monospace";

const RULESETS = [
  {
    id: 'simple',
    label: 'シンプル',
    desc: '判定は成功率%のみで統一。ルール色なし、テンポ重視。',
    hint: '',
  },
  {
    id: 'coc7e',
    label: 'CoC7e風',
    desc: 'クトゥルフ神話TRPG風。恐怖・異常事態でSAN値チェックを演出。',
    hint:
      '恐怖・異常事態の場面では適宜roll_checkでSAN値チェックを表現し、成功してもSAN減少の描写を加えること。',
  },
  {
    id: 'dnd5e',
    label: 'D&D5e風',
    desc: 'ファンタジー王道。戦闘のクリティカルを演出。',
    hint: '戦闘や罠ではクリティカル(会心/致命的失敗)を演出に反映すること。',
  },
  {
    id: 'gurps',
    label: 'GURPS風',
    desc: '汎用ルール寄り。失敗の代償を細かく描写。',
    hint:
      '判定失敗の程度に応じて代償(時間・資源・状況悪化)を具体的に描写すること。',
  },
];

/* ============================================================
   Claude API ヘルパー
   ============================================================ */
async function callClaude(body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

function extractText(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}
function extractToolUse(content) {
  return (content || []).find((b) => b.type === 'tool_use');
}
function parseJsonLoose(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('JSON not found in response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

const ROLL_TOOL = {
  name: 'roll_check',
  description:
    '行動の結果が不確実な場合に判定を行う。判定は必ずこのツールを介して実行し、結果を自分で決めないこと。',
  input_schema: {
    type: 'object',
    properties: {
      check_label: {
        type: 'string',
        description: '判定の内容(例:「崖を登る」「NPCを説得する」)',
      },
      success_percent: {
        type: 'integer',
        description:
          'この状況における成功確率(0-100)。PCの能力・状況・難易度を踏まえて自分で設定する。',
      },
    },
    required: ['check_label', 'success_percent'],
  },
};

function rollD100() {
  return Math.floor(Math.random() * 100) + 1;
}
function evaluateRoll(successPercent) {
  const p = Math.max(1, Math.min(99, Math.round(successPercent)));
  const roll = rollD100();
  const success = roll <= p;
  let degree = success ? 'success' : 'fail';
  if (roll <= Math.max(1, Math.round(p * 0.05))) degree = 'critical';
  if (roll >= 96) degree = 'fumble';
  return { roll, success_percent: p, success, degree };
}

/* ============================================================
   一回性API呼び出し(生成モード): 世界観要約 / シナリオ生成
   ============================================================ */
async function summarizeWorld(raw) {
  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system:
      '以下の世界観資料を、TRPGのGMが毎ターン参照できる程度の要約(600〜900字)に圧縮せよ。地名・組織・時代背景などキーとなる設定は保持すること。説明文やコードブロック記号は付けず、要約文のみを出力すること。',
    messages: [{ role: 'user', content: raw }],
  });
  return extractText(data.content).trim();
}

async function generateScenario(genre, pcRaw, worldSummary) {
  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system: `TRPGシナリオを作成せよ。

# ジャンル要望
${genre || '(指定なし。世界観に合う自由なジャンルでよい)'}

# 世界観
${worldSummary || '(未設定。ジャンルに応じて自由に構築してよい)'}

# PC設定
${pcRaw || '(未設定)'}

以下の見出し構成のMarkdownで出力せよ(コードブロック記号やコメントは付けない):
## シナリオ概要
(プレイヤーに見せてよい導入)
## GM専用情報
(黒幕・真相・隠しフラグなど、プレイヤーには開示しない情報)
## 章構成
(章ごとの見出しと概要、分岐条件を簡潔に。最終章には climax とわかる一文を添える)

PCのgoal/bondsに関連する引き(hook)を導入部に必ず含めること。`,
    messages: [{ role: 'user', content: 'シナリオを生成せよ。' }],
  });
  return extractText(data.content).trim();
}

/* ============================================================
   ターン処理(進行モード)
   ============================================================ */
function buildSystemPrompt(session) {
  const rs = RULESETS.find((r) => r.id === session.rulesetId) || RULESETS[0];
  const flags = session.state.flags || {};
  const flagsText =
    Object.entries(flags)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || '(なし)';
  const recentLog =
    (session.state.recent_log || [])
      .map((l) => `${l.role === 'player' ? 'PL' : 'GM'}: ${l.text}`)
      .join('\n') || '(まだなし)';

  return `あなたはTRPGのGM。以下の設定に従い物語を進行する。プレイヤーが楽しめるよう、緊迫感や盛り上がりの演出を大事にすること。

# 世界観
${session.world.summary}

# シナリオ
${session.scenario.raw}
上記のうち「GM専用情報」節は、物語内で自然に明かされた場合を除き、プレイヤーへの出力に絶対含めないこと。

# PC設定
${session.pc.raw}

# ルール性向: ${rs.label}
${rs.hint || '特別な演出指定なし。'}
判定が必要な場面ではroll_checkツールを呼び出すこと。success_percentはPCの能力・状況・難易度から自分で判断して設定し、結果そのものは自分で決めないこと(ロール結果は別途渡される)。

# 現在の状況
シーン: ${session.state.current_scene}
既知フラグ: ${flagsText}
物語要約: ${session.state.history_summary || '(まだなし)'}

# 直近のログ
${recentLog}

# 演出方針
緊迫した場面は短文を畳み掛け、平穏な場面は五感描写を増やしゆったり進行する。可能な範囲でPCのgoal/bondsや世界観の特徴を絡めること。

# 出力形式(厳守)
説明文やコードブロック記号を一切付けず、次のJSONのみを出力すること:
{"narrative": "地の文(150〜250字程度)", "state_update": {"current_scene": "更新後のシーン名", "flags": {"追加/更新分のみ": true}, "history_summary": "更新後の物語要約(300字程度)"}, "choices": ["選択肢1", "選択肢2", "選択肢3"]}
choices は自由記述を促したい場面では空配列 [] でよい。flags は新規/更新分のみでよい(既存分は保持される)。`;
}

async function takeTurn(session, playerText) {
  const system = buildSystemPrompt(session);
  let messages = [{ role: 'user', content: playerText }];
  const base = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system,
    tools: [ROLL_TOOL],
  };

  let data = await callClaude({ ...base, messages });
  let roll = null;

  const toolUse = extractToolUse(data.content);
  if (toolUse && toolUse.name === 'roll_check') {
    roll = evaluateRoll(toolUse.input.success_percent);
    roll.check_label = toolUse.input.check_label;

    messages = [
      ...messages,
      { role: 'assistant', content: data.content },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({
              roll: roll.roll,
              success: roll.success,
              degree: roll.degree,
            }),
          },
        ],
      },
    ];
    data = await callClaude({ ...base, messages });
  }

  const text = extractText(data.content);
  const result = parseJsonLoose(text);
  return { result, roll };
}

/* ============================================================
   永続化ヘルパー
   ============================================================ */
async function checkStorageAvailable() {
  try {
    if (!window.storage || typeof window.storage.set !== 'function') return false;
    await window.storage.set('__ping__', String(Date.now()), false);
    const r = await window.storage.get('__ping__', false);
    return !!r;
  } catch (e) {
    console.error('storage availability check failed', e);
    return false;
  }
}
async function loadSessionIndex() {
  try {
    const r = await window.storage.get('sessions_index', false);
    return r ? JSON.parse(r.value) : [];
  } catch (e) {
    console.error('loadSessionIndex failed', e);
    return [];
  }
}
async function saveSessionIndex(index) {
  try {
    const r = await window.storage.set('sessions_index', JSON.stringify(index), false);
    if (!r) console.error('saveSessionIndex: storage.set returned falsy result', index);
    return r;
  } catch (e) {
    console.error('saveSessionIndex failed', e);
    return null;
  }
}
async function saveSession(session) {
  try {
    const r = await window.storage.set(`session:${session.id}`, JSON.stringify(session), false);
    if (!r) console.error('saveSession: storage.set returned falsy result', session.id);
    return r;
  } catch (e) {
    console.error('saveSession failed', e);
    return null;
  }
}
async function loadSession(id) {
  try {
    const r = await window.storage.get(`session:${id}`, false);
    return r ? JSON.parse(r.value) : null;
  } catch (e) {
    console.error('loadSession failed', e);
    return null;
  }
}

function useGoogleFonts() {
  useEffect(() => {
    if (document.getElementById('trpg-fonts')) return;
    const link = document.createElement('link');
    link.id = 'trpg-fonts';
    link.rel = 'stylesheet';
    link.href = FONT_LINK;
    document.head.appendChild(link);
  }, []);
}

/* ============================================================
   ファイル/フォルダ インポート
   分割済みファイル(region/category単位等)をそのまま取り込む。
   ファイル名を見出しにして結合するので、分割の意図がテキストにも残る。
   ============================================================ */
const PLAIN_TEXT_RE = /\.(md|markdown|txt)$/i;
const HTML_RE = /\.html?$/i;

function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
  doc.querySelectorAll('br').forEach((el) => el.replaceWith('\n'));
  doc
    .querySelectorAll('p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, blockquote')
    .forEach((el) => el.insertAdjacentText('afterend', '\n'));
  const text = (doc.body ? doc.body.textContent : doc.textContent) || '';
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function readFilesAsEntries(fileList) {
  const files = Array.from(fileList).filter(
    (f) => PLAIN_TEXT_RE.test(f.name) || HTML_RE.test(f.name)
  );
  files.sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name)
  );
  const entries = await Promise.all(
    files.map(async (f) => {
      const raw = await f.text();
      const content = HTML_RE.test(f.name) ? htmlToText(raw) : raw;
      return { name: f.webkitRelativePath || f.name, content };
    })
  );
  return entries;
}

function combineEntries(entries) {
  return entries.map((e) => `===== ${e.name} =====\n${e.content}`).join('\n\n');
}

/* ============================================================
   小さいUIパーツ
   ============================================================ */
function Stamp({ roll }) {
  if (!roll) return null;
  const label =
    roll.degree === 'critical'
      ? '会心'
      : roll.degree === 'fumble'
      ? '大失敗'
      : roll.success
      ? '成功'
      : '失敗';
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        transform: 'rotate(-3deg)',
        border: `2px solid ${COLORS.stamp}`,
        color: COLORS.stamp,
        borderRadius: 4,
        padding: '4px 10px',
        fontFamily: F_MONO,
        fontWeight: 600,
        fontSize: 12,
        letterSpacing: 1,
        marginBottom: 8,
        opacity: 0.9,
      }}
    >
      <span>{roll.check_label}</span>
      <span style={{ opacity: 0.6 }}>|</span>
      <span>
        {roll.roll}/{roll.success_percent}
      </span>
      <span style={{ opacity: 0.6 }}>|</span>
      <span>{label}</span>
    </div>
  );
}

function Card({ children, style }) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.line}`,
        borderRadius: 6,
        boxShadow: '0 1px 0 rgba(31,42,56,0.06)',
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Button({ children, onClick, disabled, variant = 'primary', style }) {
  const base = {
    fontFamily: F_MONO,
    fontSize: 13,
    letterSpacing: 0.5,
    padding: '10px 16px',
    borderRadius: 4,
    cursor: disabled ? 'default' : 'pointer',
    border: 'none',
    opacity: disabled ? 0.5 : 1,
    transition: 'transform 0.1s ease',
  };
  const variants = {
    primary: { background: COLORS.ink, color: COLORS.paper },
    brass: { background: COLORS.brass, color: COLORS.paper },
    ghost: {
      background: 'transparent',
      color: COLORS.ink,
      border: `1px solid ${COLORS.line}`,
    },
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = 'scale(0.97)';
      }}
      onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
    >
      {children}
    </button>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontFamily: F_DISPLAY,
          fontSize: 13,
          color: COLORS.brassDark,
          marginBottom: 6,
          letterSpacing: 0.5,
        }}
      >
        {label}
      </div>
      {hint && (
        <div
          style={{
            fontFamily: F_BODY,
            fontSize: 12,
            color: COLORS.faint,
            marginBottom: 6,
          }}
        >
          {hint}
        </div>
      )}
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  fontFamily: F_BODY,
  fontSize: 14,
  color: COLORS.inkSoft,
  background: COLORS.paper,
  border: `1px solid ${COLORS.line}`,
  borderRadius: 4,
  padding: '10px 12px',
  outline: 'none',
  boxSizing: 'border-box',
};

function FileImportRow({ entries, onImport, onClear }) {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  async function handleFiles(e) {
    const list = e.target.files;
    if (list && list.length > 0) {
      const entries = await readFilesAsEntries(list);
      onImport(entries);
    }
    e.target.value = '';
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="ghost" onClick={() => fileInputRef.current?.click()}>
          ファイルを選択(複数可)
        </Button>
        <Button variant="ghost" onClick={() => folderInputRef.current?.click()}>
          フォルダを選択
        </Button>
        {entries.length > 0 && (
          <Button variant="ghost" onClick={onClear}>
            インポート内容をクリア
          </Button>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.markdown,.txt,.html,.htm"
        style={{ display: 'none' }}
        onChange={handleFiles}
      />
      <input
        ref={folderInputRef}
        type="file"
        webkitdirectory="true"
        directory="true"
        multiple
        style={{ display: 'none' }}
        onChange={handleFiles}
      />
      {entries.length > 0 && (
        <div
          style={{
            marginTop: 8,
            fontFamily: F_MONO,
            fontSize: 11,
            color: COLORS.brassDark,
          }}
        >
          読み込み済み({entries.length}件): {entries.map((e) => e.name).join(', ')}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   ホーム画面
   ============================================================ */
function Home({ index, storageOk, onNew, onContinue }) {
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
          この環境では保存機能(window.storage)が使えていない。「続きから再開」は動作せず、ページを離れると進行が失われる。ブラウザのコンソールにエラー詳細が出ている。
        </div>
      )}

      <Button variant="brass" onClick={onNew} style={{ marginBottom: 32 }}>
        + 新規プレイ
      </Button>

      {index.length > 0 && (
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
            {index
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((s) => (
                <Card key={s.id} style={{ cursor: 'pointer' }}>
                  <div
                    onClick={() => onContinue(s.id)}
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
                  >
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
                        {s.currentScene && (
                          <div
                            style={{
                              fontFamily: F_MONO,
                              fontSize: 11,
                              color: COLORS.brassDark,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            シーン: {s.currentScene}
                            {typeof s.turnCount === 'number' ? ` / ${s.turnCount}手` : ''}
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
                        {s.lastLine || '(まだ進行なし)'}
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: F_MONO,
                        fontSize: 12,
                        color: COLORS.brass,
                        alignSelf: 'center',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      続ける →
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

/* ============================================================
   新規プレイ作成ウィザード
   ============================================================ */
function Setup({ onStart, onCancel }) {
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
                  style={{
                    cursor: 'pointer',
                    borderColor: rulesetId === r.id ? COLORS.brass : COLORS.line,
                    background: rulesetId === r.id ? COLORS.paperDark : COLORS.card,
                  }}
                >
                  <div onClick={() => setRulesetId(r.id)}>
                    <div style={{ fontFamily: F_DISPLAY, fontSize: 14, color: COLORS.ink }}>
                      {r.label}
                    </div>
                    <div style={{ fontFamily: F_BODY, fontSize: 12, color: COLORS.inkSoft }}>
                      {r.desc}
                    </div>
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
              placeholder={
                'PC名: ...\n能力値・スキル: ...\ngoal: ...\nbonds: ...'
              }
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

/* ============================================================
   プレイ画面
   ============================================================ */
function Play({ session, setSession, onExit }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.log.length, busy]);

  const runTurn = useCallback(
    async (playerText, displayText) => {
      setBusy(true);
      setError('');
      try {
        const { result, roll } = await takeTurn(session, playerText);

        const newFlags = { ...session.state.flags, ...(result.state_update?.flags || {}) };
        const newLog = [...session.log];
        if (displayText) newLog.push({ role: 'player', text: displayText });
        newLog.push({ role: 'gm', text: result.narrative, choices: result.choices || [], roll });

        const recent = [...(session.state.recent_log || [])];
        if (displayText) recent.push({ role: 'player', text: displayText });
        recent.push({ role: 'gm', text: result.narrative });
        while (recent.length > 12) recent.shift(); // 簡易履歴管理。Phase2で要約圧縮に置き換え予定

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
        setSession(updated);
        await saveSession(updated);

        const index = await loadSessionIndex();
        const others = index.filter((s) => s.id !== updated.id);
        const lastLine = result.narrative.slice(0, 60) + (result.narrative.length > 60 ? '…' : '');
        await saveSessionIndex([
          ...others,
          {
            id: updated.id,
            title: updated.title,
            lastLine,
            currentScene: updated.state.current_scene,
            turnCount: updated.state.turn_count,
            updatedAt: updated.updatedAt,
          },
        ]);
      } catch (e) {
        console.error(e);
        setError('GM応答の取得に失敗した: ' + e.message);
      } finally {
        setBusy(false);
      }
    },
    [session, setSession]
  );

  // 初回セッション開始(ログが空ならオープニングを取りに行く)
  useEffect(() => {
    if (session.log.length === 0 && !busy) {
      runTurn('(セッション開始。導入シーンを描写せよ)', null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitFree() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput('');
    runTurn(text, text);
  }

  function submitChoice(choice) {
    if (busy) return;
    runTurn(choice, choice);
  }

  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '24px 20px 140px',
        minHeight: '100vh',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontFamily: F_DISPLAY, fontSize: 18, color: COLORS.ink }}>
            {session.title}
          </div>
          <div style={{ fontFamily: F_MONO, fontSize: 11, color: COLORS.faint }}>
            シーン: {session.state.current_scene}
          </div>
        </div>
        <Button variant="ghost" onClick={onExit}>
          ホームへ
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {session.log.map((entry, i) =>
          entry.role === 'player' ? (
            <div
              key={i}
              style={{
                alignSelf: 'flex-end',
                maxWidth: '80%',
                fontFamily: F_MONO,
                fontSize: 13,
                color: COLORS.paper,
                background: COLORS.ink,
                borderRadius: 4,
                padding: '8px 12px',
              }}
            >
              {entry.text}
            </div>
          ) : (
            <Card key={i}>
              <Stamp roll={entry.roll} />
              <div
                style={{
                  fontFamily: F_BODY,
                  fontSize: 15,
                  lineHeight: 1.8,
                  color: COLORS.inkSoft,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {entry.text}
              </div>
              {i === session.log.length - 1 && entry.choices?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {entry.choices.map((c, ci) => (
                    <Button key={ci} variant="ghost" onClick={() => submitChoice(c)} disabled={busy}>
                      {c}
                    </Button>
                  ))}
                </div>
              )}
            </Card>
          )
        )}
        {busy && (
          <div style={{ fontFamily: F_MONO, fontSize: 12, color: COLORS.faint }}>
            GMが考えている…
          </div>
        )}
        {error && <div style={{ color: COLORS.stamp, fontSize: 13 }}>{error}</div>}
        <div ref={logEndRef} />
      </div>

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: COLORS.paper,
          borderTop: `1px solid ${COLORS.line}`,
          padding: 16,
        }}
      >
        <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitFree()}
            placeholder="PCの行動を自由に書く…"
            style={{ ...inputStyle, flex: 1 }}
            disabled={busy}
          />
          <Button variant="brass" onClick={submitFree} disabled={busy || !input.trim()}>
            送る
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ルートコンポーネント
   ============================================================ */
export default function App() {
  useGoogleFonts();
  const [view, setView] = useState('home'); // home | setup | play
  const [index, setIndex] = useState([]);
  const [session, setSession] = useState(null);
  const [loadingHome, setLoadingHome] = useState(true);
  const [storageOk, setStorageOk] = useState(true);

  useEffect(() => {
    (async () => {
      setStorageOk(await checkStorageAvailable());
      setIndex(await loadSessionIndex());
      setLoadingHome(false);
    })();
  }, []);

  async function handleContinue(id) {
    const s = await loadSession(id);
    if (s) {
      setSession(s);
      setView('play');
    }
  }

  async function handleStart(newSession) {
    setSession(newSession);
    await saveSession(newSession);
    const idx = await loadSessionIndex();
    await saveSessionIndex([
      ...idx.filter((s) => s.id !== newSession.id),
      {
        id: newSession.id,
        title: newSession.title,
        lastLine: '',
        currentScene: newSession.state.current_scene,
        turnCount: newSession.state.turn_count,
        updatedAt: newSession.updatedAt,
      },
    ]);
    setView('play');
  }

  async function handleExit() {
    setIndex(await loadSessionIndex());
    setSession(null);
    setView('home');
  }

  return (
    <div
      style={{
        background: COLORS.paper,
        minHeight: '100vh',
        color: COLORS.ink,
      }}
    >
      {view === 'home' &&
        (loadingHome ? (
          <div style={{ padding: 48, fontFamily: F_MONO, color: COLORS.faint }}>読み込み中…</div>
        ) : (
          <Home index={index} storageOk={storageOk} onNew={() => setView('setup')} onContinue={handleContinue} />
        ))}
      {view === 'setup' && <Setup onStart={handleStart} onCancel={() => setView('home')} />}
      {view === 'play' && session && (
        <Play session={session} setSession={setSession} onExit={handleExit} />
      )}
    </div>
  );
}
