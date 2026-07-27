import { generateText } from './textProvider.js';

const NAMING_TIMEOUT_MS = 60000;
const NAMING_MAX_TOKENS = 4096;

// 結末付近の地の文を何件渡すか。全文を渡すと長大なセッションで無駄が大きく、
// 物語全体は history_summary が担うため、締めくくりの雰囲気を拾える程度に絞る。
const CLOSING_NARRATION_COUNT = 4;

const ENDING_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ending_title', 'summary'],
    properties: {
      ending_title: { type: 'string', description: 'エンディングタイトル(20字程度)' },
      summary: {
        type: 'string',
        description: '常体(だ・である調)で統一した物語の総括(2〜3文)。です・ます調は使わない',
      },
    },
  },
};

const SYSTEM_PROMPT =
  'あなたはTRPGのGM。1つの物語が結末を迎えた。この物語に相応しいエンディングタイトルと短い総括を付けよ。タイトルは20字程度の日本語で、結末を象徴する簡潔なもの。総括は2〜3文で、何が起きどう終わったかを物語の語り口で書く。総括の地の文は必ず常体(だ・である調。体言止め・用言止め可)で統一し、入力された物語要約や結末付近の地の文が敬体でも、です・ます調へ変えないこと。ゲーム的表現(フラグのキー名・数値・選択肢)や、物語内で明かされなかった秘密は書かないこと。';

function extractText(content) {
  return (content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function buildUserContent(session) {
  const closing = (session.log || [])
    .filter((e) => e.role === 'gm')
    .slice(-CLOSING_NARRATION_COUNT)
    .map((e) => e.text)
    .join('\n');
  const pc = [session.pc?.raw, session.pc?.goal && `goal: ${session.pc.goal}`, session.pc?.bonds && `bonds: ${session.pc.bonds}`]
    .filter(Boolean)
    .join('\n');
  return `# PC\n${pc || '(未設定)'}\n\n# 物語要約\n${session.state?.history_summary || '(なし)'}\n\n# 結末付近の地の文\n${closing || '(なし)'}`;
}

function supportsThinkingLevel(model) {
  return /^gemini-3(?:[.-]|$)/i.test(String(model || ''));
}

export async function nameEnding({ session, apiKey, model, fetchImpl = fetch }) {
  const data = await generateText({
    apiKey,
    model,
    fetchImpl,
    timeoutMs: NAMING_TIMEOUT_MS,
    request: {
      // Gemini 3.xでは思考トークンも出力上限を消費する。短いJSON生成に十分な
      // 余裕を持たせ、対応モデルでは思考を最小化して本文前の打ち切りを防ぐ。
      max_tokens: NAMING_MAX_TOKENS,
      ...(supportsThinkingLevel(model) ? { thinking_level: 'minimal' } : {}),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent(session) }],
      output_config: { format: ENDING_OUTPUT_FORMAT },
    },
  });
  if (data.stop_reason === 'max_tokens') {
    // 長い総括が途中で切れるとJSONとして壊れる。そのままだと
    // 下のJSON.parse失敗経路に落ちて「invalid JSON」としか出ず、原因が truncation
    // だと分からない(server/novelJobs.jsのrun()と同じ判定を踏襲する)。
    throw new Error('ending naming was truncated (max_tokens)');
  }
  let parsed;
  try {
    parsed = JSON.parse(extractText(data.content));
  } catch {
    throw new Error('ending naming produced invalid JSON');
  }
  const endingTitle = typeof parsed?.ending_title === 'string' ? parsed.ending_title.trim() : '';
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
  if (!endingTitle) throw new Error('ending naming produced an empty title');
  return { endingTitle, summary };
}
