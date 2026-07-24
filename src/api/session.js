import { callClaude, extractText, extractToolUse, parseJsonLoose } from './client.js';
import { ROLL_TOOL, TURN_OUTPUT_FORMAT, buildSystemBlocks, buildTurnUserContent } from './prompts.js';
import { evaluateRoll } from '../engine/dice.js';

const MODEL = 'claude-sonnet-5';

export async function summarizeWorld(raw) {
  const data = await callClaude({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: 'disabled' },
    system:
      '以下の世界観資料を、TRPGのGMが毎ターン参照できる程度の要約(600〜900字)に圧縮せよ。地名・組織・時代背景などキーとなる設定は保持すること。説明文やコードブロック記号は付けず、要約文のみを出力すること。',
    messages: [{ role: 'user', content: raw }],
  });
  return extractText(data.content).trim();
}

export async function generateScenario(genre, pcRaw, worldSummary) {
  const hookLine = pcRaw
    ? '\nPCのgoal/bondsに関連する引き(hook)を導入部に必ず含めること。'
    : '';
  const data = await callClaude({
    model: MODEL,
    max_tokens: 3000,
    thinking: { type: 'disabled' },
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
${hookLine}`,
    messages: [{ role: 'user', content: 'シナリオを生成せよ。' }],
  });
  if (data.stop_reason === 'max_tokens') {
    throw new Error('シナリオ生成が途中で打ち切られました(max_tokens)。再試行してください。');
  }
  return extractText(data.content).trim();
}

// structured outputsのスキーマ上flagsは{key, value}の配列で返るため、既存の
// state管理(オブジェクトマージ)に合わせて変換する。
function normalizeFlags(result) {
  const flags = result?.state_update?.flags;
  if (Array.isArray(flags)) {
    result.state_update.flags = Object.fromEntries(flags.map((f) => [f.key, f.value]));
  }
  return result;
}

export async function takeTurn(session, playerText) {
  const system = buildSystemBlocks(session);
  let messages = [{ role: 'user', content: buildTurnUserContent(session, playerText) }];
  const base = {
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: 'disabled' },
    system,
    tools: [ROLL_TOOL],
    output_config: { format: TURN_OUTPUT_FORMAT },
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
  const result = normalizeFlags(parseJsonLoose(text));
  return { result, roll };
}

// PC視点のオンデマンド回想。生フラグはLLMへの入力に留め、プレイヤーには自然な日本語のみ返す。
export async function recallMemory(session) {
  const flags = session.state?.flags || {};
  const flagsText =
    Object.entries(flags)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ') || '(なし)';
  const recentLog =
    (session.state?.recent_log || [])
      .map((l) => `${l.role === 'player' ? 'PL' : 'GM'}: ${l.text}`)
      .join('\n') || '(まだなし)';
  const pcLine = [
    session.pc?.raw,
    session.pc?.goal && `goal: ${session.pc.goal}`,
    session.pc?.bonds && `bonds: ${session.pc.bonds}`,
  ]
    .filter(Boolean)
    .join('\n');

  const data = await callClaude({
    model: MODEL,
    max_tokens: 600,
    thinking: { type: 'disabled' },
    system:
      'あなたはTRPGのGM。PCがこれまでに知り得たこと・手に入れたものを、PC視点で簡潔に思い返す短い地の文(200字程度)を書け。ゲーム的表現(フラグのキー名・数値・選択肢)はそのまま出さず、自然な日本語に翻訳すること。未開示の秘密やメタ情報は書かない。まだ何も無ければその旨を一言。説明やコードブロック記号は付けず、回想の地の文のみを出力せよ。',
    messages: [
      {
        role: 'user',
        content: `# PC\n${pcLine || '(未設定)'}\n\n# 物語要約\n${
          session.state?.history_summary || '(まだなし)'
        }\n\n# 既知フラグ(自然な日本語へ翻訳する材料)\n${flagsText}\n\n# 直近のログ\n${recentLog}`,
      },
    ],
  });
  return extractText(data.content).trim() || '(まだ特に思い出すことはない)';
}
