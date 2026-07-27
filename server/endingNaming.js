import { generateText } from './textProvider.js';

const NAMING_TIMEOUT_MS = 60000;

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
      summary: { type: 'string', description: '物語の総括(2〜3文)' },
    },
  },
};

const SYSTEM_PROMPT =
  'あなたはTRPGのGM。1つの物語が結末を迎えた。この物語に相応しいエンディングタイトルと短い総括を付けよ。タイトルは20字程度の日本語で、結末を象徴する簡潔なもの。総括は2〜3文で、何が起きどう終わったかを物語の語り口で書く。ゲーム的表現(フラグのキー名・数値・選択肢)や、物語内で明かされなかった秘密は書かないこと。';

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

export async function nameEnding({ session, apiKey, model, fetchImpl = fetch }) {
  const data = await generateText({
    apiKey,
    model,
    fetchImpl,
    timeoutMs: NAMING_TIMEOUT_MS,
    request: {
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserContent(session) }],
      output_config: { format: ENDING_OUTPUT_FORMAT },
    },
  });
  if (data.stop_reason === 'max_tokens') {
    // max_tokens: 500で長い総括が途中で切れるとJSONとして壊れる。そのままだと
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
