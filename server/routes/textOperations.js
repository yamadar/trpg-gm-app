import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { generateText, GeminiTextApiError } from '../textProvider.js';
import {
  buildRollTool,
  resolveAdapter,
  TURN_OUTPUT_FORMAT,
  buildSystemBlocks,
  buildTurnUserContent,
} from '../../src/api/prompts.js';
import { SHEET_OUTPUT_FORMAT, SPLIT_OUTPUT_FORMAT } from '../../src/api/textOperationSchemas.js';

const TEXT_TIMEOUT_MS = 120000;
const MAX_GENERATION_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const MAX_SESSION_BYTES = 1024 * 1024;

class TextOperationInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TextOperationInputError';
    this.status = 400;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function text(value, name, maxLength, { allowEmpty = true } = {}) {
  if (typeof value !== 'string') throw new TextOperationInputError(`${name} must be a string`);
  if (!allowEmpty && !value.trim()) throw new TextOperationInputError(`${name} must not be empty`);
  if (value.length > maxLength) throw new TextOperationInputError(`${name} is too long`);
  return value;
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TextOperationInputError(`${name} must be an object`);
  }
  return value;
}

function boundedJson(value, name, maxBytes) {
  const result = object(value, name);
  let encoded;
  try {
    encoded = JSON.stringify(result);
  } catch {
    throw new TextOperationInputError(`${name} must be JSON serializable`);
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    throw new TextOperationInputError(`${name} is too large`);
  }
  return result;
}

function summarizeWorld(input) {
  const raw = text(object(input, 'input').raw, 'raw', 500_000, { allowEmpty: false });
  return {
    max_tokens: 2000,
    system:
      '以下の世界観資料を、TRPGのGMが毎ターン参照できる程度の要約(600〜900字)に圧縮せよ。地名・組織・時代背景などキーとなる設定は保持すること。説明文やコードブロック記号は付けず、要約文のみを出力すること。',
    messages: [{ role: 'user', content: raw }],
  };
}

function generateScenario(input) {
  const value = object(input, 'input');
  const genre = text(value.genre ?? '', 'genre', 2_000);
  const pcRaw = text(value.pcRaw ?? '', 'pcRaw', 200_000);
  const worldSummary = text(value.worldSummary ?? '', 'worldSummary', 100_000);
  const hookLine = pcRaw
    ? '\nPCのgoal/bondsに関連する引き(hook)を導入部に必ず含めること。'
    : '';
  return {
    max_tokens: 3000,
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
  };
}

function sanitizeAssistantContent(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    throw new TextOperationInputError('continuation.assistantContent must be a non-empty array');
  }
  return value.map((block) => {
    object(block, 'assistant content block');
    if (block.type === 'text') {
      return { type: 'text', text: text(block.text, 'assistant text', 100_000) };
    }
    if (block.type === 'tool_use' && block.name === 'roll_check') {
      const input = object(block.input, 'roll_check input');
      const successPercent = Number(input.success_percent);
      if (!Number.isInteger(successPercent) || successPercent < 0 || successPercent > 100) {
        throw new TextOperationInputError('roll_check success_percent is invalid');
      }
      const sanitizedInput = {
        check_label: text(input.check_label, 'roll_check check_label', 500, { allowEmpty: false }),
        success_percent: successPercent,
      };
      if (input.check_kind !== undefined) {
        sanitizedInput.check_kind = text(input.check_kind, 'roll_check check_kind', 50, {
          allowEmpty: false,
        });
      }
      return {
        type: 'tool_use',
        id: text(block.id, 'roll_check id', 200, { allowEmpty: false }),
        name: 'roll_check',
        input: sanitizedInput,
      };
    }
    throw new TextOperationInputError('assistant content contains an unsupported block');
  });
}

