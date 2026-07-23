import { callClaude, extractText, parseJsonLoose } from './client.js';

const SHEET_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['goal', 'bonds'],
    properties: {
      goal: {
        type: 'string',
        description: 'このキャラクターが物語を通じて達成したいこと(記載がなければ空文字列)',
      },
      bonds: {
        type: 'string',
        description: '他PC/NPC/世界との因縁・関係(記載がなければ空文字列)',
      },
    },
  },
};

export async function parseCharacterSheet(raw) {
  const data = await callClaude({
    model: 'claude-sonnet-5',
    max_tokens: 1000,
    thinking: { type: 'disabled' },
    output_config: { format: SHEET_OUTPUT_FORMAT },
    system: '以下のキャラクターシートから goal(目標)・bonds(因縁・関係)を抽出せよ。',
    messages: [{ role: 'user', content: raw }],
  });
  const text = extractText(data.content);
  const parsed = parseJsonLoose(text);
  return {
    goal: parsed.goal || '',
    bonds: parsed.bonds || '',
  };
}
