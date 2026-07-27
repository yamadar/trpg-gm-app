import { generateText } from './textProvider.js';

const SCENARIO_ANALYSIS_TIMEOUT_MS = 120000;

export const SCENARIO_DIRECTOR_GUIDE_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'summary',
      'player_goal',
      'opening_hook',
      'phases',
      'branches',
      'climax',
      'endings',
      'ending_signals',
      'fail_forward',
    ],
    properties: {
      summary: {
        type: 'string',
        description: 'シナリオ全体の真相と進行をGM向けに短く要約したもの',
      },
      player_goal: {
        type: 'string',
        description: 'プレイヤーが物語上達成すべき主目的',
      },
      opening_hook: {
        type: 'string',
        description: '冒頭でPCを最初の行動へ誘導する状況',
      },
      phases: {
        type: 'array',
        description: '想定進行順のフェーズ。原文に章が無くても進行上のまとまりへ整理する',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'purpose',
            'key_events',
            'clues',
            'completion_conditions',
            'next_phase_guidance',
          ],
          properties: {
            title: { type: 'string' },
            purpose: { type: 'string' },
            key_events: { type: 'array', items: { type: 'string' } },
            clues: { type: 'array', items: { type: 'string' } },
            completion_conditions: { type: 'array', items: { type: 'string' } },
            next_phase_guidance: { type: 'string' },
          },
        },
      },
      branches: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['condition', 'guidance'],
          properties: {
            condition: { type: 'string' },
            guidance: { type: 'string' },
          },
        },
      },
      climax: {
        type: 'object',
        additionalProperties: false,
        required: ['trigger', 'required_setup', 'resolution_choices'],
        properties: {
          trigger: { type: 'string' },
          required_setup: { type: 'array', items: { type: 'string' } },
          resolution_choices: { type: 'array', items: { type: 'string' } },
        },
      },
      endings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'conditions', 'outcome'],
          properties: {
            title: { type: 'string' },
            conditions: { type: 'array', items: { type: 'string' } },
            outcome: { type: 'string' },
          },
        },
      },
      ending_signals: {
        type: 'array',
        description: '満たされたらエンディングを描写しending_reached=trueにすべき条件',
        items: { type: 'string' },
      },
      fail_forward: {
        type: 'string',
        description: '停滞時に原文を壊さず次の重要場面へ進める方法',
      },
    },
  },
};

const SYSTEM = `あなたはTRPGシナリオをセッション中のAI GMが運用しやすい進行ガイドへ整理する編集者。

# 最重要ルール
- 入力されたシナリオ原文だけを根拠にする。原文にない人物、真相、事件、必須条件、結末を創作しない。
- 原文は別途source of truthとして保存される。原文を書き換えず、進行判断に必要な構造だけを抽出・整理する。
- 原文が曖昧な箇所は断定せず「原文に明示なし」と書く。
- 秘密や真相を含め、GMが進行判断に必要な情報を落とさない。
- 特に「何を目指すか」「次にどこへ誘導するか」「クライマックスへ入る条件」「いつ物語を終えるか」を明確にする。
- endingsとending_signalsには、原文から判断できる終了条件と終了後の状態を具体的に書く。
- 原文に明示的な結末がない場合も、原文内の主目的・対立・最終局面が解決済みと判断できる条件を整理する。ただし新しい結末は作らない。
- phasesは進行順に並べる。分岐型なら共通導入の後、branchesで分岐先を示す。
- 手掛かりを一度の失敗で失わせて進行不能にしない。原文に代替手段があればfail_forwardへ整理する。なければ「原文に代替手段の明示なし」と書く。`;

function extractText(content) {
  return (content || [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

export async function analyzeScenarioForPlay({
  title,
  raw,
  apiKey,
  model,
  fetchImpl = fetch,
}) {
  if (!apiKey || !model) throw new Error('scenario analysis is not configured');
  const data = await generateText({
    apiKey,
    model,
    fetchImpl,
    timeoutMs: SCENARIO_ANALYSIS_TIMEOUT_MS,
    request: {
      max_tokens: 5000,
      system: SYSTEM,
      output_config: { format: SCENARIO_DIRECTOR_GUIDE_FORMAT },
      messages: [
        {
          role: 'user',
          content: `# シナリオタイトル\n${title || '(無題)'}\n\n# シナリオ原文(source of truth)\n${raw}`,
        },
      ],
    },
  });
  if (data.stop_reason === 'max_tokens') {
    throw new Error('scenario analysis was truncated');
  }
  const guide = JSON.parse(extractText(data.content));
  return { schemaVersion: 1, ...guide };
}