function takeTurn(input) {
  const value = object(input, 'input');
  const session = boundedJson(value.session, 'session', MAX_SESSION_BYTES);
  const playerText = text(value.playerText, 'playerText', 10_000);
  if (typeof value.allowRoll !== 'boolean') {
    throw new TextOperationInputError('allowRoll must be a boolean');
  }
  const adapter = resolveAdapter(session);
  const system = buildSystemBlocks(session);
  const firstUserMessage = { role: 'user', content: buildTurnUserContent(session, playerText) };
  const request = {
    max_tokens: 2000,
    system,
    ...(value.allowRoll ? { tools: [buildRollTool(adapter)] } : {}),
    output_config: { format: TURN_OUTPUT_FORMAT },
    messages: [firstUserMessage],
  };
  if (value.continuation === undefined) return request;

  const continuation = object(value.continuation, 'continuation');
  const assistantContent = sanitizeAssistantContent(continuation.assistantContent);
  const toolUse = assistantContent.find((block) => block.type === 'tool_use');
  if (!toolUse) throw new TextOperationInputError('continuation has no roll_check tool call');
  const toolResult = boundedJson(continuation.toolResult, 'continuation.toolResult', 4_000);
  return {
    ...request,
    messages: [
      firstUserMessage,
      { role: 'assistant', content: assistantContent },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(toolResult),
          },
        ],
      },
    ],
    tool_choice: { type: 'none' },
  };
}

function sessionMaterials(input) {
  const session = boundedJson(object(input, 'input').session, 'session', MAX_SESSION_BYTES);
  const flags = session.state?.flags || {};
  const flagsText =
    Object.entries(flags)
      .slice(0, 1_000)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ') || '(なし)';
  const recentLog =
    (Array.isArray(session.state?.recent_log) ? session.state.recent_log : [])
      .slice(-100)
      .map((entry) => `${entry.role === 'player' ? 'PL' : 'GM'}: ${String(entry.text || '')}`)
      .join('\n') || '(まだなし)';
  const pcLine = [
    session.pc?.raw,
    session.pc?.goal && `goal: ${session.pc.goal}`,
    session.pc?.bonds && `bonds: ${session.pc.bonds}`,
  ]
    .filter(Boolean)
    .join('\n');
  return { session, flagsText, recentLog, pcLine };
}

function recallMemory(input) {
  const { session, flagsText, recentLog, pcLine } = sessionMaterials(input);
  return {
    max_tokens: 600,
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
  };
}

function advanceCampaignPc(input) {
  const { session, flagsText, recentLog } = sessionMaterials(input);
  return {
    max_tokens: 1500,
    system:
      'あなたはTRPGのGM。1つの冒険を終えたPCの、次の冒険へ持ち越す更新版キャラクターシートを書け。元シートの体裁(PC名・能力・持ち物・goal・bonds等)を保ちつつ、この冒険で得た物・能力や経験の成長・出来事・新たな因縁や関係の変化を反映すること。ゲーム的表現(フラグのキー名・数値・選択肢)や未開示の秘密・メタ情報は書かない。説明やコードブロック記号は付けず、更新版シート本文のみを出力せよ。',
    messages: [
      {
        role: 'user',
        content: `# 元のPCシート\n${session.pc?.raw || '(未設定)'}\n\n# この冒険の要約\n${
          session.state?.history_summary || '(なし)'
        }\n\n# 冒険中のフラグ(自然な記述へ反映する材料)\n${flagsText}\n\n# 直近のログ\n${recentLog}`,
      },
    ],
  };
}

function splitWorld(input) {
  const value = object(input, 'input');
  const rawText = text(value.rawText, 'rawText', 1_000_000, { allowEmpty: false });
  const adjustmentRequest = text(value.adjustmentRequest ?? '', 'adjustmentRequest', 20_000);
  return {
    max_tokens: 16000,
    output_config: { format: SPLIT_OUTPUT_FORMAT },
    system: `以下の世界観資料を、TRPGのGMが必要な範囲だけ参照できるよう地域(region)・カテゴリ(category)に分割せよ。

世界観の規模に応じて、region・categoryの数は自由に決めてよい(小規模な世界観なら1〜2個程度でもよい)。
world・各contentは正しいMarkdownで記述し、改行には実際の改行文字を使うこと。
各titleにはIDや英数字スラグではなく、内容を端的に表す自然な表示名を付けること。`,
    messages: [
      {
        role: 'user',
        content: adjustmentRequest ? `${rawText}\n\n# 再分割の修正依頼\n${adjustmentRequest}` : rawText,
      },
    ],
  };
}

