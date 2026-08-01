const GEMINI_TEXT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function findToolName(messages, toolUseId) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (!Array.isArray(content)) continue;
    const match = content.find((part) => part?.type === 'tool_use' && part.id === toolUseId);
    if (match?.name) return match.name;
  }
  return '';
}

function parseToolResult(value) {
  if (typeof value !== 'string') return { result: value };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : { result: parsed };
  } catch {
    return { result: value };
  }
}

function convertPart(part, messages) {
  if (!part || typeof part !== 'object') return null;
  if (part.type === 'text' && typeof part.text === 'string') {
    const out = { text: part.text };
    if (part.thought_signature) out.thoughtSignature = part.thought_signature;
    return out;
  }
  if (part.type === 'tool_use') {
    const out = {
      functionCall: {
        name: part.name,
        args: part.input || {},
        ...(part.id ? { id: part.id } : {}),
      },
    };
    if (part.thought_signature) out.thoughtSignature = part.thought_signature;
    return out;
  }
  if (part.type === 'tool_result') {
    const name = findToolName(messages, part.tool_use_id);
    return {
      functionResponse: {
        name,
        response: parseToolResult(part.content),
        ...(part.tool_use_id ? { id: part.tool_use_id } : {}),
      },
    };
  }
  return null;
}

function convertMessage(message, messages) {
  const raw = typeof message.content === 'string' ? [{ text: message.content }] : message.content || [];
  const parts = raw
    .map((part) => ('text' in (part || {}) && !part.type ? part : convertPart(part, messages)))
    .filter(Boolean);
  return { role: message.role === 'assistant' ? 'model' : 'user', parts };
}

export function buildGeminiTextRequest(request) {
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const toolChoiceNone = request.tool_choice?.type === 'none';
  const tools = toolChoiceNone ? [] : Array.isArray(request.tools) ? request.tools : [];
  const responseSchema = request.output_config?.format?.schema;
  const thinkingLevel =
    typeof request.thinking_level === 'string'
      ? request.thinking_level.trim().toUpperCase()
      : '';
  const system = textFromContent(request.system);

  const body = {
    contents: messages.map((message) => convertMessage(message, messages)),
    generationConfig: {
      ...(Number.isFinite(Number(request.max_tokens))
        ? { maxOutputTokens: Number(request.max_tokens) }
        : {}),
      ...(responseSchema
        ? { responseMimeType: 'application/json', responseJsonSchema: responseSchema }
        : {}),
      ...(thinkingLevel
        ? { thinkingConfig: { thinkingLevel } }
        : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools.length) {
    body.tools = [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parametersJsonSchema: tool.input_schema,
        })),
      },
    ];
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  }
  return body;
}

export function toCompatibleTextResponse(data) {
  const blockReason = data?.promptFeedback?.blockReason;
  if (blockReason && blockReason !== 'BLOCK_REASON_UNSPECIFIED') {
    throw new GeminiTextResponseError(blockReason);
  }

  const candidate = data?.candidates?.[0];
  if (!candidate) {
    throw new GeminiTextResponseError('NO_CANDIDATES');
  }

  const finishReason = candidate.finishReason;
  const successfulFinishReasons = new Set([
    undefined,
    'FINISH_REASON_UNSPECIFIED',
    'STOP',
    'MAX_TOKENS',
  ]);
  if (!successfulFinishReasons.has(finishReason)) {
    throw new GeminiTextResponseError(finishReason, candidate.finishMessage);
  }

  const parts = candidate.content?.parts || [];
  const content = parts.flatMap((part, index) => {
    if (typeof part.text === 'string' && part.text !== '') {
      return [{
        type: 'text',
        text: part.text,
        ...(part.thoughtSignature ? { thought_signature: part.thoughtSignature } : {}),
      }];
    }
    if (part.functionCall) {
      return [{
        type: 'tool_use',
        id: part.functionCall.id || `gemini-tool-${index}`,
        name: part.functionCall.name,
        input: part.functionCall.args || {},
        ...(part.thoughtSignature ? { thought_signature: part.thoughtSignature } : {}),
      }];
    }
    return [];
  });
  const stopReason =
    finishReason === 'MAX_TOKENS'
      ? 'max_tokens'
      : content.some((part) => part.type === 'tool_use')
        ? 'tool_use'
        : 'end_turn';
  const usage = toUsage(data?.usageMetadata);
  return { content, stop_reason: stopReason, ...(usage ? { usage } : {}) };
}

// Geminiのトークン内訳。systemブロックはセッション中不変なので、暗黙キャッシュが
// 効いていれば cached_input_tokens が input_tokens の大半を占めるはずで、0が続くなら
// 効いていない。それを見ずに削減策を選ぶと当て推量になるため、まず観測できるようにする。
// usageMetadata自体が無いレスポンス(古いAPI・テストの簡易スタブ)ではundefinedを返す。
function toUsage(meta) {
  if (!meta || typeof meta !== 'object') return undefined;
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const input = num(meta.promptTokenCount);
  const cached = num(meta.cachedContentTokenCount);
  return {
    input_tokens: input,
    output_tokens: num(meta.candidatesTokenCount),
    cached_input_tokens: cached,
    thoughts_tokens: num(meta.thoughtsTokenCount),
    total_tokens: num(meta.totalTokenCount),
    // 入力のうちキャッシュから読まれた割合。削減策の効果はここで測る。
    cache_hit_ratio: input > 0 ? Number((cached / input).toFixed(3)) : 0,
  };
}

export class GeminiTextResponseError extends Error {
  constructor(reason, detail = '') {
    const suffix = detail ? ` ${String(detail).slice(0, 200)}` : '';
    super(`upstream response failed: ${reason || 'UNKNOWN'}${suffix}`);
    this.name = 'GeminiTextResponseError';
    this.reason = reason || 'UNKNOWN';
  }
}

export class GeminiTextApiError extends Error {
  constructor(status, body) {
    super(`upstream request failed: ${status} ${body.slice(0, 200)}`);
    this.name = 'GeminiTextApiError';
    this.status = status;
  }
}

export async function generateText({
  apiKey,
  model,
  request,
  fetchImpl = fetch,
  timeoutMs,
}) {
  const upstream = await fetchImpl(
    `${GEMINI_TEXT_ENDPOINT}/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildGeminiTextRequest(request)),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    },
  );
  if (!upstream.ok) {
    const body = await upstream.text().catch(() => '');
    throw new GeminiTextApiError(upstream.status, body);
  }
  return toCompatibleTextResponse(await upstream.json());
}
