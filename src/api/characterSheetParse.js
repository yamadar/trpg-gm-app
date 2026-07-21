import { callClaude, extractText, parseJsonLoose } from './client.js';

export async function parseCharacterSheet(raw) {
  const data = await callClaude({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    system: `以下のキャラクターシートから goal(目標)・bonds(因縁・関係)を抽出せよ。

# 出力形式(厳守)
説明文やコードブロック記号を一切付けず、次のJSONのみを出力すること:
{"goal": "このキャラクターが物語を通じて達成したいこと(記載がなければ空文字列)", "bonds": "他PC/NPC/世界との因縁・関係(記載がなければ空文字列)"}`,
    messages: [{ role: 'user', content: raw }],
  });
  const text = extractText(data.content);
  const parsed = parseJsonLoose(text);
  return {
    goal: parsed.goal || '',
    bonds: parsed.bonds || '',
  };
}
