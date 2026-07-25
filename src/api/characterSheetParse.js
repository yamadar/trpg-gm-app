import { callClaude, extractText, parseJsonLoose } from './client.js';

// 抽出スキーマを変えたらこの値を上げる。characterSheetCache がハッシュに混ぜており、
// 既存の parsed キャッシュが無効化されて次回使用時に一度だけ解析し直される。
// v2: name(キャラクター名)を追加。
export const SHEET_PARSE_VERSION = 2;

const SHEET_OUTPUT_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'goal', 'bonds'],
    properties: {
      name: {
        type: 'string',
        description: 'このキャラクターの名前(記載がなければ空文字列)',
      },
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
    system: '以下のキャラクターシートから name(名前)・goal(目標)・bonds(因縁・関係)を抽出せよ。',
    messages: [{ role: 'user', content: raw }],
  });
  const text = extractText(data.content);
  const parsed = parseJsonLoose(text);
  return {
    name: parsed.name || '',
    goal: parsed.goal || '',
    bonds: parsed.bonds || '',
  };
}
