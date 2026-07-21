import { callClaude, extractText, extractToolUse, parseJsonLoose } from './client.js';
import { ROLL_TOOL, buildSystemPrompt } from './prompts.js';
import { evaluateRoll } from '../engine/dice.js';

export async function summarizeWorld(raw) {
  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    system:
      '以下の世界観資料を、TRPGのGMが毎ターン参照できる程度の要約(600〜900字)に圧縮せよ。地名・組織・時代背景などキーとなる設定は保持すること。説明文やコードブロック記号は付けず、要約文のみを出力すること。',
    messages: [{ role: 'user', content: raw }],
  });
  return extractText(data.content).trim();
}

export async function generateScenario(genre, pcRaw, worldSummary) {
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

export async function takeTurn(session, playerText) {
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