function parseCharacterSheet(input) {
  const raw = text(object(input, 'input').raw, 'raw', 200_000, { allowEmpty: false });
  return {
    max_tokens: 1000,
    output_config: { format: SHEET_OUTPUT_FORMAT },
    system: '以下のキャラクターシートから name(名前)・goal(目標)・bonds(因縁・関係)を抽出せよ。',
    messages: [{ role: 'user', content: raw }],
  };
}

const OPERATIONS = new Map([
  ['summarize-world', summarizeWorld],
  ['generate-scenario', generateScenario],
  ['take-turn', takeTurn],
  ['recall-memory', recallMemory],
  ['advance-campaign-pc', advanceCampaignPc],
  ['split-world', splitWorld],
  ['parse-character-sheet', parseCharacterSheet],
]);

function shouldRetry(error) {
  return error instanceof GeminiTextApiError && error.status >= 500;
}

export function buildTextOperationRequest(operation, input) {
  const build = OPERATIONS.get(operation);
  if (!build) throw new TextOperationInputError('unknown text operation');
  return build(input);
}

export function estimateTextOperationTokens(request) {
  const input = {
    system: request.system,
    messages: request.messages,
    tools: request.tools,
    tool_choice: request.tool_choice,
    output_config: request.output_config,
  };
  const estimatedInputTokens = Math.ceil(Buffer.byteLength(JSON.stringify(input), 'utf8') / 4);
  return estimatedInputTokens + request.max_tokens;
}

export function createTextOperationsRouter({
  apiKey,
  model,
  fetchImpl = fetch,
  usage,
  maxConcurrent = 6,
  retryBaseDelayMs = RETRY_BASE_DELAY_MS,
}) {
  const router = Router();
  let active = 0;

  router.post('/text-operations/:operation', asyncHandler(async (req, res) => {
    if (!apiKey) {
      res.status(503).json({ error: 'ai_service_unavailable' });
      return;
    }

    let request;
    try {
      request = buildTextOperationRequest(req.params.operation, req.body?.input);
    } catch (error) {
      if (error instanceof TextOperationInputError) {
        res.status(error.message === 'unknown text operation' ? 404 : 400).json({ error: error.message });
        return;
      }
      throw error;
    }

    if (active >= maxConcurrent) {
      res.status(503).json({ error: 'ai_service_busy' });
      return;
    }
    active += 1;
    try {
      if (usage) {
        const reservedTokens = estimateTextOperationTokens(request);
        const reservation = await usage.reserveTextOperation(req.userId, reservedTokens);
        if (!reservation.ok) {
          res.status(429).json({ error: 'daily limit reached', resetAt: reservation.resetAt });
          return;
        }
      }

      for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
        try {
          const data = await generateText({
            apiKey,
            model,
            request,
            fetchImpl,
            timeoutMs: TEXT_TIMEOUT_MS,
          });
          res.json(data);
          return;
        } catch (error) {
          if (attempt === MAX_GENERATION_ATTEMPTS || !shouldRetry(error)) throw error;
          await wait(retryBaseDelayMs * attempt);
        }
      }
    } catch (error) {
      if (error instanceof GeminiTextApiError && (error.status === 429 || error.status === 503)) {
        const code = error.status === 429 ? 'ai_service_rate_limited' : 'ai_service_overloaded';
        res.status(502).json({ error: code, upstreamStatus: error.status });
        return;
      }
      const status = error instanceof GeminiTextApiError && error.status >= 400 && error.status < 500
        ? error.status
        : 502;
      res.status(status).json({ error: 'ai_service_error' });
    } finally {
      active -= 1;
    }
  }));

  return router;
}
